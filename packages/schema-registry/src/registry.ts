import { schemaDigest } from "./canonical.js";
import type { PublishedSchemaPackage, SchemaPackageManifest } from "./types.js";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export class SchemaRegistry {
  readonly #packages = new Map<string, PublishedSchemaPackage>();

  publish(manifest: SchemaPackageManifest, publishedAt = new Date().toISOString()): PublishedSchemaPackage {
    if (!SEMVER.test(manifest.version)) throw new Error(`Invalid semantic version: ${manifest.version}`);
    const key = `${manifest.namespace}/${manifest.name}/${manifest.version}`;
    if (this.#packages.has(key)) throw new Error(`Schema version already published: ${key}`);
    assertManifestReferences(manifest);
    const digest = schemaDigest(manifest);
    const published = Object.freeze({
      id: `schema:${digest}`,
      key,
      digest,
      status: "active" as const,
      publishedAt,
      manifest: structuredClone(manifest),
    });
    this.#packages.set(key, published);
    return published;
  }

  get(key: string): PublishedSchemaPackage | undefined {
    const value = this.#packages.get(key);
    return value ? structuredClone(value) : undefined;
  }

  list(): readonly PublishedSchemaPackage[] {
    return [...this.#packages.values()].map((item) => structuredClone(item));
  }
}

function assertManifestReferences(manifest: SchemaPackageManifest): void {
  const names = new Set(manifest.resourceTypes.map((item) => item.name));
  if (names.size !== manifest.resourceTypes.length) throw new Error("Resource type names must be unique");
  for (const relation of manifest.relationships) {
    for (const type of [...relation.sourceTypes, ...relation.targetTypes]) {
      if (!names.has(type)) throw new Error(`Relationship ${relation.type} references unknown resource type ${type}`);
    }
  }
}
