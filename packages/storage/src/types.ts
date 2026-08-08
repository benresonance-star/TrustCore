import type { Readable } from "node:stream";

export interface ObjectLocator {
  key: string;
}
export interface TemporaryObject extends ObjectLocator {
  expiresAt: string;
}
export interface ObjectMetadata {
  key: string;
  byteLength: number;
  mediaType: string;
  sha256?: string;
}
export interface StoredObject extends ObjectMetadata {
  etag?: string;
}

/** Inclusive byte range for resumable downloads. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Internal Trust Core multipart session. Opaque providerUploadRef must not be
 * exposed on public /v1, SDK, or TCAP surfaces without an approved protocol gate.
 */
export interface MultipartUploadSession {
  uploadId: string;
  providerUploadRef: string;
  locator: ObjectLocator;
  mediaType: string;
  partSize: number;
  expectedByteLength?: number;
  expectedSha256?: string;
  status: "initiated" | "uploading" | "completed" | "aborted";
  parts: readonly MultipartUploadedPart[];
  createdAt: string;
  expiresAt: string;
}

export interface MultipartUploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

/** S3-compatible provider technical bounds (not Trust Core product policy). */
export const MULTIPART_PROVIDER_LIMITS = {
  minPartSize: 5 * 1024 * 1024,
  maxPartSize: 5 * 1024 * 1024 * 1024,
  maxParts: 10_000,
} as const;

export interface ObjectStorage {
  createTemporaryUpload(input: {
    workspaceId: string;
    operationId: string;
  }): Promise<TemporaryObject>;
  writeTemporary(input: {
    locator: ObjectLocator;
    body: Readable;
    mediaType: string;
  }): Promise<ObjectMetadata>;
  commitImmutable(input: {
    temporary: ObjectLocator;
    workspaceId: string;
    sha256: string;
    byteLength: number;
    mediaType: string;
  }): Promise<StoredObject>;
  openReadStream(
    input: ObjectLocator & { range?: ByteRange },
  ): Promise<Readable>;
  head(input: ObjectLocator): Promise<ObjectMetadata>;
  exists(input: ObjectLocator): Promise<boolean>;
  deleteTemporary(input: ObjectLocator): Promise<void>;
}

/** Internal resumable transfer API — not a public Foundation/SDK surface. */
export interface MultipartObjectStorage extends ObjectStorage {
  initiateMultipartUpload(input: {
    uploadId: string;
    locator: ObjectLocator;
    mediaType: string;
    partSize: number;
    expectedByteLength?: number;
    expectedSha256?: string;
    expiresAt?: string;
  }): Promise<MultipartUploadSession>;
  listMultipartParts(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
  }): Promise<readonly MultipartUploadedPart[]>;
  uploadMultipartPart(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
    partNumber: number;
    body: Readable;
    size: number;
  }): Promise<MultipartUploadedPart>;
  completeMultipartUpload(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
    parts: readonly MultipartUploadedPart[];
    expectedByteLength: number;
    expectedSha256: string;
  }): Promise<ObjectMetadata>;
  abortMultipartUpload(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
  }): Promise<void>;
}

export function isMultipartObjectStorage(
  storage: ObjectStorage,
): storage is MultipartObjectStorage {
  return (
    typeof (storage as MultipartObjectStorage).initiateMultipartUpload ===
      "function" &&
    typeof (storage as MultipartObjectStorage).uploadMultipartPart ===
      "function" &&
    typeof (storage as MultipartObjectStorage).completeMultipartUpload ===
      "function" &&
    typeof (storage as MultipartObjectStorage).abortMultipartUpload ===
      "function" &&
    typeof (storage as MultipartObjectStorage).listMultipartParts === "function"
  );
}
