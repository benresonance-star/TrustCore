# ADR-013: Worker/RLS cross-workspace privilege boundary

## Decision

The reconciliation worker uses a dedicated non-owner, non-superuser, `NOBYPASSRLS` role. It may claim pending outbox rows across workspaces through the worker-only outbox policy, but each handler sets `trust.workspace_id` locally before reading blob metadata or writing an incident.

## Consequences

The worker can make global queue progress without receiving dataset, resource, revision, identity-session or audit access. Its grants are limited to selecting and updating outbox rows, selecting blob metadata, and inserting incidents; Docker integration tests must reject privilege expansion and prove cross-workspace claiming separately from tenant-data access.
