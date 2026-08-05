import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalObjectKey } from "@trust-core/storage";
import { MinioObjectStorage, type MinioStorageConfig } from "../src/index.js";

const liveConfig = readLiveConfig();
const runId = randomBytes(8).toString("hex");
const workspaceId = `live_${runId}`;

if (process.env.TRUST_DOCKER_TESTS === "1" && !liveConfig) {
  throw new Error("Docker MinIO contract requires TRUST_STORAGE_* environment variables");
}

describe("MinioObjectStorage validation", () => {
  const unavailable = new MinioObjectStorage({
    endpoint: "http://127.0.0.1:1",
    region: "us-east-1",
    bucket: "unavailable",
    accessKeyId: "unavailable",
    secretAccessKey: "unavailable",
  });

  it("creates scoped temporary locators", async () => {
    const temporary = await unavailable.createTemporaryUpload({
      workspaceId: "workspace_1",
      operationId: "operation_1",
    });
    expect(temporary.key).toBe("workspaces/workspace_1/temporary/operation_1");
    expect(Date.parse(temporary.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("refuses writes and deletes outside the temporary namespace", async () => {
    const canonical = canonicalObjectKey("workspace_1", "a".repeat(64));
    await expect(unavailable.writeTemporary({
      locator: { key: canonical },
      body: Readable.from("data"),
      mediaType: "text/plain",
    })).rejects.toThrow("non-temporary");
    await expect(unavailable.deleteTemporary({ key: canonical })).rejects.toThrow("non-temporary");
    await expect(unavailable.deleteTemporary({
      key: "workspaces/workspace_1/objects/temporary/not-canonical",
    })).rejects.toThrow("non-temporary");
  });

  it("rejects invalid commit declarations before accessing storage", async () => {
    await expect(unavailable.commitImmutable({
      temporary: { key: "workspaces/workspace_1/temporary/operation_1" },
      workspaceId: "workspace_1",
      sha256: "a".repeat(64),
      byteLength: -1,
      mediaType: "text/plain",
    })).rejects.toThrow("byte length");
  });
});

describe.skipIf(!liveConfig)("MinioObjectStorage live contract", () => {
  const config = liveConfig ?? {
    endpoint: "http://127.0.0.1:1",
    region: "us-east-1",
    bucket: "not-configured",
    accessKeyId: "not-configured",
    secretAccessKey: "not-configured",
  };
  const storage = new MinioObjectStorage(config);
  const admin = createClient(config);

  beforeAll(async () => {
    try {
      await admin.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch (error) {
      if (errorStatus(error) !== 404) throw error;
      await admin.send(new CreateBucketCommand({ Bucket: config.bucket }));
    }
  });

  afterAll(async () => {
    let continuationToken: string | undefined;
    do {
      const listed = await admin.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: `workspaces/${workspaceId}/`,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }));
      const objects = listed.Contents?.flatMap(({ Key }) => Key ? [{ Key }] : []) ?? [];
      if (objects.length > 0) {
        await admin.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: objects } }));
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    admin.destroy();
  });

  it("streams a temporary upload while reporting bytes and SHA-256", async () => {
    const body = Buffer.from("streamed-in-three-chunks");
    const temporary = await storage.createTemporaryUpload({
      workspaceId,
      operationId: "streamed_write",
    });
    const metadata = await storage.writeTemporary({
      locator: temporary,
      body: Readable.from([body.subarray(0, 4), body.subarray(4, 11), body.subarray(11)]),
      mediaType: "text/plain",
    });

    expect(metadata).toEqual({
      key: temporary.key,
      byteLength: body.byteLength,
      mediaType: "text/plain",
      sha256: sha256(body),
    });
    expect(await storage.exists(temporary)).toBe(true);
    await storage.deleteTemporary(temporary);
    expect(await storage.exists(temporary)).toBe(false);
  });

  it("commits immutably, supports head/read, and cleans up temporary data", async () => {
    const body = Buffer.from("immutable-object");
    const digest = sha256(body);
    const temporary = await upload(storage, "immutable_commit", body, "text/plain");
    const committed = await storage.commitImmutable({
      temporary,
      workspaceId,
      sha256: digest,
      byteLength: body.byteLength,
      mediaType: "text/plain",
    });

    expect(committed.key).toBe(canonicalObjectKey(workspaceId, digest));
    expect(committed.sha256).toBe(digest);
    expect(await storage.head(committed)).toMatchObject({
      key: committed.key,
      byteLength: body.byteLength,
      mediaType: "text/plain",
      sha256: digest,
    });
    expect(await readAll(await storage.openReadStream(committed))).toEqual(body);
    expect(await storage.exists(temporary)).toBe(false);
    expect(await storage.exists({ key: `${temporary.key}_missing` })).toBe(false);
    await expect(storage.head({ key: `${temporary.key}_missing` })).rejects.toBeDefined();
  });

  it("deduplicates equal bytes without mutating canonical metadata and allows committed retries", async () => {
    const body = Buffer.from("deduplicated-object");
    const digest = sha256(body);
    const first = await upload(storage, "dedupe_first", body, "text/plain");
    const initial = await storage.commitImmutable({
      temporary: first,
      workspaceId,
      sha256: digest,
      byteLength: body.byteLength,
      mediaType: "text/plain",
    });
    const duplicate = await upload(storage, "dedupe_second", body, "application/octet-stream");
    const deduplicated = await storage.commitImmutable({
      temporary: duplicate,
      workspaceId,
      sha256: digest,
      byteLength: body.byteLength,
      mediaType: "application/octet-stream",
    });

    expect(deduplicated.key).toBe(initial.key);
    expect(deduplicated.mediaType).toBe("text/plain");
    expect(await storage.exists(duplicate)).toBe(false);
    await expect(storage.commitImmutable({
      temporary: duplicate,
      workspaceId,
      sha256: digest,
      byteLength: body.byteLength,
      mediaType: "application/octet-stream",
    })).resolves.toMatchObject({ key: initial.key, sha256: digest });
  });

  it("rejects differing bytes and leaves the canonical object unchanged", async () => {
    const canonicalBody = Buffer.from("canonical-bytes");
    const differentBody = Buffer.from("different-bytes");
    expect(differentBody.byteLength).toBe(canonicalBody.byteLength);
    const digest = sha256(canonicalBody);
    const first = await upload(storage, "conflict_first", canonicalBody, "text/plain");
    const committed = await storage.commitImmutable({
      temporary: first,
      workspaceId,
      sha256: digest,
      byteLength: canonicalBody.byteLength,
      mediaType: "text/plain",
    });
    const conflicting = await upload(storage, "conflict_second", differentBody, "text/plain");

    await expect(storage.commitImmutable({
      temporary: conflicting,
      workspaceId,
      sha256: digest,
      byteLength: differentBody.byteLength,
      mediaType: "text/plain",
    })).rejects.toThrow("does not match");
    expect(await readAll(await storage.openReadStream(committed))).toEqual(canonicalBody);
    expect(await storage.exists(conflicting)).toBe(true);
    await storage.deleteTemporary(conflicting);
  });

  it("propagates denied and outage errors instead of reporting objects missing", async () => {
    const denied = new MinioObjectStorage({
      ...config,
      accessKeyId: `denied_${runId}`,
      secretAccessKey: `denied_${runId}`,
    });
    const outage = new MinioObjectStorage({ ...config, endpoint: "http://127.0.0.1:1" });
    await expect(denied.exists({ key: `workspaces/${workspaceId}/missing` })).rejects.toBeDefined();
    await expect(outage.exists({ key: `workspaces/${workspaceId}/missing` })).rejects.toBeDefined();
  });
});

async function upload(
  storage: MinioObjectStorage,
  operationId: string,
  body: Buffer,
  mediaType: string,
): Promise<{ key: string }> {
  const temporary = await storage.createTemporaryUpload({ workspaceId, operationId });
  await storage.writeTemporary({ locator: temporary, body: Readable.from(body), mediaType });
  return temporary;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function readLiveConfig(): MinioStorageConfig | undefined {
  const endpoint = process.env.TRUST_STORAGE_ENDPOINT;
  const bucket = process.env.TRUST_STORAGE_BUCKET;
  const accessKeyId = process.env.TRUST_STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.TRUST_STORAGE_SECRET_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return undefined;
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.TRUST_STORAGE_REGION ?? "us-east-1",
    forcePathStyle: process.env.TRUST_STORAGE_FORCE_PATH_STYLE !== "false",
  };
}

function createClient(config: MinioStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? true,
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

function errorStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}
