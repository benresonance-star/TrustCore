import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_PACK_SCHEMA_VERSION,
  CONNECTION_PACK_SDK_PACKAGE,
  CONNECTION_PACK_TCAP_VERSION,
  buildConnectionPack,
  connectionPackFilename,
} from "../src/connection-pack";

const golden = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures/connection-pack.golden.json"),
    "utf8",
  ),
) as Record<string, unknown>;

describe("buildConnectionPack", () => {
  it("includes required pins and ids", () => {
    const pack = buildConnectionPack({
      workspaceId: "workspace-demo",
      apiBase: "/api",
      application: {
        id: "fixture-app-1",
        workspaceId: "workspace-demo",
        namespace: "app/demo",
        name: "Demo",
        applicationVersion: "1.0.0",
        schemaPackageIds: [],
        capabilities: ["dataset:read"],
        status: "active",
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T00:00:00.000Z",
      },
      policyAssignmentIds: ["assignment-1"],
      bundle: null,
      probeResult: {
        ok: true,
        checkedAt: "2026-08-04T00:00:00.000Z",
        scope: "session_snapshot",
        message: "ok",
      },
    });
    expect(pack.schemaVersion).toBe(CONNECTION_PACK_SCHEMA_VERSION);
    expect(pack.sdkPackage).toBe(CONNECTION_PACK_SDK_PACKAGE);
    expect(pack.tcapVersion).toBe(CONNECTION_PACK_TCAP_VERSION);
    expect(pack.applicationId).toBe("fixture-app-1");
    expect(pack.policyAssignmentIds).toEqual(["assignment-1"]);
    expect(pack.capabilityGrants).toEqual(["dataset:read"]);
    expect(connectionPackFilename(pack.applicationId)).toBe(
      "trust-connection-pack-fixture-app-1.json",
    );
    expect(pack).toEqual(golden);
  });
});
