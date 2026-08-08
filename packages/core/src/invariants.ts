import { TrustInvariantError } from "./errors.js";
import type {
  BlobObject,
  Resource,
  RetentionPolicy,
  Revision,
} from "./types.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function assertBlobHash(blob: Pick<BlobObject, "sha256">): void {
  if (!SHA256_PATTERN.test(blob.sha256)) {
    throw new TrustInvariantError("BLOB_HASH_INVALID", "Blob SHA-256 must be 64 lowercase hexadecimal characters.");
  }
}

export function assertBlobEncryptionMetadata(
  blob: Pick<BlobObject, "encryptionState" | "encryptionKeyRef">,
): void {
  if (
    blob.encryptionState === "customer_managed" &&
    !blob.encryptionKeyRef?.trim()
  ) {
    throw new TrustInvariantError(
      "BLOB_ENCRYPTION_METADATA_INVALID",
      "Customer-managed encryption requires a non-secret key reference.",
    );
  }
  if (
    blob.encryptionKeyRef !== null &&
    /(?:secret|password|private[_-]?key)\s*[:=]/i.test(blob.encryptionKeyRef)
  ) {
    throw new TrustInvariantError(
      "BLOB_ENCRYPTION_METADATA_INVALID",
      "Encryption metadata must contain a key reference, not secret material.",
    );
  }
}

export function assertRetentionPolicy(
  policy: Pick<
    RetentionPolicy,
    | "name"
    | "recoveryWindowDays"
    | "minimumHistoryDays"
    | "backupRetentionDays"
  > & { purgeEnabled: boolean },
): void {
  if (!policy.name.trim())
    throw new TrustInvariantError(
      "RETENTION_POLICY_INVALID",
      "Retention policy name is required.",
    );
  for (const [field, value] of [
    ["recoveryWindowDays", policy.recoveryWindowDays],
    ["minimumHistoryDays", policy.minimumHistoryDays],
    ["backupRetentionDays", policy.backupRetentionDays],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 36500)
      throw new TrustInvariantError(
        "RETENTION_POLICY_INVALID",
        `${field} must be an integer between 0 and 36500.`,
      );
  }
  if (policy.purgeEnabled)
    throw new TrustInvariantError(
      "PURGE_NOT_IMPLEMENTED",
      "Purge cannot be enabled because no purge executor is implemented.",
    );
}

export function assertResourceCurrentRevision(
  resource: Resource,
  revision: Revision,
): void {
  if (resource.workspaceId !== revision.workspaceId || resource.datasetId !== revision.datasetId) {
    throw new TrustInvariantError("WORKSPACE_MISMATCH", "Resource and revision must share workspace and dataset.");
  }
  if (resource.id !== revision.resourceId || resource.currentRevisionId !== revision.id) {
    throw new TrustInvariantError("INVALID_CURRENT_REVISION", "Current revision must belong to the resource.");
  }
}

export function assertNextRevision(input: {
  resource: Resource;
  currentRevision: Revision | null;
  proposed: Revision;
}): void {
  const { resource, currentRevision, proposed } = input;

  if (proposed.resourceId !== resource.id || proposed.workspaceId !== resource.workspaceId || proposed.datasetId !== resource.datasetId) {
    throw new TrustInvariantError("WORKSPACE_MISMATCH", "Proposed revision must remain within the resource boundary.");
  }

  if (currentRevision === null) {
    if (proposed.parentRevisionId !== null || proposed.revisionNumber !== 1) {
      throw new TrustInvariantError("INVALID_REVISION_NUMBER", "First revision must be revision 1 with no parent.");
    }
    return;
  }

  if (resource.currentRevisionId !== currentRevision.id) {
    throw new TrustInvariantError("INVALID_CURRENT_REVISION", "Supplied current revision is not the resource head.");
  }
  if (proposed.parentRevisionId !== currentRevision.id) {
    throw new TrustInvariantError("BASE_REVISION_CONFLICT", "Proposed revision was based on a stale or different head.");
  }
  if (proposed.revisionNumber !== currentRevision.revisionNumber + 1) {
    throw new TrustInvariantError("INVALID_REVISION_NUMBER", "Revision number must increase by one.");
  }
}
