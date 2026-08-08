import { describe, expect, it } from "vitest";
import {
  InMemoryQuarantineScanStore,
  QuarantineScanConflictError,
  resolveQuarantineScanSave,
} from "../src/index.js";
import { assertQuarantineScanStoreIdentity } from "./quarantine-scan-store.contract.js";

describe("InMemoryQuarantineScanStore identity", () => {
  it("enforces the shared quarantine scan identity contract", async () => {
    await assertQuarantineScanStoreIdentity({
      store: new InMemoryQuarantineScanStore(),
      workspaceA: "workspace-a",
      workspaceB: "workspace-b",
      uploadA: "upload-a",
      uploadB: "upload-b",
    });
  });
});

describe("resolveQuarantineScanSave", () => {
  const base = {
    scanJobId: "job-1",
    workspaceId: "workspace-a",
    uploadId: "upload-a",
    storageKey: "key-a",
    state: "scanning" as const,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:01:00.000Z",
  };

  it("inserts when no existing identity is present", () => {
    expect(resolveQuarantineScanSave(undefined, undefined, base)).toBe(
      "insert",
    );
  });

  it("updates when the same job and upload identity is preserved", () => {
    expect(resolveQuarantineScanSave(base, base, {
      ...base,
      state: "accepted",
      outcome: "clean" as const,
      updatedAt: "2026-08-08T00:02:00.000Z",
    })).toBe("update");
  });

  it("rejects conflicting identities", () => {
    expect(() =>
      resolveQuarantineScanSave(base, undefined, {
        ...base,
        uploadId: "upload-b",
      }),
    ).toThrow(QuarantineScanConflictError);
    expect(() =>
      resolveQuarantineScanSave(undefined, base, {
        ...base,
        scanJobId: "job-2",
      }),
    ).toThrow(QuarantineScanConflictError);
    expect(() =>
      resolveQuarantineScanSave(base, base, {
        ...base,
        storageKey: "other",
      }),
    ).toThrow(QuarantineScanConflictError);
  });
});
