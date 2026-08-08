import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertObjectStorageContract, canonicalObjectKey } from "@trust-core/storage";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("passes the shared provider-neutral contract", async () => {
    await assertObjectStorageContract({
      storage,
      workspaceId,
      probeDeniedExists: async () => {
        const denied = new MinioObjectStorage({
          ...config,
          accessKeyId: `denied_${runId}`,
          secretAccessKey: `denied_${runId}`,
        });
        await expect(denied.exists({ key: `workspaces/${workspaceId}/missing` })).rejects.toBeDefined();
      },
      probeOutageExists: async () => {
        const outage = new MinioObjectStorage({ ...config, endpoint: "http://127.0.0.1:1" });
        await expect(outage.exists({ key: `workspaces/${workspaceId}/missing` })).rejects.toBeDefined();
      },
    });
  });
});

function readLiveConfig(): MinioStorageConfig | undefined {
  if (process.env.TRUST_DOCKER_TESTS !== "1") return undefined;
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
