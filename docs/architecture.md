# Architecture checkpoint

Release 0.1 is a modular monolith with a public API boundary. PostgreSQL stores tenant-scoped identity and history; S3-compatible storage holds immutable blobs. A durable operation state machine reconciles the two systems. Applications do not access either persistence layer directly.

The semantic layer is explicitly outside this release and never owns canonical evidence.

The provider-independent entity, lifecycle and portability semantics are
defined in `docs/logical-data-model.md`. Cross-layer enforcement responsibility
is defined in `contracts/logical-data-model-invariants.md`. Physical migrations,
API schemas and archives are implementations of those contracts rather than the
source of domain meaning.
