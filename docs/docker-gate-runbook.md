# Release 0.1 Docker gate runbook

This runbook is for the isolated local Trust Core PostgreSQL and MinIO stack.
It must not be adapted into commands that remove unrelated Docker resources.

## Prerequisites

- Docker Desktop is running Linux containers.
- Node.js is installed.
- The package-manager version in the root `packageManager` field is used.
- `.env` exists locally from `.env.example` and contains newly generated,
  local-only credentials.

Never commit `.env`, access keys, database URLs, tokens, cookies, generated
runtime reports containing secrets, or Docker volume contents.

## Baseline

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npx --yes pnpm@10.15.0 install --frozen-lockfile
npx --yes pnpm@10.15.0 typecheck
npx --yes pnpm@10.15.0 test
npx --yes pnpm@10.15.0 --filter @trust-core/control-centre build
npx --yes pnpm@10.15.0 trust:test
```

The last command may print only:

```text
TRUST TEST CANDIDATE: PASS (service adapters; Docker gate pending)
```

## Start and inspect

Use the repository Docker scripts documented by `pnpm run`. They start both
services, wait for health, and initialize the configured bucket idempotently.

```powershell
npx --yes pnpm@10.15.0 docker:up
npx --yes pnpm@10.15.0 docker:check
docker compose ps
```

Do not continue if PostgreSQL, MinIO, or bucket initialization is unhealthy.

## Migrate and seed

```powershell
npx --yes pnpm@10.15.0 --filter @trust-core/api db:migrate
npx --yes pnpm@10.15.0 --filter @trust-core/api db:seed-demo
```

Migration is deliberately safe to rerun. A checksum mismatch for an already
applied migration is a failure that must be investigated, never bypassed.

## Run the gate

```powershell
npx --yes pnpm@10.15.0 trust:test:docker
```

The runner owns unique test identifiers and cleans only resources created by
that run. Success exits zero and prints `TRUST TEST: PASS`. Failure exits
non-zero, prints `TRUST TEST: FAIL`, and writes:

- `reports/release-0.1-docker-gate.json`
- `reports/release-0.1-docker-gate.md`

Reports are diagnostic artifacts. Inspect them before sharing and confirm they
contain no secrets.

## Run services manually

```powershell
npx --yes pnpm@10.15.0 --filter @trust-core/api dev
npx --yes pnpm@10.15.0 --filter @trust-core/worker run-once
```

The API health response must say `mode: live`. `mode: fixture` is not Docker
gate evidence.

## Diagnose

```powershell
docker compose ps
docker compose logs postgres
docker compose logs minio
docker compose logs minio-init
```

Check the failing report stage before rerunning. Do not weaken RLS, triggers,
hash checks, immutability, lease ownership, or failure assertions to make a
stage pass.

## Stop or reset

Stopping retains named volumes for restart tests:

```powershell
npx --yes pnpm@10.15.0 docker:down
```

The repository reset command removes only the Compose project containers and
the Trust Core named volumes. Review its resolved Compose project name before
running it:

```powershell
npx --yes pnpm@10.15.0 docker:reset
```

Never use broad commands such as `docker system prune`, `docker volume prune`,
or scripts that enumerate and delete unrelated databases, buckets, containers,
or volumes.
