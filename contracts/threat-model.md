# Trust Core Release 0.1 threat model

## Scope

This model covers the Release 0.1 central trust loop running with PostgreSQL and
S3-compatible immutable object storage. Archive portability is Release 0.2 and
is intentionally out of scope.

## Trust boundaries

- Clients authenticate to the Trust API and never receive database credentials
  or canonical object-store keys.
- The API runtime uses a non-owner PostgreSQL role restricted by workspace RLS.
- The reconciliation worker can lease cross-workspace outbox work but cannot
  read or mutate tenant application data except through narrowly scoped
  functions required by its handlers.
- The verification service can read canonical objects and write verification
  results but cannot mutate canonical object bytes.
- Migration and backup operators are separate from runtime identities.
- PostgreSQL metadata and MinIO bytes are separate durable stores joined by an
  idempotent operation state machine, not a distributed transaction.

## Protected assets

- Canonical immutable object bytes and their content hashes.
- Append-only revision history, tombstones, and restoration provenance.
- Workspace isolation and role assignments.
- Audit-chain ordering and hashes.
- Operation idempotency records, outbox leases, incidents, and verification
  evidence.
- Database, object-store, OIDC, session, CSRF, and bootstrap credentials.

## Threats and required controls

### Cross-workspace identifier substitution

An authenticated actor may submit a resource, revision, blob, or operation ID
owned by another workspace. Authorization checks alone are insufficient.
Every tenant table uses forced RLS, runtime transactions set the workspace
context locally, and Docker integration tests use distinct role connections to
prove substituted IDs cannot be read or changed.

### Runtime privilege escalation

Using an owner or superuser as the API would bypass forced RLS and hide policy
defects. Runtime, worker, verification, audit, migration, and backup identities
are provisioned separately. The Docker gate rejects runtime table ownership and
unexpected grants.

### Canonical object overwrite or deletion

Object keys are derived from workspace and SHA-256 identity. Commit verifies
the temporary bytes before accepting an existing canonical key. Cleanup APIs
reject canonical keys and only remove operation-scoped temporary objects.
Unattached canonical objects are retained and reported rather than deleted.

### Hash or length confusion

Client-provided hashes and byte lengths are untrusted. Trust Core counts and
hashes streamed bytes, compares both values before metadata commit, stores the
verified identity, and distinguishes metadata checks from full-byte checks.

### Cross-store interruption

The API or worker may terminate between any two upload effects. Durable
checkpoints and idempotency keys make completed effects replay-safe. Restart
must resume, return the original result, reconcile, or quarantine with an
incident. It must never create metadata pointing to missing bytes or report
success while a critical inconsistency remains.

### Outbox lease races

Competing workers may claim the same event or a stale worker may finish after
its lease expires. Claims use row locks with `SKIP LOCKED`, completion checks
the lease owner, retries use bounded exponential backoff, and terminal failures
are quarantined with an inspectable incident.

### Migration tampering

Applied migration names and SHA-256 checksums are recorded transactionally.
Changing an applied migration is rejected. Runtime roles cannot apply schema
changes.

### Credential and evidence leakage

Local credentials live only in ignored `.env` files. Reports contain stage
names, timings, identifiers generated for the test run, and sanitized error
messages; they never include URLs with credentials, tokens, cookies, OIDC
secrets, access keys, or object contents.

### Denial or partial outage

PostgreSQL or MinIO may be unavailable, slow, or deny access. The API returns a
failure without claiming a completed operation. The worker retries transient
failures and quarantines terminal failures. Health and gate readiness checks
use bounded retries and expose the failing dependency without exposing secrets.

## Docker-gate evidence

The Release 0.1 Docker gate must prove these controls with real PostgreSQL and
MinIO, including negative cases and process termination at every defined
checkpoint. Unit tests and service doubles are supporting evidence only and
must retain the `TRUST TEST CANDIDATE` label.

## Residual risks

- Local Docker credentials are development-only and do not prove production
  secret distribution or rotation.
- MinIO in one local Docker engine does not prove multi-region object-store
  behavior.
- A synthetic administrator token does not replace production OIDC, MFA,
  emergency-access, and privileged-session operational drills.
- Docker process termination proves application recovery logic but not host or
  storage-media disaster recovery; backup/restore drills remain separate.
