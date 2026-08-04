# Trust Core Release 0.1 trust boundaries

This contract defines which identities may cross each Release 0.1 boundary. It
is read with the [threat model](./threat-model.md), [invariants](./invariants.md)
and [worker privilege ADR](../adr/ADR-013-worker-rls-cross-workspace-privilege-boundary.md).

## Client to Trust API

- Clients receive API resources and stable errors, never database credentials,
  object-store credentials or canonical storage keys.
- OIDC sessions or the emergency bootstrap token establish an actor. A
  client-supplied workspace header is only a requested scope; the authenticated
  actor membership, policy decision and PostgreSQL RLS must all permit it.
- Mutations use policy-checked commands, CSRF protection for cookie sessions,
  optimistic concurrency and idempotency where the route supports it.
- Public failures follow [the error contract](./error-codes.md). Secrets,
  canonical content, stack traces and raw provider errors stay in correlated
  server logs.

## Trust API to PostgreSQL

- The API connects as `trust_app_local` in local Docker, inheriting the
  `trust_application` group role. It is not an owner, superuser or
  `BYPASSRLS` role.
- Tenant transactions set `trust.workspace_id` locally. Tenant tables use
  forced RLS; application authorization does not replace RLS.
- The API may mutate command, identity-session and policy records granted in
  `migrations/provisioning.sql`. It cannot apply migrations or provision roles.
- Migration and provisioning commands use `TRUST_MIGRATION_DATABASE_URL` and
  must not run under a runtime identity.

## Trust API to object storage

- Only storage adapters receive object-store credentials.
- Temporary keys are operation-scoped. Canonical keys are workspace-scoped and
  content-addressed from a digest Trust Core computed while streaming bytes.
- Cleanup may delete temporary objects only. Canonical bytes are never
  overwritten or automatically deleted in Release 0.1.
- PostgreSQL metadata and object bytes are joined through the durable operation
  state machine described by [ADR-012](../adr/ADR-012-cross-store-operation-state-machine.md),
  not by a distributed transaction.

## Reconciliation worker

- The worker connects as `trust_worker_local`, inheriting only
  `trust_outbox_worker`.
- Its exceptional outbox RLS policy permits cross-workspace claim, lease,
  retry, completion and quarantine of pending events.
- A claimed event carries its workspace. Each handler sets that workspace
  context before selecting blob metadata or inserting a reconciliation
  incident.
- The worker has no grants on datasets, resources, revisions, identity
  sessions, policies or audit events. It must not be reused as a general
  background-job identity.

## Verification, audit and operator identities

- `trust_verification` can read canonical metadata and append/update
  verification results; it cannot mutate canonical bytes or tenant history.
- `trust_audit_reader` is read-only on audit events.
  `trust_audit_writer` may append audit events but may not update or delete
  them.
- `trust_backup_restore` has a broad `BYPASSRLS` boundary for backup/restore
  tooling and must be operator-controlled. Release 0.1 provisions this role but
  does not implement production backup orchestration or restore automation.
- Object-store administrators, PostgreSQL owners, migration operators, backup
  operators and IdP administrators are privileged operational roles and must
  not share runtime credentials.

## Evidence

Run the real boundary checks with:

```powershell
npx --yes pnpm@10.15.0 docker:up
$env:POSTGRES_INTEGRATION = "1"
npx --yes pnpm@10.15.0 --filter @trust-core/persistence-postgres test:docker
Remove-Item Env:POSTGRES_INTEGRATION
```

The tests prove forced RLS, cross-workspace denial, runtime non-ownership and
the worker's cross-workspace outbox-only exception. The complete Release 0.1
evidence command is `npx --yes pnpm@10.15.0 trust:test:docker`.
