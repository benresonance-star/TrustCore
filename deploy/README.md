# Service deployment

Trust Core production services are deployed separately:

- `Dockerfile.api` runs the public Trust API;
- `Dockerfile.worker` runs reconciliation and durable background work;
- managed PostgreSQL is authoritative for metadata;
- Amazon S3 or another approved immutable adapter stores canonical objects;
- Vercel hosts only the static Control Centre defined by `vercel.json`.

Build images from the repository root:

```powershell
docker build -f deploy/Dockerfile.api -t trust-core-api .
docker build -f deploy/Dockerfile.worker -t trust-core-worker .
```

The API requires production database, object-storage, identity and secret
configuration documented in `.env.example` and
`docs/production-deployment.md`. The worker uses a distinct database role and
storage identity. Do not give either container migration-owner, backup,
replication or key-administration credentials.

### Minimal object-storage IAM (Amazon S3)

Credentials stay on the API/worker host (env, instance profile, or IRSA). Control
Centre diagnoses connectivity and deep-links to the provider console; it never
accepts storage secrets.

Grant the API/worker role only the actions needed for Trust Core object
lifecycle. Prefer **resource ARNs** scoped to one bucket and the workspace
prefix (adjust names):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BucketConnectivity",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::YOUR_BUCKET"]
    },
    {
      "Sid": "ObjectLifecycle",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": ["arn:aws:s3:::YOUR_BUCKET/workspaces/*"]
    },
    {
      "Sid": "MultipartList",
      "Effect": "Allow",
      "Action": ["s3:ListBucketMultipartUploads"],
      "Resource": ["arn:aws:s3:::YOUR_BUCKET"]
    }
  ]
}
```

Notes:

- Connectivity probes use **`HeadBucket`**, which requires `s3:ListBucket` on
  the bucket ARN. AWS recommends HeadBucket over `GetBucketLocation` for region
  discovery; Trust Core compares `x-amz-bucket-region` to `TRUST_STORAGE_REGION`.
- Optional: set `TRUST_STORAGE_EXPECTED_BUCKET_OWNER` to the AWS account id to
  send `ExpectedBucketOwner` on HeadBucket.
- Optional: set `TRUST_STORAGE_SESSION_TOKEN` when using temporary static keys.
- When SSE-KMS is enabled, also allow `kms:Encrypt`, `kms:Decrypt`, and
  `kms:GenerateDataKey` on the CMK used by the bucket.
- Tier B “Test upload path” requires owner/admin (`storage:probe_ingest`); it
  writes and deletes a temporary object under `workspaces/.../temporary/`.

### BYOB customer role (application-tenant bindings)

For cross-account Bring Your Own Bucket bindings (ADR-016):

1. Trust Core generates a per-binding **ExternalId** (server-only; one-time reveal
   on create). Never put ExternalId in connection packs or browser health GET.
2. Customer trust policy **must** require `sts:ExternalId`. Roles assumable
   without ExternalId are rejected (confused-deputy hardening).
3. Customer provides `roleArn`, `bucket`, `region`, and `ExpectedBucketOwner`
   (AWS account id). Trust Core probes with ExpectedBucketOwner and refuses
   Connected until Tier A connectivity succeeds.
4. Prefer prefix-scoped IAM on the customer bucket (or exclusive bucket). Sample
   trust-policy condition:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<TRUST_ACCOUNT_ID>:root" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "<TRUST_ISSUED_EXTERNAL_ID>"
        }
      }
    }
  ]
}
```

Configure the static Control Centre with:

```text
VITE_TRUST_API_BASE=https://trust-api.example.com
VITE_TRUST_WORKSPACE_ID=<authorised-workspace-id>
```

The API must explicitly allow the Control Centre origin at the production
ingress. Browser cookies require HTTPS and same-site deployment or an approved
cross-site cookie design. Never point a production SPA at fixture mode.
