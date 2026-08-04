# Trust Core Release 0.1 retention policy

This contract describes implemented retention behaviour, not a promise of
automated legal-records management.

## Canonical history and bytes

- Revisions are append-only and have no Release 0.1 expiry mechanism.
- Canonical blob bytes are immutable. A retained revision reference prevents
  purge.
- Unattached canonical objects are reported by verification and retained for
  investigation; Release 0.1 does not automatically delete them.
- Audit events, operations, incidents and verification evidence are retained.
  No compaction or expiry job is implemented.

## Logical deletion and recovery

- Resource deletion changes resource status and appends a tombstone; it does
  not delete revisions or canonical bytes.
- `recover_until` records the requested recovery horizon. A null value means no
  scheduled end is represented.
- Restoration appends a new `restore` revision, records
  `restored_from_revision_id`, and marks the tombstone restored. It does not
  rewrite or remove prior history.
- `purge_state` represents eligibility and planning state only. Release 0.1 has
  no purge planner or purge executor, so expiry of `recover_until` must not be
  interpreted as proof that any data was removed.
- Dataset or resource `legal_hold` status is represented in the model, but
  Release 0.1 has no automated hold workflow. Operators must not claim
  regulatory hold enforcement from the status field alone.

## Sessions and login transactions

- OIDC login transactions expire after five minutes by default and are
  single-use. Expired rows are not yet removed by a scheduled cleanup job.
- OIDC and bootstrap sessions expire after 30 minutes by default. OIDC session
  revocation is persisted; bootstrap sessions are process-local and disappear
  when that API process restarts.
- Session records and hashed identifiers are authentication data, not audit
  evidence. Production operators must define deletion periods appropriate to
  their identity policy; Release 0.1 does not automate that deletion.

## Deferred capabilities

The following are not implemented in Release 0.1:

- physical purge of revisions, blobs, tombstones or audit evidence;
- `.trustarchive` creation, import or archive-based retention;
- provider lifecycle, object-lock, replication or version-retention setup;
- production backup schedules, off-site copies, restore automation or recovery
  point enforcement.

Until those controls exist and are drilled, PostgreSQL and object-store
retention must be configured and evidenced by the deployment operator. See the
[recovery runbook](../docs/recovery-runbook.md), [threat model](./threat-model.md)
and [ADR-006](../adr/ADR-006-open-archive-format.md).
