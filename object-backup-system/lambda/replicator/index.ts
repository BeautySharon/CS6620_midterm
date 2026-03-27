import {
  DeleteObjectCommand,
  S3Client,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Event } from "aws-lambda";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const DST_BUCKET_NAME = mustGetEnv("DST_BUCKET_NAME");
const TABLE_NAME = mustGetEnv("TABLE_NAME");
const MAX_COPIES = Number(process.env.MAX_COPIES ?? "3");

type BackupItem = {
  src_key: string;
  copy_created_at: number;
  copy_key: string;
  status: "OWNED" | "DISOWNED" | "PURGED";
  disowned_at: number;
  deleted_at?: number;
};

type EventBridgeS3Event = {
  source?: string;
  "detail-type"?: string;
  detail?: {
    bucket?: {
      name?: string;
    };
    object?: {
      key?: string;
    };
    reason?: string;
    deletionType?: string;
  };
};

export const handler = async (event: S3Event | EventBridgeS3Event): Promise<void> => {
  console.log("Received event:", JSON.stringify(event));

  if ("Records" in event && Array.isArray(event.Records)) {
    for (const record of event.Records) {
      const eventName = record.eventName;
      const srcKey = decodeS3Key(record.s3.object.key);
      const srcBucket = record.s3.bucket.name;

      if (eventName.startsWith("ObjectCreated:")) {
        await handlePut(srcBucket, srcKey);
      } else if (eventName.startsWith("ObjectRemoved:")) {
        await handleDelete(srcKey);
      } else {
        console.log(`Skipping unsupported event: ${eventName}`);
      }
    }
    return;
  }

  const detailType = event["detail-type"];
  const srcBucket = event.detail?.bucket?.name;
  const srcKeyRaw = event.detail?.object?.key;

  if (!detailType || !srcBucket || !srcKeyRaw) {
    console.log("Skipping event with missing EventBridge S3 details.");
    return;
  }

  const srcKey = decodeS3Key(srcKeyRaw);

  if (detailType === "Object Created") {
    await handlePut(srcBucket, srcKey);
  } else if (detailType === "Object Deleted") {
    await handleDelete(srcKey);
  } else {
    console.log(`Skipping unsupported detail-type: ${detailType}`);
  }
};

async function handlePut(srcBucket: string, srcKey: string): Promise<void> {
  const now = Date.now();
  const safeKey = sanitizeKey(srcKey);
  const copyKey = `${safeKey}__${now}`;

  await s3.send(
    new CopyObjectCommand({
      Bucket: DST_BUCKET_NAME,
      Key: copyKey,
      CopySource: `${srcBucket}/${encodeURIComponent(srcKey).replace(/%2F/g, "/")}`,
      MetadataDirective: "COPY",
    })
  );

  const newItem: BackupItem = {
    src_key: srcKey,
    copy_created_at: now,
    copy_key: copyKey,
    status: "OWNED",
    disowned_at: 0,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: newItem,
      ConditionExpression:
        "attribute_not_exists(src_key) AND attribute_not_exists(copy_created_at)",
    })
  );

  const copies = await getAllCopiesForSource(srcKey);

  if (copies.length > MAX_COPIES) {
    const extras = copies.slice(0, copies.length - MAX_COPIES);
    for (const oldCopy of extras) {
      await deleteCopyAndRecord(oldCopy);
    }
  }
}

async function handleDelete(srcKey: string): Promise<void> {
  const now = Date.now();
  const copies = await getAllCopiesForSource(srcKey);

  for (const copy of copies) {
    if (copy.status === "OWNED") {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            src_key: copy.src_key,
            copy_created_at: copy.copy_created_at,
          },
          UpdateExpression: "SET #status = :status, disowned_at = :disownedAt",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":status": "DISOWNED",
            ":disownedAt": now,
          },
        })
      );
    }
  }
}

async function getAllCopiesForSource(srcKey: string): Promise<BackupItem[]> {
  let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
  const results: BackupItem[] = [];

  do {
    const response = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "src_key = :srcKey",
        ExpressionAttributeValues: {
          ":srcKey": srcKey,
        },
        ScanIndexForward: true,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    results.push(...((response.Items ?? []) as BackupItem[]));
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return results;
}

async function deleteCopyAndRecord(item: BackupItem): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: DST_BUCKET_NAME,
      Key: item.copy_key,
    })
  );

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        src_key: item.src_key,
        copy_created_at: item.copy_created_at,
      },
    })
  );
}

function sanitizeKey(key: string): string {
  return key.replace(/\//g, "__");
}

function decodeS3Key(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, " "));
}

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
