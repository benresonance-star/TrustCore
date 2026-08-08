# Checkpoint 0.4 source candidate — reusable SDK proof

## Implemented

- governed schema publication with approval evidence and idempotency;
- compatibility classification for additive, breaking and identical schemas;
- deterministic app-specific TypeScript generation for Ivan's Diary and
  WeSketch;
- public TypeScript SDK support for policy, retention, binary archive transfer
  and TCAP conformance;
- a live conformance runner that uses only public SDK routes;
- `TrustCoreKit` Swift Package with async authenticated HTTP facades,
  idempotency helpers, portability models and archive checksum verification;
- a shared TypeScript/Swift compatibility fixture;
- source conformance for two materially different application schemas without
  kernel changes.

## Verification

- repository typecheck and source tests pass;
- generated OpenAPI and app types are deterministic;
- both app fixtures pass the TypeScript conformance runner;
- seven `TrustCoreKit` tests compile and pass under Swift 6.2 in the official
  Swift container;
- API and worker deployment images build, and the API image passes a container
  health smoke test.

## External boundary

This source checkpoint does not claim that Release 0.3 cloud recovery or the
Release 0.4 live dual-SDK gate passed in an approved external environment.
Attach matching TypeScript and Swift live conformance reports only after the
managed recovery deployment is available.
