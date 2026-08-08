import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3TransferSignerConfig {
  region: string;
  bucket: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  forcePathStyle?: boolean;
}

/**
 * Issues short-lived PUT/GET URLs for S3-compatible storage.
 * Remains inside the storage adapter boundary; public DTOs must not expose AWS types.
 */
export class S3TransferSigner {
  private readonly client: S3Client;

  constructor(private readonly config: S3TransferSignerConfig) {
    if (!config.region.trim() || !config.bucket.trim()) {
      throw new Error("S3 transfer signer requires region and bucket");
    }
    if (
      (config.accessKeyId === undefined) !==
      (config.secretAccessKey === undefined)
    ) {
      throw new Error(
        "S3 transfer signer static credentials require both accessKeyId and secretAccessKey",
      );
    }
    this.client = new S3Client(clientConfig(config));
  }

  async signUpload(input: {
    storageKey: string;
    expiresAt: string;
    mediaType?: string;
    expectedByteLength?: number;
  }): Promise<{ url: string; headers: Readonly<Record<string, string>> }> {
    const expiresIn = secondsUntil(input.expiresAt);
    const headers: Record<string, string> = {};
    if (input.mediaType) headers["content-type"] = input.mediaType;
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.storageKey,
        ...(input.mediaType ? { ContentType: input.mediaType } : {}),
        ...(input.expectedByteLength !== undefined
          ? { ContentLength: input.expectedByteLength }
          : {}),
      }),
      { expiresIn },
    );
    return { url, headers };
  }

  async signDownload(input: {
    storageKey: string;
    expiresAt: string;
    fileName?: string;
  }): Promise<{ url: string; headers: Readonly<Record<string, string>> }> {
    const expiresIn = secondsUntil(input.expiresAt);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: input.storageKey,
        ...(input.fileName
          ? {
              ResponseContentDisposition: `attachment; filename="${input.fileName}"`,
            }
          : {}),
      }),
      { expiresIn },
    );
    return { url, headers: {} };
  }
}

function secondsUntil(expiresAt: string): number {
  const ms = Date.parse(expiresAt) - Date.now();
  const seconds = Math.floor(ms / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Transfer grant expiry must be in the future");
  }
  return Math.min(seconds, 7 * 24 * 60 * 60);
}

function clientConfig(config: S3TransferSignerConfig): S3ClientConfig {
  return {
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? false,
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
  };
}
