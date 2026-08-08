import {
  StorageError,
  type MultipartObjectStorage,
  type ObjectLocator,
  type ObjectMetadata,
  type ObjectStorage,
} from "@trust-core/storage";
import type { QuarantineScanState } from "./quarantine-scan.js";

export interface PromoteQuarantineInput {
  workspaceId: string;
  quarantine: ObjectLocator;
  /** Already allocated canonical locator key. */
  canonical: ObjectLocator;
  sha256: string;
  byteLength: number;
  mediaType: string;
  scanState: QuarantineScanState;
}

/**
 * Narrow promotion primitive: copy/verify quarantine bytes into an allocated
 * immutable canonical locator. Does not commit logical revision identity.
 */
export async function promoteQuarantineObject(
  storage: ObjectStorage,
  input: PromoteQuarantineInput,
): Promise<ObjectMetadata> {
  if (input.scanState !== "accepted" && input.scanState !== "promotion_pending") {
    throw new StorageError(
      "invalid_request",
      "Promotion requires an accepted quarantine scan state",
    );
  }
  if (await storage.exists(input.canonical)) {
    const existing = await storage.head(input.canonical);
    if (
      existing.byteLength === input.byteLength &&
      existing.sha256 === input.sha256
    ) {
      return existing;
    }
    throw new StorageError(
      "conflict",
      "Canonical destination already contains conflicting content",
    );
  }
  if (!(await storage.exists(input.quarantine))) {
    throw new StorageError("not_found", "Quarantine object was not found");
  }
  const head = await storage.head(input.quarantine);
  if (
    head.byteLength !== input.byteLength ||
    (head.sha256 && head.sha256 !== input.sha256)
  ) {
    throw new StorageError(
      "invalid_request",
      "Quarantine object does not match promotion checksum declaration",
    );
  }

  // Prefer commitImmutable when quarantine key is temporary; otherwise stream copy via multipart-capable adapters is out of scope — require temporary key path.
  if (!input.quarantine.key.includes("/temporary/")) {
    throw new StorageError(
      "invalid_request",
      "Promotion source must be a temporary quarantine locator",
    );
  }

  const committed = await storage.commitImmutable({
    temporary: input.quarantine,
    workspaceId: input.workspaceId,
    sha256: input.sha256,
    byteLength: input.byteLength,
    mediaType: input.mediaType,
  });

  if (
    committed.sha256 === input.sha256 &&
    committed.byteLength === input.byteLength
  ) {
    return committed;
  }
  throw new StorageError(
    "conflict",
    "Promotion destination does not match allocated canonical locator",
  );
}

export type { MultipartObjectStorage };
