# Trust Core Platform

## Full implementation specification for Codex

**Status:** Build specification 1.0  
**Date:** 2026-08-03  
**Audience:** Codex and human maintainers  
**Purpose:** Build a reusable, application-independent continuity, trust, history, recovery and portability platform for all future applications.

---

# 1. Executive instruction

Build Trust Core as a standalone platform that future applications consume through stable APIs and SDKs.

Trust Core must preserve user and organisational data independently of any one application, interface, operating system, language, database, storage provider, cloud account, AI model or semantic system—and independently of the continued existence of the originating app.

The first proof is not a polished dashboard. It is that data can be created, revised, deleted logically, recovered, exported, destroyed locally, imported into a clean environment and independently verified.

Build the kernel first. Do not implement AI, embeddings, OCR, semantic search, RAG, graphlets or agent workflows in Release 0.1.

The required output of the first complete trust proof is:

```text
TRUST TEST: PASS
```

---

# 2. Product definition

Trust Core is a reusable data-continuity platform. It establishes:

- stable identity;
- canonical content;
- immutable revision history;
- typed relationships;
- provenance;
- logical deletion and recovery;
- retention and controlled purge;
- cryptographic integrity;
- auditability;
- provider-independent export and import;
- backup and disaster recovery;
- policy-controlled access;
- a common protocol for web, desktop, mobile and iPad apps.

It must answer:

- What is this resource?
- What is its current revision?
- What existed before it?
- Which bytes are canonical?
- Has anything changed unexpectedly?
- Who or what made the change?
- What is it connected to?
- Can it be recovered?
- Can it be reconstructed without the original app?
- Can another implementation independently verify it?

---

# 3. Foundational principle

```text
Trust Core preserves canonical evidence and history.

Applications create, organise and present that evidence.

Semantic and AI systems derive interpretations from evidence.

No application, model or derived system may silently rewrite canonical history.
```

Trust Core must remain fully operational when all AI and semantic systems are offline.

---

# 4. Target applications

Without domain logic in its kernel, Trust Core must support:

- Foundation and its architecture-practice modules;
- WeSketch;
- Ivan’s Diary / Ivan’s Book;
- future iPad drawing and detailing applications;
- future web, desktop and mobile applications;
- personal archives and organisational datasets.

| Trust primitive | Foundation            | Ivan’s Diary          | WeSketch                      |
| --------------- | --------------------- | --------------------- | ----------------------------- |
| Workspace       | Architecture practice | Private account       | User or studio                |
| Dataset         | Project or library    | Personal archive      | Sketch project                |
| Resource        | Document, note, task  | Book, page, entry     | Canvas, layer, generation     |
| Revision        | Drawing/file version  | Page state            | Canvas state                  |
| Blob            | PDF, IFC, image       | Audio, photo, strokes | Source, mask, generated image |
| Relation        | Drawing → project     | Audio → transcript    | Generation → source selection |
| Tombstone       | Deleted document      | Deleted page          | Deleted layer or variant      |

The kernel must not contain concepts such as apartment, diary, page, canvas, project stage or prompt. Apps define those through schema packages.

---

# 5. Non-negotiable invariants

1. Canonical blob bytes are never overwritten.
2. Every canonical blob is content-addressed and hash verifiable.
3. Every revision is append-only.
4. Every revision references immutable blobs and/or an immutable canonical payload.
5. Restoration creates a new revision.
6. Every tenant-scoped record belongs to exactly one workspace.
7. Every portable unit belongs to exactly one dataset.
8. Cross-workspace relations are rejected unless a separate sharing protocol explicitly permits them.
9. Apps never access Trust Core tables or canonical storage paths directly.
10. All canonical writes pass through Trust Core commands and policy checks.
11. UI permissions are never the only enforcement mechanism.
12. Deletion is logical by default and creates a tombstone.
13. Physical purge is a separate privileged workflow.
14. A blob cannot be purged while any retained revision references it.
15. Audit events are append-only and tamper-evident.
16. Exports reconstruct data without the originating app or provider.
17. Imports verify before committing canonical state.
18. Failed multi-store operations are resumable, idempotent or safely quarantined.
19. No last-write-wins policy may silently discard meaningful work.
20. Derived AI or semantic data never controls canonical evidence.
21. Original human expression remains first-class: original audio is not replaced by a transcript and editable strokes are not replaced by a preview image.
22. An independent reference tool can verify the system’s archives.

---

# 6. Architecture and deployment profiles

Use a modular monolith initially: simple deployment, strong internal boundaries, transactional metadata, easier tests and low operational burden.

```text
Apps and domain schemas
        ↓
TypeScript SDK / Swift SDK / HTTP API
        ↓
Trust Core commands and queries
        ↓
PostgreSQL + immutable object storage + audit/outbox
        ↓
Backup, replication, export and independent verification
```

The future semantic substrate is adjacent, never canonical:

```text
Canonical revision → authorised processing job → derived result with exact lineage
```

## 6.1 Server-authoritative profile

For Foundation and multi-user apps:

- PostgreSQL is authoritative for metadata;
- S3-compatible storage holds canonical blobs;
- Trust API is the only write path;
- clients may cache but never hold the only canonical copy;
- policy, audit and tenancy are centrally enforced.

## 6.2 Local-first personal profile

For offline iPad/personal apps:

- SQLite holds local revision metadata;
- encrypted local files hold working blobs;
- every change receives stable identity before sync;
- a remote continuity store provides independent recovery;
- conflicts create branches;
- app deletion must not remove the only recoverable copy;
- portable snapshots exist outside the installed app.

## 6.3 Hybrid profile

- devices create immutable local revisions;
- the server validates schema, policy, lineage and integrity;
- stale commits branch or return a conflict;
- the server never silently discards a valid local revision.

Define local-first contracts now, but implement them only after the central trust loop passes.

---

# 7. Technology baseline

## Required

- TypeScript strict mode and current Node.js LTS;
- pnpm workspaces;
- PostgreSQL and committed SQL migrations;
- MinIO for local S3-compatible development;
- Amazon S3 adapter after MinIO contract tests pass;
- Fastify or an equivalently small typed HTTP server;
- OpenAPI 3.1 generated from actual contracts;
- JSON Schema 2020-12 or Zod at boundaries;
- React + Vite Control Centre;
- Vitest and Playwright;
- Docker Compose;
- SHA-256;
- UUIDv7 or equivalent sortable random IDs;
- UTC timestamps.

SDKs:

- `@trust-core/sdk` for TypeScript;
- `TrustCoreKit` Swift Package.

Generated transport code must be wrapped behind stable handwritten SDK facades.

## Avoid initially

- microservices, Kafka and Kubernetes;
- vector databases, Neo4j or blockchain;
- custom cryptography;
- Rust as the first implementation;
- app-specific schemas in the kernel;
- direct mobile access to PostgreSQL or object storage;
- provider IDs as canonical identity.

---

# 8. Required repository structure

```text
trust-core-platform/
  README.md
  SPEC.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  docker-compose.yml
  .env.example
  apps/
    trust-api/
    trust-control-centre/
    reference-viewer/
  packages/
    core/
    protocol/
    schemas/
    policy/
    audit/
    operations/
    verification/
    archive/
    sync-contracts/
    postgres/
    storage/
    storage-minio/
    storage-s3/
    sdk-typescript/
    testkit/
  swift/TrustCoreKit/
  contracts/
    invariants.md
    threat-model.md
    trust-boundaries.md
    compatibility-policy.md
    retention-policy.md
    error-codes.md
  schemas/
    archive/
    protocol/
    fixtures/
  migrations/
  docs/
    architecture.md
    operations.md
    recovery-runbook.md
    key-management.md
    adding-an-application.md
    adding-a-storage-adapter.md
    archive-format.md
    sync-model.md
  adr/
  tests/
    unit/
    integration/
    contract/
    end-to-end/
    failure-injection/
    compatibility/
```

Required ADRs:

```text
ADR-001 Application-level revisions
ADR-002 Resource/revision/blob separation
ADR-003 Content-addressed storage
ADR-004 Modular monolith
ADR-005 Storage adapters
ADR-006 Open archive format
ADR-007 Append-only restoration
ADR-008 Derived systems remain separate
ADR-009 Trust Test release gate
ADR-010 Provider versioning is defence in depth
ADR-011 No silent last-write-wins
ADR-012 Cross-store operation state machine
```

---

# 9. Generic domain model

## Workspace

Top-level tenancy, policy and security boundary: `id`, `name`, `slug`, `status`, timestamps. Resolve workspace from authenticated identity and membership; never trust a client-supplied ID alone.

## ApplicationRegistration

Identifies an integrating app: `id`, optional `workspace_id`, `application_key`, `name`, `version`, schema-package IDs, capabilities, status and timestamp. Registration does not grant blanket access.

## SchemaPackage

Defines app-specific resource/payload types: `id`, `namespace`, `name`, semantic version, schema digest, manifest, status and timestamp.

Requirements:

- globally unique namespace;
- JSON Schemas for payloads;
- compatibility declarations and migration IDs;
- preserve permitted unknown fields on round trip;
- never execute imported schema code;
- hash-pin or sign production schemas.

## Dataset

Portable ownership/export boundary: `id`, `workspace_id`, `schema_package_id`, `dataset_type`, `name`, status, retention policy, creator and timestamps.

## Resource

Stable app-visible identity: `id`, workspace/dataset IDs, `resource_type`, optional title, status, `current_revision_id`, creator and timestamps. Mutable canonical content does not live on the resource row.

## Revision

Immutable app-level state:

```text
id, workspace_id, dataset_id, resource_id
revision_number, parent_revision_id, merge_parent_revision_ids
schema_package_id, schema_version
canonical_payload_json, canonical_payload_hash
created_by, created_on_device_id, source, change_note
restored_from_revision_id, created_at
```

Rules: append-only; monotonic number per resource; explicit parent; conflicts branch; deterministic JSON hashing; large/binary content uses blobs; restoration records its source.

## BlobObject

Immutable bytes:

```text
id, workspace_id, sha256, byte_length, media_type
storage_provider, storage_key, encryption_key_ref
encryption_state, verification_state, created_at
```

Deduplicate within a workspace only. Never include sensitive names in keys. Suggested key:

```text
workspaces/{workspace_id}/objects/{sha256[0:2]}/{sha256}
```

## RevisionBlob

Links a revision to a blob: revision/blob IDs, role, logical name and metadata. Roles include `primary`, `original`, `editable`, `preview`, `thumbnail`, `audio`, `stroke_data`, `rendered_fallback` and `attachment`.

## Relation

Typed connection among resources, revisions, blobs or external IDs: source, target, namespaced relation type, metadata, creator, start/end timestamps. Relations are appended or explicitly ended.

## Tombstone

Logical deletion: subject, actor, deletion time, reason, recovery deadline, previous revision and purge state.

## AuditEvent

Append-only significant action: actor, action, subject, request/correlation/operation IDs, previous hash, event hash, metadata and timestamp.

## Operation

Durable workflow spanning database and object storage: type, idempotency key, state, request/result, error, retry count and timestamps.

## OutboxEvent

Transactional asynchronous record written with metadata changes: operation, event type, payload, available time, attempts, processing time and error.

## Device

Later local-first identity: actor, public key reference, platform, app version, last seen and status.

## RetentionPolicy and LegalHold

Policy-driven recovery window, minimum history, backup retention, purge eligibility, holds and separate derived-data treatment.

## Logical Data Model contract

Maintain a provider-independent Logical Data Model describing entity meaning,
ownership, cardinality and lifecycle. It is not a mirror of PostgreSQL tables.
It must map canonical identities, tenancy and policy scopes, immutable history,
archive/import operations, deletion and recovery semantics across the public
contracts, `.trustarchive` representation and physical PostgreSQL/MinIO model.

The mapping must explicitly distinguish stable portable IDs from provider IDs,
canonical from derived data, and domain invariants from physical enforcement.

---

# 10. Database and storage requirements

Enforce in PostgreSQL:

```text
unique(workspace_id, sha256) on blobs
unique(resource_id, revision_number) on revisions
unique(operation_type, workspace_id, idempotency_key) on operations
current_revision_id belongs to the same resource
all revision/blob/relation endpoints remain in workspace
no cascade deletion of revisions, blobs, audits or tombstones
```

Use foreign keys and check constraints, not only TypeScript types. Enable row-level security on tenant tables and force it for runtime roles where appropriate. Use separate roles for migrations, runtime, workers, audit and backup. Runtime must not own tenant tables.

Provider-neutral interface:

```ts
interface ObjectStorage {
  createTemporaryUpload(
    input: CreateTemporaryUploadInput,
  ): Promise<TemporaryObject>;
  writeTemporary(input: WriteTemporaryInput): Promise<WriteResult>;
  commitImmutable(input: CommitImmutableInput): Promise<StoredObject>;
  openReadStream(input: ObjectLocator): Promise<NodeJS.ReadableStream>;
  head(input: ObjectLocator): Promise<ObjectMetadata>;
  exists(input: ObjectLocator): Promise<boolean>;
  copyImmutable(input: CopyImmutableInput): Promise<StoredObject>;
  deleteTemporary(input: ObjectLocator): Promise<void>;
}
```

Required adapters: fake, test-only filesystem, MinIO and Amazon S3. All pass one contract suite. Provider version IDs never become Trust Core revision IDs.

Production S3 baseline: versioning as defence in depth, Object Lock where policy requires WORM, public access blocked, scoped identities, encryption, separately administered replication, and no app bucket-list or broad-delete permission.

# 11. Cross-store operation model

PostgreSQL and object storage do not share an atomic transaction. Implement durable state machines.

## Upload

```text
requested → authorised → temporary_upload_created → bytes_received
→ hash_verified → immutable_object_committed → metadata_committed
→ audit_committed → completed
```

Failure states: `rejected`, `failed_retryable`, `failed_terminal`, `quarantined`.

Rules:

- require an idempotency key for every external write;
- calculate SHA-256 while streaming;
- never trust a client hash without verification;
- never create a revision pointing to a missing blob;
- reconcile a blob committed before a failed metadata transaction;
- alert critically if committed metadata later points to inaccessible storage;
- repeated completed requests return the original result;
- temporary cleanup never touches canonical objects.

## Revision commit

Require actor/workspace context, resource, base revision, schema/version, valid payload, authorised existing blobs, policy approval and optimistic concurrency.

If the base is stale:

- return `BASE_REVISION_CONFLICT`;
- preserve the proposal;
- create a branch or require an explicit merge;
- never silently overwrite current work.

---

# 12. Local-first sync contract

Define now and implement after the server trust proof.

- IDs generated locally remain stable after sync.
- Revisions record actor, device and parents.
- Device clocks are informational; parentage defines history.
- Sync exchanges immutable revisions/events using cursors.
- Safe metadata fields may declare merge strategies.
- Conflicting payloads form branches.
- Explicit merges cite all parents.
- Delete-versus-edit is a conflict, not automatic erasure.
- Binary/drawing conflicts become variants unless the app has a deterministic merge.

CRDTs may live inside app payloads for collaborative text or strokes, but Trust Core does not make every resource a CRDT. CRDT checkpoints still become immutable revisions.

Reinstall recovery:

1. Authenticate owner.
2. Discover authorised datasets.
3. Validate remote manifests and heads.
4. Reconstruct local metadata.
5. Download current blobs first.
6. Restore older blobs lazily where allowed.
7. Verify hashes.
8. Resume sync without changing IDs.

---

# 13. History, deletion and recovery

Apps must list revisions, show parentage, distinguish current/historical/restored/merged/conflicted states, open old states without mutation, restore as a new revision and duplicate old states when authorised.

Deleting a resource changes status, creates a tombstone, records audit, removes it from active queries and retains history according to policy.

Recovery creates new state and audit history; it does not erase the deletion.

Purge requires privileged authorisation, retention/hold checks, reference analysis, deduplication safety, confirmation, purge plan, audit event, report and resumable failure handling. Support dual approval for sensitive deployments.

---

# 14. Open archive format

Use a documented ZIP64 container with extension `.trustarchive`.

```text
archive.trustarchive
  manifest.json
  README.txt
  schemas/trust-core/
  schemas/applications/
  records/
    workspace.jsonl
    datasets.jsonl
    resources.jsonl
    revisions.jsonl
    revision-blobs.jsonl
    blobs.jsonl
    relations.jsonl
    tombstones.jsonl
    audit-events.jsonl
    retention.jsonl
  blobs/{sha256[0:2]}/{sha256}
  previews/
  checksums/sha256sums.txt
  signatures/manifest-signature.json
```

Manifest includes format/version, export/workspace/dataset IDs, creator/time, source version, schema packages, record/blob counts, total bytes, checksum algorithm, canonical JSON profile and signature profile.

Export requirements:

- durable operation at a defined logical point;
- all included blobs hash verified or clearly reported;
- checksums generated after assembly;
- production manifests signed;
- no provider-specific data required for reconstruction;
- preserve proprietary editable originals and universal fallbacks where the app declares them.

| Content          | Original/editable      | Portable fallback           |
| ---------------- | ---------------------- | --------------------------- |
| Pencil drawing   | PencilKit/app strokes  | SVG/PDF + PNG               |
| Audio            | Original M4A/WAV       | Standard audio + transcript |
| Page composition | Structured payload     | PDF preview                 |
| Canvas           | Editable scene/strokes | PNG/PDF                     |
| Rich text        | Structured spans       | UTF-8 Markdown/text         |

Fallbacks never replace originals.

Import must protect against path traversal/decompression bombs, validate versions/schemas, verify hashes/signatures/counts/references/workspace boundaries/revision parentage/audit chains, detect ID conflicts, support dry run and resumption, commit only validated state, and produce human- and machine-readable reports.

Modes: preserve IDs, mapped workspace, dry run, report only and reject-on-error.

---

# 15. Cryptographic integrity

- SHA-256 for all blobs and canonical payloads.
- Full verification streams bytes; metadata verification must not be labelled full.
- Use documented deterministic JSON canonicalisation such as RFC 8785 JCS.
- Hash-chain audit events within documented partitions.
- Add checkpoint records for incremental verification.
- Sign production archive manifests using established managed cryptography.
- Store key ID, algorithm/profile, signing time and rotation/revocation history.
- Release 0.1 local archives may be unsigned but must hash all content.

Audit hash:

```text
event_hash = SHA256(canonical_json(event_without_hash) + previous_event_hash)
```

---

# 16. Identity and authorisation

Trust Core accepts authenticated identity from an approved provider/gateway and applies Trust policy. Every request resolves actor, workspace membership, app registration, request/correlation IDs, device where relevant and authentication strength where relevant.

Actions include:

```text
workspace.read
dataset.create/read/export/import
resource.create/read/revise/delete/restore
blob.upload/download
relation.create/end
history.read
audit.read
verification.run
retention.manage
purge.plan/execute
access.manage
break_glass.activate
```

Suggested role templates: owner, member, trusted supporter, workspace admin, storage operator, security admin, recovery admin, auditor, app service and verification service.

Infrastructure operators can inspect health without automatic content access.

Break-glass access is exceptional, reasoned, time-limited, strongly authenticated, prominently audited, notified where policy allows and automatically revoked.

---

# 17. Encryption, privacy and key recovery

Required:

- TLS;
- encrypted PostgreSQL volumes and object storage;
- encrypted local stores for mobile profiles;
- scoped secrets outside source control;
- rotation procedures;
- key-loss/recovery runbook;
- separate production and backup trust boundaries.

Profiles: provider-managed at-rest, customer-managed server keys, and optional client/envelope encryption for sensitive datasets.

Do not promise end-to-end encryption until the key, sharing, recovery, search and support model is implemented and tested. Personal archives need an explicit trusted recovery option; a lost device-only key can permanently destroy access.

Privacy rules:

- minimise metadata;
- never log content, transcripts, prompts, drawings or secrets;
- separate infrastructure and content permission;
- never send data to AI as a storage side effect;
- AI processing requires an explicit authorised job;
- derived data has exact source lineage and independent deletion rules;
- preserve original human material alongside all derivatives.

---

# 18. Verification service

Levels:

1. **Metadata:** record/object exist; expected size and locator match.
2. **Full blob:** stream bytes; recompute size and SHA-256.
3. **Resource:** current pointer, revision numbering/parents, blobs and schema valid.
4. **Dataset:** scopes, resources, relations, tombstones, retention and audit valid.
5. **Workspace:** tenancy, summaries, policy configuration, orphan states and audit partitions valid.

Persist verification runs as operational records without mutating canonical history.

---

# 19. Backup and disaster recovery

Protect PostgreSQL, blobs, audit, schemas, keys/key metadata, interpretation configuration and manifests together.

Production baseline:

- PostgreSQL point-in-time recovery;
- S3 versioning;
- immutable/WORM backup where appropriate;
- cross-account or separately administered replication;
- operationally/geographically independent backup;
- archive tier for long retention;
- monitored backup jobs;
- scheduled restore drills.

Define RPO/RTO per deployment.

Required exercises:

1. Restore PostgreSQL to a point in time.
2. Restore a missing blob.
3. Reconstruct from `.trustarchive`.
4. Import into another provider.
5. Verify audit after recovery.
6. Reinstall an app and recover a personal dataset.
7. Recover while the primary cloud account is unavailable.

Only a completed verified restore counts as recovery proof.

---

# 20. Observability and security monitoring

Track API latency/errors, transfer throughput, operation duration/retries, orphan temporary/unattached immutable objects, integrity failures, provider/database errors, export/import time, conflicts, denials, unusual bulk access, backup/restore age, storage growth and audit-chain failures.

Structured logs include timestamp, level, service/environment, request/correlation/operation IDs, workspace/dataset/actor, action, subject and error code—never canonical content.

Alert on hash mismatch, missing blobs, broken audit, stale/failed backup, privileged denial, break-glass, anomalous export, cross-workspace access, purge activity, object-lock/replication changes and key errors.

# 21. Public API

Use versioned `/v1` routes and stable SDK facades.

Commands:

```text
createWorkspace
registerApplication
registerSchemaPackage
createDataset
createResource
createUploadSession
completeUpload
commitRevision
restoreRevision
createRelation
endRelation
deleteResource
recoverResource
createExport
importArchive
runVerification
createPurgePlan
executePurge
```

Queries:

```text
getWorkspace
listDatasets
getDataset
listResources
getResource
getRevision
listRevisions
getRevisionGraph
listRelations
listDeletedResources
getAuditHistory
getOperation
getVerificationReport
getBackupStatus
getStorageHealth
```

Every write has idempotency, request/correlation IDs, typed errors, policy enforcement, audit linkage and operation status if asynchronous.

Required error codes include:

```text
AUTHENTICATION_REQUIRED
WORKSPACE_ACCESS_DENIED
POLICY_DENIED
SCHEMA_VALIDATION_FAILED
BASE_REVISION_CONFLICT
BLOB_HASH_MISMATCH
BLOB_NOT_FOUND
DATASET_ON_HOLD
RETENTION_PREVENTS_PURGE
ARCHIVE_SIGNATURE_INVALID
ARCHIVE_CHECKSUM_INVALID
IMPORT_CONFLICT
OPERATION_ALREADY_COMPLETED
OPERATION_RETRYABLE
INTEGRITY_FAILURE
```

Never expose provider credentials, bucket names, SQL errors or internal paths.

---

# 22. SDK requirements

## Trust Core Application Protocol

Every integrating app implements `TCAP/1.0`. The normative prose contract is
`contracts/application-protocol.md`; its machine manifest schema is
`contracts/application-manifest.schema.json`; and
`@trust-core/app-protocol` supplies validation, method derivation and an
agent-ready implementation brief. The Control Centre exposes the same generator
as a local candidate-design tool. Generated output does not publish a schema or
grant capabilities.

TCAP requires public SDK/API access, separate application identity and policy,
versioned immutable schemas, idempotent writes, optimistic concurrency,
hash-verified blob ingest, typed relations, append-only history, logical-first
deletion, unknown-field compatibility and archive round-trip conformance.

## TypeScript SDK

- authenticated configuration;
- workspace/dataset context;
- typed command/query methods;
- resumable upload and streaming download;
- idempotency helpers;
- typed error mapping;
- operation polling abstraction;
- archive initiation;
- compatibility/version reporting.

Apps must not import server packages.

```ts
const trust = createTrustClient({ baseUrl, getAccessToken, applicationKey });

const resource = await trust.resources.create({
  workspaceId,
  datasetId,
  resourceType: "com.example.wesketch.canvas",
});

await trust.revisions.commit({
  resourceId: resource.id,
  baseRevisionId: null,
  schemaVersion: "1.0.0",
  payload,
  blobRefs,
  idempotencyKey,
});
```

## Swift SDK

Create `TrustCoreKit` with Codable models, authenticated HTTP client, dataset/resource/revision APIs, background upload support, operation status, typed errors, archive manifest parsing/verification interface and compatibility reporting.

Later add SQLite local revisions, encrypted assets, durable sync queue, device identity, conflict branches, reinstall recovery and background continuity sync.

Do not encode PencilKit, Speech, Foundation projects or other app domains in the SDK.

---

# 23. Control Centre

Build a responsive React operational client with:

- **Home:** recent datasets/projects, common components and continuity summary.
- **Dataset registry:** type, owner, schema, storage profile, counts, size, integrity, backup, verification and recovery counts.
- **System flow:** apps, Trust API, identity/policy, revisions, portability, metadata, objects, audit, backup and separate semantic layer.
- **Health:** adapters, verification, replication, backup, failures, queue and restore-drill age.
- **History/recovery:** revisions, tombstones, restore points, recovery bin, audit and exports.
- **Access:** roles, services, devices, privileged sessions and break-glass history.

Operational admins can inspect integrity without content access. Content preview requires separate authorisation. Privileged access is explicit, time-limited and audited. Do not provide raw SQL or direct object editing. UI uses only the public API.

---

# 24. Independent reference viewer

Build a small app separate from product code that opens `.trustarchive`, validates structure, verifies hashes/signature, lists datasets/resources/revisions/relations, displays universal previews, extracts authorised originals, preserves unknown fields and produces a verification report.

It is a portability proof, not an editor.

---

# 25. Adding a future application

Require:

1. unique app namespace;
2. app registration;
3. schema package;
4. resource types;
5. relation types;
6. blob roles;
7. retention defaults;
8. fallback rules;
9. migration fixtures;
10. TypeScript/Swift integration;
11. compatibility tests;
12. export/import round trip.

Every app declares which material is original/canonical, editable native, universal fallback, derived, rebuildable, sensitive and eligible for explicit AI processing.

---

# 26. Required application fixtures

## Ivan archive

Types: `book`, `diary_entry`, `page`, `text_block`, `audio_entry`, `drawing`, `photo`, `bookmark`.

Original voice remains canonical; transcript is related text. Drawings may preserve editable strokes and replayable timestamped pen events. Rendered PNG/PDF is fallback. Page composition must reconstruct. Deletion is recoverable according to personal policy.

## WeSketch

Types: `project`, `canvas`, `layer`, `stroke_document`, `selection`, `generation_request`, `generated_image`, `conversation_turn`.

Relations reconstruct:

```text
source canvas revision
→ selected region and mask
→ prompt/settings
→ generated image
→ placement transform
→ destination layer and canvas revision
```

## Foundation

Types: `project`, `document`, `drawing`, `model`, `note`, `task`, `timesheet`, `resource_link`, `decision`. Use server-authoritative deployment and organisational retention.

These are test fixtures, never kernel types.

---

# 27. Threat model

Create `contracts/threat-model.md` covering compromised users/admins/apps/API/database/storage, ransomware, malformed archives, cross-tenant access, replay, blob/audit tampering, stolen devices, app deletion, lost keys, supply-chain compromise, malicious processing output, data injection into later AI, insider exports, backup compromise and provider outage.

For each document asset, attacker capability, boundary, prevention, detection, recovery, residual risk and verification test.

---

# 28. Testing strategy

## Unit

Canonical hashing, revision invariants, conflict detection, retention, relation scope, audit hashing, errors and archive path safety.

## Database integration

Constraints, transaction behaviour, RLS, runtime-role restrictions, append-only protections, outbox atomicity and idempotency.

## Storage contracts

Identical tests against fake/filesystem/MinIO/S3: immutable write, duplicates, missing object, read/head consistency, stream hashing, temporary cleanup, outage and denial.

## Failure injection

Interrupt before/after temporary upload, hash, immutable commit, metadata, audit/outbox, retry, export and import. The system must resume, reconcile or quarantine without corrupting canonical state.

## Security

Cross-workspace ID substitution, expired identity, escalation, signed-URL scope, malicious archives, RLS bypass, key leakage, bulk export and break-glass expiry.

## Compatibility

Old archive into new code, unknown fields preserved, incompatible schema rejected, TypeScript fixture read by Swift, Swift fixture read by TypeScript, both verified independently.

---

# 29. Trust Test

Command:

```text
pnpm trust:test
```

Workflow:

```text
Create workspace
→ Register two application schemas
→ Create datasets/resources
→ Upload blobs and duplicate bytes
→ Commit multiple revisions
→ Create relations
→ Produce stale-base conflict
→ Restore old revision as new revision
→ Delete and recover a resource
→ Verify blobs/resources/datasets/audit
→ Export datasets
→ Destroy test database and object store
→ Recreate clean environment
→ Import archives
→ Verify hashes, graphs, pointers, relations, tombstones and audit
→ Open with independent viewer
```

Negative cases: corrupted/missing blob, bad checksum/signature, broken audit, cross-workspace relation, duplicate retry, interrupted import, incompatible schema, blocked purge, denied access and storage outage.

Success prints `TRUST TEST: PASS`; failure prints `TRUST TEST: FAIL`, writes a machine report and exits non-zero.

---

# 30. Release sequence

## PC/Docker and external acceptance gates

Source-only implementation may proceed while the following proofs are deferred
to the authorised PC or target operating environment, but no affected release
gate may be described as passed until its evidence is attached to the exact
clean commit under test:

- `pnpm trust:test:docker` against PostgreSQL and MinIO, including RLS,
  least-privilege roles, live API/worker flows and all interruption checkpoints;
- Release 0.2 export, source-store destruction, clean PostgreSQL/MinIO import and
  independent reconstruction of Ivan's Diary and WeSketch;
- corrupt, missing, oversized, path-traversing and interrupted archive cases
  exercised through the real import boundary;
- real organisation OIDC claim mapping, MFA/passkey, disablement and session
  revocation;
- production TLS/rate-limiting ingress, secret rotation, monitoring and alert
  delivery;
- combined PostgreSQL and object-store backup/restore followed by full Trust
  Core verification.

The corresponding source checkpoint must print a candidate marker, never the
final `TRUST TEST: PASS`, until these gates succeed.

## 0.1 Central trust loop

Modular monolith, PostgreSQL, MinIO, core generic model, upload state machine, immutable storage, hashes, idempotency, policy, minimal Control Centre, verification and failure tests.

**Gate:** create/revise/restore/verify works and interrupted operations cannot corrupt canonical state.

## 0.2 Portability proof

`.trustarchive`, export/import, clean reconstruction, viewer, two app schemas and Trust Test.

**Gate:** independent reconstruction succeeds after source destruction.

Source work is staged as: 0.2A deterministic archive model and verifier; 0.2B
ZIP64 container and malicious-archive reader; 0.2C dry-run/import planning and
conflict mapping; 0.2D provider-neutral executable import kernel; 0.2E Logical
Data Model and contract alignment; 0.2F authenticated Portability API
candidate; 0.2G Control Centre integration and independent viewer candidate;
and 0.2H PC/Docker production adapters, source destruction and clean
reconstruction. Source-only work through 0.2G may proceed without Docker. Only
0.2H can satisfy the portability gate.

The 0.2F candidate routes are authenticated archive upload/verification,
dry-run planning, plan retrieval, guarded execution and import-operation status.
They are published in OpenAPI and the handwritten TypeScript SDK. Fixture mode
may execute the provider-neutral kernel; live execution remains unconfigured
until the 0.2H PostgreSQL/MinIO adapters and proof.

The 0.2G candidate connects those routes to the Control Centre and requires a
fresh same-principal credential for privileged execution. A separate read-only
viewer reconstructs Ivan's Diary and WeSketch from verified archive bytes with
no source app, API or database. Real OIDC step-up and live-store destruction and
reconstruction remain explicitly assigned to the PC/Docker acceptance gate.

The 0.2H preparation candidate adds dataset-scoped archive creation and
download through a dedicated export permission and fresh same-principal
authentication. Its fixture implementation and offline viewer prove the source
contract only; live PostgreSQL/MinIO extraction, streaming delivery and
destructive reconstruction remain part of the Docker gate.

## 0.3 Cloud/recovery proof

S3, managed PostgreSQL guide, encryption, Object Lock where appropriate, separate backup, restore drill, signed manifests and monitoring.

**Gate:** recovery succeeds with primary environment unavailable.

## 0.4 Reusable SDK proof

Stable TypeScript SDK, Swift Package, schema tooling, two materially different app integrations and cross-language tests.

**Gate:** no app imports internals or accesses storage directly.

## 0.5 Local-first continuity

SQLite, encrypted local blobs, devices, sync cursors/queue, branching conflicts, reinstall recovery and personal backup.

**Gate:** offline edits from two devices sync without silent loss.

## 0.6 Derived-system bridge

ProcessingJob, explicit handoff, derived-result contract, lineage and rebuild/deletion rules—without canonical mutation rights.

**Gate:** derived system can be destroyed/rebuilt without affecting Trust Core.

## 0.7 Practice intelligence and Large Database Model readiness

A future Large Database Model is a permissioned derived system over governed
practice records, not part of the canonical kernel and not the same artifact as
the Logical Data Model. Prepare permissioned analytical snapshots, temporal
history, outcome labels, lineage and human feedback first. Benchmark SQL/graph
queries, embeddings, statistics and conventional machine learning before model
training.

Learned outputs must preserve source snapshot, scope, model/data version,
confidence basis and review state and must never rewrite canonical facts or
policy.

**Gate:** held-out evaluations prove useful improvement over simpler baselines
without permission leakage or loss of source-level explanation.

---

# 31. Codex implementation instructions

1. Inspect the repository first and preserve unrelated work.
2. Put this document at repository root as `SPEC.md`.
3. Create the documented structure and ADRs.
4. Implement Release 0.1 only until its gate passes.
5. Begin with invariants, migrations, storage contracts and the operation state machine—not UI.
6. Add no AI dependencies.
7. Never substitute provider versioning for app revisions.
8. Never allow apps direct database/storage access.
9. Never silently resolve revision conflicts.
10. Never physically delete through ordinary delete commands.
11. Make every external write idempotent and large blobs streaming.
12. Keep secrets out of source and logs.
13. Record deviations in ADRs.
14. Run format, lint, typecheck, tests and Trust Test before handoff.
15. Report exactly which release gate passed and what remains.

Integrate with strong existing repository conventions where they do not violate invariants. Do not replace functioning infrastructure solely to match a preferred library.

---

# 32. Required initial deliverables

- working monorepo and Docker Compose;
- PostgreSQL migrations;
- MinIO adapter and adapter contract suite;
- core domain and policy packages;
- upload/operation state machine;
- audit chain and verification service;
- Trust API + OpenAPI;
- TypeScript SDK facade;
- minimal Control Centre;
- two app schema fixtures;
- independent Trust Test;
- threat model, ADRs, operations/recovery docs;
- `.env.example` without secrets;
- CI running lint, typecheck, tests and Trust Test.

---

# 33. Definition of done

Release 0.1 is done only when blobs cannot be overwritten, revisions are append-only, restoration appends, isolation is enforced/tested, app schemas stay outside the kernel, interruptions recover, retries are idempotent, hashes/audit verify, logical delete/recover works, APIs are neutral, no AI is required and all tests pass.

Portability proof is done only when two different app datasets export, the source store is destroyed, clean import reconstructs all hashes/relations/revision graphs/tombstones/audit, the independent viewer works, Swift/TypeScript fixtures round-trip and `TRUST TEST: PASS` appears.

Production recovery proof is done only when a separately administered backup exists, a restore drill completes, recovery does not require the old UI, key recovery is tested and privileged actions are auditable.

---

# 34. Final architectural statement

Trust Core is infrastructure for continuity.

Its success is whether people and organisations can trust that their work remains theirs, retains its original form and history, survives mistakes, app deletion, app replacement, provider change and system failure, can be moved and independently verified, and can support future intelligence without surrendering authority to it.

Build the smallest kernel that makes those guarantees real. Test it under failure. Only then allow future applications to depend on it.
