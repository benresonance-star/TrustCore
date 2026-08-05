# Trust Core Application Protocol — TCAP/1.0

## Purpose

TCAP is the versioned interface between an application and Trust Core. It
prevents each application from inventing its own persistence, identity,
revision, blob, deletion and portability conventions.

Applications integrate through the public SDK or HTTP API. They must not read
or write Trust Core PostgreSQL, object storage or server-internal packages.

## Required application contract

Every application supplies a manifest conforming to
`contracts/application-manifest.schema.json` with:

- globally unique lowercase namespace;
- application name and semantic version;
- one or more versioned schema packages;
- resource types, relation types and blob roles;
- requested capabilities;
- append-only history, logical-first deletion and portability commitments.

Registration identifies an application but does not grant access. Workspace,
dataset and application assignments remain separate policy decisions.

## Interface rules

1. Use `/v1` or a stable SDK facade only.
2. Send workspace context on every operation.
3. Send a stable idempotency key for every external write and retry.
4. Send the expected head revision when changing a resource.
5. Bind every revision to an immutable schema package/version.
6. Upload blobs through the bounded hash-verified workflow and link them with a
   declared role.
7. Preserve request/correlation identity and accept typed errors.
8. Treat history and audit as append-only.
9. Delete logically before any policy-governed purge.
10. Preserve unknown fields when the schema permits them.
11. Pass archive export/import round-trip tests.

## Schema evolution

- Compatible optional additions use a new minor schema version.
- Breaking changes use a new major schema version and explicit migration.
- Old revisions retain their original schema identity.
- Migration creates traceable new revisions; it never rewrites history.
- Deployment order is schema publication, compatibility proof, generated app
  types, then application deployment.

## Conformance

`@trust-core/app-protocol` validates manifests and deterministically generates
the SDK/HTTP method map and agent handoff. The conformance surface must grow to
cover authenticated registration, permission isolation, idempotent retries,
optimistic concurrency, blob verification, deletion/restoration, unknown-field
preservation and archive round trip.

Passing source validation is a candidate marker. Cross-language TypeScript and
Swift app conformance remains the Release 0.4 gate.
