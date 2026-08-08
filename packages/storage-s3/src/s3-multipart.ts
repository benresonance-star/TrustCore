import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  MULTIPART_PROVIDER_LIMITS,
  StorageError,
  type ByteRange,
  type MultipartUploadSession,
  type MultipartUploadedPart,
  type ObjectLocator,
  type ObjectMetadata,
} from "@trust-core/storage";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

const TEMPORARY_KEY_PATTERN =
  /^workspaces\/[A-Za-z0-9_-]+\/temporary\/[A-Za-z0-9_-]+$/;

interface SessionRecord {
  session: MultipartUploadSession;
}

export class S3MultipartController {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly encryption: {
      ServerSideEncryption?: "AES256" | "aws:kms";
      SSEKMSKeyId?: string;
    } = {},
  ) {}

  async openReadStream(
    input: ObjectLocator & { range?: ByteRange },
  ): Promise<Readable> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          ...(input.range
            ? { Range: `bytes=${input.range.start}-${input.range.end}` }
            : {}),
        }),
      );
      if (!(result.Body instanceof Readable)) {
        throw new StorageError(
          "permanent",
          "Storage adapter received a non-Node stream",
        );
      }
      return result.Body;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw mapProviderError(error, "Failed to open object stream");
    }
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
    assertPartSize(input.partSize);
    const existing = this.sessions.get(input.uploadId);
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
    try {
      const created = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: input.locator.key,
          ContentType: input.mediaType,
          ...this.encryption,
        }),
      );
      if (!created.UploadId) {
        throw new StorageError(
          "permanent",
          "Provider did not return a multipart upload reference",
        );
      }
      const session: MultipartUploadSession = {
        uploadId: input.uploadId,
        providerUploadRef: created.UploadId,
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
      this.sessions.set(input.uploadId, { session });
      return cloneSession(session);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw mapProviderError(error, "Failed to initiate multipart upload");
    }
  }

  async listMultipartParts(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
  }): Promise<readonly MultipartUploadedPart[]> {
    const state = this.requireSession(input);
    try {
      const listed = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: input.locator.key,
          UploadId: input.providerUploadRef,
        }),
      );
      return (listed.Parts ?? []).map((part) => ({
        partNumber: part.PartNumber ?? 0,
        etag: part.ETag ?? "",
        size: part.Size ?? 0,
      }));
    } catch (error) {
      throw mapProviderError(error, "Failed to list multipart parts");
    } finally {
      void state;
    }
  }

  async uploadMultipartPart(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
    partNumber: number;
    body: Readable;
    size: number;
  }): Promise<MultipartUploadedPart> {
    const state = this.requireSession(input);
    if (state.session.status === "aborted" || state.session.status === "completed") {
      throw new StorageError(
        "invalid_request",
        `Cannot upload parts for ${state.session.status} multipart upload`,
      );
    }
    assertPartNumber(input.partNumber);
    if (input.size > MULTIPART_PROVIDER_LIMITS.maxPartSize) {
      throw new StorageError("invalid_request", "Multipart part exceeds max size");
    }
    const body = await readAll(input.body);
    if (body.byteLength !== input.size) {
      throw new StorageError(
        "invalid_request",
        "Multipart part size does not match declared size",
      );
    }
    const existing = state.session.parts.find(
      (part) => part.partNumber === input.partNumber,
    );
    try {
      const uploaded = await this.client.send(
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: input.locator.key,
          UploadId: input.providerUploadRef,
          PartNumber: input.partNumber,
          Body: body,
          ContentLength: body.byteLength,
        }),
      );
      const etag = uploaded.ETag;
      if (!etag) {
        throw new StorageError("permanent", "Provider omitted multipart part etag");
      }
      const part = {
        partNumber: input.partNumber,
        etag,
        size: body.byteLength,
      };
      if (existing) {
        if (existing.etag !== part.etag || existing.size !== part.size) {
          throw new StorageError(
            "conflict",
            "Duplicate multipart part number with inconsistent checksum",
          );
        }
        return { ...existing };
      }
      state.session = {
        ...state.session,
        status: "uploading",
        parts: [...state.session.parts, part].sort(
          (a, b) => a.partNumber - b.partNumber,
        ),
      };
      return { ...part };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw mapProviderError(error, "Failed to upload multipart part");
    }
  }

  async completeMultipartUpload(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
    parts: readonly MultipartUploadedPart[];
    expectedByteLength: number;
    expectedSha256: string;
  }): Promise<ObjectMetadata> {
    const state = this.requireSession(input);
    if (state.session.status === "aborted") {
      throw new StorageError(
        "invalid_request",
        "Cannot complete an aborted multipart upload",
      );
    }
    if (state.session.status === "completed") {
      return this.verifyCompleted(input);
    }
    reconcileParts(state.session.parts, input.parts);
    const ordered = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: input.locator.key,
          UploadId: input.providerUploadRef,
          MultipartUpload: {
            Parts: ordered.map((part) => ({
              ETag: part.etag,
              PartNumber: part.partNumber,
            })),
          },
        }),
      );
    } catch (error) {
      throw mapProviderError(error, "Failed to complete multipart upload");
    }
    const verified = await this.verifyCompleted(input);
    state.session = { ...state.session, status: "completed", parts: ordered };
    return verified;
  }

  async abortMultipartUpload(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
  }): Promise<void> {
    const existing = this.sessions.get(input.uploadId);
    if (!existing) {
      try {
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: input.locator.key,
            UploadId: input.providerUploadRef,
          }),
        );
      } catch (error) {
        if (errorStatus(error) === 404) return;
        throw mapProviderError(error, "Failed to abort multipart upload");
      }
      return;
    }
    if (
      existing.session.locator.key !== input.locator.key ||
      existing.session.providerUploadRef !== input.providerUploadRef
    ) {
      throw new StorageError("conflict", "Multipart abort target mismatch");
    }
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: input.locator.key,
          UploadId: input.providerUploadRef,
        }),
      );
    } catch (error) {
      if (errorStatus(error) !== 404) {
        throw mapProviderError(error, "Failed to abort multipart upload");
      }
    }
    existing.session = { ...existing.session, status: "aborted", parts: [] };
  }

  private async verifyCompleted(input: {
    locator: ObjectLocator;
    expectedByteLength: number;
    expectedSha256: string;
  }): Promise<ObjectMetadata> {
    const stream = await this.openReadStream(input.locator);
    const body = await readAll(stream);
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (
      body.byteLength !== input.expectedByteLength ||
      sha256 !== input.expectedSha256
    ) {
      throw new StorageError(
        "invalid_request",
        "Multipart assembly does not match expected size or checksum",
      );
    }
    return {
      key: input.locator.key,
      byteLength: body.byteLength,
      mediaType: "application/octet-stream",
      sha256,
    };
  }

  private requireSession(input: {
    uploadId: string;
    locator: ObjectLocator;
    providerUploadRef: string;
  }): SessionRecord {
    const state = this.sessions.get(input.uploadId);
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

function assertMediaType(mediaType: string): void {
  if (mediaType.trim().length === 0) {
    throw new StorageError("invalid_request", "Invalid object media type");
  }
}

function assertPartSize(partSize: number): void {
  if (
    !Number.isSafeInteger(partSize) ||
    partSize < MULTIPART_PROVIDER_LIMITS.minPartSize ||
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

function errorStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
}

function mapProviderError(error: unknown, fallbackMessage: string): StorageError {
  if (error instanceof StorageError) return error;
  const status = errorStatus(error);
  const rawMessage = error instanceof Error ? error.message : fallbackMessage;
  if (status === 404) {
    return new StorageError("not_found", "Object was not found", error);
  }
  if (status === 403) {
    return new StorageError("access_denied", "Storage access was denied", error);
  }
  if (status === 409 || status === 412) {
    return new StorageError("conflict", "Storage object conflict", error);
  }
  if (status === 429) {
    return new StorageError(
      "throttled",
      "Storage provider throttled the request",
      error,
    );
  }
  if (status !== undefined && status >= 500) {
    return new StorageError(
      "transient",
      "Storage provider is temporarily unavailable",
      error,
    );
  }
  return new StorageError("permanent", rawMessage || fallbackMessage, error);
}
