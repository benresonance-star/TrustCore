import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SchemaRegistry,
  generateTypeScriptTypes,
  validateResourcePayload,
} from "@trust-core/schema-registry";
import {
  createIvansDiaryFixture,
  createIvansDiaryPublicationRequest,
  ivansDiarySchema,
} from "../src/index.js";

describe("Ivan’s Diary synthetic fixture", () => {
  it("publishes its versioned schema and validates every canonical payload", () => {
    const registry = new SchemaRegistry();
    const published = registry.publishGoverned(
      createIvansDiaryPublicationRequest(
        { approvedBy: "test-admin", approvalId: "approval-ivan" },
        "publish-ivan",
      ),
      "2026-08-04T09:00:00.000Z",
    );
    const fixture = createIvansDiaryFixture();
    expect(published.key).toBe("app/ivans-diary/1.0.0");
    expect(fixture.classification).toBe("synthetic-demo");
    expect(fixture.revisions).toHaveLength(fixture.resources.length);
    expect(published.governance?.approvedBy).toBe("test-admin");
    for (const revision of fixture.revisions) {
      const resource = fixture.resources.find((item) => item.id === revision.resourceId)!;
      expect(validateResourcePayload(ivansDiarySchema, resource.resourceType, revision.canonicalPayload).valid).toBe(true);
    }
  });

  it("contains a recoverable deletion and a bookmark relationship", () => {
    const fixture = createIvansDiaryFixture();
    expect(fixture.tombstones[0]?.subjectId).toBe("audio-reflection");
    expect(fixture.relations.some((item) => item.relationType === "references" && item.sourceId === "bookmark-tuesday")).toBe(true);
  });

  it("keeps committed app types byte-for-byte deterministic", () => {
    const committed = readFileSync(
      new URL("../src/generated-types.ts", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(generateTypeScriptTypes(ivansDiarySchema).source);
  });
});
