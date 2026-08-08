import { describe, expect, it } from "vitest";
import { uploadScanStates } from "@trust-core/protocol";
import {
  quarantineScanStates,
  toUploadScanStatus,
  type QuarantineScanRecord,
} from "../src/index.js";

function record(
  overrides: Partial<QuarantineScanRecord> = {},
): QuarantineScanRecord {
  return {
    scanJobId: "scan_internal",
    workspaceId: "workspace_a",
    uploadId: "upload_1",
    storageKey: "workspaces/workspace_a/temporary/secret",
    state: "scanning",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:01:00.000Z",
    ...overrides,
  };
}

describe("toUploadScanStatus", () => {
  it("maps every quarantine scan state without provider fields", () => {
    expect(quarantineScanStates).toEqual(uploadScanStates);
    for (const state of quarantineScanStates) {
      const status = toUploadScanStatus(record({ state }));
      expect(status).toEqual({
        uploadId: "upload_1",
        workspaceId: "workspace_a",
        state,
        updatedAt: "2026-08-08T00:01:00.000Z",
      });
      expect(Object.keys(status).sort()).toEqual(
        ["state", "updatedAt", "uploadId", "workspaceId"].sort(),
      );
      expect(status).not.toHaveProperty("scanJobId");
      expect(status).not.toHaveProperty("storageKey");
      expect(status).not.toHaveProperty("engine");
      expect(JSON.stringify(status)).not.toContain("temporary/secret");
    }
  });

  it("includes outcome only when present", () => {
    expect(toUploadScanStatus(record({ outcome: "clean" })).outcome).toBe(
      "clean",
    );
    expect(toUploadScanStatus(record()).outcome).toBeUndefined();
  });
});
