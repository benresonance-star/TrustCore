# ADR-009: Trust Test release gate

## Decision

Release 0.1 acceptance requires the repository Docker gate against real PostgreSQL and MinIO. Unit tests and service doubles remain supporting evidence and retain the `TRUST TEST CANDIDATE` label.

## Consequences

The gate must prove migrations, least-privilege roles, forced RLS, immutable storage, live API and worker behaviour, verification, and restart at every ingest checkpoint. A passing local gate does not prove production backup, secret rotation, multi-region durability or identity-provider operations.
