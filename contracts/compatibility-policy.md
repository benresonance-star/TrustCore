# Trust Core compatibility policy

## Release 0.1 public API

- `/v1` route shapes, OpenAPI operation IDs and existing public error meanings
  are stable for Release 0.1.
- The generated source of truth is
  `packages/protocol/src/release01-contract.ts`; `contracts/openapi.json` must
  be regenerated and checked after protocol changes.
- New optional response fields, routes and error codes may be added within
  `/v1`. Clients must ignore unknown fields and handle unknown error codes.
- Required request fields are not removed, renamed or reinterpreted within
  `/v1`. Existing error codes are not reused for a different condition.
- `message` text is diagnostic and display-safe but is not a compatibility
  discriminator. Clients branch on `code` as defined by
  [the error contract](./error-codes.md).

Verify the checked-in contract with:

```powershell
npx --yes pnpm@10.15.0 check:openapi
npx --yes pnpm@10.15.0 --filter @trust-core/protocol test
```

## Schemas and stored data

- A schema package is identified by namespace, name, semantic version and
  immutable digest. Reusing a version with different schema content is
  forbidden.
- Revisions retain their schema package and schema version. Schema evolution
  does not rewrite historical canonical payloads.
- Breaking schema changes require a new major schema version and explicit
  migration or application handling. Release 0.1 validates registered schemas
  but does not provide a general stored-data migration engine.
- Application registration versions and capabilities do not grant access;
  policy remains independently evaluated.

## Persistence and operations

- Applied SQL migration names and SHA-256 checksums are recorded. An altered
  applied migration is rejected; corrective schema changes require a new
  migration.
- Operation states and idempotency semantics are durable compatibility
  boundaries. The same idempotency key and input may replay the original
  result; different input returns `IDEMPOTENCY_CONFLICT`.
- Concurrent resource commands use the expected revision and return
  `REVISION_CONFLICT` instead of silently replacing newer state.

## Deferred formats and providers

- `.trustarchive` is a Release 0.2 design target. No Release 0.1 archive
  compatibility claim exists.
- A storage adapter is compatible only if it preserves immutable canonical
  writes, streamed verification and temporary cleanup semantics. Passing that
  contract does not certify provider backup, lifecycle or regional durability.
