const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function canonicalObjectKey(workspaceId: string, sha256: string): string {
  if (!SAFE_ID_PATTERN.test(workspaceId)) throw new Error("Unsafe workspace identifier");
  if (!SHA256_PATTERN.test(sha256)) throw new Error("Invalid SHA-256");
  return `workspaces/${workspaceId}/objects/${sha256.slice(0, 2)}/${sha256}`;
}

export function temporaryObjectKey(workspaceId: string, operationId: string): string {
  if (!SAFE_ID_PATTERN.test(workspaceId) || !SAFE_ID_PATTERN.test(operationId)) throw new Error("Unsafe identifier");
  return `workspaces/${workspaceId}/temporary/${operationId}`;
}

/** Pooled platform bucket layout for app-tenant objects (ADR-016). */
export function canonicalAppTenantPoolObjectKey(input: {
  workspaceId: string;
  applicationId: string;
  tenantKey: string;
  sha256: string;
}): string {
  assertSafeAppTenantIds(input);
  if (!SHA256_PATTERN.test(input.sha256)) throw new Error("Invalid SHA-256");
  return `workspaces/${input.workspaceId}/apps/${input.applicationId}/tenants/${input.tenantKey}/objects/${input.sha256.slice(0, 2)}/${input.sha256}`;
}

/** BYOB silo layout inside a customer bucket (ADR-016). */
export function canonicalAppTenantSiloObjectKey(input: {
  applicationId: string;
  tenantKey: string;
  sha256: string;
}): string {
  if (
    !SAFE_ID_PATTERN.test(input.applicationId) ||
    !SAFE_ID_PATTERN.test(input.tenantKey)
  ) {
    throw new Error("Unsafe identifier");
  }
  if (!SHA256_PATTERN.test(input.sha256)) throw new Error("Invalid SHA-256");
  return `apps/${input.applicationId}/tenants/${input.tenantKey}/objects/${input.sha256.slice(0, 2)}/${input.sha256}`;
}

function assertSafeAppTenantIds(input: {
  workspaceId: string;
  applicationId: string;
  tenantKey: string;
}): void {
  if (
    !SAFE_ID_PATTERN.test(input.workspaceId) ||
    !SAFE_ID_PATTERN.test(input.applicationId) ||
    !SAFE_ID_PATTERN.test(input.tenantKey)
  ) {
    throw new Error("Unsafe identifier");
  }
}
