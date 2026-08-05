# Trust Core Platform

## Current implementation specification for Codex

- **Specification version:** 1.2
- **Current source checkpoint:** 0.1L
- **Date:** 2026-08-04
- **Audience:** Codex agents and human maintainers
- **Status:** Release 0.1 complete; post-0.1 operational hardening and Release 0.2 portability are tracked separately
- **Docker report source revision:** recorded in the generated report; the current working tree is uncommitted

---

# 1. Executive instruction

Build Trust Core as a standalone, application-independent continuity, history, integrity, recovery and portability platform for Ivan’s Diary, WeSketch, Foundation and future applications.

Trust Core must preserve user and organisational work independently of any one application, interface, operating system, programming language, database, storage provider, cloud account, AI model or semantic system—and independently of the continued existence of the originating app.

The first complete proof is not a polished dashboard. It is a tested central trust loop in which data can be created, revised, deleted logically, recovered and fully verified under real interruption without corrupting canonical state.

Do not implement archive portability, AI, embeddings, OCR, semantic search, RAG, graphlets or agent workflows until the Release 0.1 Docker gate passes.

The source-only test marker remains:

```text
TRUST TEST CANDIDATE: PASS (service adapters; Docker gate pending)
```

The complete real-service gate now prints:

```text
TRUST TEST: PASS
```

---

# 2. Foundational principle

```text
Trust Core preserves canonical evidence and history.

Applications create, organise and present that evidence.

Semantic and AI systems derive interpretations from evidence.

No application, model or derived system may silently rewrite canonical history.
```

Trust Core must remain fully operational when AI and semantic systems are offline.

---

# 3. Product boundary

Trust Core owns:

- stable identities;
- canonical blobs and payloads;
- immutable revision ancestry;
- schema-package identity and compatibility metadata;
- typed relations;
- provenance;
- logical deletion, retention and recovery;
- content and audit integrity;
- durable multi-store operations;
- reconciliation and quarantine;
- provider-independent archive contracts;
- policy-controlled access;
- operational verification;
- common protocols for web, desktop, mobile and iPad applications.

Applications own:

- domain language and schemas;
- user experience;
- page, drawing, project, diary and canvas semantics;
- capture tools such as PencilKit and Apple speech;
- app-specific rendering and editing;
- explicitly authorised derived processing.

The kernel must not contain concepts such as apartment, diary page, canvas, project stage, drawing prompt or architectural element. Applications declare these through versioned schema packages.

---

# 4. Target applications

| Trust primitive | Foundation            | Ivan’s Diary          | WeSketch                      |
| --------------- | --------------------- | --------------------- | ----------------------------- |
| Workspace       | Architecture practice | Private account       | User or studio                |
| Dataset         | Project or library    | Personal archive      | Sketch project                |
| Resource        | Document, note, task  | Book, page, entry     | Canvas, layer, generation     |
| Revision        | Drawing/file state    | Page state            | Canvas state                  |
| Blob            | PDF, IFC, image       | Audio, photo, strokes | Source, mask, generated image |
| Relation        | Drawing → project     | Audio → transcript    | Generation → selected source  |
| Tombstone       | Deleted document      | Deleted page          | Deleted layer or variant      |

Original human material remains first-class. Original audio is not replaced by transcript text. Editable drawing strokes are not replaced by a rendered image. Universal previews supplement rather than replace originals.

---

# 5. Non-negotiable invariants

1. Canonical blob bytes are never overwritten.
2. Every canonical blob is content-addressed and SHA-256 verifiable.
3. Every revision is append-only.
4. Every revision references immutable blobs and/or an immutable canonical payload.
5. Restoration creates a new revision linked to the restored source.
6. Every tenant-scoped record belongs to exactly one workspace.
7. Every portable unit belongs to exactly one dataset.
8. Cross-workspace relations are rejected unless an explicit sharing protocol permits them.
9. Apps never access Trust Core tables or canonical storage paths directly.
10. Canonical writes pass through Trust Core commands, authentication and policy checks.
11. UI permissions are never the only enforcement mechanism.
12. Deletion is logical by default and creates a tombstone.
13. Physical purge is a separate privileged workflow.
14. A blob cannot be purged while any retained revision references it.
15. Audit events are append-only and tamper-evident.
16. Exports reconstruct data without the originating app or provider.
17. Imports verify completely before committing canonical state.
18. Failed cross-store operations resume, return an idempotent result or quarantine safely.
19. No last-write-wins policy silently discards meaningful work.
20. Derived AI or semantic data never controls canonical evidence.
21. Original human expression remains preserved alongside derivatives.
22. An independent implementation can verify Trust Core archives.
23. Metadata verification is never represented as full-byte verification.
24. Unattached immutable bytes are retained for reconciliation, not automatically deleted.
25. A completed backup job is not recovery proof; only a verified restoration is recovery proof.

Any implementation shortcut violating an invariant requires stopping work and obtaining explicit human approval. It must not be hidden behind an ADR.

---

# 6. Architecture

Use a modular monolith initially:

```text
Application schemas and apps
          ↓
TypeScript SDK / Swift SDK / HTTP API
          ↓
Identity → policy → Trust commands and queries
          ↓
Revision engine + durable operation state machines
          ↓
PostgreSQL metadata + immutable object storage
          ↓
Audit + outbox + worker + verification + reconciliation
          ↓
Backup + archive + independent verification
```

The future semantic substrate remains adjacent:

```text
Canonical revision
  → explicitly authorised processing job
  → derived result with exact source lineage
```

## Deployment profiles

### Server-authoritative

For Foundation and multi-user applications:

- PostgreSQL is authoritative for metadata;
- S3-compatible storage holds canonical blobs;
- the Trust API is the only write path;
- clients may cache but never hold the only canonical copy;
- policy, audit and tenancy are centrally enforced.

### Local-first personal

For iPad and personal applications, later in Release 0.5:

- SQLite holds local revision metadata;
- encrypted local files hold working blobs;
- stable identity is assigned before sync;
- a remote continuity store provides independent recovery;
- conflicts create branches;
- app deletion must not remove the only recoverable copy.

### Hybrid

- devices create immutable local revisions;
- the server validates schema, policy, lineage and integrity;
- stale commits branch or return a conflict;
- valid local work is never silently discarded.

---

# 7. Technology baseline

- TypeScript strict mode;
- current supported Node.js LTS selected and pinned by maintainers;
- pnpm workspaces and frozen lockfile;
- PostgreSQL with committed ordered migrations;
- MinIO for local S3-compatible integration;
- Amazon S3 adapter after MinIO contracts pass;
- React and Vite Control Centre;
- Vitest and later Playwright;
- Docker Compose;
- SHA-256;
- UTC timestamps;
- JSON Schema at application boundaries;
- OpenAPI 3.1 generated from actual transport contracts;
- provider-neutral OpenID Connect authorization-code flow with PKCE.

Avoid initially:

- microservices, Kafka and Kubernetes;
- blockchain;
- custom cryptography;
- vector databases and graph databases in the canonical kernel;
- direct mobile access to PostgreSQL or object storage;
- provider IDs as canonical identities;
- application-specific domain types in the kernel.

---

# 8. Current checkpoint 0.1L

## 8.1 Implemented and locally verified

The current source includes:

- pnpm modular-monolith workspace;
- generic `Workspace`, `Dataset`, `Resource`, `Revision`, `BlobObject`, `Relation` and `Tombstone` types;
- revision-number, parentage, workspace and stale-base invariants;
- provider-neutral object-storage contract;
- safe content-addressed and temporary object keys;
- MinIO/S3-compatible adapter;
- immutable-object ingestion service with hashing, byte-length checks and workspace deduplication;
- upload state-machine transitions;
- append-only SHA-256 audit chain;
- PostgreSQL migrations `0001` through `0010`;
- PostgreSQL metadata schema, constraints, RLS policies and outbox foundation;
- schema registry with immutable namespace/name/version identity and digest validation;
- `app/ivans-diary/1.0.0` synthetic schema and fixture;
- diary, journal, sketchbook, page, text, drawing, audio, bookmark and tombstone fixture data;
- explicit `synthetic-demo` classification with no personal information;
- PostgreSQL migration runner with checksums and idempotent ordering;
- transactional synthetic seeding;
- deterministic portable-ID to UUID mapping;
- PostgreSQL history, blob, schema, verification, identity-session, outbox and reconciliation adapters;
- immutable revision creation with optimistic head locking;
- logical deletion with tombstones;
- restoration as a new revision with `restored_from_revision_id`;
- revision and blob immutability triggers;
- authenticated revision, deletion, restoration, history and verification routes;
- workspace/role capability checks;
- short-lived HTTP-only administrator sessions and CSRF protection;
- OpenID Connect authorization-code flow with S256 PKCE, state, nonce and browser binding;
- strict issuer, audience, signature, algorithm and claim validation;
- shared hashed PostgreSQL identity sessions;
- metadata and streaming full-byte verification;
- persisted verification runs and blob verification state;
- revision-graph verification helpers;
- leased outbox worker with `FOR UPDATE SKIP LOCKED`;
- exponential retry, attempt accounting and terminal quarantine;
- reconciliation incidents for missing or unattached objects;
- safe temporary cleanup that refuses canonical keys;
- simulated and real process failure injection across all eight upload checkpoints;
- deterministic Docker Compose orchestration for PostgreSQL and MinIO;
- least-privilege runtime, worker, verification, audit and backup roles;
- Docker-backed migration, checksum, constraint, immutability and RLS proofs;
- live MinIO storage-contract proof;
- authenticated durable object-ingest API with persisted idempotency checkpoints;
- transactional blob metadata, audit and outbox persistence;
- real API termination and restart proof;
- shared Release 0.1 route, schema, operation-state and stable error-code contracts;
- generated OpenAPI 3.1 with an enforced no-drift check;
- handwritten `@trust-core/sdk` public TypeScript facade;
- scoped policy assignments for user, service and registered-application principals;
- application capability checks, infrastructure/content separation and time-limited break-glass grants;
- metadata, full-blob, resource, dataset and workspace verification;
- public queries and commands for workspaces, applications, schemas, datasets, resources, relations, uploads, operations, history, audit, verification and service health;
- materially different WeSketch schema and deterministic canvas/lineage fixture;
- live PostgreSQL/MinIO proof reading both Ivan's Diary and WeSketch through the public SDK;
- Control Centre sections for Home, Datasets, Flow, Health, History,
  Portability and Access;
- interactive recovery and verification fixture workflows plus live SDK-backed snapshot, health, history, restoration and verification paths;
- React-Flow-style system topology;
- compatibility, retention, trust-boundary, threat-model, identity-provider and recovery documentation;
- CI quality and generated-contract gates, with scheduled/main Docker integration and sanitized report artifacts;
- strict TypeScript checks;
- all source-level workspace tests passing;
- successful Control Centre production build.

## 8.2 Current test status

```text
Lint/format gate: PASS
Generated OpenAPI drift: PASS
TypeScript strict checks across 18 projects: PASS
All source-level workspace tests: PASS
Control Centre production build (1,584 modules): PASS
TRUST TEST CANDIDATE: PASS (service adapters; Docker gate pending)
Docker PostgreSQL proof: 13 PASS
Docker MinIO contract proof: 5 PASS
Docker live API route/upload/scoped-verification/dual-fixture proof: PASS
Docker process interruption checkpoints: 8 PASS
TRUST TEST: PASS
```

The source-only marker proves domain and adapter behavior. The separate Docker
gate proves PostgreSQL, MinIO, RLS, worker leasing, live API behavior and
process interruption against real services. Reports are written to
`reports/release-0.1-docker-gate.json` and
`reports/release-0.1-docker-gate.md`.

The latest generated Docker report records a 27.216-second run on `win32 x64`,
Node `v25.2.1` and Docker Linux engine `29.6.2`. The working tree contains
uncommitted changes, so the report's source-revision metadata is not presented
as current committed-HEAD evidence.

## 8.3 Remaining post-0.1 operational hardening

Release 0.1 is complete. These deployment exercises remain distinct from its
implemented product scope and local real-service gate:

- integrate organisation identity against a real external OIDC provider tenant
  and verify production claim mapping, MFA/passkey and session behavior;
- execute production backup/restore and credential-rotation drills in the
  target operating environment;
- implement and prove Release 0.2 archive/export/import portability.

---

# 9. Release 0.1 completion checklist

Repository inspection and the verified 0.1L completion gates produced this status:

1. [x] Run migrations `0001–0010` against clean PostgreSQL.
2. [x] Provision separate migration, runtime, worker, verification, audit and backup test roles.
3. [x] Prove real RLS isolation and cross-workspace substitution denial.
4. [x] Run MinIO storage contracts with streamed bytes and failure cases.
5. [x] Implement and wire the durable live upload command around `operations`, object storage, blob metadata, audit and outbox.
6. [x] Require an idempotency key for durable object ingestion and return the prior operation result.
7. [x] Ensure blob commit, metadata, audit and outbox transitions are persisted and resumable.
8. [x] Ensure implemented history and ingest metadata transactions emit outbox events atomically.
9. [x] Run competing real outbox workers and prove single event completion.
10. [x] Terminate and restart the API process at each cross-store ingest checkpoint and prove recovery.
11. [x] Run full-byte verification against real MinIO bytes.
12. [x] Extend verification into resource, dataset and workspace operational runs.
13. [x] Complete the public Release 0.1 API commands and queries beyond the original Docker Trust Test surface.
14. [x] Generate OpenAPI 3.1 from actual contracts and enforce a no-drift check.
15. [x] Add the handwritten TypeScript SDK facade so apps do not import server packages.
16. [x] Add a second materially different application schema fixture: WeSketch.
17. [x] Complete scoped policy boundaries for assignments, application capabilities, infrastructure separation and break-glass access.
18. [x] Complete the remaining ADR, stable error-code, compatibility, retention, trust-boundary, threat-model and operational contracts.
19. [x] Add CI for lint, generated OpenAPI, strict typecheck, tests, production build, the service-adapter candidate and scheduled/main Docker integration.
20. [x] Implement `pnpm trust:test:docker` and its machine/human reports.

All Release 0.1 checklist items are complete. External-provider identity
integration, production backup/restore and credential-rotation drills, and
Release 0.2 archive/export/import remain explicitly outside this checkpoint.

Codex must inspect the repository before assuming any listed gap remains. If current code already satisfies an item, prove it with evidence and update this document.

---

# 10. Generic domain model

## Workspace

Top-level tenancy, policy and security boundary. Resolve it from authenticated identity and membership; never trust a client-supplied workspace ID by itself.

## ApplicationRegistration

Identifies an integrating application, its version, schema packages, capabilities and status. Registration never grants blanket access.

## SchemaPackage

Immutable identity comprising namespace, name and semantic version with a digest-pinned manifest. Preserve permitted unknown fields. Never execute imported schema code.

## Dataset

Portable ownership and export boundary with workspace, schema, type, name, status, retention policy and provenance.

## Resource

Stable application-visible identity. Mutable canonical content never lives directly on the resource row; the row points to an immutable current revision.

## Revision

```text
id, workspace_id, dataset_id, resource_id
revision_number, parent_revision_id, merge_parent_revision_ids
schema_package_id, schema_version
canonical_payload_json, canonical_payload_hash
created_by, created_on_device_id, source, change_note
restored_from_revision_id, created_at
```

Revisions are append-only, monotonically numbered per resource, explicitly parented and deterministically hashed. Restoration cites its source. Conflicts branch or fail explicitly.

## BlobObject

```text
id, workspace_id, sha256, byte_length, media_type
storage_provider, storage_key
encryption_state, verification_state, created_at
```

Deduplicate only within a workspace. Storage keys contain no sensitive names.

## RevisionBlob

Links revisions to blobs using roles such as original, editable, primary, preview, thumbnail, audio, stroke data, rendered fallback or attachment.

## Relation

Typed, namespaced, auditable relation among resources, revisions, blobs or controlled external IDs. Cross-workspace endpoints are rejected by default.

## Tombstone

Logical deletion record containing subject, actor, reason, recovery deadline, prior revision and purge state.

## AuditEvent

Append-only significant event containing actor, action, subject, request/correlation/operation IDs, previous hash, event hash, metadata and timestamp.

## Operation and OutboxEvent

Durable cross-store workflow state and transactionally emitted asynchronous work. Operation identity includes operation type, workspace and idempotency key.

## Logical Data Model contract

Before adding the public Release 0.2 portability routes, maintain a
provider-independent Logical Data Model describing the meaning, ownership,
cardinality and lifecycle of the canonical entities above. It is an
architectural contract, not a diagram of PostgreSQL tables.

It must identify:

- tenancy, dataset and application ownership boundaries;
- stable portable identities versus provider and physical-store identifiers;
- immutable records, mutable pointers and append-only histories;
- principal, role, capability, assignment and scope relationships;
- archive, manifest, import-plan, identity-map, operation and checkpoint
  relationships;
- deletion, retention, restoration and purge states;
- identities and relations that must survive export and reconstruction;
- canonical, derived, operational and audit classifications;
- invariants enforced by contracts, services, PostgreSQL, object storage and
  policy respectively.

The canonical API schemas, `.trustarchive` logical representation and physical
PostgreSQL/MinIO model must be checked against this contract. Physical storage
details must not leak back into the logical model as domain meaning.

---

# 11. Cross-store upload contract

```text
requested
→ authorised
→ temporary_upload_created
→ bytes_received
→ hash_verified
→ immutable_object_committed
→ metadata_committed
→ audit_committed
→ completed
```

Failure states:

```text
rejected
failed_retryable
failed_terminal
quarantined
```

Rules:

- hash while streaming;
- never trust a client hash;
- require an idempotency key;
- never create a revision referencing missing bytes;
- repeated completed requests return the original result;
- a blob committed before failed metadata is reconciled and retained;
- metadata pointing to inaccessible bytes creates a critical incident;
- temporary cleanup cannot delete canonical keys;
- retries preserve operation identity and completed checkpoints.

---

# 12. History, deletion, recovery and purge

Apps must be able to:

- list revisions and parentage;
- distinguish current, historical, restored, merged and conflicted states;
- open old states without mutation;
- restore old state as a new revision;
- logically delete resources;
- list recoverable tombstones;
- recover without erasing deletion history.

Physical purge is not ordinary deletion. It requires retention and hold checks, reference analysis, deduplication safety, privileged approval, a purge plan, audit, report and resumable failure handling. Sensitive deployments should support dual approval.

---

# 13. Verification

Verification levels:

1. **Metadata:** object locator, existence and expected metadata.
2. **Full blob:** stream bytes, recompute byte length and SHA-256.
3. **Resource:** current pointer, revision ancestry, schema and referenced blobs.
4. **Dataset:** workspace scope, resources, relations, tombstones, retention and audit.
5. **Workspace:** tenancy, policy, orphan states, operational summaries and audit partitions.

Persist verification runs as operational records. Verification never mutates canonical history. A failure may update operational verification state and create an incident.

---

# 14. Identity and authorisation

Trust Core accepts identity from an approved provider and applies its own workspace/policy checks.

Current identity foundation includes:

- OIDC authorization-code flow;
- S256 PKCE;
- one-use state;
- nonce;
- browser-binding cookie;
- signed ID-token verification;
- issuer and audience validation;
- deny-by-default role/workspace claim mapping;
- hashed shared sessions;
- HTTP-only session cookie;
- separate CSRF proof for mutation.

Passkeys and MFA belong at the organisation identity provider. Trust Core must not store biometric credentials.

Required action vocabulary includes workspace, dataset, resource, blob, relation, history, audit, verification, retention, purge, access and break-glass actions.

Infrastructure operators may inspect health without automatic content permission. Break-glass access must be strongly authenticated, time-limited, reasoned, prominently audited and automatically revoked.

---

# 15. Control Centre

The Control Centre is an operational client, not a database administrator.

Required sections:

- Home;
- Dataset registry;
- System flow;
- Health;
- History and recovery;
- Portability;
- Access.

It must not expose raw SQL, arbitrary object editing or direct storage access. Operational integrity access is separate from content preview permission. Every mutation uses the public API.

The current UI preserves a typed synthetic fixture mode for safe visual
exploration. When `VITE_TRUST_API_BASE` is configured, its HTTP gateway uses
the public TypeScript SDK for authenticated live snapshot, storage/backup
health, verification reports, history, restoration and verification commands.
Vercel hosts only this static SPA; the Trust API, worker, PostgreSQL and
canonical object storage are separately operated services.

The Portability screen uses the public SDK for archive verification, dry-run
planning and guarded import execution. Execution requires both explicit
confirmation and a fresh same-principal administrator credential; the UI does
not retain that proof. Live execution remains unavailable while the production
provider is deliberately unconfigured pending the deferred PC/Docker proof. The
Access screen exposes fixture identities, scoped assignments, role boundaries,
session assurance and preview-only assignment controls. Live assignment data
and mutations remain unavailable until public policy-administration routes are
implemented; authentication and authorization continue to be enforced by the
Trust API rather than by UI state.

---

# 16. Release 0.1 Docker integration gate

Use a Docker-capable machine and the separate PC handoff instructions.

Required proof:

## PostgreSQL

- clean and repeated migrations;
- checksum tamper rejection;
- real constraints and immutable triggers;
- least-privilege runtime ownership separation;
- RLS workspace isolation;
- worker privilege boundary;
- concurrent revision conflict behavior;
- atomic metadata/audit/outbox transactions;
- identity-session expiry and revocation;
- verification and reconciliation persistence.

## MinIO

- temporary streamed upload;
- accurate byte count;
- SHA-256 verification;
- immutable commit;
- duplicate-byte idempotency;
- read/head consistency;
- missing, denied and outage behavior;
- safe temporary cleanup;
- canonical deletion refusal;
- no overwrite with different bytes.

## Real process interruption

Interrupt before or after:

1. temporary upload;
2. byte receipt;
3. hash verification;
4. immutable commit;
5. metadata commit;
6. audit/outbox commit;
7. client acknowledgement;
8. reconciliation retry.

After restart, each operation must resume, return its prior completed result, reconcile or quarantine. It must not silently lose, duplicate or misreference canonical data.

## Gate output

Add:

```text
pnpm trust:test:docker
```

Success:

```text
TRUST TEST: PASS
```

Failure:

```text
TRUST TEST: FAIL
```

Failure exits non-zero and writes sanitised JSON and Markdown reports.

---

# 17. Release roadmap after 0.1

## 0.2 — Portability proof

Implement `.trustarchive` as documented ZIP64 with manifests, schemas, JSONL records, content-addressed blobs, checksums, optional signatures and human README.

Required:

- export at a defined logical point;
- full hash verification or explicit exceptions;
- path traversal and decompression-bomb protection;
- dry-run import;
- schema/version/reference/parentage/audit validation;
- ID conflict handling;
- commit only after complete validation;
- independent reference viewer;
- Ivan and WeSketch datasets;
- source destruction and clean reconstruction.

**Gate:** independent reconstruction succeeds without the source app or provider.

### Deferred PC/Docker proof

Source-only archive implementation may proceed, but the portability gate remains
open until a Docker-capable PC runs export, destroys the isolated PostgreSQL and
MinIO source stores, imports into clean stores, verifies both Ivan's Diary and
WeSketch, and exercises corrupted, missing, oversized, traversal and interrupted
archive cases. The report must identify the exact clean commit. Real OIDC,
production ingress, secret rotation, monitoring, and combined-store recovery are
separate external 0.1P/0.3 gates recorded in `CHECKPOINT_0.1P.md`.

## 0.3 — Cloud and recovery proof

- Amazon S3 adapter;
- managed PostgreSQL deployment guide;
- encryption and key recovery;
- S3 versioning and appropriate Object Lock;
- separately administered backup/replication;
- monitoring and alerts;
- point-in-time database restoration;
- missing-blob restoration;
- primary-account-unavailable drill.

**Gate:** verified recovery succeeds while the primary environment is unavailable.

## 0.4 — Reusable SDK proof

- stable TypeScript SDK;
- `TrustCoreKit` Swift Package;
- generated transport wrapped by handwritten facades;
- two materially different applications;
- TypeScript/Swift compatibility fixtures;
- no app imports server internals or accesses storage directly.

**Gate:** Ivan’s Diary and WeSketch can use the same public trust module without kernel changes.

## 0.5 — Local-first continuity

- encrypted SQLite metadata;
- encrypted local blobs;
- device identity;
- durable sync queue and cursors;
- background upload;
- branch conflicts and explicit merges;
- reinstall recovery;
- personal continuity backup.

**Gate:** offline edits from two devices sync without silent loss.

## 0.6 — Derived-system bridge

- authorised `ProcessingJob`;
- source revision and blob lineage;
- derived result contract;
- independent derived-data retention/deletion;
- rebuild without canonical mutation rights.

**Gate:** the derived system can be destroyed and rebuilt without affecting Trust Core.

## 0.7 — Practice intelligence and Large Database Model readiness

A Large Database Model is a future derived intelligence system trained or
adapted over governed enterprise records. It is distinct from the Logical Data
Model contract and must never become part of the canonical Trust Core kernel.

Prepare for it through permissioned analytical snapshots, stable semantics,
temporal history, outcome labels, lineage and explicit human feedback. Begin
with explainable baselines—SQL and graph queries, similarity embeddings,
statistics and conventional anomaly detection—before training or adopting a
specialised model.

Every learned output must record its source snapshot, permission scope, model
and dataset version, creation time, confidence or similarity basis and human
acceptance or rejection. It remains derived evidence and may not silently
rewrite canonical facts, permissions, history or retention state.

**Gate:** on held-out practice questions, a learned database model produces a
measurable improvement over simpler baselines without tenant leakage,
permission bypass or loss of source-level explanation.

## Next source-only checkpoints before Docker is available

1. **0.2E — Logical model and contract alignment:** publish the Logical Data
   Model, invariant matrix and mappings to API, archive and physical stores;
   resolve identity or lifecycle inconsistencies.
2. **0.2F — Portability API candidate:** add authenticated upload,
   verification, dry-run planning, operation-status and guarded execute
   contracts using the provider-neutral executor; prove authorization,
   idempotency and failure behavior with source tests.
3. **0.2G — Control Centre and independent viewer candidate:** connect live UI
   states to the public contracts, retain explicit re-authentication and
   confirmation boundaries, and build a read-only reference viewer for both
   synthetic fixtures.
4. **0.2H — PC/Docker portability proof (deferred):** implement PostgreSQL and
   MinIO production adapters, terminate and resume real processes, destroy the
   isolated source stores, reconstruct both fixtures and attach sanitized
   evidence to the exact clean commit.

Checkpoints 0.2E through 0.2G may produce candidate evidence without Docker.
Only 0.2H may close the Release 0.2 portability gate.

Checkpoint 0.2E is recorded in `CHECKPOINT_0.2E.md`; its authoritative model and
matrix are `docs/logical-data-model.md` and
`contracts/logical-data-model-invariants.md`.

Checkpoint 0.2F is recorded in `CHECKPOINT_0.2F.md`. The source candidate now
has authenticated archive upload/verification, dry-run planning, guarded
execution and operation-status contracts plus the handwritten SDK surface.
Fixture mode executes the provider-neutral kernel; live PostgreSQL/MinIO
adapters remain deliberately unavailable until 0.2H.

Checkpoint 0.2G is recorded in `CHECKPOINT_0.2G.md`. The Control Centre now
drives the SDK portability lifecycle, privileged execution has a same-principal
re-authentication boundary, and `@trust-core/archive-viewer` reconstructs both
fixtures directly from verified archive bytes. The checkpoint lists the
remaining PC/Docker destruction, reconstruction, interruption and real-OIDC
tests; none are claimed by the source candidate.

The first 0.2H preparation slice is recorded in `CHECKPOINT_0.2H_PREP.md`.
It adds privileged dataset-scoped archive creation/download contracts, SDK
methods and a runnable offline viewer. Fixture mode proves the byte handoff for
Ivan and WeSketch; PostgreSQL/MinIO export, durable operations, streaming and
destructive reconstruction remain unproved until the PC/Docker gate.

---

# 18. Application integration requirements

All applications implement the versioned Trust Core Application Protocol
`TCAP/1.0`, defined in `contracts/application-protocol.md` and the machine
manifest schema `contracts/application-manifest.schema.json`. The authoritative
source validator and deterministic method/agent-brief generator live in
`@trust-core/app-protocol`.

TCAP registration identifies an application and its requested schema packages
and capabilities; it never grants access by itself. Apps use the public SDK/API,
stable idempotency keys, optimistic revision concurrency, declared blob roles,
append-only history, logical-first deletion and archive round-trip proof. Direct
application access to Trust Core PostgreSQL, object storage or server packages
is prohibited.

The Control Centre App Protocol section generates a candidate manifest, method
map and agent handoff locally. Generation is not schema publication or access
approval; administrator review and the governed API lifecycle remain required.

Every future application must provide:

1. globally unique application namespace;
2. application registration;
3. versioned schema package;
4. resource types;
5. relation types;
6. blob roles;
7. retention defaults;
8. original/editable/fallback/derived classifications;
9. migration fixtures;
10. TypeScript or Swift integration;
11. unknown-field compatibility tests;
12. export/import round trip.

## Ivan’s Diary

Preserve original audio, transcript relation, editable strokes, pen-event history where supplied, rendered fallback, page composition, bookmarks and recoverable deletion.

## WeSketch

Reconstruct:

```text
source canvas revision
→ selected region and mask
→ prompt and generation settings
→ generated image
→ placement transform
→ destination layer and new canvas revision
```

## Foundation

Use server-authoritative datasets for projects, documents, drawings, models, notes, tasks, timesheets, resources and decisions with organisational policy and retention.

---

# 19. Security and privacy requirements

- TLS for every non-local transport;
- encryption at rest;
- secrets outside source and logs;
- scoped service identities;
- credential rotation and recovery procedures;
- separate production and backup trust boundaries;
- content-free operational logs;
- no storage-triggered AI processing;
- explicit authorisation for derived processing;
- exact lineage for every derivative;
- alerts for hash mismatch, missing blobs, broken audit, stale backup, privileged denial, cross-workspace access, anomalous export, purge and key failures.

Do not promise end-to-end encryption until sharing, search, recovery, support and key-loss behavior are implemented and tested.

The threat model must cover compromised users, admins, apps, API, database and storage; ransomware; malformed archives; tenant escape; replay; tampering; stolen devices; app deletion; lost keys; supply-chain compromise; insider export; backup compromise and provider outage.

---

# 20. Codex execution rules

1. Inspect the repository and read this specification completely before editing.
2. Preserve existing work and unrelated changes.
3. Preserve the completed Release 0.1 gates while beginning later work.
4. Begin Release 0.2 only as an explicit archive/export/import milestone.
5. Prefer invariants, integration and failure proof over more dashboard polish.
6. Never substitute provider versioning for Trust Core revisions.
7. Never allow apps direct database or storage access.
8. Never silently resolve revision conflicts.
9. Never physically delete through an ordinary delete command.
10. Require idempotency for external writes.
11. Stream large blobs.
12. Keep secrets out of source, reports and logs.
13. Record material deviations and security boundaries in ADRs.
14. Run format/lint, strict typecheck, tests, UI build and applicable Trust Test before handoff.
15. Distinguish mocked, contract, integration and recovery evidence.
16. Do not weaken RLS, immutability, hashing or audit to make tests pass.
17. Use only synthetic data during development.
18. Stop and ask if a decision materially weakens user ownership, recoverability or isolation.

---

# 21. Required Codex handoff evidence

Every milestone handoff must state:

- commit hash tested;
- exact commands run;
- test counts and failures;
- which adapters were real and which were simulated;
- migration results;
- RLS and role results;
- object-storage contract results;
- interruption and restart results;
- reconciliation/quarantine results;
- report paths;
- remaining risks;
- exact release gate status.

No checkpoint may be described as complete merely because code compiles.

---

# 22. Definition of done

## Release 0.1

Completed at checkpoint 0.1L. Real PostgreSQL/MinIO testing proves:

- blobs cannot be overwritten;
- revisions are append-only;
- restoration appends;
- workspace isolation is enforced;
- app schemas remain outside the kernel;
- durable uploads resume or reconcile;
- retries are idempotent;
- full hashes and audit chains verify;
- logical delete and recovery work;
- APIs remain domain-neutral;
- no AI is required;
- process interruption cannot corrupt canonical state;
- the Docker Trust Test passes.

The latest completion evidence is: lint PASS; generated OpenAPI no-drift PASS;
strict typecheck across 18 projects PASS; all source-level workspace tests
PASS; production SPA build PASS; source `TRUST TEST CANDIDATE: PASS`; 13 Docker PostgreSQL tests
PASS; 5 live MinIO tests PASS; live API route/upload/scoped-verification and
dual-fixture proof PASS; all eight interruption checkpoints PASS; final
`TRUST TEST: PASS`.

## Portability

Done only when at least Ivan and WeSketch export, the source store is destroyed, a clean environment imports them, all blobs/relations/revision graphs/tombstones/audit verify, unknown fields survive, and an independent viewer succeeds.

## Production recovery

Done only when a separately administered backup exists, a real restore drill completes, recovery does not require the old UI, key recovery is tested and privileged actions are auditable.

---

# 23. Final architectural statement

Trust Core is infrastructure for continuity.

Its success is whether people and organisations can trust that their work remains theirs, retains its original form and history, survives mistakes, app deletion, app replacement, provider change and system failure, can be moved and independently verified, and can support future intelligence without surrendering authority to it.

Build the smallest kernel that makes those guarantees real. Test it under failure. Only then allow future applications to depend on it.
