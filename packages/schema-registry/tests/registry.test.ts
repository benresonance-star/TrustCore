import { describe, expect, it } from "vitest";
import {
  SchemaRegistry,
  classifyCompatibility,
  generateTypeScriptTypes,
  schemaDigest,
  validateResourcePayload,
  type GovernedPublicationRequest,
  type SchemaPackageManifest,
} from "../src/index.js";

const manifest: SchemaPackageManifest = {
  namespace: "app", name: "notes", version: "1.0.0", title: "Notes", description: "Test notes", classification: "application",
  compatibleArchiveFormat: "trust-core-archive/1.0.0",
  resourceTypes: [{ name: "Note", description: "A note", additionalFields: "preserve", fields: { title: { kind: "string", required: true }, createdAt: { kind: "timestamp", required: true } } }],
  relationships: [],
};

describe("schema registry", () => {
  it("publishes immutable, digest-addressed versions once", () => {
    const registry = new SchemaRegistry();
    const published = registry.publishGoverned(
      publication(manifest, "initial"),
      "2026-08-04T00:00:00.000Z",
    );
    expect(published.digest).toBe(schemaDigest(manifest));
    expect(published.id).toBe(`schema:${published.digest}`);
    expect(Object.isFrozen(published.manifest.resourceTypes[0]?.fields)).toBe(
      true,
    );
  });

  it("validates required types while preserving forward-compatible fields", () => {
    const valid = validateResourcePayload(manifest, "Note", { title: "Hello", createdAt: "2026-08-04T01:00:00Z", futureField: 3 });
    expect(valid).toEqual({ valid: true, issues: [], preservedUnknownFields: ["$.futureField"] });
    const invalid = validateResourcePayload(manifest, "Note", { title: 42 });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toEqual(["invalid_field_type", "missing_required_field"]);
  });

  it("publishes an approved TCAP package idempotently with governance evidence", () => {
    const registry = new SchemaRegistry();
    const request = publication(manifest, "initial");
    const first = registry.publishGoverned(
      request,
      "2026-08-04T00:00:00.000Z",
    );
    const replay = registry.publishGoverned(
      request,
      "2026-08-05T00:00:00.000Z",
    );
    expect(replay).toEqual(first);
    expect(first.governance).toMatchObject({
      protocolVersion: "TCAP/1.0",
      applicationNamespace: "app/notes",
      approvedBy: "admin:release",
    });
    expect(first.compatibility?.classification).toBe("initial");
    expect(() =>
      registry.publishGoverned({
        ...request,
        manifest: { ...manifest, title: "Different" },
      }),
    ).toThrow(/Idempotency key/);
  });

  it("classifies optional additions and enforces breaking major versions", () => {
    const compatible: SchemaPackageManifest = {
      ...manifest,
      version: "1.1.0",
      resourceTypes: [
        {
          ...manifest.resourceTypes[0]!,
          fields: {
            ...manifest.resourceTypes[0]!.fields,
            subtitle: { kind: "string" },
          },
        },
      ],
    };
    expect(
      classifyCompatibility(manifest, compatible).classification,
    ).toBe("backward-compatible");

    const registry = new SchemaRegistry();
    registry.publishGoverned(publication(manifest, "initial"));
    registry.publishGoverned(
      publication(compatible, "backward-compatible", "publish-2"),
    );
    const breaking = {
      ...compatible,
      version: "1.2.0",
      resourceTypes: [],
    } satisfies SchemaPackageManifest;
    expect(() =>
      registry.publishGoverned(
        publication(breaking, "breaking", "publish-3"),
      ),
    ).toThrow(/new major version/);
  });

  it("generates stable app-specific types with explicit unknown-field preservation", () => {
    const first = generateTypeScriptTypes(manifest);
    const second = generateTypeScriptTypes({
      ...manifest,
      resourceTypes: [...manifest.resourceTypes].reverse(),
    });
    expect(first).toEqual(second);
    expect(first.source).toContain("export interface Note");
    expect(first.source).toContain(
      "readonly [field: string]: unknown;",
    );
    expect(first.source).toContain(
      'readonly "createdAt": string;',
    );
  });
});

function publication(
  value: SchemaPackageManifest,
  expectedCompatibility: GovernedPublicationRequest["expectedCompatibility"],
  idempotencyKey = "publish-1",
): GovernedPublicationRequest {
  return {
    manifest: value,
    application: {
      protocolVersion: "TCAP/1.0",
      namespace: `${value.namespace}/${value.name}`,
      applicationVersion: "1.0.0",
      schemaPackage: {
        key: `${value.namespace}/${value.name}/${value.version}`,
        version: value.version,
        resourceTypes: value.resourceTypes.map(({ name }) => name),
        relationTypes: value.relationships.map(({ type }) => type),
        additionalFields: "preserve",
      },
    },
    approval: {
      approvedBy: "admin:release",
      approvalId: `approval-${idempotencyKey}`,
    },
    idempotencyKey,
    expectedCompatibility,
  };
}
