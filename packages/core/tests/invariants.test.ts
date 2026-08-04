import { describe, expect, it } from "vitest";
import { assertBlobHash, assertNextRevision, TrustInvariantError } from "../src/index.js";
import type { Resource, Revision } from "../src/index.js";

const now = "2026-08-03T00:00:00.000Z";

const resource: Resource = {
  id: "resource-1", workspaceId: "workspace-1", datasetId: "dataset-1",
  resourceType: "example.page", title: "Page", status: "active",
  currentRevisionId: "revision-1", createdBy: "actor-1", createdAt: now, updatedAt: now,
};

const revisionOne: Revision = {
  id: "revision-1", workspaceId: "workspace-1", datasetId: "dataset-1", resourceId: "resource-1",
  revisionNumber: 1, parentRevisionId: null, mergeParentRevisionIds: [], schemaPackageId: "schema-1",
  schemaVersion: "1.0.0", canonicalPayload: {}, canonicalPayloadHash: "a".repeat(64), createdBy: "actor-1",
  createdOnDeviceId: null, source: "user", changeNote: null, restoredFromRevisionId: null, createdAt: now,
};

describe("Trust Core invariants", () => {
  it("accepts a valid SHA-256", () => expect(() => assertBlobHash({ sha256: "f".repeat(64) })).not.toThrow());

  it("rejects stale-base revision commits", () => {
    const proposed: Revision = { ...revisionOne, id: "revision-2", revisionNumber: 2, parentRevisionId: "other" };
    expect(() => assertNextRevision({ resource, currentRevision: revisionOne, proposed }))
      .toThrowError(TrustInvariantError);
    try {
      assertNextRevision({ resource, currentRevision: revisionOne, proposed });
    } catch (error) {
      expect((error as TrustInvariantError).code).toBe("BASE_REVISION_CONFLICT");
    }
  });
});
