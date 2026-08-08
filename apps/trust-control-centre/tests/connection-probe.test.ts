import { describe, expect, it, vi } from "vitest";
import { runConnectionProbe } from "../src/connection-probe";

describe("runConnectionProbe", () => {
  it("returns ok when snapshot loads", async () => {
    const result = await runConnectionProbe({
      workspaceId: "workspace-demo",
      getSnapshot: async () =>
        ({
          status: {
            protectedDatasets: 1,
            activeProjects: 1,
            latestVerifiedBackup: "Today",
            recoveryAttention: 0,
            canonicalIntegrityPercent: 100,
            canonicalIntegrityStatus: "verified",
            syncQueue: 0,
          },
          datasets: [{ id: "one" }],
        }) as never,
    });
    expect(result.ok).toBe(true);
    expect(result.scope).toBe("session_snapshot");
    expect(result.message).toContain("1 dataset");
  });

  it("maps failures with remediation", async () => {
    const result = await runConnectionProbe({
      workspaceId: "workspace-live",
      getSnapshot: vi.fn(async () => {
        throw Object.assign(new Error("Unauthorized"), { status: 401 });
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.remediation).toContain("Sign in again");
  });
});
