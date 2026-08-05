# Checkpoint 0.1P — production-readiness hardening

Release 0.1P hardens the completed 0.1 trust loop before Release 0.2 portability.

## Implemented in source

- Docker integration runs for pull requests, protected-branch pushes, schedules
  and manual dispatches.
- Production bootstrap credentials are exchange-only by default.
- API responses carry no-store, anti-sniffing, anti-framing, referrer and
  production HSTS headers.
- CI rejects known high or critical production dependency vulnerabilities.
- Release evidence is valid only for the exact clean committed SHA.
- A production ingress, identity, durability, recovery and observability
  contract is defined.

## External acceptance gates

These cannot be claimed from source or fixture mode:

- successful Docker gate for the release commit;
- required GitHub branch-protection checks;
- real organisation OIDC login, MFA/passkey and revocation drill;
- approved TLS/rate-limiting ingress deployment;
- secret rotation drill;
- combined PostgreSQL and object-store backup/restore followed by full
  verification;
- monitoring and alert delivery proof.

Release 0.2 `.trustarchive` export/import begins only after the applicable 0.1P
gates are evidenced in the target environment.
