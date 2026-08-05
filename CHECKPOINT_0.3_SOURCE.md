# Checkpoint 0.3 source candidate — cloud recovery contracts

## Implemented in source

- provider-neutral recovery evidence and exact-commit gate evaluation in
  `@trust-core/recovery`;
- required PITR, missing-blob, combined-store, key-recovery,
  primary-account-unavailable and full-verification exercise contracts;
- content-free alert contracts, severity enforcement and alert-delivery
  completeness checks in `@trust-core/observability`;
- managed PostgreSQL deployment requirements;
- production cloud/recovery acceptance runbook;
- Release 0.2 completion alignment and explicit fixture/live UI labels.
- production Amazon S3 adapter configuration for KMS encryption, immutable
  conditional copy and Object Lock retention;
- checksum-bound Ed25519 archive manifest signatures with provider-neutral key
  interfaces;
- first-class retention policy persistence/API and immutable blob encryption
  metadata across core, PostgreSQL and archive projections;
- deployable API/worker containers, live policy administration, binary archive
  download and browser end-to-end coverage.

## Gate boundary

This checkpoint is not `RECOVERY TEST: PASS`. It cannot prove a real OIDC
tenant, managed PostgreSQL PITR, cross-account S3 recovery, KMS rotation, alert
delivery or primary-account-unavailable recovery without approved external
infrastructure.

Release 0.3 closes only when the exercises in
`docs/cloud-recovery-gate-runbook.md` produce complete evidence for one exact
clean commit and `evaluateRecoveryGate` returns `pass`.
