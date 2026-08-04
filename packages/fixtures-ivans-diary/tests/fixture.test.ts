import { describe, expect, it } from "vitest";
import { SchemaRegistry, validateResourcePayload } from "@trust-core/schema-registry";
import { createIvansDiaryFixture, ivansDiarySchema } from "../src/index.js";

describe("Ivan’s Diary synthetic fixture", () => {
  it("publishes its versioned schema and validates every canonical payload", () => {
    const registry = new SchemaRegistry();
    const published = registry.publish(ivansDiarySchema, "2026-08-04T09:00:00.000Z");
    const fixture = createIvansDiaryFixture();
    expect(published.key).toBe("app/ivans-diary/1.0.0");
    expect(fixture.classification).toBe("synthetic-demo");
    expect(fixture.revisions).toHaveLength(fixture.resources.length);
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
});
