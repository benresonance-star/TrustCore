import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { StorageError } from "./errors.js";
import { canonicalObjectKey, temporaryObjectKey } from "./keys.js";
import type {
  ByteRange,
  MultipartObjectStorage,
  MultipartUploadSession,
  MultipartUploadedPart,
  ObjectLocator,
  ObjectMetadata,
  StoredObject,
  TemporaryObject,
} from "./types.js";
import { MULTIPART_PROVIDER_LIMITS } from "./types.js";

const TEMPORARY_KEY_PATTERN =
  /^workspaces\/[A-Za-z0-9_-]+\/temporary\/[A-Za-z0-9_-]+$/;

interface StoredBytes {
  body: Buffer;
  mediaType: string;
  sha256: string;
}

interface MemoryMultipartSession {
  session: MultipartUploadSession;
  partBodies: Map<number, Buffer>;
}

/** Deterministic in-process ObjectStorage for contract and unit tests. */
export class MemoryObjectStorage implements MultipartObjectStorage {
  private readonly objects = new Map<string, StoredBytes>();
  private readonly multipart = new Map<string, MemoryMultipartSession>();
  private readonly relaxMultipartLimits: boolean;

  constructor(options?: { relaxMultipartLimits?: boolean }) {
    this.relaxMultipartLimits = options?.relaxMultipartLimits ?? false;
  }

  async createTemporaryUpload(input: {
    workspaceId: string;
    operationId: string;
  }): Promise<TemporaryObject> {
    return {
      key: temporaryObjectKey(input.workspaceId, input.operationId),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async writeTemporary(input: {
    locator: ObjectLocator;
    body: Readable;
    mediaType: string;
  }): Promise<ObjectMetadata> {
    assertTemporaryKey(input.locator.key);
    assertMediaType(input.mediaType);
    const body = await readAll(input.body);
    const sha256 = createHash("sha256").update(body).digest("hex");
    this.objects.set(input.locator.key, {
      body,
      mediaType: input.mediaType,
      sha256,
    });
    return {
      key: input.locator.key,
      byteLength: body.byteLength,
      mediaType: input.mediaType,
      sha256,
    };
  }

  async commitImmutable(input: {
    temporary: ObjectLocator;
    workspaceId: string;
    sha256: string;
    byteLength: number;
    mediaType: string;
  }): Promise<StoredObject> {
    assertTemporaryKey(input.temporary.key);
    assertByteLength(input.byteLength);
    assertMediaType(input.mediaType);
    const key = canonicalObjectKey(input.workspaceId, input.sha256);
    const temporary = this.objects.get(input.temporary.key);
    if (!temporary) {
      const existing = this.objects.get(key);
      if (
        existing &&
        existing.sha256 === input.sha256 &&
        existing.body.byteLength === input.byteLength
      ) {
        return {
          key,
          byteLength: existing.body.byteLength,
          mediaType: existing.mediaType,
          sha256: existing.sha256,
        };
      }
      throw new StorageError(
        "not_found",
        "Temporary object was not found for immutable commit",
      );
    }
    if (
      temporary.sha256 !== input.sha256 ||
      temporary.body.byteLength !== input.byteLength ||
      temporary.mediaType !== input.mediaType
    ) {
      throw new StorageError(
        "invalid_request",
        "Temporary object does not match the immutable commit declaration",
      );
    }
    const existing = this.objects.get(key);
    if (existing) {
      if (
        existing.sha256 !== input.sha256 ||
        existing.body.byteLength !== input.byteLength
      ) {
        throw new StorageError(
          "conflict",
          "Canonical object conflicts with the immutable commit declaration",
        );
      }
      this.objects.delete(input.temporary.key);
      return {
        key,
        byteLength: existing.body.byteLength,
        mediaType: existing.mediaType,
        sha256: existing.sha256,
      };
    }
    this.objects.set(key, { ...temporary });
    this.objects.delete(input.temporary.key);
    return {
      key,
      byteLength: temporary.body.byteLength,
      mediaType: temporary.mediaType,
      sha256: temporary.sha256,
    };
  }

  async openReadStream(
    input: ObjectLocator & { range?: ByteRange },
  ): Promise<Readable> {
    const object = this.require(input.key);
    if (!input.range) return Readable.from(object.body);
    const { start, end } = input.range;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= object.body.byteLength
    ) {
      throw new StorageError("invalid_request", "Invalid byte range");
    }
    return Readable.from(object.body.subarray(start, end + 1));
  }

  async head(input: ObjectLocator): Promise<ObjectMetadata> {
    const object = this.require(input.key);
    return {
      key: input.key,
      byteLength: object.body.byteLength,
      mediaType: object.mediaType,
      sha256: object.sha256,
    };
  }

  async exists(input: ObjectLocator): Promise<boolean> {
    return this.objects.has(input.key);
  }

  async deleteTemporary(input: ObjectLocator): Promise<void> {
    assertTemporaryKey(input.key);
    this.objects.delete(input.key);
  }

  async initiateMultipartUpload(input: {
    uploadId: string;
    locator: ObjectLocator;
    mediaType: string;
    partSize: number;
    expectedByteLength?: number;
    expectedSha256?: string;
    expiresAt?: string;
  }): Promise<MultipartUploadSession> {
    assertTemporaryKey(input.locator.key);
    assertMediaType(input.mediaType);
    assertPartSize(input.partSize, this.relaxMultipartLimits);
    const existing = this.multipart.get(input.uploadId);
    if (existing) {
      if (
        existing.session.locator.key !== input.locator.key ||
        existing.session.mediaType !== input.mediaType ||
        existing.session.partSize !== input.partSize
      ) {
        throw new StorageError(
          "conflict",
          "Multipart upload id already bound to a different plan",
        );
      }
      return cloneSession(existing.session);
    }
    const session: MultipartUploadSession = {
      uploadId: input.uploadId,
      providerUploadRef: `memory-${randomBytes(8).toString("hex")}`,
      locator: { key: input.locator.key },
      mediaType: input.mediaType,
      partSize: input.partSize,
      ...(input.expectedByteLength !== undefined
        ? { expectedByteLength: input.expectedByteLength }
        : {}),
      ...(input.expectedSha256 !== undefined
        ? { expectedSha256: input.expectedSha256 }
        : {}),
      status: "initiated",
      parts: [],
      createdAt: new Date().toISOString(),
      expiresAt:
        input.expiresAt ??
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    this.multipart.set(input.uploadId, {
      session,
      partBodies: new Map(),
    });
    return cloneSession(session);
  }

  async listMultipartParts(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
  }): Promise<readonly MultipartUploadedPart[]> {
    const state = this.requireMultipart(input);
    return state.session.parts.map((part) => ({ ...part }));
  }

  async uploadMultipartPart(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
    partNumber: number;
    body: Readable;
    size: number;
  }): Promise<MultipartUploadedPart> {
    const state = this.requireMultipart(input);
    if (state.session.status === "aborted" || state.session.status === "completed") {
      throw new StorageError(
        "invalid_request",
        `Cannot upload parts for ${state.session.status} multipart upload`,
      );
    }
    assertPartNumber(input.partNumber);
    const body = await readAll(input.body);
    if (body.byteLength !== input.size) {
      throw new StorageError(
        "invalid_request",
        "Multipart part size does not match declared size",
      );
    }
    if (
      body.byteLength > state.session.partSize ||
      (body.byteLength < state.session.partSize &&
        input.partNumber !== maxExpectedPart(state))
    ) {
      // Allow undersized only as potential last part; still accept and reconcile at complete.
    }
    if (body.byteLength > MULTIPART_PROVIDER_LIMITS.maxPartSize) {
      throw new StorageError("invalid_request", "Multipart part exceeds max size");
    }
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    const existing = state.session.parts.find(
      (part) => part.partNumber === input.partNumber,
    );
    if (existing) {
      if (existing.etag !== etag || existing.size !== body.byteLength) {
        throw new StorageError(
          "conflict",
          "Duplicate multipart part number with inconsistent checksum",
        );
      }
      return { ...existing };
    }
    const part = {
      partNumber: input.partNumber,
      etag,
      size: body.byteLength,
    };
    state.partBodies.set(input.partNumber, body);
    state.session = {
      ...state.session,
      status: "uploading",
      parts: [...state.session.parts, part].sort(
        (a, b) => a.partNumber - b.partNumber,
      ),
    };
    return { ...part };
  }

  async completeMultipartUpload(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
    parts: readonly MultipartUploadedPart[];
    expectedByteLength: number;
    expectedSha256: string;
  }): Promise<ObjectMetadata> {
    const state = this.requireMultipart(input);
    if (state.session.status === "aborted") {
      throw new StorageError(
        "invalid_request",
        "Cannot complete an aborted multipart upload",
      );
    }
    if (state.session.status === "completed") {
      const object = this.require(input.locator.key);
      if (
        object.sha256 !== input.expectedSha256 ||
        object.body.byteLength !== input.expectedByteLength
      ) {
        throw new StorageError(
          "conflict",
          "Completed multipart object does not match declaration",
        );
      }
      return {
        key: input.locator.key,
        byteLength: object.body.byteLength,
        mediaType: object.mediaType,
        sha256: object.sha256,
      };
    }
    reconcileParts(state.session.parts, input.parts);
    const ordered = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
    const buffers: Buffer[] = [];
    for (const part of ordered) {
      const body = state.partBodies.get(part.partNumber);
      if (!body) {
        throw new StorageError("invalid_request", `Missing multipart part ${part.partNumber}`);
      }
      buffers.push(body);
    }
    const assembled = Buffer.concat(buffers);
    const sha256 = createHash("sha256").update(assembled).digest("hex");
    if (assembled.byteLength !== input.expectedByteLength || sha256 !== input.expectedSha256) {
      throw new StorageError(
        "invalid_request",
        "Multipart assembly does not match expected size or checksum",
      );
    }
    this.objects.set(input.locator.key, {
      body: assembled,
      mediaType: state.session.mediaType,
      sha256,
    });
    state.session = { ...state.session, status: "completed", parts: ordered };
    return {
      key: input.locator.key,
      byteLength: assembled.byteLength,
      mediaType: state.session.mediaType,
      sha256,
    };
  }

  async abortMultipartUpload(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
  }): Promise<void> {
    const existing = this.multipart.get(input.uploadId);
    if (!existing) return;
    if (
      existing.session.locator.key !== input.locator.key ||
      existing.session.providerUploadRef !== input.providerUploadRef
    ) {
      throw new StorageError("conflict", "Multipart abort target mismatch");
    }
    existing.session = { ...existing.session, status: "aborted", parts: [] };
    existing.partBodies.clear();
  }

  private require(key: string): StoredBytes {
    const object = this.objects.get(key);
    if (!object) {
      throw new StorageError("not_found", `Object was not found: ${key}`);
    }
    return object;
  }

  private requireMultipart(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
  }): MemoryMultipartSession {
    const state = this.multipart.get(input.uploadId);
    if (!state) {
      throw new StorageError("not_found", "Multipart upload was not found");
    }
    if (
      state.session.locator.key !== input.locator.key ||
      state.session.providerUploadRef !== input.providerUploadRef
    ) {
      throw new StorageError("conflict", "Multipart upload reference mismatch");
    }
    return state;
  }
}

function maxExpectedPart(state: MemoryMultipartSession): number {
  return state.session.parts.length + 1;
}

function reconcileParts(
  recorded: readonly MultipartUploadedPart[],
  declared: readonly MultipartUploadedPart[],
): void {
  if (recorded.length !== declared.length) {
    throw new StorageError(
      "invalid_request",
      "Multipart part list does not match recorded parts",
    );
  }
  const byNumber = new Map(recorded.map((part) => [part.partNumber, part]));
  for (const part of declared) {
    const match = byNumber.get(part.partNumber);
    if (!match || match.etag !== part.etag || match.size !== part.size) {
      throw new StorageError(
        "invalid_request",
        "Multipart part list is inconsistent with recorded parts",
      );
    }
  }
  const numbers = declared.map((part) => part.partNumber).sort((a, b) => a - b);
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index + 1) {
      throw new StorageError(
        "invalid_request",
        "Multipart parts must be a contiguous sequence starting at 1",
      );
    }
  }
}

function cloneSession(session: MultipartUploadSession): MultipartUploadSession {
  return {
    ...session,
    locator: { ...session.locator },
    parts: session.parts.map((part) => ({ ...part })),
  };
}

function assertTemporaryKey(key: string): void {
  if (!TEMPORARY_KEY_PATTERN.test(key)) {
    throw new StorageError(
      "invalid_request",
      "Refusing to operate on a non-temporary object",
    );
  }
}

function assertByteLength(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new StorageError("invalid_request", "Invalid object byte length");
  }
}

function assertMediaType(mediaType: string): void {
  if (mediaType.trim().length === 0) {
    throw new StorageError("invalid_request", "Invalid object media type");
  }
}

function assertPartSize(partSize: number, relax: boolean): void {
  const min = relax ? 1 : MULTIPART_PROVIDER_LIMITS.minPartSize;
  if (
    !Number.isSafeInteger(partSize) ||
    partSize < min ||
    partSize > MULTIPART_PROVIDER_LIMITS.maxPartSize
  ) {
    throw new StorageError(
      "invalid_request",
      "Multipart part size is outside provider limits",
    );
  }
}

function assertPartNumber(partNumber: number): void {
  if (
    !Number.isSafeInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > MULTIPART_PROVIDER_LIMITS.maxParts
  ) {
    throw new StorageError("invalid_request", "Invalid multipart part number");
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
