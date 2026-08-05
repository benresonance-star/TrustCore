# Application Protocol source checkpoint — TCAP/1.0

## Outcome

Trust Core now has one versioned application interface contract rather than a
collection of implicit integration conventions.

Implemented:

- normative `contracts/application-protocol.md`;
- machine-readable `contracts/application-manifest.schema.json`;
- `@trust-core/app-protocol` manifest types, validation, deterministic method
  derivation and agent-brief generation;
- conformance tests for valid and invalid application contracts;
- Control Centre App Protocol generator for namespace, versions, domain types,
  blob roles and requested capabilities;
- generated SDK/HTTP method map, JSON manifest and agent-ready handoff;
- explicit UI warning that generation does not publish schemas or grant access.

## Boundary

TCAP requires applications to use the public SDK/API and prohibits direct
access to Trust Core PostgreSQL, object storage and server internals.
Registration identifies an application; policy assignments grant access.

The current generator produces a candidate contract. Governed schema
publication, compatibility classification, generated app-specific types and a
live end-to-end app conformance runner remain subsequent work toward Release
0.4.

## Source evidence

Source evidence:

- strict typecheck across all 21 buildable workspace projects: PASS;
- 122 non-Docker workspace tests: PASS;
- TCAP manifest/generator conformance: 2 PASS;
- Control Centre: 10 PASS, including manifest/method/agent-brief generation;
- production Control Centre build: PASS (1,585 modules);
- source `TRUST TEST CANDIDATE: PASS`.

This source checkpoint does not alter the deferred Docker portability gate.
