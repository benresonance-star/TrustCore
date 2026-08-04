# ADR-007: Append-only restoration

## Decision

Restoring a logically deleted resource appends a new revision whose source is `restore` and whose `restored_from_revision_id` records the selected prior revision. Existing revisions are never changed or made current by mutation.

## Consequences

Deletion and recovery remain auditable and historical hashes remain stable. Restoration requires authorization and an open recoverable tombstone, then closes that tombstone without erasing it. Revision creation and deletion continue to use expected-revision checks.
