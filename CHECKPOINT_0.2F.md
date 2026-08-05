# Checkpoint 0.2F — authenticated Portability API candidate

## Outcome

Trust Core now exposes a source-only, authenticated Portability API and
TypeScript SDK surface backed by the strict archive reader, deterministic
planner and checkpointed provider-neutral executor.

## Public candidate routes

- `POST /v1/portability/archives`
- `GET /v1/portability/archives/{archiveId}`
- `POST /v1/portability/plans`
- `GET /v1/portability/plans/{planId}`
- `POST /v1/portability/plans/{planId}/execute`
- `GET /v1/portability/operations/{operationId}`

Archive upload is bounded, strictly parsed and content-identified by SHA-256.
Planning and execution are workspace/actor/idempotency scoped. Mutation requires
the new `portability:plan` or `portability:execute` policy actions; auditors and
infrastructure operators retain read-only visibility. Execution additionally
requires the exact `IMPORT` confirmation value.

## Contract alignment

- introduced the first-class logical `RetentionPolicy` type while leaving its
  physical/public implementation explicitly pending;
- aligned tombstone deletion reason and restoration timestamp through the core
  and PostgreSQL history projections;
- added source audit-lineage boundaries to every archive manifest;
- required archive verification to bind lineage count and boundary hashes;
- required the target audit adapter to receive source lineage separately from
  its target-native import event;
- added portability actions to the shared policy capability matrix;
- generated OpenAPI and exposed the operations through the handwritten
  TypeScript SDK facade.

## Candidate adapter boundary

Fixture mode performs real ZIP verification, planning and all eight executor
checkpoints against an in-memory target. Live mode deliberately leaves the
Portability provider unconfigured. It does not imply PostgreSQL/MinIO writes,
cross-process durability or source-store reconstruction.

## Gate status

`0.2F PORTABILITY API CANDIDATE: PASS`

Source evidence:

- strict typecheck across all 19 buildable workspace projects: PASS;
- 114 non-Docker workspace tests: PASS;
- API candidate: 17 PASS, 3 Docker tests skipped;
- archive kernel: 20 PASS;
- generated OpenAPI contract/no-drift tests: 10 PASS;
- TypeScript SDK: 6 PASS;
- Control Centre: 9 PASS;
- production Control Centre build: PASS (1,584 modules);
- source `TRUST TEST CANDIDATE: PASS`.

Only checkpoint 0.2H on the Docker-capable PC may close the Release 0.2 gate.
