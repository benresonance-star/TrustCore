import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "../src/readiness";
import type { ControlCentreSnapshot, OperationalSnapshot } from "../src/model";

const snapshot = {
  status: {
    protectedDatasets: 1,
    activeProjects: 1,
    latestVerifiedBackup: "Today",
    recoveryAttention: 0,
    canonicalIntegrityPercent: 100,
    canonicalIntegrityStatus: "verified",
    syncQueue: 0,
  },
  datasets: [],
} satisfies ControlCentreSnapshot;

function operational(
  storage: OperationalSnapshot["storage"]["status"],
  backup: OperationalSnapshot["backup"]["status"],
): OperationalSnapshot {
  return {
    storage: {
      status: storage,
      checkedAt: "2026-08-04T00:00:00.000Z",
      summary: `storage ${storage}`,
      details: {},
    },
    backup: {
      status: backup,
      checkedAt: "2026-08-04T00:00:00.000Z",
      summary: `backup ${backup}`,
      details: {},
    },
    latestVerification: null,
  };
}

describe("evaluateReadiness", () => {
  it("marks fixture mode signed-in and workspace ok with healthy ops", () => {
    const steps = evaluateReadiness({
      mode: "fixture",
      workspaceId: "workspace-demo",
      signedIn: false,
      snapshot,
      operational: operational("healthy", "healthy"),
      applicationCount: 1,
      applicationGrantCount: 1,
      probeOk: true,
    });
    expect(steps.find((step) => step.id === "signed_in")?.status).toBe("ok");
    expect(steps.find((step) => step.id === "workspace")?.status).toBe("ok");
    expect(steps.find((step) => step.id === "storage")?.status).toBe("ok");
    expect(steps.find((step) => step.id === "probe")?.status).toBe("ok");
  });

  it("blocks live mode without workspace and without apps/grants", () => {
    const steps = evaluateReadiness({
      mode: "live",
      workspaceId: "",
      signedIn: false,
      snapshot: null,
      operational: null,
      applicationCount: 0,
      applicationGrantCount: 0,
      probeOk: null,
    });
    expect(steps.find((step) => step.id === "signed_in")).toMatchObject({
      status: "blocked",
      remediationKey: "sign_in",
    });
    expect(steps.find((step) => step.id === "workspace")).toMatchObject({
      status: "blocked",
      remediationKey: "workspace_env",
    });
    expect(steps.find((step) => step.id === "applications")?.status).toBe(
      "blocked",
    );
    expect(steps.find((step) => step.id === "access_grant")?.status).toBe(
      "blocked",
    );
  });

  it("warns when backup is not_configured and blocks storage not_configured", () => {
    const steps = evaluateReadiness({
      mode: "live",
      workspaceId: "workspace-live",
      signedIn: true,
      snapshot,
      operational: operational("not_configured", "not_configured"),
      applicationCount: 1,
      applicationGrantCount: 1,
      probeOk: false,
    });
    expect(steps.find((step) => step.id === "storage")).toMatchObject({
      status: "blocked",
      remediationKey: "storage_env",
    });
    expect(steps.find((step) => step.id === "backup")).toMatchObject({
      status: "warning",
      remediationKey: "backup_not_configured",
    });
    expect(steps.find((step) => step.id === "probe")).toMatchObject({
      status: "blocked",
      remediationKey: "probe_failed",
    });
  });
});
