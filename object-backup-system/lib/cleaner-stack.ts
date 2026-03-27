import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";

export interface CleanerStackProps extends cdk.StackProps {
  dstBucket: s3.Bucket;
  table: dynamodb.Table;
}

export class CleanerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CleanerStackProps) {
    super(scope, id, props);

    const cleanerFn = new lambdaNodejs.NodejsFunction(this, "CleanerFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: "lambda/cleaner/index.ts",
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
        STATUS_INDEX_NAME: "status-disownedAt-index",
        DISOWNED_AGE_SECONDS: "10",
      },
    });

    props.dstBucket.grantDelete(cleanerFn);
    props.table.grantReadWriteData(cleanerFn);

    new events.Rule(this, "CleanerSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(cleanerFn)],
    });

    new cdk.CfnOutput(this, "CleanerFunctionName", {
      value: cleanerFn.functionName,
    });
  }
}
