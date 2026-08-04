# ADR-005: Storage adapters

## Decision

Canonical byte operations use the storage package contracts. Release 0.1 supplies an S3-compatible MinIO adapter; domain and operation packages do not depend on MinIO APIs or credentials.

## Consequences

Storage providers can be replaced only by adapters that preserve immutable put, streamed read, metadata and operation-scoped temporary cleanup semantics. Passing an adapter contract does not by itself prove provider durability, retention, backup or multi-region behaviour.
