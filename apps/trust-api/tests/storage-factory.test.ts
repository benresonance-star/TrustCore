import { describe, expect, it } from "vitest";
import { MinioObjectStorage } from "@trust-core/storage-minio";
import { S3ObjectStorage } from "@trust-core/storage-s3";
import {
  createObjectStorageFromEnv,
  resolveProvider,
} from "../src/storage-factory.js";

describe("storage-factory", () => {
  it("defaults to minio and returns undefined when minio env is incomplete", () => {
    expect(resolveProvider(undefined)).toBe("minio");
    expect(createObjectStorageFromEnv({})).toBeUndefined();
  });

  it("constructs MinIO when complete local env is present", () => {
    const storage = createObjectStorageFromEnv({
      TRUST_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      TRUST_STORAGE_BUCKET: "trust-core-local",
      TRUST_STORAGE_ACCESS_KEY: "trustcore",
      TRUST_STORAGE_SECRET_KEY: "trustcore-local-secret",
    });
    expect(storage).toBeInstanceOf(MinioObjectStorage);
  });

  it("opts into S3 only when provider is s3 and fails closed on partial config", () => {
    expect(() =>
      createObjectStorageFromEnv({
        TRUST_STORAGE_PROVIDER: "s3",
      }),
    ).toThrow(/TRUST_STORAGE_BUCKET/);
    expect(() =>
      createObjectStorageFromEnv({
        TRUST_STORAGE_PROVIDER: "s3",
        TRUST_STORAGE_BUCKET: "bucket",
        TRUST_STORAGE_ACCESS_KEY: "only-access",
      }),
    ).toThrow(/both TRUST_STORAGE_ACCESS_KEY and TRUST_STORAGE_SECRET_KEY/);
    const storage = createObjectStorageFromEnv({
      TRUST_STORAGE_PROVIDER: "s3",
      TRUST_STORAGE_BUCKET: "bucket",
      TRUST_STORAGE_REGION: "eu-west-1",
    });
    expect(storage).toBeInstanceOf(S3ObjectStorage);
  });

  it("rejects unknown providers", () => {
    expect(() => resolveProvider("gcs")).toThrow(/Unknown TRUST_STORAGE_PROVIDER/);
  });
});
