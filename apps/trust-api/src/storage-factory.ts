import type { ObjectStorage } from "@trust-core/storage";
import { MinioObjectStorage } from "@trust-core/storage-minio";
import { S3ObjectStorage } from "@trust-core/storage-s3";

export type StorageProviderName = "minio" | "s3";

/**
 * Composition-root storage selection.
 * Default is MinIO for local/CI. S3 is explicit opt-in via TRUST_STORAGE_PROVIDER=s3.
 * Rollback: omit or set provider to minio.
 */
export function createObjectStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorage | undefined {
  const provider = resolveProvider(env.TRUST_STORAGE_PROVIDER);
  const bucket = env.TRUST_STORAGE_BUCKET;
  const region = env.TRUST_STORAGE_REGION ?? "us-east-1";
  const endpoint = env.TRUST_STORAGE_ENDPOINT;
  const accessKeyId = env.TRUST_STORAGE_ACCESS_KEY;
  const secretAccessKey = env.TRUST_STORAGE_SECRET_KEY;
  const forcePathStyle = env.TRUST_STORAGE_FORCE_PATH_STYLE !== "false";

  if (provider === "s3") {
    if (!bucket?.trim()) {
      throw new Error("TRUST_STORAGE_PROVIDER=s3 requires TRUST_STORAGE_BUCKET");
    }
    if (!region.trim()) {
      throw new Error("TRUST_STORAGE_PROVIDER=s3 requires TRUST_STORAGE_REGION");
    }
    if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
      throw new Error(
        "TRUST_STORAGE_PROVIDER=s3 requires both TRUST_STORAGE_ACCESS_KEY and TRUST_STORAGE_SECRET_KEY when using static credentials",
      );
    }
    return new S3ObjectStorage({
      region,
      bucket,
      forcePathStyle: env.TRUST_STORAGE_FORCE_PATH_STYLE === "true",
      ...(endpoint ? { endpoint } : {}),
      ...(accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : {}),
    });
  }

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return undefined;
  }
  return new MinioObjectStorage({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    forcePathStyle,
  });
}

export function resolveProvider(
  value: string | undefined,
): StorageProviderName {
  const normalized = (value ?? "minio").trim().toLowerCase();
  if (normalized === "" || normalized === "minio") return "minio";
  if (normalized === "s3" || normalized === "aws") return "s3";
  throw new Error(
    `Unknown TRUST_STORAGE_PROVIDER "${value}". Expected minio or s3.`,
  );
}
