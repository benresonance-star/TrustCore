# Trust Core — PC Codex Docker Handoff

You are continuing implementation of **Trust Core Platform**, an application-independent continuity, history, integrity, recovery and portability framework intended for Ivan’s Diary, WeSketch, Foundation and future applications.

The supplied source is `trust-core-platform-checkpoint-0.1j.zip`. It is the complete tracked source snapshot at commit-equivalent checkpoint 0.1J, but it intentionally contains no `.git` directory, dependencies, secrets, databases, object-store contents or Docker volumes.

## Mission

Turn the Release 0.1 service-adapter candidate into a genuinely proven Docker integration candidate using real PostgreSQL and MinIO. Do not begin Release 0.2 portability work. Do not print `TRUST TEST: PASS` until the complete Docker gate genuinely passes.

The current automated marker is deliberately weaker:

```text
TRUST TEST CANDIDATE: PASS (service adapters; Docker gate pending)
```

Preserve that distinction.

## First actions

1. Extract the ZIP into a new folder named `trust-core-platform`.
2. Open that folder as the Codex working directory.
3. Read completely before editing:
   - `SPEC.md`
   - `CHECKPOINT.md`
   - `README.md`
   - `ARCHITECTURE.md`, if present
   - all ADRs, threat-model documents and repository instructions that are present
4. Inspect `package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`, `.env.example`, migrations `0001` through `0006`, and every package/app manifest.
5. Run `git status`. If this is not already a repository, initialize it:

   ```powershell
   git init -b main
   git add .
   git commit -m "chore: import Trust Core checkpoint 0.1J"
   ```

6. Never commit `.env`, credentials, database volumes, MinIO data, test secrets or generated reports containing secrets.
7. Confirm Docker Desktop is using Linux containers and is healthy before changing code.
8. Use the package-manager version declared in the root `packageManager` field through Corepack. Do not silently upgrade dependencies.

## Baseline verification

Before implementing Docker-specific changes, establish the source baseline:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm trust:test
```

Expected baseline:

- strict TypeScript checks pass;
- 38 backend tests pass;
- 5 Control Centre interaction tests pass;
- the Control Centre production build passes;
- the Trust Test says only `TRUST TEST CANDIDATE: PASS (service adapters; Docker gate pending)`.

If the exact count differs because test discovery or package-manager versions differ, investigate and document it. Do not weaken or delete tests merely to reproduce a number.

## Local configuration

Create `.env` from `.env.example`. Generate new strong local-only credentials; do not reuse values from chat or commit them. Inspect `docker-compose.yml` and make its environment contract agree with `.env`.

The local stack must provide at least:

- PostgreSQL 18 or the version explicitly required by the repository;
- MinIO with a dedicated Trust Core bucket;
- health checks;
- persistent named volumes for restart tests;
- a repeatable clean-reset procedure restricted to these named test resources.

Do not use destructive commands against broad Docker resources, unrelated volumes or unrelated databases.

## Required implementation work

### 1. Reproducible Docker orchestration

- Make `docker compose up -d` start PostgreSQL and MinIO reliably.
- Add an idempotent bucket-initialisation mechanism if one does not exist.
- Add health-based readiness rather than fixed sleeps.
- Add repository scripts for starting, checking and stopping the Trust Core test stack.
- Add a narrowly scoped clean-test reset command that names only Trust Core test containers/volumes.

### 2. PostgreSQL migration proof

Run every migration from `0001` through `0006` against a clean database using the repository migration runner.

Prove:

- ordered migration application;
- migration checksum/tamper detection;
- rerunning migrations is idempotent;
- constraints and foreign keys operate as designed;
- immutable revision triggers reject update and deletion;
- blob identity/storage-coordinate mutation is rejected;
- schema-package immutability is enforced;
- verification, identity-session, outbox and reconciliation tables exist and behave correctly.

### 3. Least-privilege roles and RLS

Implement any missing provisioning SQL or scripts for distinct local test roles representing:

- migration owner;
- API runtime;
- reconciliation worker;
- verification service;
- audit reader/writer where required;
- backup/restore operator where required by Release 0.1.

The runtime role must not own tenant tables. Test cross-workspace ID substitution using real connections and real roles. Prove ordinary runtime access cannot read or mutate another workspace. Prove the worker can claim its intended cross-workspace outbox workload without receiving unnecessary application-data privileges.

Do not weaken RLS merely to make the worker operate. Resolve worker privilege and policy boundaries deliberately and document the decision in an ADR if necessary.

### 4. MinIO storage-contract proof

Run the same object-storage contract suite against MinIO that is used against test doubles.

Prove:

- temporary upload creation;
- streamed writes and accurate byte counting;
- SHA-256 verification;
- immutable content-addressed commit;
- equal-byte deduplication;
- safe retry after an already committed object;
- `head` and streamed read consistency;
- missing-object detection;
- outage/denial reporting;
- temporary cleanup;
- refusal to delete canonical object keys through the temporary cleanup API;
- no silent overwrite of different bytes.

Use unique workspace/test prefixes. Clean up only objects created by the test run.

### 5. Real API and worker integration

Run the Trust API and reconciliation worker against PostgreSQL and MinIO, not fixture adapters.

Prove:

- health reports `mode: live`;
- schema and synthetic Ivan data seed transactionally;
- authenticated create/revise/delete/restore commands persist;
- restoration creates a new revision and preserves the prior revision;
- full-byte verification streams real MinIO bytes and persists a verification run;
- outbox events are leased with concurrent workers without double processing;
- completed leases cannot be completed by a stale worker;
- transient failures retry with backoff;
- terminal repeated failures quarantine and create an inspectable incident.

### 6. Actual interruption and reconciliation tests

The existing checkpoint runner proves simulated interruption at service boundaries. Extend this into real process-level integration tests.

Interrupt or terminate the operation at each meaningful point:

1. before temporary upload;
2. after temporary upload creation;
3. after bytes are received;
4. after hash verification;
5. after immutable object commit but before metadata commit;
6. after metadata commit but before audit/outbox completion;
7. after audit/outbox completion but before client acknowledgement;
8. during reconciliation retry.

After restart, the system must do exactly one of:

- resume safely;
- return the original idempotent result;
- reconcile the partial state;
- quarantine it with an explicit incident.

It must never:

- create a revision pointing to missing bytes;
- silently lose committed canonical bytes;
- duplicate a completed revision;
- delete an unattached immutable object automatically;
- treat metadata-only verification as full verification;
- report success while a critical inconsistency remains unresolved.

### 7. Genuine Release 0.1 Docker Trust Test

Add a dedicated command such as:

```powershell
pnpm trust:test:docker
```

It must operate against isolated Docker test resources and cover the Release 0.1 portion of `SPEC.md`, including negative cases relevant to Release 0.1.

Only when every required Docker assertion passes may it print:

```text
TRUST TEST: PASS
```

On failure it must:

- print `TRUST TEST: FAIL`;
- exit non-zero;
- write a machine-readable JSON report;
- write a concise human-readable Markdown report;
- identify the failing stage without exposing secrets.

Suggested report paths:

```text
reports/release-0.1-docker-gate.json
reports/release-0.1-docker-gate.md
```

Commit a sanitised example or schema for reports, not secret-bearing runtime reports unless `.gitignore` and review confirm safety.

## Evidence and documentation

Update:

- `CHECKPOINT.md` with implemented, verified and still-unverified scope;
- `README.md` with exact Windows/Docker commands;
- `.env.example` without real secrets;
- an ADR for database-role/RLS worker boundaries if the existing design changes;
- the threat model with findings from real failure tests;
- a Docker gate runbook containing start, migrate, seed, test, diagnose and safe cleanup procedures.

Record exact versions:

- Windows and WSL version if relevant;
- Docker Desktop and engine;
- PostgreSQL image;
- MinIO image;
- Node and pnpm;
- Git commit tested.

## Working rules

- Preserve all existing passing behavior.
- Do not bypass a failing invariant, RLS policy, trigger, hash check or immutable-storage rule to make tests green.
- Do not claim real PostgreSQL/MinIO proof from mocks.
- Do not begin `.trustarchive` export/import or Release 0.2 until the Release 0.1 Docker gate passes.
- Keep provider adapters behind public contracts.
- Applications must never access Trust Core tables or storage keys directly.
- Preserve unknown schema fields and synthetic-demo classification.
- Use only synthetic Ivan data; do not introduce real personal data.
- Treat credentials, cookies, OIDC secrets, MinIO keys and database URLs as secrets.
- Make small intentional commits at stable checkpoints.
- If an implementation decision materially weakens a Trust Core guarantee, stop and ask before proceeding.

## Required final handoff

At completion, report:

1. the commit hash tested;
2. exact commands run;
3. test counts and durations;
4. Docker service/image versions;
5. migration results;
6. RLS and least-privilege results;
7. MinIO contract results;
8. process-interruption results by checkpoint;
9. reconciliation and quarantine results;
10. paths to JSON and Markdown gate reports;
11. remaining risks and deferred work;
12. whether `TRUST TEST: PASS` was genuinely reached.

If the gate does not pass, state that plainly and leave the repository in a diagnosable, recoverable state. A truthful incomplete result is preferable to a false trust claim.
