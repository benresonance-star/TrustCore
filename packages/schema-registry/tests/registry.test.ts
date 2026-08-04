import { describe, expect, it } from "vitest";
import { SchemaRegistry, schemaDigest, validateResourcePayload, type SchemaPackageManifest } from "../src/index.js";

const manifest: SchemaPackageManifest = {
  namespace: "app", name: "notes", version: "1.0.0", title: "Notes", description: "Test notes", classification: "application",
  compatibleArchiveFormat: "trust-core-archive/1.0.0",
  resourceTypes: [{ name: "Note", description: "A note", additionalFields: "preserve", fields: { title: { kind: "string", required: true }, createdAt: { kind: "timestamp", required: true } } }],
  relationships: [],
};

describe("schema registry", () => {
  it("publishes immutable, digest-addressed versions once", () => {
    const registry = new SchemaRegistry();
    const published = registry.publish(manifest, "2026-08-04T00:00:00.000Z");
    expect(published.digest).toBe(schemaDigest(manifest));
    expect(published.id).toBe(`schema:${published.digest}`);
    expect(() => registry.publish(manifest)).toThrow(/already published/);
  });

  it("validates required types while preserving forward-compatible fields", () => {
    const valid = validateResourcePayload(manifest, "Note", { title: "Hello", createdAt: "2026-08-04T01:00:00Z", futureField: 3 });
    expect(valid).toEqual({ valid: true, issues: [], preservedUnknownFields: ["$.futureField"] });
    const invalid = validateResourcePayload(manifest, "Note", { title: 42 });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toEqual(["invalid_field_type", "missing_required_field"]);
  });
});
