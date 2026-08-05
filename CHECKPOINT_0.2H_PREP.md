# Checkpoint 0.2H preparation — export and offline handoff candidate

## Outcome

Trust Core now has the source-only boundaries needed to carry a genuine archive
from the API into the independent viewer:

- authenticated, dataset-scoped archive creation;
- deterministic idempotency per actor and workspace;
- SHA-256 and byte-length export metadata;
- separately authenticated archive download;
- TypeScript SDK methods for both operations;
- an offline CLI that strictly verifies archive bytes before rendering HTML.

## Candidate routes

- `POST /v1/portability/exports`
- `GET /v1/portability/exports/{exportId}/download`

Both routes require the dedicated `portability:export` capability and a fresh
same-principal credential in `x-trust-reauth`. Auditors, infrastructure
operators and recovery operators do not receive export authority by default.

Fixture mode assembles real `.trustarchive` bytes for Ivan's Diary and WeSketch.
The API returns archive bytes as bounded base64 for this candidate contract. A
production implementation should stream large downloads or issue tightly
scoped, short-lived download URLs without weakening authorization or audit.

The live 0.2H adapter deliberately preserves that bounded base64 public
contract for the synthetic gate. PostgreSQL extraction and MinIO object reads
are verified against declared byte lengths and SHA-256 digests, but archive
assembly and delivery remain memory-bounded by the existing 8 MB container
limit. A streaming public upload/download contract is deferred to a later
contract revision rather than being introduced incompatibly in 0.2H.

## Docker acceptance command

The complete destructive acceptance scope is now encoded behind:

```powershell
corepack pnpm@10.15.0 trust:test:portability:docker
```

It uses dedicated RLS portability tables, run-scoped source/target databases
and MinIO buckets, live API/adapters, source destruction, clean-target
reconstruction, hostile archive rejection, offline viewer execution, and API
process exit/restart at every declared import checkpoint. See
[`docs/portability-gate-runbook.md`](docs/portability-gate-runbook.md).

The local profile intentionally validates unsigned archives and same-principal
bootstrap re-authentication. Managed signatures and real OIDC/MFA remain
deferred. This preparation record does not claim 0.2H complete: the parent must
rerun the command on the exact clean, committed candidate SHA and retain both
sanitized reports before `TRUST TEST: PASS` is release evidence.

## Source evidence

- strict typecheck across all 20 buildable workspace projects: PASS;
- 119 non-Docker workspace tests: PASS;
- API: 18 PASS, 3 Docker tests skipped;
- generated OpenAPI contract/no-drift tests: PASS;
- production Control Centre build: PASS (1,584 modules);
- source `TRUST TEST CANDIDATE: PASS`.
