import type {
  CompatibilityChange,
  CompatibilityReport,
  FieldDefinition,
  RelationshipDefinition,
  ResourceTypeDefinition,
  SchemaPackageManifest,
} from "./types.js";

export function classifyCompatibility(
  previous: SchemaPackageManifest | undefined,
  next: SchemaPackageManifest,
): CompatibilityReport {
  if (!previous)
    return { classification: "initial", previousKey: null, changes: [] };
  if (
    previous.namespace !== next.namespace ||
    previous.name !== next.name
  )
    throw new Error("Compatibility requires the same schema package identity.");

  const changes: CompatibilityChange[] = [];
  compareResourceTypes(previous.resourceTypes, next.resourceTypes, changes);
  compareRelationships(previous.relationships, next.relationships, changes);
  if (previous.compatibleArchiveFormat !== next.compatibleArchiveFormat)
    changed(
      changes,
      "compatibleArchiveFormat",
      true,
      "Compatible archive format changed.",
    );
  return {
    classification: changes.some(({ breaking }) => breaking)
      ? "breaking"
      : "backward-compatible",
    previousKey: schemaKey(previous),
    changes,
  };
}

export function assertVersionMatchesCompatibility(
  previous: SchemaPackageManifest | undefined,
  next: SchemaPackageManifest,
  report: CompatibilityReport,
): void {
  if (!previous) return;
  const previousVersion = parseVersion(previous.version);
  const nextVersion = parseVersion(next.version);
  if (compareVersion(nextVersion, previousVersion) <= 0)
    throw new Error("Published schema versions must increase.");
  if (
    report.classification === "breaking" &&
    nextVersion.major <= previousVersion.major
  )
    throw new Error("Breaking schema changes require a new major version.");
  if (
    report.classification === "backward-compatible" &&
    nextVersion.major !== previousVersion.major
  )
    throw new Error(
      "Backward-compatible schema changes must remain in the current major version.",
    );
}

function compareResourceTypes(
  previous: readonly ResourceTypeDefinition[],
  next: readonly ResourceTypeDefinition[],
  changes: CompatibilityChange[],
): void {
  const previousByName = new Map(previous.map((value) => [value.name, value]));
  const nextByName = new Map(next.map((value) => [value.name, value]));
  for (const [name, before] of previousByName) {
    const after = nextByName.get(name);
    if (!after) {
      removed(changes, `resourceTypes.${name}`, "Resource type was removed.");
      continue;
    }
    if (
      before.additionalFields === "preserve" &&
      after.additionalFields === "reject"
    )
      changed(
        changes,
        `resourceTypes.${name}.additionalFields`,
        true,
        "Unknown fields are no longer preserved.",
      );
    compareFields(name, before.fields, after.fields, changes);
  }
  for (const name of nextByName.keys())
    if (!previousByName.has(name))
      added(changes, `resourceTypes.${name}`, "Resource type was added.");
}

function compareFields(
  resourceName: string,
  previous: Readonly<Record<string, FieldDefinition>>,
  next: Readonly<Record<string, FieldDefinition>>,
  changes: CompatibilityChange[],
): void {
  for (const [name, before] of Object.entries(previous)) {
    const path = `resourceTypes.${resourceName}.fields.${name}`;
    const after = next[name];
    if (!after) {
      removed(changes, path, "Field was removed.");
      continue;
    }
    if (before.kind !== after.kind || before.format !== after.format)
      changed(changes, path, true, "Field type or format changed.");
    if (!before.required && after.required)
      changed(changes, `${path}.required`, true, "Field became required.");
  }
  for (const [name, field] of Object.entries(next)) {
    if (previous[name]) continue;
    const path = `resourceTypes.${resourceName}.fields.${name}`;
    if (field.required)
      added(changes, path, "Required field was added.", true);
    else added(changes, path, "Optional field was added.");
  }
}

function compareRelationships(
  previous: readonly RelationshipDefinition[],
  next: readonly RelationshipDefinition[],
  changes: CompatibilityChange[],
): void {
  const key = (value: RelationshipDefinition) =>
    `${value.type}:${[...value.sourceTypes].sort().join(",")}:${[
      ...value.targetTypes,
    ]
      .sort()
      .join(",")}:${value.cardinality}`;
  const previousKeys = new Set(previous.map(key));
  const nextKeys = new Set(next.map(key));
  for (const relation of previous)
    if (!nextKeys.has(key(relation)))
      removed(
        changes,
        `relationships.${relation.type}`,
        "Relationship constraint was removed or changed.",
      );
  for (const relation of next)
    if (!previousKeys.has(key(relation)))
      added(
        changes,
        `relationships.${relation.type}`,
        "Relationship constraint was added.",
      );
}

function schemaKey(manifest: SchemaPackageManifest): string {
  return `${manifest.namespace}/${manifest.name}/${manifest.version}`;
}

function parseVersion(value: string): {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
} {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersion(
  left: ReturnType<typeof parseVersion>,
  right: ReturnType<typeof parseVersion>,
): number {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

function added(
  changes: CompatibilityChange[],
  path: string,
  message: string,
  breaking = false,
): void {
  changes.push({ path, kind: "added", breaking, message });
}

function removed(
  changes: CompatibilityChange[],
  path: string,
  message: string,
): void {
  changes.push({ path, kind: "removed", breaking: true, message });
}

function changed(
  changes: CompatibilityChange[],
  path: string,
  breaking: boolean,
  message: string,
): void {
  changes.push({ path, kind: "changed", breaking, message });
}
