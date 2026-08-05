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

## Deliberate limits

This checkpoint does not claim:

- PostgreSQL logical-point export;
- MinIO streaming reads;
- durable export-operation state across processes;
- production-scale streaming download;
- source destruction or clean-store reconstruction;
- real OIDC/MFA step-up evidence.

Those remain the Docker-capable PC's 0.2H gate. This file records preparation,
not `TRUST TEST: PASS`.

## Source evidence

- strict typecheck across all 20 buildable workspace projects: PASS;
- 119 non-Docker workspace tests: PASS;
- API: 18 PASS, 3 Docker tests skipped;
- generated OpenAPI contract/no-drift tests: PASS;
- production Control Centre build: PASS (1,584 modules);
- source `TRUST TEST CANDIDATE: PASS`.
