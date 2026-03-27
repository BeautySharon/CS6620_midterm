import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";

export class StorageStack extends cdk.Stack {
  public readonly srcBucket: s3.Bucket;
  public readonly dstBucket: s3.Bucket;
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.srcBucket = new s3.Bucket(this, "BucketSrc", {
      versioned: false,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      eventBridgeEnabled: true,
    });

    this.dstBucket = new s3.Bucket(this, "BucketDst", {
      versioned: false,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.table = new dynamodb.Table(this, "TableT", {
      partitionKey: { name: "src_key", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "copy_created_at", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "status-disownedAt-index",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "disowned_at", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, "SrcBucketName", {
      value: this.srcBucket.bucketName,
    });

    new cdk.CfnOutput(this, "DstBucketName", {
      value: this.dstBucket.bucketName,
    });

    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
    });
  }
}
