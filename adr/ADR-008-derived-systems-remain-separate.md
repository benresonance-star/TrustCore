# ADR-008: Derived systems remain separate

## Decision

Search indexes, semantic services, previews, analytics and other derived systems may consume Trust Core evidence but never own canonical payloads, blob bytes, revision lineage or authorization decisions.

## Consequences

Derived state may be discarded and rebuilt from canonical records. Release 0.1 does not include a semantic layer, and no derived-system availability or consistency claim is part of the release gate.
