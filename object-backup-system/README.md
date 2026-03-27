# Object Backup System

This CDK project creates:

- `Bucket Src` for source objects
- `Bucket Dst` for replicated backup copies
- `Table T` in DynamoDB for source-to-copy mappings
- `Replicator` Lambda triggered by source bucket PUT and DELETE events
- `Cleaner` Lambda triggered every 1 minute by EventBridge

## Table design

### Primary key
- `src_key` (partition key)
- `copy_created_at` (sort key)

Each DynamoDB item represents **one copy** of one source object.

### Attributes
- `copy_key`
- `status` = `OWNED` or `DISOWNED`
- `disowned_at`

### GSI
- Index name: `status-disownedAt-index`
- Partition key: `status`
- Sort key: `disowned_at`

This lets Cleaner find expired disowned copies using **Query**, not **Scan**.

## Behavior

### Replicator on PUT
1. Copy source object into destination bucket with a timestamped name
2. Write the mapping into DynamoDB
3. Query all copies for that source object
4. If there are more than 3 copies, delete the oldest extras from S3 and DynamoDB

### Replicator on DELETE
1. Query all copies for the deleted source object
2. Mark them `DISOWNED`
3. Set `disowned_at = now`
4. Do not delete the copies yet

### Cleaner every minute
1. Query the GSI for records where:
   - `status = DISOWNED`
   - `disowned_at <= now - 10 seconds`
2. Delete those copies from Bucket Dst
3. Delete those mapping items from DynamoDB

## Deploy

Install dependencies:

```bash
npm install
```

Bootstrap CDK if needed:

```bash
cdk bootstrap
```

Deploy all stacks:

```bash
npm run deploy
```

## Test flow

### 1. Upload one object
Upload `MyObj.txt` to `Bucket Src`.

Expected:
- one backup copy appears in `Bucket Dst`
- one DynamoDB item is created

### 2. Upload same object multiple times
Upload the same object 4 or 5 times.

Expected:
- only the latest 3 copies remain in `Bucket Dst`
- only 3 DynamoDB items remain for that `src_key`

### 3. Delete source object
Delete `MyObj.txt` from `Bucket Src`.

Expected:
- destination copies remain for now
- DynamoDB records become `DISOWNED`

### 4. Wait for Cleaner
Wait at least one minute.

Expected:
- disowned copies older than 10 seconds are deleted from `Bucket Dst`
- their DynamoDB records are removed

## Notes

- No DynamoDB Scan is used.
- All infrastructure is created by CDK.
- Buckets are configured with `RemovalPolicy.DESTROY` and `autoDeleteObjects: true` for easier lab cleanup. Change these for production.


## Important fix

The source bucket uses EventBridge-based S3 events to avoid a cross-stack dependency cycle between the storage stack and the replicator stack.
