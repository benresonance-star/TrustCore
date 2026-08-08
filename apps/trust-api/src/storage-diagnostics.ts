import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { isStorageError, type ObjectStorage } from "@trust-core/storage";
import type {
  StorageConsoleLink,
  StorageCredentialMode,
  StorageHealthDetails,
  StorageIssueClass,
  StorageProbeResult,
  StorageProbeTier,
  StorageProviderName,
} from "@trust-core/protocol";

export const STORAGE_PROBE_TIMEOUT_MS = 5_000;
export const STORAGE_HEALTH_CACHE_TTL_MS = 30_000;
export const STORAGE_PROBE_RATE_LIMIT_MS = 5_000;

export interface SafeStorageConfig {
  provider: StorageProviderName;
  region: string;
  bucket: string;
  credentialMode: StorageCredentialMode;
  endpointHost: string | null;
  consoleUrl: string | null;
  transferSignerConfigured: boolean;
  objectStorageConfigured: boolean;
  expectedBucketOwner: string | null;
}

export interface StorageBucketProbeOutcome {
  bucketRegion?: string;
}

export interface StorageBucketProber {
  probeConnectivity(signal?: AbortSignal): Promise<StorageBucketProbeOutcome>;
}

export type ClassifiedStorageIssue = {
  issueClass: StorageIssueClass;
  issueCode: string;
  billingHint?: string;
  summary: string;
};

/** Map provider / network errors to operator-facing issue classes. */
export function classifyStorageError(error: unknown): ClassifiedStorageIssue {
  if (error && typeof error === "object") {
    const name = String((error as { name?: string }).name ?? "");
    const message = String((error as { message?: string }).message ?? "");
    const code = String(
      (error as { Code?: string; code?: string }).Code ??
        (error as { code?: string }).code ??
        (name || "unknown"),
    );
    const status =
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode ??
      (error as { $response?: { statusCode?: number } }).$response?.statusCode;

    if (
      name === "CredentialsProviderError" ||
      code === "InvalidAccessKeyId" ||
      code === "SignatureDoesNotMatch" ||
      code === "ExpiredToken" ||
      code === "InvalidToken" ||
      /credential|access key|secret key|not authorized to perform: sts/i.test(
        message,
      )
    ) {
      return {
        issueClass: "auth",
        issueCode: code || "auth_failure",
        summary: "Server cannot prove identity to the provider.",
      };
    }

    if (
      code === "PermanentRedirect" ||
      code === "AuthorizationHeaderMalformed" ||
      status === 301 ||
      /region|endpoint|permanent redirect/i.test(message)
    ) {
      return {
        issueClass: "wrong_region",
        issueCode: code || "wrong_region",
        summary:
          "Bucket region does not match TRUST_STORAGE_REGION on the API host.",
      };
    }

    if (
      code === "AccessDenied" ||
      code === "AllAccessDisabled" ||
      code === "AccessDeniedException" ||
      status === 403
    ) {
      const billingHint =
        /disabled|delinquent|suspend|billing|payment/i.test(message) ||
        code === "AllAccessDisabled"
          ? "If access looks right, check the provider account or billing page."
          : undefined;
      return {
        issueClass: "permission",
        issueCode: code || "access_denied",
        ...(billingHint ? { billingHint } : {}),
        summary: "Identity works but lacks bucket rights.",
      };
    }

    if (
      code === "NoSuchBucket" ||
      code === "NotFound" ||
      status === 404
    ) {
      return {
        issueClass: "not_found",
        issueCode: code || "not_found",
        summary: "Bucket or region looks wrong.",
      };
    }

    if (
      code === "SlowDown" ||
      code === "ServiceUnavailable" ||
      code === "InternalError" ||
      (typeof status === "number" && status >= 500)
    ) {
      return {
        issueClass: "provider_outage",
        issueCode: code || `http_${status}`,
        billingHint:
          "If access looks right, check the provider account or billing page.",
        summary: "Provider side looks unhealthy.",
      };
    }

    if (
      name === "TimeoutError" ||
      name === "AbortError" ||
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      code === "ETIMEDOUT" ||
      code === "EAI_AGAIN" ||
      code === "ABORT_ERR" ||
      /timeout|timed out|aborted|network|ECONNREFUSED|ENOTFOUND/i.test(message)
    ) {
      return {
        issueClass: "network",
        issueCode: code || "network_failure",
        summary:
          "Cannot reach the provider (internet / VPC / firewall).",
      };
    }
  }

  if (isStorageError(error)) {
    if (error.code === "access_denied") {
      return {
        issueClass: "permission",
        issueCode: error.code,
        summary: "Identity works but lacks bucket rights.",
      };
    }
    if (error.code === "not_found") {
      return {
        issueClass: "not_found",
        issueCode: error.code,
        summary: "Bucket or region looks wrong.",
      };
    }
    if (error.code === "throttled" || error.code === "transient") {
      return {
        issueClass: "provider_outage",
        issueCode: error.code,
        summary: "Provider side looks unhealthy.",
      };
    }
  }

  return {
    issueClass: "internal",
    issueCode: "unexpected",
    summary: "Unexpected server error — check API logs.",
  };
}

export function awsConsoleBase(region: string): string {
  const normalized = region.trim().toLowerCase();
  if (normalized.startsWith("us-gov-")) {
    return "https://console.amazonaws-us-gov.com";
  }
  if (normalized.startsWith("cn-")) {
    return "https://console.amazonaws.cn";
  }
  if (normalized) {
    return `https://${normalized}.console.aws.amazon.com`;
  }
  return "https://console.aws.amazon.com";
}

/** Build allowlisted provider console links — never accept client URLs. */
export function buildConsoleLinks(
  config: Pick<
    SafeStorageConfig,
    "provider" | "region" | "bucket" | "endpointHost" | "consoleUrl"
  >,
): readonly StorageConsoleLink[] {
  const links: StorageConsoleLink[] = [];

  if (config.provider === "s3" && config.bucket.trim()) {
    const region = config.region || "us-east-1";
    const base = awsConsoleBase(region);
    const bucket = encodeURIComponent(config.bucket);
    const regionQ = encodeURIComponent(region);
    links.push(
      {
        id: "s3_bucket",
        label: "Open in Amazon S3",
        url: `${base}/s3/buckets/${bucket}?region=${regionQ}`,
      },
      {
        id: "iam",
        label: "Open IAM",
        url: `${base}/iam/home#/home`,
      },
      {
        id: "billing",
        label: "Open billing",
        url: `${base}/billing/home`,
      },
    );
    return links;
  }

  if (config.provider === "minio") {
    const consoleUrl = config.consoleUrl ?? deriveMinioConsoleUrl(config.endpointHost);
    if (consoleUrl && isAllowlistedHttpHost(consoleUrl)) {
      links.push({
        id: "minio_console",
        label: "Open MinIO console",
        url: consoleUrl,
      });
    }
  }

  return links;
}

export function deriveMinioConsoleUrl(
  endpointHost: string | null | undefined,
): string | null {
  if (!endpointHost) return null;
  try {
    const url = new URL(
      endpointHost.includes("://") ? endpointHost : `http://${endpointHost}`,
    );
    if (url.port === "9000") url.port = "9001";
    else if (!url.port) url.port = "9001";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isAllowlistedHttpHost(host: string): boolean {
  try {
    const url = new URL(host.includes("://") ? host : `http://${host}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (hostname.endsWith(".local")) return true;
    if (
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname) ||
      hostname === "minio" ||
      hostname.startsWith("minio.")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function projectSafeStorageConfig(input: {
  provider: StorageProviderName;
  region: string;
  bucket: string;
  endpoint?: string;
  consoleUrl?: string;
  hasStaticKeys: boolean;
  transferSignerConfigured: boolean;
  objectStorageConfigured: boolean;
  expectedBucketOwner?: string;
}): SafeStorageConfig {
  let endpointHost: string | null = null;
  if (input.endpoint?.trim()) {
    try {
      const url = new URL(input.endpoint);
      endpointHost = `${url.protocol}//${url.host}`;
    } catch {
      endpointHost = null;
    }
  }
  const credentialMode: StorageCredentialMode = !input.objectStorageConfigured
    ? "missing"
    : input.hasStaticKeys
      ? "static_keys_configured"
      : "iam_role";

  return {
    provider: input.provider,
    region: input.region,
    bucket: input.bucket,
    credentialMode,
    endpointHost,
    consoleUrl: input.consoleUrl?.trim() || deriveMinioConsoleUrl(endpointHost),
    transferSignerConfigured: input.transferSignerConfigured,
    objectStorageConfigured: input.objectStorageConfigured,
    expectedBucketOwner: input.expectedBucketOwner?.trim() || null,
  };
}

export function toStorageHealthDetails(
  config: SafeStorageConfig,
  probe: StorageProbeResult | null,
  catalog: { cataloguedObjects: number; failedVerificationObjects: number },
): StorageHealthDetails {
  return {
    provider: config.provider,
    region: config.region,
    bucket: config.bucket,
    credentialMode: config.credentialMode,
    endpointHost: config.endpointHost,
    transferSignerConfigured: config.transferSignerConfigured,
    objectStorageConfigured: config.objectStorageConfigured,
    cataloguedObjects: catalog.cataloguedObjects,
    failedVerificationObjects: catalog.failedVerificationObjects,
    consoleLinks: buildConsoleLinks(config),
    probe,
    minimalIamActions: [...MINIMAL_STORAGE_IAM_ACTIONS],
    scannerConfigured: isFakeScannerEnabled(),
  };
}

export function assertNoSecretFields(
  details: Readonly<Record<string, unknown>>,
): void {
  const serialized = JSON.stringify(details);
  if (
    /accessKey|secretKey|secretAccessKey|sessionToken|SECRET|AKIA[0-9A-Z]{16}/i.test(
      serialized,
    )
  ) {
    throw new Error("Storage health details must not include secret material.");
  }
}

export class ProbeRateLimiter {
  private readonly lastByKey = new Map<string, number>();

  constructor(
    private readonly windowMs: number = STORAGE_PROBE_RATE_LIMIT_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  tryAcquire(key: string): boolean {
    const now = this.now();
    const last = this.lastByKey.get(key) ?? 0;
    if (now - last < this.windowMs) return false;
    this.lastByKey.set(key, now);
    return true;
  }
}

export class StorageHealthCache {
  private entry:
    | {
        storedAt: number;
        details: StorageHealthDetails;
        status: string;
        summary: string;
      }
    | undefined;

  constructor(
    private readonly ttlMs: number = STORAGE_HEALTH_CACHE_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get():
    | { details: StorageHealthDetails; status: string; summary: string }
    | undefined {
    if (!this.entry) return undefined;
    if (this.now() - this.entry.storedAt > this.ttlMs) return undefined;
    return {
      details: this.entry.details,
      status: this.entry.status,
      summary: this.entry.summary,
    };
  }

  /** Most recent entry even if TTL expired — used for rate-limit coalescing. */
  getLatest():
    | { details: StorageHealthDetails; status: string; summary: string }
    | undefined {
    if (!this.entry) return undefined;
    return {
      details: this.entry.details,
      status: this.entry.status,
      summary: this.entry.summary,
    };
  }

  set(input: {
    details: StorageHealthDetails;
    status: string;
    summary: string;
  }): void {
    this.entry = { ...input, storedAt: this.now() };
  }

  clear(): void {
    this.entry = undefined;
  }
}

export async function withAbortTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const timeoutError = new Error("Storage probe timed out.") as Error & {
        name: string;
        code: string;
      };
      timeoutError.name = "TimeoutError";
      timeoutError.code = "ETIMEDOUT";
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function regionsMatch(
  configured: string,
  reported: string | undefined,
): boolean | null {
  if (!reported?.trim()) return null;
  return (
    configured.trim().toLowerCase() === reported.trim().toLowerCase()
  );
}

export async function runStorageProbe(input: {
  tier: StorageProbeTier;
  config: SafeStorageConfig;
  prober: StorageBucketProber | undefined;
  storage: ObjectStorage | undefined;
  workspaceId: string;
  timeoutMs?: number;
  createId?: () => string;
  now?: () => Date;
}): Promise<StorageProbeResult> {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? (() => randomUUID());
  const probeId = createId();
  const checkedAt = now().toISOString();
  const started = Date.now();

  if (!input.config.objectStorageConfigured || !input.prober) {
    return {
      probeId,
      tier: input.tier,
      ok: false,
      latencyMs: Date.now() - started,
      issueClass: "not_configured",
      issueCode: "not_configured",
      checkedAt,
      summary: "Storage is not set up on the server.",
      bucketRegion: null,
      regionMatch: null,
    };
  }

  try {
    const outcome = await withAbortTimeout(async (signal) => {
      const connectivity = await input.prober!.probeConnectivity(signal);
      if (input.tier === "ingest") {
        if (!input.storage) {
          throw Object.assign(
            new Error("Object storage missing for ingest probe."),
            { code: "not_configured" },
          );
        }
        const operationId = `probe-${probeId.replace(/-/g, "").slice(0, 24)}`;
        const temporary = await input.storage.createTemporaryUpload({
          workspaceId: input.workspaceId,
          operationId,
        });
        try {
          await input.storage.writeTemporary({
            locator: temporary,
            body: Readable.from([Buffer.from("trust-core-storage-probe")]),
            mediaType: "application/octet-stream",
          });
        } finally {
          try {
            await input.storage.deleteTemporary({ key: temporary.key });
          } catch (cleanupError) {
            throw Object.assign(
              new Error(
                "Ingest probe wrote a temporary object but failed to delete it; reconciliation should clean leftovers.",
              ),
              { cause: cleanupError, code: "cleanup_failed" },
            );
          }
        }
      }
      return connectivity;
    }, input.timeoutMs ?? STORAGE_PROBE_TIMEOUT_MS);

    const regionMatch = regionsMatch(
      input.config.region,
      outcome.bucketRegion,
    );
    if (regionMatch === false) {
      return {
        probeId,
        tier: input.tier,
        ok: false,
        latencyMs: Date.now() - started,
        issueClass: "wrong_region",
        issueCode: "region_mismatch",
        checkedAt,
        summary: `Provider reports region ${outcome.bucketRegion}, but the API is configured for ${input.config.region}.`,
        bucketRegion: outcome.bucketRegion ?? null,
        regionMatch: false,
      };
    }

    return {
      probeId,
      tier: input.tier,
      ok: true,
      latencyMs: Date.now() - started,
      issueClass: null,
      issueCode: null,
      checkedAt,
      summary:
        input.tier === "ingest"
          ? "Connectivity and upload path succeeded."
          : "Provider connectivity succeeded.",
      bucketRegion: outcome.bucketRegion ?? null,
      regionMatch,
    };
  } catch (error) {
    const classified = classifyStorageError(error);
    return {
      probeId,
      tier: input.tier,
      ok: false,
      latencyMs: Date.now() - started,
      issueClass: classified.issueClass,
      issueCode: classified.issueCode,
      checkedAt,
      summary: classified.summary,
      ...(classified.billingHint
        ? { billingHint: classified.billingHint }
        : {}),
      bucketRegion: null,
      regionMatch: null,
    };
  }
}

export const MINIMAL_STORAGE_IAM_ACTIONS = [
  "s3:ListBucket",
  "s3:GetObject",
  "s3:PutObject",
  "s3:DeleteObject",
  "s3:AbortMultipartUpload",
  "s3:ListBucketMultipartUploads",
  "s3:ListMultipartUploadParts",
] as const;

/** Example identity policy resources for a single bucket + workspace prefix. */
export function exampleStorageIamResources(bucket: string): {
  bucketArn: string;
  objectArn: string;
  note: string;
} {
  const safe = bucket.trim() || "YOUR_BUCKET";
  return {
    bucketArn: `arn:aws:s3:::${safe}`,
    objectArn: `arn:aws:s3:::${safe}/workspaces/*`,
    note: "Prefer HeadBucket (needs s3:ListBucket on the bucket ARN). Do not rely on GetBucketLocation for region discovery. Add kms:Encrypt/Decrypt/GenerateDataKey when SSE-KMS is enabled.",
  };
}

/** Fake scanner may auto-promote only when explicitly enabled. */
export function isFakeScannerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env.TRUST_SCANNER ?? "").trim().toLowerCase() === "fake";
}
