import { describe, expect, it, vi } from "vitest";
import {
  ProbeRateLimiter,
  StorageHealthCache,
  assertNoSecretFields,
  buildConsoleLinks,
  classifyStorageError,
  projectSafeStorageConfig,
  runStorageProbe,
  toStorageHealthDetails,
} from "../src/storage-diagnostics.js";

describe("classifyStorageError", () => {
  it("classifies auth, permission, not_found, network, and outage", () => {
    expect(
      classifyStorageError({ name: "CredentialsProviderError", message: "no" })
        .issueClass,
    ).toBe("auth");
    expect(
      classifyStorageError({
        name: "AccessDenied",
        Code: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      }).issueClass,
    ).toBe("permission");
    expect(
      classifyStorageError({
        name: "NoSuchBucket",
        Code: "NoSuchBucket",
        $metadata: { httpStatusCode: 404 },
      }).issueClass,
    ).toBe("not_found");
    expect(
      classifyStorageError({
        name: "TimeoutError",
        code: "ETIMEDOUT",
        message: "timed out",
      }).issueClass,
    ).toBe("network");
    expect(
      classifyStorageError({
        name: "ServiceUnavailable",
        Code: "ServiceUnavailable",
        $metadata: { httpStatusCode: 503 },
      }).issueClass,
    ).toBe("provider_outage");
    expect(classifyStorageError(new Error("weird")).issueClass).toBe(
      "internal",
    );
  });

  it("classifies PermanentRedirect as wrong_region", () => {
    expect(
      classifyStorageError({
        Code: "PermanentRedirect",
        message: "The bucket you are attempting to access must be addressed using the specified endpoint",
        $metadata: { httpStatusCode: 301 },
      }).issueClass,
    ).toBe("wrong_region");
  });

  it("adds a billing hint for account-disabled style permission failures", () => {
    const result = classifyStorageError({
      Code: "AllAccessDisabled",
      message: "Account is delinquent",
      $metadata: { httpStatusCode: 403 },
    });
    expect(result.issueClass).toBe("permission");
    expect(result.billingHint).toMatch(/billing/i);
  });
});

describe("buildConsoleLinks", () => {
  it("builds allowlisted S3 links including billing", () => {
    const links = buildConsoleLinks({
      provider: "s3",
      region: "eu-west-1",
      bucket: "trust-core",
      endpointHost: null,
      consoleUrl: null,
    });
    expect(links.map((link) => link.id)).toEqual([
      "s3_bucket",
      "iam",
      "billing",
    ]);
    expect(
      links.every((link) =>
        link.url.startsWith("https://eu-west-1.console.aws.amazon.com"),
      ),
    ).toBe(true);
  });

  it("uses partition-aware console bases for gov and china regions", () => {
    const gov = buildConsoleLinks({
      provider: "s3",
      region: "us-gov-west-1",
      bucket: "b",
      endpointHost: null,
      consoleUrl: null,
    });
    expect(gov[0]?.url).toContain("console.amazonaws-us-gov.com");
    const cn = buildConsoleLinks({
      provider: "s3",
      region: "cn-north-1",
      bucket: "b",
      endpointHost: null,
      consoleUrl: null,
    });
    expect(cn[0]?.url).toContain("console.amazonaws.cn");
  });

  it("builds MinIO console only for allowlisted hosts and never AWS billing", () => {
    const links = buildConsoleLinks({
      provider: "minio",
      region: "us-east-1",
      bucket: "local",
      endpointHost: "http://127.0.0.1:9000",
      consoleUrl: null,
    });
    expect(links.map((link) => link.id)).toEqual(["minio_console"]);
    expect(links[0]?.url).toBe("http://127.0.0.1:9001");
    expect(links.some((link) => /billing/i.test(link.label))).toBe(false);

    expect(
      buildConsoleLinks({
        provider: "minio",
        region: "us-east-1",
        bucket: "local",
        endpointHost: "https://evil.example.com",
        consoleUrl: null,
      }),
    ).toEqual([]);
  });
});

describe("safe config and secrets", () => {
  it("projects credential mode without secret fields", () => {
    const config = projectSafeStorageConfig({
      provider: "s3",
      region: "us-east-1",
      bucket: "b",
      hasStaticKeys: true,
      transferSignerConfigured: true,
      objectStorageConfigured: true,
    });
    expect(config.credentialMode).toBe("static_keys_configured");
    const details = toStorageHealthDetails(config, null, {
      cataloguedObjects: 2,
      failedVerificationObjects: 0,
    });
    expect(() =>
      assertNoSecretFields(details as unknown as Record<string, unknown>),
    ).not.toThrow();
    expect(JSON.stringify(details)).not.toMatch(/AKIA|secretAccessKey/i);
  });
});

describe("probe helpers", () => {
  it("rate limits repeated probes", () => {
    const limiter = new ProbeRateLimiter(1_000, () => 1_000);
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("a")).toBe(false);
  });

  it("caches health within TTL", () => {
    let now = 0;
    const cache = new StorageHealthCache(100, () => now);
    cache.set({
      status: "healthy",
      summary: "ok",
      details: toStorageHealthDetails(
        projectSafeStorageConfig({
          provider: "minio",
          region: "us-east-1",
          bucket: "b",
          endpoint: "http://127.0.0.1:9000",
          hasStaticKeys: true,
          transferSignerConfigured: false,
          objectStorageConfigured: true,
        }),
        null,
        { cataloguedObjects: 0, failedVerificationObjects: 0 },
      ),
    });
    expect(cache.get()?.status).toBe("healthy");
    now = 200;
    expect(cache.get()).toBeUndefined();
  });

  it("times out slow connectivity probes", async () => {
    const result = await runStorageProbe({
      tier: "connectivity",
      config: projectSafeStorageConfig({
        provider: "s3",
        region: "us-east-1",
        bucket: "b",
        hasStaticKeys: false,
        transferSignerConfigured: false,
        objectStorageConfigured: true,
      }),
      prober: {
        probeConnectivity: () =>
          new Promise((resolve) => setTimeout(resolve, 50)),
      },
      storage: undefined,
      workspaceId: "ws",
      timeoutMs: 5,
      createId: () => "probe-1",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.issueClass).toBe("network");
    expect(result.probeId).toBe("probe-1");
  });

  it("returns not_configured when storage is missing", async () => {
    const result = await runStorageProbe({
      tier: "connectivity",
      config: projectSafeStorageConfig({
        provider: "minio",
        region: "us-east-1",
        bucket: "",
        hasStaticKeys: false,
        transferSignerConfigured: false,
        objectStorageConfigured: false,
      }),
      prober: undefined,
      storage: undefined,
      workspaceId: "ws",
      createId: () => "probe-2",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.issueClass).toBe("not_configured");
  });

  it("enables fake scanner only for TRUST_SCANNER=fake", async () => {
    const { isFakeScannerEnabled } = await import("../src/storage-diagnostics.js");
    expect(isFakeScannerEnabled({ TRUST_SCANNER: "fake" })).toBe(true);
    expect(isFakeScannerEnabled({ TRUST_SCANNER: "off" })).toBe(false);
    expect(isFakeScannerEnabled({})).toBe(false);
  });

  it("marks successful connectivity probes ok", async () => {
    const probeConnectivity = vi.fn(async () => ({
      bucketRegion: "us-east-1",
    }));
    const result = await runStorageProbe({
      tier: "connectivity",
      config: projectSafeStorageConfig({
        provider: "s3",
        region: "us-east-1",
        bucket: "b",
        hasStaticKeys: false,
        transferSignerConfigured: true,
        objectStorageConfigured: true,
      }),
      prober: { probeConnectivity },
      storage: undefined,
      workspaceId: "ws",
      createId: () => "probe-3",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(probeConnectivity).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.issueClass).toBeNull();
    expect(result.regionMatch).toBe(true);
  });

  it("fails when HeadBucket region disagrees with config", async () => {
    const result = await runStorageProbe({
      tier: "connectivity",
      config: projectSafeStorageConfig({
        provider: "s3",
        region: "us-east-1",
        bucket: "b",
        hasStaticKeys: false,
        transferSignerConfigured: true,
        objectStorageConfigured: true,
      }),
      prober: {
        probeConnectivity: async () => ({ bucketRegion: "eu-west-1" }),
      },
      storage: undefined,
      workspaceId: "ws",
      createId: () => "probe-region",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.issueClass).toBe("wrong_region");
    expect(result.regionMatch).toBe(false);
  });

  it("aborts timed-out probes via AbortSignal", async () => {
    let seenSignal: AbortSignal | undefined;
    const result = await runStorageProbe({
      tier: "connectivity",
      config: projectSafeStorageConfig({
        provider: "s3",
        region: "us-east-1",
        bucket: "b",
        hasStaticKeys: false,
        transferSignerConfigured: false,
        objectStorageConfigured: true,
      }),
      prober: {
        probeConnectivity: (signal) =>
          new Promise((resolve, reject) => {
            seenSignal = signal;
            signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      },
      storage: undefined,
      workspaceId: "ws",
      timeoutMs: 5,
      createId: () => "probe-abort",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.issueClass).toBe("network");
    expect(seenSignal?.aborted).toBe(true);
  });
});
