import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ScheduledHandler } from "aws-lambda";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const DST_BUCKET_NAME = mustGetEnv("DST_BUCKET_NAME");
const TABLE_NAME = mustGetEnv("TABLE_NAME");
const STATUS_INDEX_NAME = mustGetEnv("STATUS_INDEX_NAME");
const DISOWNED_AGE_SECONDS = Number(process.env.DISOWNED_AGE_SECONDS ?? "10");

type DisownedItem = {
  src_key: string;
  copy_created_at: number;
  copy_key: string;
  status: "DISOWNED";
  disowned_at: number;
};

export const handler: ScheduledHandler = async () => {
  const cutoff = Date.now() - DISOWNED_AGE_SECONDS * 1000;
  console.log(`Cleaner cutoff timestamp: ${cutoff}`);

  let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
  const expiredItems: DisownedItem[] = [];

  do {
    const response = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: STATUS_INDEX_NAME,
        KeyConditionExpression: "#status = :status AND disowned_at <= :cutoff",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": "DISOWNED",
          ":cutoff": cutoff,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    expiredItems.push(...((response.Items ?? []) as DisownedItem[]));
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Cleaner found ${expiredItems.length} expired disowned copies.`);

  for (const item of expiredItems) {
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
};

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
