# Checkpoint 0.1L — Release 0.1 completion

## Implemented

- standalone pnpm monorepo;
- full platform specification;
- constitutional invariants and initial ADRs;
- generic Workspace/Dataset/Resource/Revision/Blob/Relation/Tombstone types;
- revision-head and stale-base conflict checks;
- durable upload state machine;
- provider-neutral storage contract and safe content-addressed keys;
- MinIO/S3-compatible adapter implementation;
- SHA-256 audit chain and tamper verification;
- PostgreSQL 18 schema, constraints, RLS and outbox foundation;
- Docker Compose for PostgreSQL and MinIO;
- navigable responsive Control Centre with Home, Datasets, Flow, Health, History and Access sections;
- React-Flow-style interactive system topology;
- typed fixture gateway isolated behind the same contract a live adapter will implement;
- shared protocol package for UI/API status and dataset contracts;
- initial read-only Trust API process with health and Control Centre snapshot routes;
- immutable, digest-addressed schema registry contract and payload validator;
- published `app/ivans-diary/1.0.0` application schema;
- deterministic synthetic Ivan diary, journal, sketchbook, drawing, audio and bookmark fixture;
- explicit `synthetic-demo` classification with no personal information;
- schema listing and detail routes in the fixture Trust API;
- PostgreSQL migration protecting published schema identity and definitions;
- checksum-tracked, ordered and tamper-detecting migration runner;
- transactional PostgreSQL seeding with rollback and idempotent inserts;
- deterministic database UUID mapping for portable Trust IDs;
- RLS workspace context applied before dataset reads and writes;
- PostgreSQL schema registry and Control Centre snapshot repositories;
- API live/fixture mode selection with explicit health reporting;
- database administration commands for migration and synthetic seeding;
- content-hashed immutable object ingestion with byte-length verification and workspace deduplication;
- temporary-object cleanup on failed verification;
- sequential immutable revision creation with optimistic head locking;
- recoverable logical deletion represented by tombstones;
- restoration as a new revision linked to the recovered revision;
- atomic revision, deletion and restoration repository transactions;
- PostgreSQL history and blob-catalog adapters under workspace RLS scope;
- database triggers preventing revision mutation and blob identity/storage-coordinate mutation;
- one-open-tombstone protection for deleted resources;
- corrected S3-compatible stream byte counting and immutable copy behavior;
- bearer-token authentication using constant-time credential comparison;
- workspace membership and role-capability authorization for history, revision, deletion and restoration commands;
- strict command-envelope validation and explicit 401, 403, 409 and 422 responses;
- authenticated history, create-revision, logical-delete and restore API routes;
- PostgreSQL command provider wired to the atomic history service;
- audit events committed inside the same PostgreSQL transaction as history mutations;
- workspace-scoped advisory locking for correctly ordered concurrent audit hashes;
- bounded JSON request ingestion for command routes;
- interactive Control Centre recovery bin using the same gateway contract as the live API;
- visible restoration confirmation explaining that prior history remains preserved;
- real HTTP Control Centre gateway for snapshot, history and restoration commands;
- administrator bootstrap-token exchange into a short-lived server-side session;
- `HttpOnly`, `SameSite=Strict` session cookies with `Secure` enabled in production;
- independent CSRF tokens required for every cookie-authenticated mutation;
- session expiry, revocation and constant-time CSRF verification;
- bootstrap credentials retained only for the exchange and never persisted by the browser client;
- live-mode protection for Control Centre dataset summaries as well as recovery actions;
- same-origin Vite development proxy and configurable API/workspace routing;
- global administrator sign-in UI plus re-authentication when a recovery session expires;
- no-store response policy for authentication and Trust API responses;
- successful local end-to-end session → history → restore → refreshed-history proof;
- reusable provider-neutral identity package separated from application and storage concerns;
- OpenID Connect authorization-code flow with S256 PKCE;
- cryptographically random, one-use state and nonce validation;
- short-lived HTTP-only browser binding that prevents login-CSRF/account swapping;
- strict issuer, audience, signature, algorithm, subject and nonce verification;
- HTTPS-only discovery, authorization, token and JWKS endpoints;
- deny-by-default mapping from provider roles and workspace claims into Trust Core actors;
- hashed session identifiers and CSRF tokens at rest;
- shared PostgreSQL login-transaction and session store with atomic state consumption and revocation;
- federated sign-in and callback routes plus a Control Centre organisation-identity action;
- safe relative return-path enforcement preventing open redirects;
- passkeys and MFA delegated to the configured organisation identity provider;
- reusable verification package with explicit metadata and full-blob levels;
- streaming SHA-256 and byte-count recomputation without loading canonical objects into memory;
- critical detection for missing/inaccessible objects, length mismatches, hash mismatches and stream failure;
- distinct reporting so metadata verification is never labelled full verification;
- persisted PostgreSQL verification runs, issue reports and per-blob verification state;
- row-level workspace isolation for verification records;
- resource revision-graph checks for pointer, scope, numbering, parent existence and parent order;
- authenticated verification command API with owner/admin/auditor policy;
- live PostgreSQL plus S3-compatible verification adapter wiring;
- interactive full-verification action and result summary in Control Centre Health;
- reusable reconciliation package separated from storage and PostgreSQL adapters;
- leased outbox claiming with `FOR UPDATE SKIP LOCKED` for safe concurrent workers;
- lease ownership checks preventing stale workers from completing another worker's event;
- exponential retry with attempt accounting and terminal quarantine;
- production worker process with bounded batches, non-overlapping polling and graceful shutdown;
- reconciliation handlers for temporary cleanup and committed blob/object consistency;
- critical incidents when metadata points to missing bytes;
- retained-and-reported handling for unattached immutable objects instead of unsafe deletion;
- canonical-object deletion refusal preserved through the temporary-storage boundary;
- workspace-isolated reconciliation incident records;
- durable checkpoint runner covering every upload stage;
- failure injection before all eight upload checkpoints with successful idempotent resumption;
- shared Release 0.1 transport contracts with stable routes, schemas, operation
  identifiers, error codes and durable operation states;
- a generated OpenAPI 3.1 artifact checked against those actual transport
  contracts;
- a handwritten `@trust-core/sdk` facade that keeps applications on the public
  HTTP surface and out of server internals;
- scoped policy evaluation for users, services and registered applications,
  including dataset/application assignments, capability checks, infrastructure
  separation and time-limited break-glass grants;
- all five verification levels: metadata, full blob, resource, dataset and
  workspace;
- public workspace, application, schema, dataset, resource, relation, upload,
  operation, audit, verification and service-health queries and commands;
- a materially different WeSketch schema and deterministic fixture preserving
  canvas, layer, mask, prompt, generated-image and placement lineage;
- live Control Centre reads and commands routed through the public TypeScript
  SDK, with fixture mode retained for safe visual exploration;
- contract, compatibility, retention, trust-boundary, threat-model,
  identity-provider and recovery documentation;
- CI quality gates for lint, strict typecheck, tests, production build,
  generated OpenAPI drift and the source Trust Test, plus a scheduled/main
  Docker gate with sanitized report artifacts.

## Fresh Release 0.1 verification

The completion gates were rerun on 2026-08-04 after the Release 0.1 contract,
SDK, policy, verification, WeSketch, live UI, CI and documentation work:

- `pnpm lint`: PASS;
- `pnpm check:openapi`: PASS; regeneration produced no OpenAPI drift;
- `pnpm typecheck`: PASS across workspace projects with strict TypeScript
  checks;
- `pnpm test`: PASS; Docker-dependent suites were intentionally skipped by the
  source-only invocation and then exercised by the Docker gate;
- `pnpm --filter @trust-core/control-centre build`: PASS, with 1,584 modules
  transformed into the production SPA bundle;
- `pnpm trust:test`: `TRUST TEST CANDIDATE: PASS (service adapters; Docker gate
  pending)`;
- `pnpm trust:test:docker`: 13 PostgreSQL tests and 5 live MinIO contract tests
  PASS, the
  live API integration PASS, all eight interruption/restart checkpoints PASS,
  and final `TRUST TEST: PASS`.

The live API proof covered health, idempotent object ingest, upload creation and
completion, operation lookup, full-blob verification, scoped resource and
dataset verification, persisted report lookup, authenticated public reads,
revision creation, logical deletion and append-only restoration. It also read
both Ivan's Diary and WeSketch through the public SDK and proved WeSketch
revision/blob lineage against real PostgreSQL and MinIO.

## Docker integration proof

- Windows build 10.0.26200 with WSL2 kernel
  6.18.33.1-microsoft-standard-WSL2;
- Docker Desktop 4.84.0 with Linux engine 29.6.2;
- PostgreSQL `postgres:18-alpine`;
- MinIO `RELEASE.2025-04-22T22-12-26Z` and MinIO Client
  `RELEASE.2025-04-16T18-13-26Z`;
- health-based Compose startup, idempotent private bucket initialization,
  persistent named volumes and scoped reset/stop commands;
- migrations `0001` through `0010` applied on a clean PostgreSQL database,
  rerun idempotently and rejected after checksum tampering;
- real constraint, foreign-key, revision immutability, blob-coordinate
  immutability and schema-package immutability assertions;
- separate migration owner, API runtime, reconciliation worker, verification,
  audit reader/writer and backup/restore roles;
- real runtime RLS cross-workspace denial and a dedicated worker role that can
  claim cross-workspace outbox work without dataset access;
- live MinIO contract tests covering streaming, hashes, immutable commit,
  deduplication, retry, read/head, missing objects, denial/outage, temporary
  cleanup and overwrite refusal;
- live authenticated API proof for ingest, full-byte verification,
  create-revision, logical deletion and restoration;
- real PostgreSQL worker lease, stale-owner, retry, quarantine and incident
  proof;
- actual API process termination and restart after each of all eight ingest
  effects, with exactly one durable operation, blob, audit event and outbox
  event;
- sanitized JSON and Markdown Docker-gate reports.

The latest generated Release 0.1 Docker report records a 27.216-second run on
`win32 x64`, Node `v25.2.1` and Docker Linux engine `29.6.2`. It printed
`TRUST TEST: PASS`. The working tree contains uncommitted changes, so the
report's source-revision metadata is not presented as current committed-HEAD
evidence.
The source-only `pnpm trust:test` command deliberately retains its weaker
`TRUST TEST CANDIDATE` marker.

## Remaining post-0.1 operational hardening

- integrate organisation identity against a real external OIDC provider tenant
  and verify its production claim mapping, MFA/passkey and session behavior;
- execute production backup/restore and credential-rotation drills in the
  target operating environment;
- implement and prove Release 0.2 archive/export/import portability.
