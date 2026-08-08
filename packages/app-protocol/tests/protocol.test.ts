import { describe, expect, it } from "vitest";
import {
  createAppProtocolBundle,
  validateAppProtocolManifest,
} from "../src/index.js";

const input = {
  namespace: "app/wesketch",
  name: "WeSketch",
  applicationVersion: "1.4.0",
  schemaVersion: "1.4.0",
  resourceTypes: ["Canvas", "Layer", "Prompt"],
  relationTypes: ["contains", "generated-from"],
  blobRoles: ["source", "mask", "generated-image"],
  capabilities: [
    "dataset:read",
    "resource:read",
    "revision:create",
    "object:ingest",
  ] as const,
};

describe("TCAP/1 application protocol", () => {
  it("generates a deterministic manifest, method map and agent brief", () => {
    const first = createAppProtocolBundle(input);
    const second = createAppProtocolBundle(input);
    expect(first).toEqual(second);
    expect(validateAppProtocolManifest(first.manifest)).toEqual([]);
    expect(first.methods.map((method) => method.sdk)).toContain(
      "client.revisions.create(resourceId, command)",
    );
    expect(first.methods.map((method) => method.sdk)).toContain(
      "client.uploads.getScanStatus(uploadId)",
    );
    expect(first.methods.map((method) => method.http)).toContain(
      "GET /v1/uploads/{uploadId}/scan-status",
    );
    expect(first.agentBrief).toContain("Do not access Trust Core PostgreSQL");
  });

  it("rejects invalid namespaces, versions and domain tokens", () => {
    expect(() =>
      createAppProtocolBundle({
        ...input,
        namespace: "We Sketch",
        schemaVersion: "latest",
        resourceTypes: ["canvas"],
      }),
    ).toThrow(/namespace.*schemaPackage.version.*UpperCamelCase/s);
  });
});
