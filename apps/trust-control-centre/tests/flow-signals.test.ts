import { describe, expect, it } from "vitest";
import { deriveFlowSignals } from "../src/flow-signals";
import type { ControlCentreSnapshot, OperationalSnapshot } from "../src/model";
import { platformStatusCounts, wiringEntries } from "../src/wiring-status";

const snapshot = {
  status: {
    protectedDatasets: 3,
    activeProjects: 2,
    latestVerifiedBackup: "Today",
    recoveryAttention: 2,
    canonicalIntegrityPercent: 100,
    canonicalIntegrityStatus: "verified",
    syncQueue: 0,
  },
  datasets: [
    {
      id: "a",
      name: "A",
      description: "",
      kind: "foundation",
      canonicalStore: "S3",
      schema: "x/1",
      objects: "1",
      storage: "1",
      lastVerified: "Today",
      health: "verified",
      recovery: "Daily",
      deleted: "0",
      recentEvents: [],
    },
    {
      id: "b",
      name: "B",
      description: "",
      kind: "foundation",
      canonicalStore: "S3",
      schema: "x/1",
      objects: "1",
      storage: "1",
      lastVerified: "Today",
      health: "verified",
      recovery: "Daily",
      deleted: "0",
      recentEvents: [],
    },
    {
      id: "c",
      name: "C",
      description: "",
      kind: "personal",
      canonicalStore: "S3",
      schema: "x/1",
      objects: "1",
      storage: "1",
      lastVerified: "Today",
      health: "verified",
      recovery: "Daily",
      deleted: "0",
      recentEvents: [],
    },
  ],
} satisfies ControlCentreSnapshot;

function operational(
  backup: OperationalSnapshot["backup"]["status"],
): OperationalSnapshot {
  return {
    storage: {
      status: "healthy",
      checkedAt: "2026-08-04T00:00:00.000Z",
      summary: "ok",
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

describe("deriveFlowSignals", () => {
  it("derives measured workspace counts from snapshot and application count", () => {
    const signals = deriveFlowSignals({
      snapshot,
      operational: operational("healthy"),
      mode: "fixture",
      applicationCount: 1,
    });
    expect(signals.workspace.datasetsValue).toBe("3");
    expect(signals.workspace.applicationsValue).toBe("1");
    expect(signals.workspace.backupValue).toBe("healthy");
    expect(signals.workspace.fixtureCaption).toBe(
      "Serving fixture gateway data.",
    );
    expect(signals.byNode.metadata).toMatchObject({
      kind: "measured",
      text: expect.stringContaining("3 datasets"),
    });
    expect(signals.byNode.applications).toMatchObject({
      kind: "measured",
      text: expect.stringContaining("1 registered application"),
    });
    expect(signals.byNode.portability.kind).toBe("note");
    expect(signals.byNode.semantic.kind).toBe("deferred");
  });

  it("falls back safely when operational data is missing", () => {
    const signals = deriveFlowSignals({
      snapshot: null,
      operational: null,
      mode: "live",
      applicationCount: null,
    });
    expect(signals.workspace.datasetsValue).toBe("—");
    expect(signals.workspace.applicationsValue).toBe("—");
    expect(signals.workspace.backupValue).toBe("unavailable");
    expect(signals.workspace.fixtureCaption).toBeNull();
    expect(signals.byNode.semantic.text).toMatch(/deferred/i);
  });

  it("surfaces backup not_configured and application load errors", () => {
    const signals = deriveFlowSignals({
      snapshot,
      operational: operational("not_configured"),
      mode: "live",
      applicationCount: null,
      applicationsError: "boom",
    });
    expect(signals.workspace.backupValue).toBe("not_configured");
    expect(signals.byNode.backup.text).toContain("not_configured");
    expect(signals.byNode.applications).toMatchObject({
      kind: "note",
      text: expect.stringContaining("boom"),
    });
  });
});

describe("platformStatusCounts", () => {
  it("excludes flow.node diagram entries from surface wiring totals", () => {
    const allPartial = Object.values(wiringEntries).filter(
      (entry) => entry.level === "partial",
    ).length;
    const counts = platformStatusCounts();
    expect(counts.implemented).toBe(8);
    expect(counts.outstanding).toBe(10);
    expect(counts.partial).toBeLessThan(allPartial);
    expect(
      Object.values(wiringEntries).some((entry) =>
        entry.id.startsWith("flow.node."),
      ),
    ).toBe(true);
  });
});
