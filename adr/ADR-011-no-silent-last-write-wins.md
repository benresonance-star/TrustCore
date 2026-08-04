# ADR-011: No silent last-write-wins

## Decision

Revision creation and logical deletion require the caller's expected current revision. A mismatch returns the stable `REVISION_CONFLICT` error; idempotency-key reuse with different input returns `IDEMPOTENCY_CONFLICT`. Restoration instead acts on the single open tombstone and appends a new revision.

## Consequences

Concurrent changes are surfaced for explicit retry, merge or user resolution. Trust Core never silently replaces a newer resource state, while exact command retries can return their original result.
