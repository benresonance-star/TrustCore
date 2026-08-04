# Trust Core Platform

Trust Core is an application-independent continuity, history, integrity, recovery and portability platform.

This repository is implementing Release 0.1: the central trust loop. Checkpoint
0.1K has passed its real PostgreSQL/MinIO Docker integration gate, including
least-privilege RLS, full-byte verification, worker retry/quarantine, and
actual API process termination and restart at all eight ingest checkpoints.

## Commands

Use the `pnpm@10.15.0` version pinned in `package.json`. If the installed Node
distribution does not include Corepack, replace `pnpm` below with
`npx --yes pnpm@10.15.0`.

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm --filter @trust-core/control-centre build
pnpm trust:test
```

The source-only checkpoint deliberately prints `TRUST TEST CANDIDATE: PASS
(service adapters; Docker gate pending)`. Only `pnpm trust:test:docker` can
print `TRUST TEST: PASS`.

Explore the UI:

```powershell
pnpm --filter @trust-core/control-centre dev
```

Run the fixture API on port 4310:

```powershell
pnpm --filter @trust-core/api dev
```

Run one reconciliation batch or the continuous worker after PostgreSQL and object storage are configured:

```powershell
pnpm --filter @trust-core/worker run-once
pnpm --filter @trust-core/worker start
```

The worker requires a dedicated production database role permitted to claim cross-workspace outbox events. Ordinary application roles remain workspace-scoped and must not receive worker privileges.

Create a local `.env` from `.env.example` with newly generated local-only
credentials. Start PostgreSQL and MinIO, wait for both services, migrate, and
seed the synthetic Ivan dataset:

```powershell
pnpm infra:wait
pnpm db:migrate
pnpm db:provision
pnpm --filter @trust-core/api db:seed-demo
pnpm --filter @trust-core/api dev
```

The scoped `infra:start`, `infra:wait`, `infra:stop`, and `infra:reset`
commands only operate on this repository's Compose project. `infra:reset`
removes its named PostgreSQL and MinIO volumes. Bucket initialization is
idempotent. Run the Docker-backed migration, checksum, constraint, RLS, and
least-privilege role proofs with `pnpm db:test:postgres`; ordinary unit tests
do not require Docker.

Run the isolated Release 0.1 integration gate:

```powershell
pnpm trust:test:docker
```

Only this complete real-service gate may print `TRUST TEST: PASS`. On failure
it exits non-zero and writes sanitized JSON and Markdown diagnostics under
`reports/`. See [the Docker gate runbook](docs/docker-gate-runbook.md) for
exact start, diagnosis, restart, and narrowly scoped cleanup procedures.

The verified 0.1K gate used Docker Desktop 4.84.0, Linux engine 29.6.2,
PostgreSQL 18, and MinIO `RELEASE.2025-04-22T22-12-26Z`. It completed in
18.724 seconds. The imported source snapshot has no commit yet, so the report
records an uncommitted source snapshot rather than inventing a commit hash.

With `DATABASE_URL` present the API reports `mode: live` and reads PostgreSQL. Without it, the API deliberately reports `mode: fixture`.

Live mutation routes also require `TRUST_ADMIN_TOKEN`. The bootstrap-token exchange is a controlled development boundary, not the final production identity system; OIDC/passkey authentication, credential rotation and privileged-session controls remain a later security checkpoint.

To exercise the real HTTP gateway during local development, run the API and set `VITE_TRUST_API_BASE=/api` plus `VITE_TRUST_WORKSPACE_ID=<workspace UUID>` when starting the Control Centre. Without `VITE_TRUST_API_BASE`, the UI deliberately uses synthetic fixture data for safe visual exploration.

For production, configure `TRUST_OIDC_*` and apply migration `0004`. The Control Centre redirects to the organisation identity provider using authorization code flow with S256 PKCE. Trust Core validates issuer, audience, signature, algorithm, subject, nonce, one-use state and a separate browser-binding cookie before creating a hashed, shared PostgreSQL session. Passkeys and MFA belong at the identity provider.

The bootstrap-token flow remains available for controlled local development and emergency design work. It must not be the ordinary production sign-in path.

The Control Centre uses its typed fixture adapter unless
`VITE_TRUST_API_BASE` is set. Its HTTP gateway uses the authenticated live
history, revision, deletion, restoration, and verification command routes.

## Synthetic Ivan fixture

`@trust-core/fixtures-ivans-diary` contains no personal information. It intentionally exercises diary entries, ordered pages, a multipage sketchbook, voice-derived text, drawing and audio metadata, bookmarks, unknown-field preservation and recoverable deletion. It is test data for the same schema path real app data will later use.

## Rule

Applications must use the public API or SDK. They must never manipulate Trust Core tables or canonical storage paths directly.
