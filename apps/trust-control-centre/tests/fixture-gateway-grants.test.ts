import { describe, expect, it } from "vitest";
import { fixtureGateway } from "../src/fixture-gateway";

describe("fixture gateway download grants", () => {
  it("creates a grant with copyable ids", async () => {
    const grant = await fixtureGateway.createDownloadGrant("workspace-demo", {
      objectId: "object-123",
      requestedTtlSeconds: 120,
    });
    expect(grant.grantId).toMatch(/^fixture-grant-/);
    expect(grant.objectId).toBe("object-123");
    expect(grant.workspaceId).toBe("workspace-demo");
    expect(grant.transfer.method).toBe("GET");
  });

  it("refuses quarantined object ids", async () => {
    await expect(
      fixtureGateway.createDownloadGrant("workspace-demo", {
        objectId: "quarantine:pending-1",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns a fixture quarantine summary", async () => {
    const summary =
      await fixtureGateway.getQuarantineScanSummary("workspace-demo");
    expect(summary.available).toBe(true);
    expect(summary.items[0]?.state).toBe("pending");
  });

  it("returns per-upload scan status", async () => {
    const status = await fixtureGateway.getUploadScanStatus(
      "workspace-demo",
      "fixture-upload-1",
    );
    expect(status).toEqual({
      uploadId: "fixture-upload-1",
      workspaceId: "workspace-demo",
      state: "scanning",
      updatedAt: "2026-08-04T02:10:00.000Z",
    });
    expect(status).not.toHaveProperty("storageKey");
    expect(status).not.toHaveProperty("scanJobId");
  });
});
