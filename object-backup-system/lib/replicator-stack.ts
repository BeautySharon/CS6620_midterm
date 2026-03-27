import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";

export interface ReplicatorStackProps extends cdk.StackProps {
  srcBucket: s3.Bucket;
  dstBucket: s3.Bucket;
  table: dynamodb.Table;
}

export class ReplicatorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ReplicatorStackProps) {
    super(scope, id, props);

    const replicatorFn = new lambdaNodejs.NodejsFunction(this, "ReplicatorFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: "lambda/replicator/index.ts",
      handler: "handler",
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      bundling: {
        minify: true,
        sourceMap: true,
      },
      environment: {
        DST_BUCKET_NAME: props.dstBucket.bucketName,
        TABLE_NAME: props.table.tableName,
        MAX_COPIES: "3",
      },
    });

    props.srcBucket.grantRead(replicatorFn);
    props.dstBucket.grantReadWrite(replicatorFn);
    props.table.grantReadWriteData(replicatorFn);

    new events.Rule(this, "ReplicatorS3EventRule", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created", "Object Deleted"],
        detail: {
          bucket: {
            name: [props.srcBucket.bucketName],
          },
        },
      },
      targets: [new targets.LambdaFunction(replicatorFn)],
    });

    new cdk.CfnOutput(this, "ReplicatorFunctionName", {
      value: replicatorFn.functionName,
    });
  }
}
