# ADR-004: Modular monolith

## Decision

Release 0.1 is deployed as a modular monolith with explicit package boundaries, a public Trust API, and a separately runnable reconciliation worker. PostgreSQL and S3-compatible storage are infrastructure adapters, not application-facing interfaces.

## Consequences

Core, policy, protocol, operations, verification and persistence concerns remain independently testable without introducing distributed service calls. Modules may be separated later behind the existing contracts, but Release 0.1 does not claim independent service availability.
