# Release 0.1P production deployment contract

Trust Core is production-eligible only when the controls below are implemented
and evidenced for the exact deployed commit. Passing the local Docker gate does
not prove this operating environment.

## Network and ingress boundary

- Expose the Trust API only through an approved TLS 1.2+ reverse proxy or API
  gateway. PostgreSQL and object storage remain on private network paths.
- Redirect HTTP to HTTPS before traffic reaches the API. Preserve a generated
  request ID and never trust client-supplied forwarding headers unless they come
  from the approved proxy.
- Apply per-IP and per-identity rate limits to authentication, OIDC callback,
  upload, ingest and verification routes. Bound connection, header, request and
  upstream timeouts.
- Serve the Control Centre and API from the same trusted site unless an explicit
  reviewed CORS policy is introduced. Do not use wildcard credentialed CORS.
- Retain the API's no-store and security headers. The gateway may strengthen
  them but must not remove them.

## Identity and emergency access

- Configure and test a real organisation OIDC tenant, approved claim mapping,
  MFA/passkeys, account disablement and session revocation.
- Keep `TRUST_ALLOW_BOOTSTRAP_BEARER=false`. Emergency bootstrap access is
  exchange-only, high entropy, time limited, approved, retrieved at runtime and
  removed immediately after the drill or incident.
- Store database, object-store, OIDC and bootstrap credentials in a secret
  manager. Do not place production credentials in images or Vercel build-time
  environment variables.

## Evidence and release gate

- Require both `Source quality` and `Docker integration` for pull requests and
  the protected `main` branch.
- A Docker report is release evidence only when its recorded source revision is
  the exact clean commit being released and its workflow run is retained.
- Record image digests, migration checksums, deployment identifier, operator,
  timestamp and rollback target.

## Durability and recovery

- Configure encrypted PostgreSQL backups and separately administered object
  storage replication/versioning according to policy.
- Restore both stores into an isolated environment and run full Trust Core
  verification. A database-only import is not a successful recovery drill.
- Record achieved recovery point and recovery time. Test credential and key
  recovery without relying on the original Control Centre.

## Observability

- Alert on authentication failures, bootstrap activation, cross-workspace
  denials, critical verification issues, quarantined events, storage failures,
  migration failures and backup/restore failures.
- Logs must contain request and correlation identifiers but no tokens, cookies,
  database URLs, object contents or secret-bearing headers.

## Deployment separation

Vercel may host only the static Control Centre. The Trust API, worker,
PostgreSQL and canonical object storage require separately operated runtime and
private service boundaries.
