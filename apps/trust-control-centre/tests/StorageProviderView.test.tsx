// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceHealth } from "@trust-core/protocol";
import { StorageProviderView } from "../src/StorageProviderView";
import {
  mapScanStateToLifecycleLabel,
  remediationKeyForIssueClass,
  storageOperatorStatus,
} from "../src/storage-status";

afterEach(cleanup);

const healthy: ServiceHealth = {
  status: "healthy",
  checkedAt: "2026-08-04T02:14:00.000Z",
  summary: "Provider connectivity succeeded.",
  details: {
    provider: "s3",
    region: "ap-southeast-2",
    bucket: "trust-core-fixture",
    credentialMode: "iam_role",
    endpointHost: null,
    transferSignerConfigured: true,
    objectStorageConfigured: true,
    cataloguedObjects: 10,
    failedVerificationObjects: 0,
    consoleLinks: [
      {
        id: "s3_bucket",
        label: "Open in Amazon S3",
        url: "https://console.aws.amazon.com/s3/buckets/trust-core-fixture?region=ap-southeast-2",
      },
    ],
    probe: {
      probeId: "probe-123",
      tier: "connectivity",
      ok: true,
      latencyMs: 9,
      issueClass: null,
      issueCode: null,
      checkedAt: "2026-08-04T02:15:00.000Z",
      summary: "Provider connectivity succeeded.",
    },
    minimalIamActions: ["s3:GetObject"],
  },
};

describe("storage-status helpers", () => {
  it("maps operator status and remediation keys", () => {
    expect(storageOperatorStatus(healthy)).toBe("Connected");
    expect(
      storageOperatorStatus({
        status: "not_configured",
        checkedAt: "",
        summary: "",
        details: {
          provider: "s3",
          region: "",
          bucket: "",
          credentialMode: "missing",
          endpointHost: null,
          transferSignerConfigured: false,
          objectStorageConfigured: false,
          cataloguedObjects: 0,
          failedVerificationObjects: 0,
          consoleLinks: [],
          probe: null,
        },
      }),
    ).toBe("Not set up");
    expect(
      storageOperatorStatus({
        status: "degraded",
        checkedAt: "",
        summary: "configured but unverified",
        details: {
          ...healthy.details,
          probe: null,
        },
      }),
    ).toBe("Configured");
    expect(remediationKeyForIssueClass("network")).toBe("storage_network");
    expect(remediationKeyForIssueClass("wrong_region")).toBe(
      "storage_wrong_region",
    );
  });

  it("maps scan lifecycle labels including awaiting scanner", () => {
    expect(mapScanStateToLifecycleLabel("promoted")).toBe("Available");
    expect(
      mapScanStateToLifecycleLabel("scan_queued", { scannerConfigured: false }),
    ).toBe("Awaiting scanner");
    expect(mapScanStateToLifecycleLabel("rejected")).toBe("Blocked");
  });
});

describe("StorageProviderView", () => {
  it("shows connected status, managed-on-server copy, and probes", () => {
    const onProbe = vi.fn();
    render(
      <StorageProviderView health={healthy} mode="fixture" onProbe={onProbe} />,
    );
    expect(screen.getByRole("heading", { name: "Storage" })).toBeVisible();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.getByText(/managed on the server/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(onProbe).toHaveBeenCalledWith("connectivity");
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("trust-core-fixture")).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "Open in Amazon S3" })[0],
    ).toHaveAttribute(
      "href",
      "https://console.aws.amazon.com/s3/buckets/trust-core-fixture?region=ap-southeast-2",
    );
  });
});
