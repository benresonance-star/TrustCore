import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { DatasetRecord } from "../src/index.js";
import {
  operationStates,
  publicErrorCodes,
  release01Routes,
  verificationLevels,
} from "../src/index.js";

describe("Release 0.1 public contracts", () => {
  it("publishes the five ordered verification levels", () => {
    expect(verificationLevels).toEqual([
      "metadata",
      "full_blob",
      "resource",
      "dataset",
      "workspace",
    ]);
  });

  it("publishes the durable upload operation states", () => {
    expect(operationStates).toContain("requested");
    expect(operationStates).toContain("immutable_object_committed");
    expect(operationStates).toContain("completed");
    expect(operationStates).toContain("quarantined");
  });

  it("uses stable uppercase public error codes", () => {
    expect(publicErrorCodes).toContain("REVISION_CONFLICT");
    expect(publicErrorCodes).toContain("TRUST_STORE_UNAVAILABLE");
    expect(
      publicErrorCodes.every((code) => /^[A-Z][A-Z0-9_]*$/.test(code)),
    ).toBe(true);
  });

  it("publishes unique Release 0.1 route operation identifiers", () => {
    expect(
      new Set(release01Routes.map(({ operationId }) => operationId)).size,
    ).toBe(release01Routes.length);
  });

  it("decodes the shared TypeScript and Swift dataset fixture", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../../../swift/TrustCoreKit/Tests/TrustCoreKitTests/Fixtures/typescript-compatibility.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { items: DatasetRecord[] };
    expect(fixture.items.map((item) => item.datasetType)).toEqual([
      "personal-archive",
      "creative-workspace",
    ]);
    expect(fixture.items.every((item) => item.retentionPolicyId === null)).toBe(
      true,
    );
  });
});
