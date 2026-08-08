import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertObjectStorageContract } from "@trust-core/storage";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3ObjectStorage, type S3StorageConfig } from "../src/index.js";

const liveConfig = readLiveConfig();
const runId = randomBytes(8).toString("hex");
const workspaceId = `s3_live_${runId}`;

if (process.env.TRUST_DOCKER_TESTS === "1" && !liveConfig) {
  throw new Error(
    "Docker S3-compatible contract requires TRUST_STORAGE_* environment variables",
  );
}

describe("S3ObjectStorage validation", () => {
  it("creates scoped temporary locators without contacting the provider", async () => {
    const storage = new S3ObjectStorage({
      region: "us-east-1",
      bucket: "validation-bucket",
      endpoint: "http://127.0.0.1:1",
      forcePathStyle: true,
      accessKeyId: "validation",
      secretAccessKey: "validation",
    });
    const temporary = await storage.createTemporaryUpload({
      workspaceId: "workspace_1",
      operationId: "operation_1",
    });
    expect(temporary.key).toBe("workspaces/workspace_1/temporary/operation_1");
  });
});

describe.skipIf(!liveConfig)("S3ObjectStorage live contract", () => {
  const config = liveConfig ?? {
    region: "us-east-1",
    bucket: "not-configured",
    endpoint: "http://127.0.0.1:1",
    accessKeyId: "not-configured",
    secretAccessKey: "not-configured",
    forcePathStyle: true,
  };
  const storage = new S3ObjectStorage(config);
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
      const listed = await admin.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: `workspaces/${workspaceId}/`,
          ...(continuationToken
            ? { ContinuationToken: continuationToken }
            : {}),
        }),
      );
      const objects =
        listed.Contents?.flatMap(({ Key }) => (Key ? [{ Key }] : [])) ?? [];
      if (objects.length > 0) {
        await admin.send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: objects },
          }),
        );
      }
      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);
    admin.destroy();
  });

  it("passes the shared provider-neutral contract against S3-compatible storage", async () => {
    await assertObjectStorageContract({
      storage,
      workspaceId,
      probeDeniedExists: async () => {
        const denied = new S3ObjectStorage({
          ...config,
          accessKeyId: `denied_${runId}`,
          secretAccessKey: `denied_${runId}`,
        });
        await expect(
          denied.exists({ key: `workspaces/${workspaceId}/missing` }),
        ).rejects.toBeDefined();
      },
      probeOutageExists: async () => {
        const outage = new S3ObjectStorage({
          ...config,
          endpoint: "http://127.0.0.1:1",
          forcePathStyle: true,
        });
        await expect(
          outage.exists({ key: `workspaces/${workspaceId}/missing` }),
        ).rejects.toBeDefined();
      },
    });
  });
});

describe.skipIf(process.env.TRUST_S3_SMOKE !== "1")(
  "S3ObjectStorage optional real-AWS smoke",
  () => {
    it("requires explicit TRUST_S3_SMOKE=1 and AWS credentials", async () => {
      const region = process.env.TRUST_S3_SMOKE_REGION ?? process.env.AWS_REGION;
      const bucket = process.env.TRUST_S3_SMOKE_BUCKET;
      if (!region || !bucket) {
        throw new Error(
          "Real AWS smoke requires TRUST_S3_SMOKE_REGION/AWS_REGION and TRUST_S3_SMOKE_BUCKET",
        );
      }
      const storage = new S3ObjectStorage({ region, bucket });
      const temporary = await storage.createTemporaryUpload({
        workspaceId: `smoke_${runId}`,
        operationId: "ping",
      });
      expect(temporary.key).toContain(`smoke_${runId}`);
    });
  },
);

function readLiveConfig(): S3StorageConfig | undefined {
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

function createClient(config: S3StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? true,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            ...(config.sessionToken
              ? { sessionToken: config.sessionToken }
              : {}),
          },
        }
      : {}),
  });
}

function errorStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
}
