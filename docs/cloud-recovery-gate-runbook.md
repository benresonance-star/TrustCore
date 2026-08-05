# Release 0.3 cloud and recovery gate

This runbook closes Release 0.3 only in an approved production-like deployment.
Source tests and fixture services cannot prove cloud recovery.

## Required boundaries

- The source commit is clean, immutable and recorded in every artifact.
- The recovery PostgreSQL service, object replica and signing keys are
  independently administered from the primary account.
- Runtime identities cannot administer backups, replicas, retention locks or
  signing keys.
- Evidence contains identifiers and counts, never canonical content, tokens,
  cookies, credentials, bucket names or private endpoints.
- The primary account is disabled or network-isolated for the final drill. A
  simulated boolean in a test harness is not sufficient evidence.

## Deployment baseline

1. Apply every ordered migration with the migration-owner identity.
2. Provision separate API, worker, verification, audit and backup roles.
3. Configure the Amazon S3 adapter with versioning, default encryption and the
   approved Object Lock retention mode.
4. Configure managed PostgreSQL continuous archiving and point-in-time restore.
5. Configure cross-account object replication and separately retained database
   backups.
6. Configure an asymmetric archive-signing key and publish its verification
   key by stable key ID.
7. Configure organisation OIDC, production ingress and alert destinations.
8. Run source quality, Release 0.1 and Release 0.2 regression gates.

## Required exercises

Run each exercise in an isolated, run-scoped environment and retain an
`@trust-core/recovery` evidence record:

1. `postgres_pitr`: restore metadata to a selected timestamp and verify
   migrations, RLS, audit partitions and revision heads.
2. `missing_blob_restore`: remove access to one target object, restore it from
   the separately administered copy and recompute its byte length and SHA-256.
3. `combined_store_restore`: restore PostgreSQL and canonical objects to a
   mutually consistent point, then run workspace verification.
4. `key_recovery`: rotate or disable the active signing key, recover according
   to the approved procedure and verify old and new signed archives.
5. `primary_account_unavailable`: disable the primary account and recover using
   only independently administered services and credentials.
6. `full_trust_verification`: run metadata, full-blob, resource, dataset and
   workspace verification against the recovered deployment.

The gate passes only when `evaluateRecoveryGate` returns `pass` for all six
exercises and every alert kind in `@trust-core/observability` has a delivered
receipt from the configured external destination.

## Identity and ingress proof

- Complete OIDC authorization-code login with S256 PKCE.
- Prove deny-by-default claim mapping, MFA/passkey assurance, user disablement,
  session revocation and fresh same-principal reauthentication.
- Prove TLS, HSTS, request-size limits and rate limits at the external ingress.
- Confirm bootstrap bearer authentication is disabled.

## Failure handling

Any failed or missing exercise leaves Release 0.3 open. Preserve failed
artifacts, quarantine inconsistent recovered state and rerun in a new
run-scoped environment after correcting the cause. Never alter evidence to turn
a failed run into a pass.
