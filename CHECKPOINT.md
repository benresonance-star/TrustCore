# Checkpoint 0.1K — Release 0.1 Docker integration proof

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
- twenty-six backend tests and four Control Centre interaction tests.
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
- twenty-eight backend tests and four Control Centre interaction tests.
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
- thirty backend tests and four Control Centre interaction tests.
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
- thirty-two backend tests and five Control Centre interaction tests.
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
- thirty-eight backend tests and five Control Centre interaction tests.

## Verified

- TypeScript strict checks pass for all implemented packages.
- Unit tests pass.
- Trust-loop checkpoint test passes.
- Control Centre production build passes.
- Every synthetic Ivan canonical payload validates against its published schema.
- PostgreSQL persistence contracts, transactions and failure rollback pass tests.
- History tests prove stale writers cannot leave orphan revisions.
- Recovery tests prove deleted content is restored as a new, traceable revision.
- Object tests prove identical bytes deduplicate and failed verification leaves no blob record.
- API tests prove missing credentials, wrong-workspace access, insufficient roles and malformed commands are rejected.
- Control Centre tests prove an administrator can open History and restore a recoverable item as a new revision.
- Session tests prove invalid bootstrap credentials, missing CSRF, revoked sessions and unauthenticated live snapshots are rejected.
- The HTTP proof restored the sole recoverable fixture as revision 18 and confirmed the recovery bin changed from one item to zero.
- OIDC tests prove PKCE, one-use state, browser binding, nonce validation, claim denial, hashed sessions and replay rejection.
- Verification tests prove clean metadata/full checks and critical reporting for corrupted or missing bytes.
- Control Centre tests prove administrators can initiate full verification and see objects, streamed bytes and issue counts.
- Reconciliation tests prove retry, quarantine, safe cleanup, missing-object incidents and retention of unattached immutable bytes.
- Failure-injection tests prove simulated interruption at every upload checkpoint resumes without repeating completed effects.

## Docker integration proof

- Windows build 10.0.26200 with WSL2 kernel
  6.18.33.1-microsoft-standard-WSL2;
- Docker Desktop 4.84.0 with Linux engine 29.6.2;
- PostgreSQL `postgres:18-alpine`;
- MinIO `RELEASE.2025-04-22T22-12-26Z` and MinIO Client
  `RELEASE.2025-04-16T18-13-26Z`;
- health-based Compose startup, idempotent private bucket initialization,
  persistent named volumes and scoped reset/stop commands;
- migrations `0001` through `0006` applied on a clean PostgreSQL database,
  rerun idempotently and rejected after checksum tampering;
- real constraint, foreign-key, revision immutability, blob-coordinate
  immutability and schema-package immutability assertions;
- separate migration owner, API runtime, reconciliation worker, verification,
  audit reader/writer and backup/restore roles;
- real runtime RLS cross-workspace denial and a dedicated worker role that can
  claim cross-workspace outbox work without dataset access;
- five live MinIO contract tests covering streaming, hashes, immutable commit,
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

The Release 0.1 Docker gate completed in 18.724 seconds and printed
`TRUST TEST: PASS`. The source-only `pnpm trust:test` command deliberately
retains its weaker `TRUST TEST CANDIDATE` marker.

## Remaining work outside this Docker gate

- a real organisation identity-provider integration test (provider
  configuration is not available in this workspace);
- identity-provider administration runbook, emergency-access policy,
  credential-rotation drill and long-lived session rotation;
- production backup/restore and credential-rotation drills;
- Release 0.2 archive/export/import proof.

The tested source is an uncommitted imported snapshot because the supplied
checkpoint contained no Git history. No commit was created during this run.
