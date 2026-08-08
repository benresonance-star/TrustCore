# Release 0.4 SDK and TCAP conformance

The non-Swift Release 0.4 surface has four ordered gates:

1. publish a schema through `SchemaRegistry.publishGoverned`;
2. record its compatibility classification and TCAP approval evidence;
3. regenerate app payload types with `generateTypeScriptTypes`;
4. run each application through `runAppConformance` using only
   `TrustClient` public methods.

Governed publication binds the TCAP namespace, schema key/version, resource
types, relation types and unknown-field policy. It requires an approver,
approval ID, stable idempotency key and the caller's expected compatibility
classification. Replaying the same request is safe; reusing its key for
different content is rejected. Optional additions stay in the current major
version, while removals, required additions and type or preservation-policy
changes require a new major version.

Ivan's Diary and WeSketch commit generated `generated-types.ts` files. Fixture
tests compare those files byte-for-byte with fresh generator output. Schemas
that preserve additional fields receive an `unknown` index signature; rejecting
schemas remain closed.

## Focused source gate

```text
corepack pnpm@10.15.0 --filter @trust-core/schema-registry test
corepack pnpm@10.15.0 --filter @trust-core/fixtures-ivans-diary test
corepack pnpm@10.15.0 --filter @trust-core/fixtures-wesketch test
corepack pnpm@10.15.0 --filter @trust-core/sdk test
corepack pnpm@10.15.0 --filter @trust-core/schema-registry typecheck
corepack pnpm@10.15.0 --filter @trust-core/fixtures-ivans-diary typecheck
corepack pnpm@10.15.0 --filter @trust-core/fixtures-wesketch typecheck
corepack pnpm@10.15.0 --filter @trust-core/sdk typecheck
```

## Live API gate

Set `TRUST_CORE_BASE_URL`, `TRUST_CORE_ACCESS_TOKEN`,
`TRUST_CORE_UNASSIGNED_ACCESS_TOKEN`, and `TRUST_CORE_REAUTH_PROOF`, then run:

```text
corepack pnpm@10.15.0 --filter @trust-core/sdk conformance:live
```

The runner verifies governed schema evidence, idempotent registration, expected
resources and relations, append-only history, Ivan's unknown-field evidence,
policy separation, and a guarded archive export/upload/plan/import round trip.
It uses no server, database, or object-storage package.

`swift/TrustCoreKit` implements the same public HTTP boundary and decodes the
shared TypeScript compatibility fixture. Its seven Swift tests pass under Swift
6.2 on Linux using Apple Swift Crypto's cross-platform `Crypto` product; Apple
platforms use `CryptoKit`.

The remaining operational acceptance is to run both SDKs against the approved
external deployment and attach the matching live conformance reports. Source
and cross-language fixture conformance do not by themselves claim that external
deployment gate.
