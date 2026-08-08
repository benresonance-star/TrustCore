# `@trust-core/storage-s3`

Amazon S3 adapter for Trust Core’s provider-neutral `ObjectStorage` contract.

## Boundary

- Domain and application packages depend on `@trust-core/storage` only.
- This package may use `@aws-sdk/*`. AWS types and bucket/object keys must not leak into public `/v1`, SDK, or TCAP DTOs.
- Foundation and other apps must never import this package.

## Configuration (`S3StorageConfig`)

Injected at the composition root (API/worker). The adapter does not read `process.env`.

| Field | Required | Notes |
|-------|----------|--------|
| `region` | yes | Non-empty |
| `bucket` | yes | Non-empty; server-owned |
| `endpoint` | no | MinIO/LocalStack tests |
| `forcePathStyle` | no | Default `false`; use `true` for MinIO |
| `accessKeyId` / `secretAccessKey` / `sessionToken` | no | Static creds; otherwise AWS default chain |
| `serverSideEncryption` | no | `AES256` or `aws:kms` + `keyId` |
| `objectLockRetention` | no | Optional adapter hook only — not governance policy |

Fail-closed: partial static credentials, empty region/bucket, empty KMS key id, or non-positive retention days throw `StorageError`.

### Composition-root selection

| `TRUST_STORAGE_PROVIDER` | Behaviour |
|--------------------------|-----------|
| unset / `minio` | MinIO adapter (CI/local default) |
| `s3` | `S3ObjectStorage` |

CI and `pnpm trust:test:docker` always default to MinIO. Opt into S3 only with explicit provider config. Rollback: omit `TRUST_STORAGE_PROVIDER=s3`.

Environment placeholders (composition root):

```text
TRUST_STORAGE_PROVIDER=minio
TRUST_STORAGE_ENDPOINT=http://localhost:5900
TRUST_STORAGE_REGION=us-east-1
TRUST_STORAGE_BUCKET=trust-core-local
TRUST_STORAGE_ACCESS_KEY=...
TRUST_STORAGE_SECRET_KEY=...
TRUST_STORAGE_SESSION_TOKEN=
TRUST_STORAGE_EXPECTED_BUCKET_OWNER=
TRUST_STORAGE_CONSOLE_URL=
TRUST_STORAGE_FORCE_PATH_STYLE=true
```

- `TRUST_STORAGE_SESSION_TOKEN` — optional STS session token with static keys
- `TRUST_STORAGE_EXPECTED_BUCKET_OWNER` — optional AWS account id for `ExpectedBucketOwner` on HeadBucket
- `TRUST_STORAGE_CONSOLE_URL` — optional MinIO console override (API S3 API port 9000 maps to console 9001 by default)
## Transfer sequences (internal services)

```text
Upload grant
  authenticate -> policy(object:ingest) -> resolve quarantine locator
  -> sign short-lived PUT transfer -> audit -> client-safe grant DTO

Download grant
  authenticate -> policy(blob:read) -> refuse quarantine/pending states
  -> sign short-lived GET transfer -> audit -> client-safe grant DTO

Quarantine scan
  uploaded -> scan_queued -> scanning -> accepted|rejected|manual_review|failed
  accepted -> promotion_pending -> promoted (bytes only; no revision commit)
```

Public download grants: `POST /v1/blobs/download-grants` (TCAP `blob:read` → `client.blobs.createDownloadGrant`). Signing uses `S3TransferSigner` (`@aws-sdk/s3-request-presigner`) at the composition root. Multipart transfer remains an internal `ObjectStorage` capability until a separate protocol gate approves public methods.

Composition-root grant TTL: `TRUST_TRANSFER_GRANT_MAX_TTL_SECONDS` (default `900`).


## Local tests

```bash
pnpm --filter @trust-core/storage-s3 test
pnpm --filter @trust-core/storage-s3 test:docker   # requires Compose MinIO + TRUST_DOCKER_TESTS=1
```

Optional real AWS smoke (skipped by default):

```bash
TRUST_S3_SMOKE=1 TRUST_S3_SMOKE_BUCKET=... TRUST_S3_SMOKE_REGION=... pnpm --filter @trust-core/storage-s3 test
```

Never point automated tests at an unscoped production bucket. Live contract tests use a unique `workspaces/<runId>/` prefix and delete only that prefix.
