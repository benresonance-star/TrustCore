import { TrustInvariantError } from "./errors.js";
import type { BlobObject, Resource, Revision } from "./types.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function assertBlobHash(blob: Pick<BlobObject, "sha256">): void {
  if (!SHA256_PATTERN.test(blob.sha256)) {
    throw new TrustInvariantError("BLOB_HASH_INVALID", "Blob SHA-256 must be 64 lowercase hexadecimal characters.");
  }
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
