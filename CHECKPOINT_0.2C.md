# Checkpoint 0.2C — dry-run import planning

Release 0.2C converts a successfully parsed and verified Trust Archive into a
deterministic, non-mutating import plan.

## Implemented in source

- preserve-ID and mapped-workspace modes;
- reject-on-error and report-only conflict policies;
- deterministic dependency phases for schemas, datasets, blobs, resources,
  revisions, attachments, relations, tombstones, audit and retention;
- stable plan identity across partial/resumed imports;
- identical-target detection as `already_present`;
- divergent ID and immutable schema-digest conflicts;
- workspace-boundary, dataset/resource/revision, revision-parent/number,
  revision-blob, relation and tombstone validation;
- unknown-field preservation in planned records;
- no database, object-store or filesystem writes.

## Deliberately not implemented

- plan execution or mutation APIs;
- transaction/outbox persistence for import operations;
- blob streaming into temporary/canonical storage;
- target locking and revalidation immediately before commit;
- rollback/quarantine after interruption;
- imported audit-chain partition policy;
- mapped IDs below the workspace boundary.

## PC/Docker acceptance gate

The 0.2D gate must execute plans against clean PostgreSQL and MinIO, terminate at
every import checkpoint, resume with the same plan/operation identity, reject
stale target assessments, reconstruct both fixtures, and independently verify
all hashes, graphs, pointers, relations, tombstones and audit evidence after the
source stores are destroyed.
