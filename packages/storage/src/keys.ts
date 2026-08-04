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
