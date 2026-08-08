# Managed PostgreSQL deployment profile

Trust Core supports managed PostgreSQL only when the provider can preserve its
database-enforced invariants and produce independently recoverable evidence.

## Required capabilities

- PostgreSQL extensions and features used by committed migrations;
- transaction-scoped `trust.workspace_id` for forced RLS;
- separate migration, runtime, worker, verification, audit and backup roles;
- TLS with certificate validation;
- continuous WAL archiving and point-in-time recovery;
- encrypted storage and backups;
- backup retention in a separately administered account or project;
- exportable audit, recovery and maintenance logs;
- maintenance controls that do not silently relax RLS or immutable triggers.

## Provisioning order

1. Create an empty database and a migration-owner identity.
2. Run committed migrations in checksum order.
3. Run `migrations/provisioning.sql` with newly generated credentials supplied
   through the provider secret manager.
4. Verify runtime ownership separation, `FORCE ROW LEVEL SECURITY`, cross-
   workspace substitution denial and worker-only outbox access.
5. Enable PITR before admitting canonical writes.
6. Restore into a separate database and run the complete PostgreSQL integration
   suite against that restored target.

## Connection policy

Use short-lived provider identities where supported. Otherwise rotate scoped
passwords through the secret manager without placing credentials in source,
reports or logs. Connection poolers must preserve transaction affinity for
workspace context and must not use a database owner as the application role.

## Release evidence

Record the provider product/version, region class, source commit, migration
checksums, role and RLS results, restore timestamp, recovery duration and
verification report URI. Do not record database hostnames, account IDs,
credentials or canonical content.
