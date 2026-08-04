# Architecture checkpoint

Release 0.1 is a modular monolith with a public API boundary. PostgreSQL stores tenant-scoped identity and history; S3-compatible storage holds immutable blobs. A durable operation state machine reconciles the two systems. Applications do not access either persistence layer directly.

The semantic layer is explicitly outside this release and never owns canonical evidence.
