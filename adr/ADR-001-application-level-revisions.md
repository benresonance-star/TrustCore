# ADR-001: Application-level revisions

## Decision

Trust Core revisions are provider-independent canonical history. Provider object versioning is defence in depth only.

## Consequences

Revision lineage, restoration, export and verification behave consistently across storage providers. Restoration always creates a new revision.
