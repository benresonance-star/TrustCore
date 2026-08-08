import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  SchemaRegistry,
  generateTypeScriptTypes,
  validateResourcePayload,
} from "@trust-core/schema-registry";
import { describe, expect, it } from "vitest";
import {
  createWeSketchFixture,
  createWeSketchPublicationRequest,
  weSketchSchema,
} from "../src/index.js";

describe("WeSketch synthetic creative-generation fixture", () => {
  it("publishes app/wesketch/1.0.0 and validates every revision payload", () => {
    const registry = new SchemaRegistry();
    const published = registry.publishGoverned(
      createWeSketchPublicationRequest(
        { approvedBy: "test-admin", approvalId: "approval-wesketch" },
        "publish-wesketch",
      ),
      "2026-08-04T10:00:00.000Z",
    );
    const fixture = createWeSketchFixture();
    expect(published.key).toBe("app/wesketch/1.0.0");
    expect(fixture.classification).toBe("synthetic-demo");
    expect(published.governance?.approvedBy).toBe("test-admin");
    expect(
      new Set(fixture.resources.map(({ resourceType }) => resourceType)),
    ).toEqual(
      new Set([
        "Project",
        "Canvas",
        "Layer",
        "SelectionMask",
        "GenerationRequest",
        "GeneratedImage",
        "Placement",
        "ConversationTurn",
        "StrokeDocument",
      ]),
    );
    for (const revision of fixture.revisions) {
      const resource = fixture.resources.find(
        ({ id }) => id === revision.resourceId,
      );
      expect(resource, revision.id).toBeDefined();
      expect(
        validateResourcePayload(
          weSketchSchema,
          resource!.resourceType,
          revision.canonicalPayload,
        ),
        revision.id,
      ).toMatchObject({ valid: true, issues: [] });
    }
  });

  it("references real deterministic blob content through revision attachments", () => {
    const fixture = createWeSketchFixture();
    expect(fixture.blobs).toHaveLength(4);
    expect(fixture.revisionBlobs).toHaveLength(4);
    for (const content of fixture.blobContents) {
      const blob = fixture.blobs.find(({ id }) => id === content.blobObjectId);
      expect(blob, content.blobObjectId).toBeDefined();
      expect(blob!.byteLength).toBe(content.bytes.byteLength);
      expect(blob!.sha256).toBe(
        createHash("sha256").update(content.bytes).digest("hex"),
      );
      expect(
        fixture.revisionBlobs.some(
          ({ blobObjectId }) => blobObjectId === blob!.id,
        ),
      ).toBe(true);
    }
  });

  it("constrains every emitted relation in the schema manifest", () => {
    const fixture = createWeSketchFixture();
    const resourceTypes = new Map(
      fixture.resources.map(({ id, resourceType }) => [id, resourceType]),
    );
    const revisionTypes = new Map(
      fixture.revisions.map(({ id, resourceId }) => [
        id,
        resourceTypes.get(resourceId),
      ]),
    );
    const endpointType = (kind: string, id: string) =>
      kind === "resource"
        ? resourceTypes.get(id)
        : kind === "revision"
          ? revisionTypes.get(id)
          : undefined;

    for (const relation of fixture.relations) {
      const sourceType = endpointType(relation.sourceKind, relation.sourceId);
      const targetType = endpointType(relation.targetKind, relation.targetId);
      expect(sourceType, `${relation.id} source`).toBeDefined();
      expect(targetType, `${relation.id} target`).toBeDefined();
      expect(
        weSketchSchema.relationships.some(
          (constraint) =>
            constraint.type === relation.relationType &&
            constraint.sourceTypes.includes(sourceType!) &&
            constraint.targetTypes.includes(targetType!),
        ),
        `${relation.id}: ${sourceType} ${relation.relationType} ${targetType}`,
      ).toBe(true);
    }
  });

  it("keeps committed app types byte-for-byte deterministic", () => {
    const committed = readFileSync(
      new URL("../src/generated-types.ts", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(generateTypeScriptTypes(weSketchSchema).source);
  });

  it("reconstructs prompt-to-placement provenance and preserves a recoverable output", () => {
    const fixture = createWeSketchFixture();
    const edges = new Set(
      fixture.relations.map(
        ({ sourceId, relationType, targetId }) =>
          `${sourceId}:${relationType}:${targetId}`,
      ),
    );
    for (const edge of [
      "turn-sunrise-001:initiates:generation-sunrise-001",
      "generation-sunrise-001:uses_selection:selection-horizon",
      "generation-sunrise-001:uses_guidance:strokes-mountain-guide",
      "generation-sunrise-001:uses_canvas_revision:revision-canvas-hero-1",
      "generation-sunrise-001:produces:generated-sunrise-001",
      "generated-sunrise-001:placed_by:placement-sunrise-001",
      "placement-sunrise-001:targets_layer:layer-generated",
      "placement-sunrise-001:results_in:revision-canvas-hero-2",
      "revision-canvas-hero-2:derived_from:revision-canvas-hero-1",
    ])
      expect(edges.has(edge), edge).toBe(true);
    expect(
      fixture.resources.find(({ id }) => id === "canvas-hero")
        ?.currentRevisionId,
    ).toBe("revision-canvas-hero-2");
    expect(fixture.tombstones).toEqual([
      expect.objectContaining({
        subjectId: "generated-sunrise-rejected",
        priorRevisionId: "revision-generated-sunrise-rejected-1",
        purgeState: "not_eligible",
      }),
    ]);
  });
});
