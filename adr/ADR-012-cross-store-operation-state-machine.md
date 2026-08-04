# ADR-012: Cross-store operation state machine

## Decision

Workflows spanning PostgreSQL and object storage use durable, idempotent operations and an outbox. They do not pretend to be one distributed transaction.

## Consequences

Interrupted uploads can resume, reconcile or quarantine without producing a revision that points to missing bytes.
