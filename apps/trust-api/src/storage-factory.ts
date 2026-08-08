import {
  HeadBucketCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { ObjectStorage } from "@trust-core/storage";
import { MinioObjectStorage } from "@trust-core/storage-minio";
import { S3ObjectStorage } from "@trust-core/storage-s3";
import type { StorageProviderName as ProtocolProviderName } from "@trust-core/protocol";
import {
  projectSafeStorageConfig,
  type SafeStorageConfig,
  type StorageBucketProber,
} from "./storage-diagnostics.js";

export type StorageProviderName = ProtocolProviderName;

export interface StorageRuntime {
  storage: ObjectStorage | undefined;
  config: SafeStorageConfig;
  prober: StorageBucketProber | undefined;
}

/**
 * Composition-root storage selection.
 * Default is MinIO for local/CI. S3 is explicit opt-in via TRUST_STORAGE_PROVIDER=s3.
 * Rollback: omit or set provider to minio.
 */
export function createObjectStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorage | undefined {
  return createStorageRuntimeFromEnv(env).storage;
}

export function createStorageRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: { transferSignerConfigured?: boolean } = {},
): StorageRuntime {
  const provider = resolveProvider(env.TRUST_STORAGE_PROVIDER);
  const bucket = env.TRUST_STORAGE_BUCKET ?? "";
  const region = env.TRUST_STORAGE_REGION ?? "us-east-1";
  const endpoint = env.TRUST_STORAGE_ENDPOINT;
  const accessKeyId = env.TRUST_STORAGE_ACCESS_KEY;
  const secretAccessKey = env.TRUST_STORAGE_SECRET_KEY;
  const sessionToken = env.TRUST_STORAGE_SESSION_TOKEN;
  const expectedBucketOwner = env.TRUST_STORAGE_EXPECTED_BUCKET_OWNER;
  const consoleUrl = env.TRUST_STORAGE_CONSOLE_URL;
  const hasStaticKeys = Boolean(accessKeyId && secretAccessKey);
  const transferSignerConfigured = options.transferSignerConfigured ?? false;

  if (provider === "s3") {
    if (!bucket.trim()) {
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
    const forcePathStyle = env.TRUST_STORAGE_FORCE_PATH_STYLE === "true";
    const clientOptions = {
      region,
      bucket,
      forcePathStyle,
      ...(endpoint ? { endpoint } : {}),
      ...(accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
            ...(sessionToken ? { sessionToken } : {}),
          }
        : {}),
      ...(expectedBucketOwner ? { expectedBucketOwner } : {}),
    };
    const storage = new S3ObjectStorage({
      region,
      bucket,
      forcePathStyle,
      ...(endpoint ? { endpoint } : {}),
      ...(accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
            ...(sessionToken ? { sessionToken } : {}),
          }
        : {}),
    });
    const config = projectSafeStorageConfig({
      provider: "s3",
      region,
      bucket,
      ...(endpoint ? { endpoint } : {}),
      ...(consoleUrl ? { consoleUrl } : {}),
      hasStaticKeys,
      transferSignerConfigured,
      objectStorageConfigured: true,
      ...(expectedBucketOwner ? { expectedBucketOwner } : {}),
    });
    return {
      storage,
      config,
      prober: createS3CompatibleProber(clientOptions),
    };
  }

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    const config = projectSafeStorageConfig({
      provider: "minio",
      region,
      bucket: bucket || "",
      ...(endpoint ? { endpoint } : {}),
      ...(consoleUrl ? { consoleUrl } : {}),
      hasStaticKeys: false,
      transferSignerConfigured,
      objectStorageConfigured: false,
      ...(expectedBucketOwner ? { expectedBucketOwner } : {}),
    });
    return { storage: undefined, config, prober: undefined };
  }

  const forcePathStyle = env.TRUST_STORAGE_FORCE_PATH_STYLE !== "false";
  const storage = new MinioObjectStorage({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    forcePathStyle,
  });
  const config = projectSafeStorageConfig({
    provider: "minio",
    region,
    bucket,
    endpoint,
    ...(consoleUrl ? { consoleUrl } : {}),
    hasStaticKeys: true,
    transferSignerConfigured,
    objectStorageConfigured: true,
    ...(expectedBucketOwner ? { expectedBucketOwner } : {}),
  });
  return {
    storage,
    config,
    prober: createS3CompatibleProber({
      region,
      bucket,
      endpoint,
      forcePathStyle,
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
      ...(expectedBucketOwner ? { expectedBucketOwner } : {}),
    }),
  };
}

export function buildS3ClientConfig(input: {
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}): S3ClientConfig {
  return {
    region: input.region,
    forcePathStyle: input.forcePathStyle ?? false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    ...(input.accessKeyId && input.secretAccessKey
      ? {
          credentials: {
            accessKeyId: input.accessKeyId,
            secretAccessKey: input.secretAccessKey,
            ...(input.sessionToken
              ? { sessionToken: input.sessionToken }
              : {}),
          },
        }
      : {}),
  };
}

function createS3CompatibleProber(input: {
  region: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  expectedBucketOwner?: string;
}): StorageBucketProber {
  const client = new S3Client(buildS3ClientConfig(input));
  return {
    async probeConnectivity(signal) {
      const response = await client.send(
        new HeadBucketCommand({
          Bucket: input.bucket,
          ...(input.expectedBucketOwner
            ? { ExpectedBucketOwner: input.expectedBucketOwner }
            : {}),
        }),
        signal ? { abortSignal: signal } : {},
      );
      const bucketRegion =
        typeof response.BucketRegion === "string"
          ? response.BucketRegion
          : undefined;
      return { ...(bucketRegion ? { bucketRegion } : {}) };
    },
  };
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
