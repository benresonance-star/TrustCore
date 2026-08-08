# Foundation + Trust Core + Amazon S3

## Composer 2.5 implementation specification

**Status:** Implementation brief  
**Agent:** Cursor Composer 2.5  
**Scope:** Bounded implementation checkpoints only  
**Primary system:** Trust Core repository  
**Consumer:** Foundation  
**Required app boundary:** Trust Core Application Protocol `TCAP/1.0`  

---

## 1. Mission

Implement the bounded parts of the Amazon S3 integration that are suitable for Composer 2.5:

1. the `trust-storage-s3` storage adapter;
2. resumable multipart upload and download primitives;
3. policy-gated, short-lived upload and download grants;
4. quarantine, malware-scanning orchestration, and promotion primitives;
5. automated tests directly required to prove the behaviour of those four phases.

Do not redesign Trust Core, Foundation, the canonical revision model, the security model, or the recovery architecture.

The required dependency direction is:

```text
Foundation
  -> Trust Core public API/SDK
    -> Trust Core policy, audit and metadata services
      -> provider-neutral storage interface
        -> trust-storage-s3
          -> Amazon S3
```

Foundation must never access S3 buckets, object keys, AWS credentials, or Trust Core database tables directly.

### Governing application boundary: TCAP/1.0

Foundation is not a privileged or built-in Trust Core module. It is one registered application using the same Trust Core Application Protocol as Ivan's Diary, WeSketch and future apps.

The only permitted Foundation integration path is:

```text
Foundation domain/UI
  -> Foundation Trust adapter
    -> @trust-core/sdk or public /v1 HTTP API
      -> TCAP/1.0 authentication, workspace context, application registration,
         capability checks, idempotency, schema identity and typed errors
        -> Trust Core commands and queries
          -> policy, audit, operations and provider-neutral storage
            -> trust-storage-s3
              -> Amazon S3
```

The S3 adapter is an internal Trust Core infrastructure component. It must never be imported by Foundation, exposed as a Foundation service, or referenced by a Foundation schema.

All new Foundation-visible storage behaviour must be added in this order:

1. provider-neutral Trust Core command/query contract;
2. stable `/v1` transport schema and typed error contract;
3. generated OpenAPI update with no-drift verification;
4. stable `@trust-core/sdk` facade;
5. TCAP manifest/method-map/conformance update where a new application capability is required;
6. Foundation's thin adapter consuming only that public SDK/API.

Do not create Foundation-only Trust Core routes, packages, permissions, object-key rules, database columns or storage behaviour. If a capability cannot be expressed generically for any registered application, stop and return it for architecture review.

Foundation must supply and use a conforming application manifest containing its namespace, semantic application version, versioned schema package, resource types, relation types, blob roles, requested capabilities, logical-first deletion, append-only history and required portability commitments. Registration identifies Foundation but does not grant access; workspace, dataset and application policy assignments remain separate.

---

## 2. Explicit exclusions

The following work is reserved for separate architecture and security review. Do not implement it, silently design it, or broaden this task to include it:

- canonical revision-to-object transaction architecture;
- reconciliation architecture spanning PostgreSQL and S3;
- lifecycle retention policy and archival policy;
- Object Lock governance/compliance policy;
- cross-account immutable recovery architecture;
- KMS key ownership, deletion and recovery policy;
- disaster-recovery design or certification;
- Foundation desktop sync client or virtual drive;
- offline conflict semantics;
- system-wide threat modelling;
- production security certification;
- final infrastructure deployment to a production AWS account;
- migration of existing practice files;
- unrestricted AI access to stored files.

If an included checkpoint requires one of these decisions, stop and report the dependency. Do not choose a policy on the user's behalf.

---

## 3. Non-negotiable invariants

Preserve these rules throughout the implementation:

1. **Trust Core is the authority.** S3 stores bytes; it does not define identity, tenancy, permissions, logical revisions or audit meaning.
2. **Workspace is the tenancy boundary.** Every operation must be associated with a workspace and checked against Trust Core policy.
3. **No AWS credentials on client devices.** Clients receive only narrowly scoped, short-lived grants.
4. **No public objects or buckets.** Do not introduce public-read ACLs, public bucket policies or public website access.
5. **ACLs remain disabled.** Assume bucket-owner-enforced object ownership.
6. **Canonical objects are immutable.** No included operation may overwrite a canonical object.
7. **Stable application identity.** Public APIs expose provider-neutral identifiers such as `workspaceId`, `assetId`, `revisionId`, `uploadId` and `grantId`, not bucket names or object keys.
8. **Provider neutrality.** AWS-specific DTOs and errors remain inside `trust-storage-s3` or an AWS infrastructure package.
9. **Checksums are mandatory.** Uploaded bytes are not accepted or promoted without integrity verification.
10. **Quarantine is mandatory.** A newly uploaded file is not canonical or generally downloadable until the configured scan decision permits promotion.
11. **Operations are idempotent where retries are expected.** Duplicate callbacks or repeated commands must not create duplicate logical outcomes.
12. **Audit hooks are mandatory.** Security-relevant operations emit the existing Trust Core audit event or call the existing audit interface. Do not invent a parallel audit system.
13. **No silent last-write-wins.** If an operation would overwrite or ambiguously replace existing state, fail explicitly.
14. **No destructive defaults.** Test cleanup must target only resources created by that test run.
15. **S3 Versioning is defence in depth.** Do not substitute S3 version IDs for Trust Core revision identity.
16. **TCAP is the app boundary.** Foundation uses `TCAP/1.0` through `@trust-core/sdk` or `/v1`; it does not import server, storage, policy, persistence or operations packages.
17. **No Foundation special cases.** Public capabilities must be application-independent and authorised through normal application registration and policy assignment.
18. **Protocol writes are retry-safe.** Every Foundation-originated external write carries a stable idempotency key, workspace context, application identity and correlation identity; revision writes also carry the expected head.
19. **Protocol evolution is explicit.** Any new public method updates transport contracts, OpenAPI, SDK, TCAP method mapping and conformance tests together.

---

## 4. Working method

Work in short checkpoints. Never implement more than one checkpoint before presenting its evidence.

For every checkpoint:

1. Inspect the repository, relevant interfaces, package conventions and tests.
2. Restate the exact files expected to change.
3. State assumptions and unresolved questions.
4. Define acceptance tests before editing.
5. Implement the smallest vertical slice.
6. Run formatting, lint, typechecking, unit tests and the relevant integration tests.
7. Review the diff for scope creep, leaked AWS types and security regressions.
8. Report:
   - files changed;
   - commands run;
   - tests passed or failed;
   - remaining risks;
   - manual verification required.
9. Stop for review before the next checkpoint.
10. After approval, create one intentional commit for that checkpoint.

Do not claim success if a test was skipped because Docker, MinIO, AWS credentials, malware-scanner infrastructure or another dependency was unavailable. Report it as **implemented but unverified**.

### Required checkpoint report format

```markdown
## Checkpoint N result

### Outcome
<one paragraph>

### Changed
- <file and purpose>

### Verification
- `<command>` — passed/failed/not run

### Security and invariant check
- <invariant and evidence>

### Open issues
- <issue or “none”>

### Proposed commit
`<type(scope): message>`

### Stop
Awaiting review before Checkpoint N+1.
```

---

## 5. Preliminary checkpoint — repository orientation only

### Goal

Understand the existing implementation before proposing edits.

### Actions

- Read the root instructions, package manifests, workspace configuration and relevant `AGENTS.md` or Cursor rules.
- Locate the provider-neutral storage interface and its existing implementation, expected to include a MinIO adapter.
- Locate Trust Core policy, identity, audit, error and DTO conventions.
- Locate existing test fixtures and Docker/MinIO integration tests.
- Locate any existing S3 code, AWS SDK dependency or infrastructure package.
- Read `contracts/application-protocol.md`, `contracts/application-manifest.schema.json`, `@trust-core/app-protocol`, the public `/v1` contracts and `@trust-core/sdk` before proposing any Foundation-facing change.
- Identify how TCAP currently maps `object:ingest`, `blob:read`, resource reads and uploads into SDK and HTTP methods.
- Classify every Foundation-visible operation required here as already supported, a compatible extension, or a protocol decision requiring review.
- Identify exact package names rather than assuming those in this brief already exist.
- Map every proposed public method to an existing interface method.

### Deliverable

Produce a repository-grounded implementation map containing:

- relevant packages and paths;
- existing interfaces to implement;
- missing interfaces or decisions;
- proposed checkpoint/file mapping;
- a TCAP compatibility matrix covering application manifest, capabilities, SDK methods, `/v1` routes, typed errors, idempotency and conformance tests;
- exact verification commands available in the repository.

### Stop conditions

Stop without coding if:

- the provider-neutral storage interface does not exist;
- the current interface requires AWS concepts in public DTOs;
- workspace policy enforcement has no callable interface;
- audit event integration has no callable interface;
- repository instructions conflict with this specification;
- unrelated local changes overlap expected files.
- a proposed Foundation integration would bypass TCAP, the SDK or the public `/v1` API;
- a required TCAP capability or method has no approved application-independent contract.

### Repository-grounded starting facts

The following facts were verified against `main` at merge commit `3eb7553f31d5f148dfafe25b98263639577dd0e3`. Composer must confirm they remain current before editing:

- Trust Core is a pnpm TypeScript modular monolith with public API/SDK boundaries.
- `packages/storage` already defines the provider-neutral `ObjectStorage` contract.
- `packages/storage-minio` already uses AWS SDK v3 and `@aws-sdk/lib-storage` to implement S3-compatible immutable storage against MinIO.
- The current storage contract supports temporary upload, streamed write, immutable commit, streamed read, head, exists and safe temporary deletion.
- The current contract does not yet expose persistent multipart-resume state, ranged download or short-lived direct-transfer grants.
- `packages/operations` already contains upload state and durable idempotent object-ingest checkpoints.
- `packages/policy` and the API access gateway already enforce workspace/application capability decisions.
- TCAP/1.0 already requires public SDK/API access, workspace context, stable idempotency keys, expected revision heads, immutable blob workflows, schema identity, correlation identity, typed errors, append-only history and logical-first deletion.
- `@trust-core/app-protocol` maps registered application capabilities to public SDK and `/v1` methods.
- `@trust-core/sdk` currently implements bounded base64 uploads with a 750,000-byte candidate limit; it does not yet provide large-file multipart transfer.
- Docker Compose already supplies PostgreSQL and MinIO, and CI contains source, Docker integration and portability gates.
- The merged PR head `24d125a7953395c0711c11f0a664d537feb27025` passed its CI workflow.

These facts mean the repository is ready for the Preliminary checkpoint and incremental implementation. They do not authorise Composer to bypass the protocol-evolution gate below.

### Protocol-evolution gate

Before implementing any new Foundation-visible method, Composer must produce a no-edit proposal showing:

- why existing TCAP methods are insufficient;
- the generic application capability involved;
- proposed SDK method and `/v1` route;
- workspace/application policy action;
- idempotency and correlation rules;
- typed success and error DTOs;
- OpenAPI impact;
- TCAP method-map and conformance-test impact;
- proof that the proposal contains no Foundation-specific concept.

Stop for approval after this proposal. Do not implement a public protocol extension in the same checkpoint in which it is designed.

---

# Phase 1 — `trust-storage-s3` adapter

The repository already contains `packages/storage-minio`, implemented with the AWS S3 SDK. Do not duplicate it blindly. During the Preliminary checkpoint, compare these bounded options:

1. create `packages/storage-s3` using shared provider-neutral helpers;
2. extract a small internal S3-compatible base used by separate MinIO and AWS adapters;
3. extend the existing adapter configuration only if doing so preserves truthful package naming and clean provider-specific deployment configuration.

Recommend one option with file-level evidence and stop for approval. Avoid a broad storage refactor.

## Checkpoint 1.1 — package skeleton and configuration

### Goal

Create or complete the S3 adapter package without implementing business policy.

### Requirements

- Follow the repository's package naming and build conventions.
- Use the repository's existing AWS SDK generation/version.
- Accept configuration through typed dependency injection.
- Do not read arbitrary environment variables throughout the adapter; centralise configuration at composition-root boundaries.
- Support a custom endpoint and path-style addressing only where needed for test infrastructure such as MinIO or LocalStack.
- Do not log credentials, signed URLs, encryption context or sensitive object metadata.
- Map SDK exceptions to the existing provider-neutral Trust Core storage errors.

### Expected configuration concepts

Use only concepts supported by the existing configuration system:

- region;
- bucket identifier supplied by trusted server configuration;
- optional endpoint for tests;
- optional role/client injection;
- request timeout and retry settings;
- server-side encryption expectation where already defined.

Do not define retention, lifecycle, KMS ownership or production IAM policy here.

### Acceptance criteria

- package builds independently and in the workspace;
- configuration validation fails closed;
- no credentials are hard-coded;
- AWS-specific types are not exported through the provider-neutral interface;
- unit tests cover configuration and error mapping.

---

## Checkpoint 1.2 — basic object operations

### Goal

Implement the provider-neutral object operations required by the existing storage contract.

### Candidate operations

Implement only those present in the repository interface, typically:

- place an object at an already allocated immutable storage locator;
- stream an object;
- read object metadata;
- verify existence;
- copy/promote an object where the interface requires it;
- remove an explicitly identified non-canonical/quarantine object where permitted.

Do not add a generic public `overwrite` operation.

### Required behaviour

- stream data rather than buffering complete BIM/PDF files in memory;
- preserve content type, byte length and checksum metadata;
- distinguish not-found, access-denied, conflict, invalid-request, throttling and transient-provider failures;
- use conditional requests where the existing interface supports immutability enforcement;
- reject empty or malformed storage locators;
- ensure logs identify Trust Core operation IDs, not signed URLs or credentials.

### Tests

- provider contract tests shared with the MinIO adapter;
- object round trip;
- zero-byte object if supported by the contract;
- unicode metadata/filename behaviour if filenames are represented;
- not-found mapping;
- access-denied mapping using a test double;
- no-overwrite/conflict behaviour;
- streaming behaviour using a payload larger than the configured buffer.

### Stop condition

If the existing interface permits canonical overwrite without an explicit immutable precondition, report the problem. Do not redesign or extend the interface in this checkpoint.

---

## Checkpoint 1.3 — integration harness

### Goal

Prove the S3 adapter against disposable test infrastructure.

### Requirements

- Reuse the repository's Docker test approach.
- Prefer MinIO or LocalStack for deterministic CI contract tests if that is already the project convention.
- Keep a separate optional real-S3 smoke test behind explicit credentials and an explicit test flag.
- Generate a unique test-run prefix.
- Cleanup only the unique resources created by the test run.
- Never point automated tests at an unscoped production bucket.

### Acceptance criteria

- local integration tests run in one documented command;
- CI can run without production AWS credentials;
- optional AWS smoke test is clearly separated and skipped by default;
- MinIO and S3 adapters pass the same provider contract suite where semantics overlap.

---

# Phase 2 — multipart transfer primitives

## Checkpoint 2.1 — multipart upload state and initiation

### Goal

Add provider-neutral multipart primitives without defining Trust Core's canonical revision transaction.

### Required state

Represent the minimum resumable transfer state through existing domain conventions:

- Trust Core upload identifier;
- opaque provider upload reference stored only in the adapter-facing state;
- immutable target locator allocated by an upstream service;
- expected total size where known;
- expected checksum;
- configured part size;
- created/expiry timestamps;
- current status;
- completed part numbers and provider ETags/checksums where required.

Do not expose an S3 multipart upload ID to Foundation clients.

### Required operations

- initiate multipart upload;
- validate part-number and part-size boundaries;
- query/list already uploaded parts for resumption;
- abort an incomplete multipart upload;
- return provider-neutral results.

### Acceptance criteria

- initiation is idempotent using the existing command/idempotency convention;
- retries do not allocate multiple logical uploads;
- invalid part plans fail before calling S3;
- abort is safe to retry;
- state contains no permanent AWS credentials.

### Stop condition

If persistence of multipart state requires a new cross-store transaction or database schema decision, stop and provide the minimal proposed schema as a review question. Do not apply the migration.

---

## Checkpoint 2.2 — upload parts and completion

### Goal

Upload parts, resume interrupted transfers and complete only verified uploads.

### Requirements

- support streamed part upload;
- retry only failures classified as transient;
- never retry invalid, denied or checksum-mismatch operations as transient;
- reconcile the client's declared completed parts with the provider's recorded parts;
- complete parts in the correct order;
- reject duplicate part numbers with inconsistent ETags/checksums;
- verify final byte length and configured checksum before reporting success;
- make completion safe to retry;
- preserve enough evidence for an audit event through the existing audit interface.

### Tests

- normal multipart completion;
- interruption after one or more parts and successful resumption;
- duplicate identical retry;
- duplicate inconsistent part rejection;
- missing part rejection;
- out-of-order client report;
- checksum mismatch;
- incorrect final size;
- transient SDK failure followed by success;
- abort and subsequent refusal to complete.

### Exclusion

Do not mark a Trust Core revision canonical. Completion in this checkpoint means only that the quarantined storage object has been successfully assembled and verified.

---

## Checkpoint 2.3 — resumable download primitive

### Goal

Support reliable ranged downloads for large files.

### Requirements

- stream full downloads;
- support validated byte ranges through the provider-neutral contract;
- return stable content length, content type and integrity metadata;
- fail explicitly if the object identity changes during a resumed transfer;
- do not buffer the entire object;
- emit no signed URL into application logs.

### Tests

- full download;
- multiple ranges recombine into the original bytes;
- invalid range;
- not found;
- interrupted stream and resumed range;
- identity/checksum mismatch during resume.

---

# Phase 3 — policy-gated short-lived access grants

## Checkpoint 3.1 — grant service boundary

### Goal

Implement an application service that issues a grant only after existing Trust Core authentication and policy checks succeed.

This is a Trust Core service exposed to applications only through an approved generic TCAP/SDK/API extension. Foundation must not call the service class or S3 presigner directly.

### Mandatory request context

- authenticated actor;
- workspace;
- requested operation: upload or download;
- provider-neutral asset/revision/upload identifier as applicable;
- content constraints for upload;
- requested expiry bounded by server policy;
- request/correlation ID.

### Mandatory sequence

```text
authenticate
  -> resolve workspace resource
  -> call existing Trust Core policy evaluator
  -> resolve server-side storage locator
  -> create narrowly scoped short-lived grant
  -> emit existing audit event
  -> return client-safe grant DTO
```

Do not allow the client to supply an arbitrary bucket or object key.

The public DTO must use provider-neutral transfer language. It may contain a short-lived operation URL and required request headers, but must not describe the provider as S3, expose a bucket, expose an object key, or make AWS behaviour part of Foundation's domain contract.

### Grant restrictions

- one intended operation;
- one allocated object locator;
- short server-bounded expiry;
- expected content length/range where supported;
- expected checksum and content type for upload where supported;
- no list-bucket capability;
- no delete capability;
- no access to a different workspace;
- no access to quarantined content through a normal canonical-download route.

### Acceptance criteria

- denied policy produces no signed grant;
- missing workspace context fails closed;
- client cannot alter the resolved storage target;
- expiry cannot exceed server maximum;
- public DTO contains no AWS credentials;
- audit hook is called for issued and denied grants according to existing conventions.

### Stop conditions

Stop if:

- the repository lacks an explicit policy evaluation interface;
- permission rules must be invented;
- maximum expiry has not been configured;
- audit semantics require a new security policy decision.

---

## Checkpoint 3.2 — upload grant implementation

### Goal

Create short-lived upload grants for single-part or previously authorised multipart operations.

### Requirements

- grant only to an allocated quarantine locator;
- bind the grant to the current actor/workspace/upload request in Trust Core state;
- require the expected checksum and content constraints wherever supported;
- ensure an expired or revoked upstream session is rejected;
- return only the client-safe URL/headers/expiry required to perform the operation;
- redact signed query strings and headers from logs and errors.
- expose creation, status and completion only through the approved generic TCAP upload workflow and `@trust-core/sdk` facade;
- preserve workspace ID, registered application identity, stable idempotency key and correlation ID across initiation, direct byte transfer and completion.

### Tests

- allowed upload;
- denied actor;
- wrong workspace;
- expired upload session;
- excessive expiry request;
- mismatched content constraint;
- arbitrary-key injection attempt;
- audit call and redaction test.

---

## Checkpoint 3.3 — download grant implementation

### Goal

Create short-lived download grants for authorised, downloadable objects.

### Requirements

- policy-check the resolved Trust Core asset/revision;
- refuse ordinary download when state is pending, scanning, rejected or quarantined;
- allow only the server-resolved immutable object locator;
- support approved filename/content-disposition handling without key leakage;
- maintain short server-bounded expiry;
- redact signed URL material from logs.
- expose the operation only through an approved generic TCAP blob/resource download method in `@trust-core/sdk` and `/v1`;
- apply the same application capability and workspace policy model used by every other registered app.

### Tests

- allowed canonical download;
- denied actor;
- cross-workspace attempt;
- quarantined object refusal;
- rejected object refusal;
- arbitrary-key injection attempt;
- excessive expiry request;
- filename/header sanitisation;
- audit call and log redaction.

---

# Phase 4 — quarantine and malware scanning

## Checkpoint 4.1 — quarantine state machine

### Goal

Implement the already-approved quarantine states and transitions using existing domain/state-machine conventions.

### Expected conceptual states

Use the repository's approved names. If none exist, propose—but do not commit—a mapping equivalent to:

```text
pending_upload
uploaded
scan_queued
scanning
accepted
rejected
manual_review
promotion_pending
promoted
failed
```

### Required properties

- transitions are explicit and validated;
- repeated identical commands/events are idempotent;
- out-of-order or impossible transitions are rejected and audited;
- rejection preserves evidence required by existing policy without making content generally downloadable;
- promotion never occurs directly from `uploaded`;
- failures remain inspectable and retryable where policy allows.

### Stop condition

If quarantine states and retention of rejected material are not already approved, provide a state-transition proposal and stop. This agent must not choose legal/security retention policy.

---

## Checkpoint 4.2 — scanner interface and orchestration

### Goal

Introduce a provider-neutral malware scanner interface and orchestrate scanning without coupling Trust Core to one scanner vendor.

### Interface responsibilities

- submit or initiate a scan for a quarantine object;
- correlate a scan job with Trust Core upload/revision context;
- normalise outcomes: clean, malicious, suspicious, unsupported, error and timeout;
- verify callback/event authenticity using the selected existing mechanism;
- process duplicate callbacks idempotently;
- record scanner engine/version and result metadata where permitted;
- emit existing audit events.

### Implementation boundary

If no scanner provider has been selected, implement:

- the provider-neutral scanner interface;
- a deterministic fake scanner for tests;
- orchestration and state transitions;
- configuration validation.

Do not select or deploy a production scanner without an explicit decision.

### Tests

- clean result;
- malicious result;
- suspicious/manual-review result;
- unsupported format;
- scanner timeout;
- transient scanner error and bounded retry;
- duplicate callback;
- unauthenticated/invalid callback;
- callback for unknown scan job;
- out-of-order callback.

---

## Checkpoint 4.3 — verified promotion primitive

### Goal

Implement the narrow storage operation that promotes an accepted, checksum-verified quarantine object to an already allocated immutable canonical locator.

### Required preconditions

- Trust Core policy/application service has authorised the promotion;
- scan state is accepted;
- quarantine object exists;
- size and checksum match the recorded upload;
- canonical destination has already been allocated by an upstream reviewed component;
- canonical destination does not already contain conflicting content.

### Required behaviour

- copy/stream into the immutable destination using the adapter contract;
- verify destination integrity;
- return a provider-neutral promotion result;
- make an identical retry safe;
- fail on a conflicting destination;
- emit or call the existing audit hook;
- leave final logical revision commit to the excluded reviewed transaction architecture.

### Exclusions

This checkpoint must not:

- define the canonical revision transaction;
- mark a Foundation revision current;
- delete quarantine evidence based on an invented retention period;
- configure S3 lifecycle or Object Lock;
- treat an S3 copy result alone as a committed Trust Core revision.

### Tests

- successful clean promotion;
- retry after successful identical promotion;
- checksum mismatch;
- missing quarantine source;
- rejected/non-accepted source;
- conflicting destination;
- transient copy failure;
- destination verification failure;
- audit hook invocation.

---

## 6. Cross-checkpoint quality gates

Every checkpoint must satisfy the repository's normal commands plus the following relevant gates.

### Static quality

- formatting passes;
- lint passes;
- typechecking passes;
- package dependency boundaries pass;
- no AWS SDK type escapes a provider-neutral boundary;
- no secrets, signed URLs or credentials appear in fixtures, snapshots or logs.
- Foundation-facing code imports only `@trust-core/sdk` or calls the public `/v1` API;
- generated OpenAPI remains current;
- TCAP manifest/method mapping and conformance tests remain current;
- no public route, DTO, capability or schema contains a Foundation-specific exception.

### Unit tests

- happy paths;
- permission denial;
- malformed input;
- idempotent retry;
- transient-provider failure;
- permanent-provider failure;
- log redaction;
- error mapping.

### Integration tests

- run against disposable local S3-compatible infrastructure;
- use unique test prefixes;
- clean up only owned test resources;
- exercise streaming and multipart behaviour with realistically large synthetic files;
- never require production credentials for the normal CI suite.

### Contract tests

The same provider-neutral contract suite should run against `trust-storage-minio` and `trust-storage-s3` where their supported semantics overlap.

Do not weaken an existing contract test merely to make the new adapter pass.

---

## 7. Required security tests within scope

These tests are implementation checks, not security certification:

- actor from workspace A cannot obtain access to workspace B;
- client-supplied object-key injection is rejected;
- policy denial occurs before grant creation;
- quarantine content cannot use the normal canonical download path;
- an upload grant cannot download, delete or list;
- a download grant cannot upload, delete or list;
- expiry is server bounded;
- signed URLs and signed headers are redacted from logs and exception messages;
- checksum mismatch prevents completion and promotion;
- a canonical destination cannot be overwritten;
- duplicate scanner callbacks do not duplicate promotion;
- invalid scanner callbacks cause no state transition.

Any failure in this group blocks checkpoint completion.

---

## 8. Documentation required

Update only documentation directly related to the implemented checkpoints:

- package README for `trust-storage-s3`;
- required environment/configuration variables using placeholders only;
- local integration-test instructions;
- optional real-S3 smoke-test instructions;
- supported and unsupported adapter capabilities;
- sequence documentation for upload, scan and grant flows;
- troubleshooting for common local-test failures.

Do not document excluded architecture as if it has been implemented.

---

## 9. Definition of done

Composer's assigned scope is complete only when:

- all four included phases have passed their checkpoint reviews;
- all relevant unit, contract and local integration tests pass;
- the optional real-S3 smoke test has either passed or is clearly reported as not run;
- Foundation accesses storage only through Trust Core APIs;
- Foundation is registered and authorised through TCAP/1.0 like any other application;
- all new app-visible behaviour is represented consistently in `/v1`, OpenAPI, `@trust-core/sdk`, TCAP method mapping and conformance tests;
- no Foundation code imports Trust Core storage, operations, persistence, policy or server packages;
- AWS-specific types remain behind the adapter boundary;
- multipart uploads resume and verify integrity;
- access grants are policy-gated, narrow, short-lived and redacted from logs;
- quarantined files cannot be treated as canonical before an accepted scan;
- promotion is verified and does not commit the excluded logical revision transaction;
- no excluded phase has been partially or implicitly implemented;
- the final diff contains no unrelated refactor;
- each checkpoint has its own reviewed commit.

Completion of this specification does **not** mean Foundation is ready to become the authoritative store for the practice. Production readiness still requires the excluded architecture, infrastructure, recovery, sync, threat-model and security-review work.

---

## 10. Final handoff report

At the end of the assigned work, produce:

```markdown
# Composer implementation handoff

## Implemented
- <checkpoint and commit>

## Public interfaces added or changed
- <interface and compatibility effect>

## Verification evidence
- <command and result>

## Not verified
- <test or environment dependency>

## Deferred by specification
- canonical revision transaction and reconciliation
- lifecycle, archival, Object Lock and recovery policy
- KMS and production IAM architecture
- Foundation Sync Client
- system threat model and security certification

## Architecture-review questions
- <question requiring the stronger review stage>

## Recommended next action
Stop. Do not begin deferred work until the architecture review is complete.
```

---

## 11. Initial instruction to Composer 2.5

Use this prompt with the specification:

> Read this specification and all repository instructions in full. Begin only with the Preliminary checkpoint: repository orientation. Do not edit any files. Confirm the repository-grounded starting facts, then return the implementation map, TCAP compatibility matrix, detected conflicts, unresolved protocol decisions, comparison of the three S3-adapter package options, proposed files for Checkpoint 1.1, and exact verification commands. Treat Foundation as a normal TCAP/1.0 registered application using only `@trust-core/sdk` or `/v1`. Do not proceed to Checkpoint 1.1 until I explicitly approve it.
