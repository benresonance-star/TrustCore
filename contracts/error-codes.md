# Trust Core public error contract

The canonical code list is `publicErrorCodes` in
`packages/protocol/src/release01-contract.ts` and is emitted into
`contracts/openapi.json`. This document explains that generated contract; the
three sources must not diverge. Compatibility rules are in
[compatibility-policy.md](./compatibility-policy.md).

Release 0.1 HTTP endpoints return errors as:

```json
{
  "code": "INVALID_COMMAND",
  "message": "The request body is not valid for this command.",
  "details": {},
  "requestId": "optional-correlation-id"
}
```

`code` is a stable uppercase identifier. `message` is safe for display but is not
an API discriminator. `details` and `requestId` are optional. New codes may be
added within `/v1`; clients must handle unknown codes. Existing code meanings
will not be changed within `/v1`.

## Codes

- `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `INVALID_SESSION`
- `PERMISSION_DENIED`, `WORKSPACE_REQUIRED`
- `INVALID_COMMAND`, `REQUEST_TOO_LARGE`
- `SCHEMA_NOT_FOUND`, `RESOURCE_NOT_FOUND`, `DATASET_NOT_FOUND`,
  `APPLICATION_NOT_FOUND`, `VERIFICATION_REPORT_NOT_FOUND`,
  `OPERATION_NOT_FOUND`, `NOT_FOUND`
- `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `COMMAND_REJECTED`
- `COMMAND_BOUNDARY_UNAVAILABLE`, `OIDC_UNAVAILABLE`,
  `OIDC_CALLBACK_INVALID`, `TRUST_STORE_UNAVAILABLE`
- `METHOD_NOT_ALLOWED`

Errors never include stack traces, credentials, tokens, canonical content, or
raw database/storage failures. Internal diagnostics belong in correlated logs.

`REVISION_CONFLICT` implements
[ADR-011](../adr/ADR-011-no-silent-last-write-wins.md).
`IDEMPOTENCY_CONFLICT` means a previously used operation key was presented
with different input. `COMMAND_BOUNDARY_UNAVAILABLE`, `OIDC_UNAVAILABLE` and
`TRUST_STORE_UNAVAILABLE` report unavailable dependencies without exposing
their provider errors.

Check alignment with:

```powershell
npx --yes pnpm@10.15.0 check:openapi
npx --yes pnpm@10.15.0 --filter @trust-core/protocol test
```
