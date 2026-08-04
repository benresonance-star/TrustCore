# ADR-003: Content-addressed storage

## Decision

Canonical blob keys and database identity are derived from the workspace and the verified SHA-256 digest. Client-declared hashes and lengths are accepted only as expectations; Trust Core streams, counts and hashes the bytes before committing immutable metadata.

## Consequences

Equal bytes may be reused within a workspace without permitting cross-workspace discovery. Existing canonical objects must match the verified length and digest, and canonical keys are never overwritten or deleted by temporary-object cleanup.
