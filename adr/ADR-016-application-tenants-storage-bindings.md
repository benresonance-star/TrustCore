# ADR-016: Application tenants and storage binding inheritance

## Status

Accepted (implementation in progress)

## Context

Connected apps (e.g. Foundation) have app-global and per-tenant object stores.
Trust Core’s isolation boundary remains the **Workspace**. Mapping each
Foundation tenant to a Workspace would explode policy and audit chains.

Platform blob storage today is process-level env/IAM (`ObjectStorage`). Admins
need to see and manage **bindings** per application and application-tenant,
including BYOB (bring your own bucket), without putting secrets in the browser.

User source connectors (Drive/OneDrive/…) remain separate per ADR-015.

## Decision

1. Introduce **ApplicationTenant** under `ApplicationRegistration`, keyed by
   `(workspaceId, applicationId, externalTenantKey)`.
2. Introduce **StorageProfile** (non-secret provider metadata) and
   **StorageBinding** linking app-default (`applicationTenantId = null`) or
   tenant override to a profile + credential reference.
3. **Effective storage resolution:** tenant override → app default → platform
   default (host env `ObjectStorage`).
4. **Bridge model:** platform pooled storage by default; BYOB silo per tenant
   when overridden.
5. **Credentials:** prefer `sts:AssumeRole` + server-issued **ExternalId** +
   `ExpectedBucketOwner`. Reject roles assumable without ExternalId. Static
   keys only for MinIO/dev via server-side refs.
6. **Status honesty:** Connected only after successful live probe (Tier A
   required). Configured = metadata present but unverified.
7. **Routing:** server-derived `RoutingContext`; sticky `storage_binding_id` on
   `blob_objects` at commit; downloads follow blob binding; new writes follow
   effective binding; fail-closed if binding not Connected/enabled.
8. **Key layout:** pool —
   `workspaces/{workspaceId}/apps/{applicationId}/tenants/{tenantKey}/…`;
   BYOB silo — app/tenant prefix inside the customer bucket (or bucket root if
   exclusive). No cross-binding dedupe by default.
9. **Handshake:** Draft → ExternalId/template → role submitted → hardening
   check (assume without ExternalId must fail) → connectivity probe → optional
   ingest probe → Connected.
10. **Plan sync:** declared entitlement vs observed usage/quota; never invent
    quotas; sync does not grant Connected.
11. **Portability:** reuse `.trustarchive` with app/tenant scope; migrate uses
    digest-equal copy + epoch cutover + rollback window.
12. **SourceConnector** remains deferred (ADR-015).

## Addendum — Primary-path completion and multi-option deferral

1. **Primary slice first:** One primary binding per app-default and per
   tenant scope (unique indexes from migration 0015). Multi-option
   (`binding_role` ∈ primary | archive | replica) is deferred until the
   primary CRUD, binding-aware data plane, and Control Centre live path
   ship.
2. **Tenant lifecycle:** create → update `displayName` → suspend → close
   (soft-delete). `externalTenantKey` is immutable. Suspended/closed
   tenants fail-closed for new writes; sticky blob reads remain valid.
3. **Binding lifecycle:** upsert / get / list / disable / delete (delete
   guarded when Connected or sticky blobs exist). `generation` bumps on
   profile-changing upsert and rollback; mutate APIs accept optional
   `expectedGeneration` for optimistic concurrency.
4. **Operator surfaces:** Connections registers apps and grants access;
   Apps & Tenants manages tenants and BYOB bindings; Storage diagnoses
   the platform host store only. Platform-healthy must not imply all
   tenant bindings are Connected.
5. **Credentials:** Prefer STS AssumeRole + ExternalId +
   `ExpectedBucketOwner`. Never return secrets to the browser. Connected
   requires a live Tier-A probe on the Postgres path.
6. **Audit + idempotency:** Tenant and binding mutations require
   `storage:manage`, an idempotency key where create/upsert applies, and
   audit events without secret material.
7. **Non-goals:** Trust Core does not apply AWS Backup, S3 Versioning, or
   Lifecycle rules; profiles may store opaque `lifecyclePolicyRef` /
   storage-class intent later. Archive copy workers are a follow-on.

## Consequences

- Control Centre gains Apps & Tenants; platform Storage page stays host-default
  diagnostics.
- Migrations add RLS-scoped tenant/binding tables.
- API/worker must resolve bindings before object I/O when app-tenant context
  is present; platform path unchanged without that context.
- Tests: routing matrix R1–R12, security S1–S15, dummy-data performance suite.
