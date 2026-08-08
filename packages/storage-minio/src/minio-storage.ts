import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { ObjectMetadata, ObjectStorage, StoredObject, TemporaryObject } from "@trust-core/storage";
import { canonicalObjectKey, temporaryObjectKey } from "@trust-core/storage";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ByteRange } from "@trust-core/storage";

const TEMPORARY_KEY_PATTERN = /^workspaces\/[A-Za-z0-9_-]+\/temporary\/[A-Za-z0-9_-]+$/;

export interface MinioStorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export class MinioObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: MinioStorageConfig) {
    if ((config.accessKeyId === undefined) !== (config.secretAccessKey === undefined)) {
      throw new Error("MinIO static credentials require both accessKeyId and secretAccessKey");
    }
    this.client = new S3Client({
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async createTemporaryUpload(input: { workspaceId: string; operationId: string }): Promise<TemporaryObject> {
    return {
      key: temporaryObjectKey(input.workspaceId, input.operationId),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async writeTemporary(input: { locator: { key: string }; body: Readable; mediaType: string }): Promise<ObjectMetadata> {
    assertTemporaryKey(input.locator.key);
    assertMediaType(input.mediaType);
    let byteLength = 0;
    const hash = createHash("sha256");
    const countedBody = Readable.from((async function* () {
      for await (const chunk of input.body) {
        const bytes = Buffer.from(chunk);
        byteLength += bytes.byteLength;
        hash.update(bytes);
        yield bytes;
      }
    })());
    const upload = new Upload({
      client: this.client,
      leavePartsOnError: false,
      params: {
        Bucket: this.config.bucket,
        Key: input.locator.key,
        Body: countedBody,
        ContentType: input.mediaType,
      },
    });
    await upload.done();
    return { key: input.locator.key, byteLength, mediaType: input.mediaType, sha256: hash.digest("hex") };
  }

  async commitImmutable(input: { temporary: { key: string }; workspaceId: string; sha256: string; byteLength: number; mediaType: string }): Promise<StoredObject> {
    assertTemporaryKey(input.temporary.key);
    assertByteLength(input.byteLength);
    assertMediaType(input.mediaType);
    const key = canonicalObjectKey(input.workspaceId, input.sha256);
    let temporary: InspectedObject;
    try {
      temporary = await this.inspectObject(input.temporary);
    } catch (error) {
      if (!isMissingError(error)) throw error;
      return this.verifyCommittedObject(key, input.sha256, input.byteLength);
    }
    if (
      temporary.sha256 !== input.sha256 ||
      temporary.byteLength !== input.byteLength ||
      temporary.mediaType !== input.mediaType
    ) {
      throw new Error("Temporary object does not match the immutable commit declaration");
    }
    if (!temporary.etag) throw new Error("Temporary object has no entity tag for an immutable copy");

    try {
      const committed = await this.verifyCommittedObject(key, input.sha256, input.byteLength);
      await this.deleteTemporary(input.temporary);
      return committed;
    } catch (error) {
      if (!isMissingError(error)) throw error;
    }

    try {
      await this.client.send(new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        CopySource: encodeCopySource(this.config.bucket, input.temporary.key),
        CopySourceIfMatch: temporary.etag,
        IfNoneMatch: "*",
        ContentType: input.mediaType,
        MetadataDirective: "REPLACE",
        Metadata: { sha256: input.sha256 },
      }));
    } catch (error) {
      if (!isConditionalConflict(error)) throw error;
      await this.verifyCommittedObject(key, input.sha256, input.byteLength);
    }
    await this.deleteTemporary(input.temporary);
    const committed = await this.head({ key });
    return { ...committed, sha256: input.sha256 };
  }

  async openReadStream(input: { key: string; range?: ByteRange }): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ...(input.range ? { Range: `bytes=${input.range.start}-${input.range.end}` } : {}),
    }));
    if (!(result.Body instanceof Readable)) throw new Error("Storage adapter received a non-Node stream");
    return result.Body;
  }

  async head(input: { key: string }): Promise<ObjectMetadata> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: input.key }));
    return {
      key: input.key,
      byteLength: result.ContentLength ?? 0,
      mediaType: result.ContentType ?? "application/octet-stream",
      ...(result.Metadata?.sha256 ? { sha256: result.Metadata.sha256 } : {}),
    };
  }

  async exists(input: { key: string }): Promise<boolean> {
    try {
      await this.head(input);
      return true;
    } catch (error) {
      if (isMissingError(error)) return false;
      throw error;
    }
  }

  async deleteTemporary(input: { key: string }): Promise<void> {
    assertTemporaryKey(input.key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: input.key }));
  }

  private async inspectObject(input: { key: string }): Promise<InspectedObject> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: input.key }));
    if (!result.Body) throw new Error("Storage adapter received an object without a body");
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array | string>) {
      const bytes = Buffer.from(chunk);
      byteLength += bytes.byteLength;
      hash.update(bytes);
    }
    return {
      key: input.key,
      byteLength,
      mediaType: result.ContentType ?? "application/octet-stream",
      sha256: hash.digest("hex"),
      ...(result.ETag ? { etag: result.ETag } : {}),
    };
  }

  private async verifyCommittedObject(key: string, sha256: string, byteLength: number): Promise<StoredObject> {
    const committed = await this.inspectObject({ key });
    if (committed.sha256 !== sha256 || committed.byteLength !== byteLength) {
      throw new Error("Canonical object conflicts with the immutable commit declaration");
    }
    return committed;
  }
}

interface InspectedObject extends ObjectMetadata {
  sha256: string;
  etag?: string;
}

function assertTemporaryKey(key: string): void {
  if (!TEMPORARY_KEY_PATTERN.test(key)) throw new Error("Refusing to operate on a non-temporary object");
}

function assertByteLength(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new Error("Invalid object byte length");
}

function assertMediaType(mediaType: string): void {
  if (mediaType.trim().length === 0) throw new Error("Invalid object media type");
}

function encodeCopySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function isMissingError(error: unknown): boolean {
  return errorStatus(error) === 404;
}

function isConditionalConflict(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 409 || status === 412;
}

function errorStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}
