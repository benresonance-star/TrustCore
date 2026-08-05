# Checkpoint 0.2G — Control Centre and independent viewer candidate

## Outcome

The Control Centre Portability screen now drives the public TypeScript SDK
archive verification, dry-run planning and import-operation lifecycle. Import
execution requires the administrator credential to be presented again on the
privileged request; confirmation in UI state alone is insufficient.

The separate `@trust-core/archive-viewer` package reconstructs a read-only
model and self-contained HTML view directly from verified `.trustarchive`
bytes. Its tests cover both Ivan's Diary and WeSketch without the Trust API,
database or originating application, and escape archive-controlled labels.

## Security boundary

- `POST /v1/portability/plans/{planId}/execute` requires the ordinary
  authenticated/authorised actor plus `x-trust-reauth`.
- The re-authentication proof must resolve to the same principal as the active
  actor.
- A missing or invalid proof returns `REAUTHENTICATION_REQUIRED` before the
  provider is invoked.
- The SDK requires `reauthenticationProof` for execution and the Control Centre
  does not persist it.

Fixture/bootstrap-token re-authentication is proven in source. Real OIDC
step-up, MFA/passkey assurance and session revocation remain an external PC
acceptance gate.

## Candidate evidence

- API, SDK, Control Centre and archive-viewer strict typecheck: PASS;
- API: 17 PASS, 3 Docker tests skipped;
- TypeScript SDK: 6 PASS;
- Control Centre: 9 PASS;
- independent viewer: 3 PASS across both fixtures and hostile labels.

Full source verification:

- strict typecheck across all 20 buildable workspace projects: PASS;
- 117 non-Docker workspace tests: PASS;
- generated OpenAPI contract/no-drift tests: PASS;
- production Control Centre build: PASS (1,584 modules);
- source `TRUST TEST CANDIDATE: PASS`.

## Required PC/Docker tests — not run here

Checkpoint 0.2H must run against PostgreSQL and MinIO on the exact clean commit:

1. export Ivan's Diary and WeSketch through live adapters;
2. destroy the isolated source database and object store;
3. import each archive into newly provisioned stores;
4. verify blobs, relations, revision graphs, tombstones, audit lineage and
   unknown-field preservation;
5. open the exported bytes with the independent viewer, with the source app and
   Trust API unavailable;
6. interrupt and resume every import checkpoint;
7. reject corrupt, missing, oversized and path-traversing archives;
8. prove same-principal OIDC step-up/MFA and reject expired, revoked or
   different-principal proofs.

`0.2G SOURCE CANDIDATE: PASS` does not close the Release 0.2 gate. Only 0.2H may
produce the final portability proof.
