# ADR-010: Provider versioning is defence in depth

## Decision

Provider object versioning, retention locks and replication may be enabled operationally, but Trust Core correctness depends on application revisions, verified content identity and immutable canonical keys.

## Consequences

The same history and restore semantics apply to MinIO and future providers. Provider version IDs are not canonical revision IDs, and Release 0.1 does not configure or verify provider versioning, object lock, replication or lifecycle policies.
