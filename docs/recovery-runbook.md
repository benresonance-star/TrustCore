# Release 0.1 recovery runbook

This runbook covers the local PostgreSQL and MinIO implementation. Read it with
the [threat model](../contracts/threat-model.md),
[retention policy](../contracts/retention-policy.md) and
[Docker gate runbook](./docker-gate-runbook.md).

No recovery is successful until operation state, hashes, relationships and the
audit chain verify. A process restart or a successful database import alone is
not recovery evidence.

## Safety and prerequisites

- Use an isolated Trust Core Compose project and local-only credentials from an
  ignored `.env`.
- Do not run fault injection against shared or production data.
- Do not use `docker system prune`, `docker volume prune`, or commands that
  enumerate and delete unrelated resources.
- Record source revision, operator, timestamps, command output and generated
  report paths. Inspect reports for secrets before sharing.

Install dependencies, start the stores, apply migrations and provision roles:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npx --yes pnpm@10.15.0 install --frozen-lockfile
npx --yes pnpm@10.15.0 docker:up
npx --yes pnpm@10.15.0 --filter @trust-core/api db:migrate
npx --yes pnpm@10.15.0 --filter @trust-core/api db:provision
npx --yes pnpm@10.15.0 --filter @trust-core/api db:seed-demo
```

## Drill 1: interrupted ingest and idempotent resume

This is the executable Release 0.1 cross-store recovery drill. The test starts
the live API, terminates it with exit code 86 after every declared ingest
checkpoint, restarts it, and retries the same idempotency key:

```powershell
$env:TRUST_DOCKER_TESTS = "1"
npx --yes pnpm@10.15.0 --filter @trust-core/api test:interruption:docker
Remove-Item Env:TRUST_DOCKER_TESTS
```

Pass criteria:

- every interrupted operation resumes to `completed`;
- the operation ID is unchanged on retry;
- all checkpoints appear exactly once in the durable result;
- exactly one audit event and one outbox event refer to the operation.

The checkpoints are `authorised`, `temporary_upload_created`,
`bytes_received`, `hash_verified`, `immutable_object_committed`,
`metadata_committed`, `audit_committed`, and `completed`. This drill includes
the case where canonical bytes exist before the metadata transaction commits.

## Drill 2: live verification and append-only restore

Run the live API integration drill:

```powershell
$env:TRUST_DOCKER_TESTS = "1"
npx --yes pnpm@10.15.0 --filter @trust-core/api test:docker
Remove-Item Env:TRUST_DOCKER_TESTS
```

It ingests bytes, performs `full_blob` verification, reads the bytes back,
creates a revision, logically deletes the resource, restores it as a newer
revision, and proves the pre-delete revision still exists. Pass requires a
`passed` verification report with the expected byte count and no issues.

The same verification engine reports a critical
`BLOB_MISSING_OR_INACCESSIBLE` issue when metadata references an absent object
and `AUDIT_CHAIN_INVALID` when chained event hashes do not verify. The
non-destructive detector tests are:

```powershell
npx --yes pnpm@10.15.0 --filter @trust-core/verification test
```

Do not prove missing-object detection by deleting a canonical object from a
shared bucket.

## Drill 3: worker lease and quarantine recovery

Prove that stale workers cannot complete another worker's lease, retries are
bounded, terminal events are quarantined, and an incident is recorded:

```powershell
$env:POSTGRES_INTEGRATION = "1"
npx --yes pnpm@10.15.0 --filter @trust-core/persistence-postgres test:docker
Remove-Item Env:POSTGRES_INTEGRATION
```

For normal backlog processing, start the worker with its dedicated URL:

```powershell
$env:DATABASE_URL = $env:TRUST_WORKER_DATABASE_URL
npx --yes pnpm@10.15.0 --filter @trust-core/worker run-once
```

Inspect unresolved incidents and pending/quarantined events using an approved
operator connection. Do not give the worker dataset privileges to clear an
incident; correct the storage or metadata condition, then replay through an
idempotent handler.

## Drill 4: complete Release 0.1 gate

Run all real-store stages and preserve the generated reports:

```powershell
npx --yes pnpm@10.15.0 trust:test:docker
```

Success prints `TRUST TEST: PASS` and writes
`reports/release-0.1-docker-gate.json` and `.md`. The gate includes migrations,
role/RLS checks, MinIO adapter checks, the live API/worker flow and the complete
process-interruption drill.

## PostgreSQL logical restore rehearsal

Release 0.1 provisions `trust_backup_restore`, but the repository does not
provide production backup scheduling, encryption, transfer, retention or
restore orchestration. The following is only a local PostgreSQL logical-copy
rehearsal inside the Compose container:

```powershell
docker compose exec -T postgres pg_dump -U trust_admin -d trust_core -Fc -f /tmp/trust-core-release-01.dump
docker compose exec -T postgres dropdb -U trust_admin --if-exists trust_core_restore_drill
docker compose exec -T postgres createdb -U trust_admin trust_core_restore_drill
docker compose exec -T postgres pg_restore -U trust_admin -d trust_core_restore_drill --exit-on-error /tmp/trust-core-release-01.dump
docker compose exec -T postgres psql -U trust_admin -d trust_core_restore_drill -v ON_ERROR_STOP=1 -c "SELECT count(*) AS revisions FROM revisions; SELECT count(*) AS audit_events FROM audit_events;"
docker compose exec -T postgres dropdb -U trust_admin trust_core_restore_drill
docker compose exec -T postgres rm -f /tmp/trust-core-release-01.dump
```

This proves that one local PostgreSQL logical dump can be imported into a
scratch database. It does not restore MinIO bytes, verify a production recovery
point, prove off-site durability, or run Trust Core's full verification against
the scratch database. Production backup and end-to-end database-plus-object
restore remain deferred operational capabilities.

## Unsupported recovery claims

- `.trustarchive` export/import and dataset reconstruction are Release 0.2.
- Physical purge and recovery after purge do not exist in Release 0.1.
- Local named volumes are not backups.
- The Docker gate does not prove media failure, region loss, provider object
  lock, replication, production secret recovery or production OIDC recovery.

Stop while retaining volumes with `npx --yes pnpm@10.15.0 docker:down`. Use
`npx --yes pnpm@10.15.0 docker:reset` only after reviewing the Compose project
name and only when deletion of this isolated drill's named volumes is intended.
