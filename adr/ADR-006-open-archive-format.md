# ADR-006: Open archive format

## Decision

Portable exports will use a documented, provider-independent `.trustarchive` format with manifests, schemas, canonical payloads, blob hashes and verification material. The archive format and exporter/importer are deferred to Release 0.2 and are not implemented in Release 0.1.

## Consequences

Release 0.1 data models and schemas must avoid provider-only identities that would prevent later reconstruction. Current revision history and object hashes are prerequisites, not a claim that an archive can yet be created, imported or used for disaster recovery.
