# Identity-provider administration runbook

This runbook covers the Release 0.1 OIDC authorization-code flow and emergency
bootstrap credential. It is read with the
[threat model](../contracts/threat-model.md),
[trust boundaries](../contracts/trust-boundaries.md) and
[public error contract](../contracts/error-codes.md).

Production MFA, passkeys, account recovery, administrator approval and IdP
audit retention are configured and evidenced at the identity provider; Trust
Core does not implement those controls.

## OIDC application configuration

Register a confidential web client with:

- authorization-code flow;
- PKCE with `S256`;
- exact redirect URI matching `TRUST_OIDC_REDIRECT_URI`;
- `openid profile email` scopes;
- signed ID tokens using `RS256`, `PS256` or `ES256`; and
- an HTTPS issuer whose discovery document reports the same issuer and HTTPS
  authorization, token and JWKS endpoints.

Set runtime values through the deployment secret/configuration system:

```text
TRUST_OIDC_ISSUER=https://identity.example.com
TRUST_OIDC_CLIENT_ID=trust-core-control-centre
TRUST_OIDC_CLIENT_SECRET=<secret-manager-reference>
TRUST_OIDC_REDIRECT_URI=https://trust.example.com/v1/auth/oidc/callback
TRUST_OIDC_ROLE_CLAIM=roles
TRUST_OIDC_WORKSPACE_CLAIM=trust_workspaces
```

OIDC is enabled only when issuer, client ID, redirect URI and PostgreSQL are
available at API startup. The issuer must not include an unapproved tenant or
realm, wildcard redirect URIs are forbidden, and the client secret must never
be placed in source control, browser configuration or reports.

Validate after deployment:

```powershell
curl.exe -i "https://trust.example.com/v1/auth/oidc/start?returnTo=/"
```

Expect a `302` to the configured issuer and an HttpOnly, SameSite=Lax
`trust_oidc_binding` cookie. Complete a real login in a controlled browser,
then confirm the `trust_session` cookie is HttpOnly, SameSite=Strict and Secure
in production. Missing configuration returns `OIDC_UNAVAILABLE`; malformed
callbacks return `OIDC_CALLBACK_INVALID`.

## Claims administration

The ID token must contain:

- `sub`, `iss`, `aud`, `nonce`, and normal token timestamps validated by the
  OIDC library;
- the configured role claim; and
- the configured workspace claim.

Release 0.1 maps only these external role values:

- `trust-owner` to `owner`
- `trust-admin` to `admin`
- `trust-editor` to `editor`
- `trust-recovery` to `recovery_operator`
- `trust-auditor` to `auditor`

The workspace claim is a string or array of workspace UUIDs. Unknown roles are
discarded. A login with no mapped role or no workspace is denied. Claims
establish candidate membership only: route policy and forced PostgreSQL RLS
still apply. Do not place global infrastructure or worker privileges in user
claims.

Test at least one allowed and denied user after every claim-rule change:

- expected role and workspace succeeds;
- wrong workspace is denied;
- unknown role is denied;
- missing workspace is denied; and
- a user removed at the IdP cannot create a new Trust Core session.

Existing Trust Core sessions embed the actor claims captured at login. Claim
changes therefore require session revocation when immediate effect is needed.

## Session revocation

Users may revoke their current cookie session with:

```powershell
curl.exe -i -X DELETE "https://trust.example.com/v1/auth/session" `
  -H "Cookie: trust_session=<session>; trust_csrf=<csrf>" `
  -H "X-Trust-CSRF: <csrf>"
```

OIDC sessions are stored as SHA-256 hashes in `identity_sessions`. For emergency
revocation by actor, use the migration/operator connection, record the incident
and affected actor, then run:

```powershell
$env:PGPASSWORD = "<migration-password-from-secret-manager>"
psql.exe $env:TRUST_MIGRATION_DATABASE_URL -v ON_ERROR_STOP=1 -v actor_id="https://issuer.example#subject" -c "UPDATE identity_sessions SET revoked_at=now() WHERE revoked_at IS NULL AND actor_json->>'id'=:'actor_id';"
Remove-Item Env:PGPASSWORD
```

To revoke every OIDC session during a broad incident:

```powershell
$env:PGPASSWORD = "<migration-password-from-secret-manager>"
psql.exe $env:TRUST_MIGRATION_DATABASE_URL -v ON_ERROR_STOP=1 -c "UPDATE identity_sessions SET revoked_at=now() WHERE revoked_at IS NULL;"
Remove-Item Env:PGPASSWORD
```

Release 0.1 does not consume IdP back-channel logout or continuous-access
events. Disabling an IdP account blocks new login but does not revoke an
existing Trust Core session until it expires or is revoked in PostgreSQL.
Sessions expire after 30 minutes by default.

## Emergency bootstrap

`TRUST_ADMIN_TOKEN` is an emergency local/bootstrap credential, not the normal
production sign-in path. It creates a process-local 30-minute administrator
session through `POST /v1/auth/session`. Direct bearer authentication is
disabled in production by default. `TRUST_ALLOW_BOOTSTRAP_BEARER=true` is a
temporary compatibility override requiring the same explicit approval and
removal procedure as the bootstrap token itself.
The actor is configured by `TRUST_ADMIN_ACTOR_ID`; its workspace access is
limited to the API process's configured workspace list.

If production emergency access is explicitly approved:

1. Generate a high-entropy token in the secret manager.
2. Set `TRUST_ADMIN_TOKEN` and a unique `TRUST_ADMIN_ACTOR_ID`.
3. Restart the API and record approver, operator, reason and start time outside
   Trust Core.
4. Exchange it without logging the token:

```powershell
$headers = @{ Authorization = "Bearer <retrieve-at-runtime>"; "Cache-Control" = "no-store" }
Invoke-RestMethod -Method Post -Uri "https://trust.example.com/v1/auth/session" -Headers $headers
```

5. Perform only the approved action, revoke the returned session, remove the
   bootstrap token from deployment configuration, and restart every API
   instance.
6. Review correlated application, IdP and infrastructure logs.

Bootstrap sessions are held in process memory rather than PostgreSQL. Restarting
all API instances revokes them; there is no Release 0.1 endpoint to enumerate or
centrally revoke all bootstrap sessions. Never use the fixture fallback token
as production evidence.

## Credential rotation

### OIDC client secret

1. Create a second IdP client secret if the provider supports overlap.
2. Store it as a new secret-manager version.
3. update `TRUST_OIDC_CLIENT_SECRET` and restart all API instances.
4. Complete an OIDC login and revoke the test session.
5. Revoke the old secret at the IdP and verify old-secret exchange fails.

If overlap is unsupported, schedule a login outage. Existing Trust Core
sessions continue until revoked or expired.

### Bootstrap token

Replace `TRUST_ADMIN_TOKEN`, restart all API instances, validate only through an
approved emergency-access drill, then revoke the old secret-manager version.
A restart is required because configuration is read at process startup.

### PostgreSQL runtime credentials

Set new `TRUST_*_DB_PASSWORD` values in the secret manager and use the owner
connection to rerun provisioning:

```powershell
npx --yes pnpm@10.15.0 --filter @trust-core/api db:provision
```

Update each corresponding connection URL and restart that runtime. Validate
API, worker, verifier and audit roles independently with:

```powershell
$env:POSTGRES_INTEGRATION = "1"
npx --yes pnpm@10.15.0 --filter @trust-core/persistence-postgres test:docker
Remove-Item Env:POSTGRES_INTEGRATION
```

The repository provisioning command is local/development tooling. Production
rotation needs deployment-specific secret rollout and rollback procedures.

### Object-store credentials

Release 0.1 local Docker uses MinIO root credentials for the adapter. Rotate
`TRUST_STORAGE_ACCESS_KEY` and `TRUST_STORAGE_SECRET_KEY`, restart API and worker
instances, and run:

```powershell
$env:TRUST_DOCKER_TESTS = "1"
npx --yes pnpm@10.15.0 --filter @trust-core/storage-minio test:docker
npx --yes pnpm@10.15.0 --filter @trust-core/api test:docker
Remove-Item Env:TRUST_DOCKER_TESTS
```

Production must use provider-scoped credentials and provider-native overlap or
key-revocation procedures. This repository does not automate object-store key
creation or rotation.

## Incident closure

Before closing an identity incident, preserve sanitized evidence that:

- compromised IdP and bootstrap credentials were revoked;
- affected OIDC rows were marked revoked and all bootstrap-hosting processes
  restarted;
- claim mappings and workspace assignments were reviewed;
- denied and allowed login tests passed;
- storage and database runtime checks passed after any related rotation; and
- no token, cookie, client secret or database URL was copied into the incident
  record.
