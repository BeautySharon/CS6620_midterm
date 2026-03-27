#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { StorageStack } from "../lib/storage-stack";
import { ReplicatorStack } from "../lib/replicator-stack";
import { CleanerStack } from "../lib/cleaner-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-west-2",
};

const storageStack = new StorageStack(app, "ObjectBackupStorageStack", {
  env,
});

new ReplicatorStack(app, "ObjectBackupReplicatorStack", {
  env,
  srcBucket: storageStack.srcBucket,
  dstBucket: storageStack.dstBucket,
  table: storageStack.table,
});

new CleanerStack(app, "ObjectBackupCleanerStack", {
  env,
  dstBucket: storageStack.dstBucket,
  table: storageStack.table,
});
