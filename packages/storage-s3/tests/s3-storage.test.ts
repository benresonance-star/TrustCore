import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S3ObjectStorage } from "../src/index.js";

const mocks = vi.hoisted(() => ({
  clientConfigs: [] as unknown[],
  send: vi.fn(),
  uploads: [] as Array<{ params: Record<string, unknown>; leavePartsOnError?: boolean }>,
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      constructor(config: unknown) {
        mocks.clientConfigs.push(config);
      }

      send(command: unknown): Promise<unknown> {
        return mocks.send(command);
      }
    },
  };
});

vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    private readonly options: {
      params: Record<string, unknown>;
      leavePartsOnError?: boolean;
    };

    constructor(options: { params: Record<string, unknown>; leavePartsOnError?: boolean }) {
      this.options = options;
      mocks.uploads.push(options);
    }

    async done(): Promise<void> {
      const body = this.options.params.Body as AsyncIterable<Uint8Array>;
      for await (const _chunk of body) {
        // Consume the upload stream as the real multipart uploader does.
      }
    }
  },
}));

describe("S3ObjectStorage configuration", () => {
  beforeEach(() => {
    mocks.clientConfigs.length = 0;
    mocks.uploads.length = 0;
    mocks.send.mockReset();
  });

  it("uses the AWS credential chain and virtual-host addressing by default", () => {
    new S3ObjectStorage({ region: "eu-west-1", bucket: "production-bucket" });

    expect(mocks.clientConfigs[0]).toMatchObject({
      region: "eu-west-1",
      forcePathStyle: false,
    });
    expect(mocks.clientConfigs[0]).not.toHaveProperty("endpoint");
    expect(mocks.clientConfigs[0]).not.toHaveProperty("credentials");
  });

  it("accepts an endpoint, path-style addressing, and complete static credentials", () => {
    new S3ObjectStorage({
      region: "us-east-1",
      bucket: "test-bucket",
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
      accessKeyId: "test-access",
      secretAccessKey: "test-secret",
      sessionToken: "test-session",
    });

    expect(mocks.clientConfigs[0]).toMatchObject({
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "test-access",
        secretAccessKey: "test-secret",
        sessionToken: "test-session",
      },
    });
  });

  it("rejects partial credentials and invalid protection settings", () => {
    expect(() => new S3ObjectStorage({
      region: "us-east-1",
      bucket: "bucket",
      accessKeyId: "incomplete",
    })).toThrow("both accessKeyId and secretAccessKey");
    expect(() => new S3ObjectStorage({
      region: "us-east-1",
      bucket: "bucket",
      serverSideEncryption: { algorithm: "aws:kms", keyId: " " },
    })).toThrow("key id");
    expect(() => new S3ObjectStorage({
      region: "us-east-1",
      bucket: "bucket",
      objectLockRetention: { mode: "COMPLIANCE", days: 0 },
    })).toThrow("positive integer");
  });
});

describe("S3ObjectStorage commands", () => {
  beforeEach(() => {
    mocks.clientConfigs.length = 0;
    mocks.uploads.length = 0;
    mocks.send.mockReset();
  });

  it("encrypts temporary uploads and reports their digest without cloud access", async () => {
    const storage = new S3ObjectStorage({
      region: "us-east-1",
      bucket: "bucket",
      serverSideEncryption: { algorithm: "AES256" },
    });
    const body = Buffer.from("streamed-object");
    const locator = await storage.createTemporaryUpload({
      workspaceId: "workspace_1",
      operationId: "operation_1",
    });

    const metadata = await storage.writeTemporary({
      locator,
      body: Readable.from([body.subarray(0, 5), body.subarray(5)]),
      mediaType: "text/plain",
    });

    expect(mocks.uploads[0]).toMatchObject({
      leavePartsOnError: false,
      params: {
        Bucket: "bucket",
        Key: locator.key,
        ContentType: "text/plain",
        ServerSideEncryption: "AES256",
      },
    });
    expect(metadata).toEqual({
      key: locator.key,
      byteLength: body.byteLength,
      mediaType: "text/plain",
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  });

  it("conditionally copies canonical objects with KMS encryption and retention", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00.000Z"));
    try {
      const body = Buffer.from("immutable");
      const sha256 = createHash("sha256").update(body).digest("hex");
      mocks.send.mockImplementation(async (command: unknown) => {
        if (command instanceof GetObjectCommand) {
          const key = command.input.Key;
          if (key?.includes("/temporary/")) {
            return {
              Body: Readable.from(body),
              ContentType: "text/plain",
              ETag: "\"temporary-etag\"",
            };
          }
          throw { $metadata: { httpStatusCode: 404 } };
        }
        if (command instanceof CopyObjectCommand || command instanceof DeleteObjectCommand) {
          return {};
        }
        if (command instanceof HeadObjectCommand) {
          return {
            ContentLength: body.byteLength,
            ContentType: "text/plain",
            Metadata: { sha256 },
          };
        }
        throw new Error("Unexpected command");
      });
      const storage = new S3ObjectStorage({
        region: "us-east-1",
        bucket: "locked-bucket",
        serverSideEncryption: { algorithm: "aws:kms", keyId: "alias/trust-core" },
        objectLockRetention: { mode: "COMPLIANCE", days: 30 },
      });

      const committed = await storage.commitImmutable({
        temporary: { key: "workspaces/workspace_1/temporary/operation_1" },
        workspaceId: "workspace_1",
        sha256,
        byteLength: body.byteLength,
        mediaType: "text/plain",
      });

      const copy = mocks.send.mock.calls
        .map(([command]) => command)
        .find((command) => command instanceof CopyObjectCommand);
      expect(copy).toBeInstanceOf(CopyObjectCommand);
      expect((copy as CopyObjectCommand).input).toMatchObject({
        Bucket: "locked-bucket",
        IfNoneMatch: "*",
        CopySourceIfMatch: "\"temporary-etag\"",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: "alias/trust-core",
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: new Date("2026-09-04T00:00:00.000Z"),
        MetadataDirective: "REPLACE",
        Metadata: { sha256 },
      });
      expect(committed).toMatchObject({ sha256, byteLength: body.byteLength });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to delete canonical keys", async () => {
    const storage = new S3ObjectStorage({ region: "us-east-1", bucket: "bucket" });
    await expect(storage.deleteTemporary({
      key: `workspaces/workspace_1/objects/${"a".repeat(64)}`,
    })).rejects.toThrow("non-temporary");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
