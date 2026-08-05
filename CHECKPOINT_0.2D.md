# Checkpoint 0.2D — executable import kernel candidate

Release 0.2D now has a provider-neutral import executor. This is a source
candidate, not the final portability proof.

## Implemented in source

- verified-archive and ready-plan preconditions;
- plan identity recomputation preventing action or archive substitution;
- durable begin/resume port keyed by stable plan identity;
- target revalidation before any blob staging;
- operation-scoped temporary blob staging;
- staged hash and byte-length verification;
- immutable canonical blob commit boundary;
- one atomic metadata adapter boundary;
- idempotent audit completion;
- eight explicit interruption checkpoints;
- clean reference reconstruction for Ivan's Diary and WeSketch;
- forced interruption and successful resume at every checkpoint with one
  operation, one metadata commit and one audit completion.

## Not yet production adapters

The source proof uses independent in-memory operation and target adapters. It
does not claim PostgreSQL transactions, RLS, MinIO streaming, process-level
termination, large-archive memory bounds or source-store destruction.

## Required PC/Docker implementation and proof

- add ordered migration(s) for import operations/checkpoints and plan identity;
- implement a least-privilege PostgreSQL operation store;
- implement operation-scoped MinIO temporary staging and immutable commit;
- implement atomic metadata insertion with target-lock revalidation;
- define imported audit partition/linkage and append it transactionally;
- terminate the real API/worker process at every checkpoint and resume;
- export both live fixtures, destroy isolated source stores, reconstruct clean
  PostgreSQL/MinIO stores and run full independent verification;
- prove stale targets, conflicting IDs, missing/corrupt blobs and interrupted
  imports cannot expose partial metadata as successful;
- retain sanitized evidence against the exact clean commit.

Only that Docker reconstruction proof may complete Release 0.2.
