# Trust Core Platform

Trust Core is an application-independent continuity, history, integrity, recovery and portability platform.

Release 0.1, the central trust loop, is complete at checkpoint 0.1L. Its
real-service proof includes least-privilege PostgreSQL RLS, immutable MinIO
storage, five-level verification, public contracts/OpenAPI/TypeScript SDK,
Ivan's Diary and WeSketch fixtures, live Control Centre API paths, worker
retry/quarantine, and actual API process termination and restart at all eight
ingest checkpoints.

## Commands

Use the `pnpm@10.15.0` version pinned in `package.json`. If the installed Node
distribution does not include Corepack, replace `pnpm` below with
`npx --yes pnpm@10.15.0`.

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm check:openapi
pnpm typecheck
pnpm test
pnpm --filter @trust-core/control-centre build
pnpm --filter @trust-core/sdk test
pnpm --filter @trust-core/fixtures-wesketch test
pnpm trust:test
```

`pnpm generate:openapi` regenerates `contracts/openapi.json` from the shared
Release 0.1 route and schema contracts. `pnpm check:openapi` fails when the
generated artifact drifts. The SDK and WeSketch commands above run their
focused contract/fixture suites; applications must use `@trust-core/sdk` or
the public HTTP API rather than importing server packages.

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

Historical local Docker proofs are recorded in `CHECKPOINT.md`. A release is
current only when the Docker gate succeeds for the exact committed release SHA;
local dirty-tree reports are supporting diagnostics, not release evidence.

With `DATABASE_URL` present the API reports `mode: live` and reads PostgreSQL. Without it, the API deliberately reports `mode: fixture`.

Live mutation routes also require `TRUST_ADMIN_TOKEN`. The bootstrap-token
exchange is a controlled development boundary, not the ordinary production
identity system. The provider-neutral OIDC/PKCE implementation is complete;
integration against a real external organisation identity provider, plus
production credential-rotation drills, remains post-0.1 operational hardening.

To exercise the real HTTP gateway during local development, run the API and set `VITE_TRUST_API_BASE=/api` plus `VITE_TRUST_WORKSPACE_ID=<workspace UUID>` when starting the Control Centre. Without `VITE_TRUST_API_BASE`, the UI deliberately uses synthetic fixture data for safe visual exploration.

For production, configure `TRUST_OIDC_*` and apply all ordered migrations
(`0004` introduced the identity tables). The Control Centre redirects to the
organisation identity provider using authorization code flow with S256 PKCE.
Trust Core validates issuer, audience, signature, algorithm, subject, nonce,
one-use state and a separate browser-binding cookie before creating a hashed,
shared PostgreSQL session. Passkeys and MFA belong at the identity provider.

The bootstrap-token flow remains available for controlled local development and
emergency exchange. In production, direct bootstrap bearer authentication is
disabled unless `TRUST_ALLOW_BOOTSTRAP_BEARER=true` is explicitly set. It must
not be the ordinary production sign-in path.

Production deployments must satisfy the ingress and operational controls in
[`docs/production-deployment.md`](docs/production-deployment.md).

Release 0.2 portability is in progress. `@trust-core/archive` now provides the
0.2A deterministic logical archive/verifier, the 0.2B hardened ZIP64 container,
and the 0.2C non-mutating import planner. These are source candidates; the
PC/Docker reconstruction gates are recorded in the checkpoint documents and the
governing specification.

The 0.2D provider-neutral execution kernel is also present, including durable
checkpoint ports, staged/verified blob flow, atomic metadata handoff and
interruption/resumption tests. PostgreSQL/MinIO execution remains a deliberately
unclaimed PC/Docker gate.

The Control Centre uses its typed fixture adapter unless
`VITE_TRUST_API_BASE` is set. Its HTTP gateway uses the authenticated live
snapshot, health, history, restoration and verification routes through the
public TypeScript SDK.

Vercel hosts only the static Control Centre SPA. It does not host the Trust API,
worker, PostgreSQL or canonical object storage; configure the SPA to reach
separately operated Trust Core services.

## Synthetic Ivan fixture

`@trust-core/fixtures-ivans-diary` contains no personal information. It intentionally exercises diary entries, ordered pages, a multipage sketchbook, voice-derived text, drawing and audio metadata, bookmarks, unknown-field preservation and recoverable deletion. It is test data for the same schema path real app data will later use.

## Rule

Applications must use the public API or SDK. They must never manipulate Trust Core tables or canonical storage paths directly.
