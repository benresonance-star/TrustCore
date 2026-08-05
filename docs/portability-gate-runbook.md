# Release 0.2 portability gate runbook

## Purpose

The 0.2H gate proves a live, authorized export from PostgreSQL and MinIO,
durable handoff after source destruction, clean-store reconstruction, strict
hostile-archive rejection, offline viewer operation, and process-level import
resumption at every declared checkpoint.

Managed archive signatures and external OIDC/MFA are not part of this local
profile. The gate enables the explicitly local unsigned profile and uses the
same-principal bootstrap re-authentication boundary.

## Run

Start from an exact clean commit with Docker available:

```powershell
corepack pnpm@10.15.0 install --frozen-lockfile
corepack pnpm@10.15.0 trust:test:portability:docker
```

The runner uses only the existing `trust-core` Compose project and starts its
existing PostgreSQL and MinIO services if needed. It creates two databases and
two buckets whose names include a random run ID. The test removes only those
four run-scoped resources. It never runs Compose down, volume removal, pruning,
or shared bucket/database reset.

## Evidence and failure

Every run writes:

- `reports/release-0.2-portability-gate.json`
- `reports/release-0.2-portability-gate.md`

Reports contain the exact Git SHA, initial clean-tree result, environment
versions, stage outcomes and sanitized failure summaries. They contain no
tokens, archive bytes, canonical content, database URLs, or object-storage
credentials. A dirty tree or any failed stage exits nonzero and cannot print
`TRUST TEST: PASS`.

Checkpoint 0.2H is complete only after this command succeeds on the exact clean,
committed candidate SHA and its reports are retained as release evidence.

## Narrow cleanup after an interrupted test

The test's finalizer normally removes its own databases and buckets. If the
process is externally killed, obtain the run ID from the test process
environment or console prefix and remove only:

```text
trust_port_src_<run-id>
trust_port_dst_<run-id>
trust-port-src-<run-id>
trust-port-dst-<run-id>
```

Do not use `docker compose down --volumes`, `docker system prune`, broad MinIO
deletion, or a shared PostgreSQL reset for portability-gate cleanup.
