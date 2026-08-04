import type { FieldDefinition, ResourceTypeDefinition, SchemaPackageManifest, ValidationIssue, ValidationResult } from "./types.js";

export function validateResourcePayload(manifest: SchemaPackageManifest, resourceType: string, payload: Readonly<Record<string, unknown>>): ValidationResult {
  const definition = manifest.resourceTypes.find((item) => item.name === resourceType);
  if (!definition) return result([{ path: "$", code: "unknown_resource_type", message: `Unknown resource type: ${resourceType}` }], []);
  const issues: ValidationIssue[] = [];
  const preserved: string[] = [];
  for (const [name, field] of Object.entries(definition.fields)) {
    const value = payload[name];
    if (value === undefined) {
      if (field.required) issues.push({ path: `$.${name}`, code: "missing_required_field", message: `${name} is required` });
      continue;
    }
    if (!matchesKind(value, field.kind)) issues.push({ path: `$.${name}`, code: "invalid_field_type", message: `${name} must be ${field.kind}` });
    else if (!matchesFormat(value, field)) issues.push({ path: `$.${name}`, code: "invalid_format", message: `${name} does not match ${field.format}` });
  }
  for (const name of Object.keys(payload)) {
    if (definition.fields[name]) continue;
    if (definition.additionalFields === "preserve") preserved.push(`$.${name}`);
    else issues.push({ path: `$.${name}`, code: "unknown_field", message: `${name} is not allowed` });
  }
  return result(issues, preserved);
}

function result(issues: ValidationIssue[], preservedUnknownFields: string[]): ValidationResult {
  return { valid: issues.length === 0, issues, preservedUnknownFields };
}

function matchesKind(value: unknown, kind: FieldDefinition["kind"]): boolean {
  if (kind === "array") return Array.isArray(value);
  if (kind === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (kind === "timestamp") return typeof value === "string" && !Number.isNaN(Date.parse(value));
  return typeof value === kind;
}

function matchesFormat(value: unknown, field: FieldDefinition): boolean {
  if (!field.format || typeof value !== "string") return true;
  if (field.format === "sha256") return /^[a-f0-9]{64}$/.test(value);
  if (field.format === "media-type") return /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(value);
  try { new URL(value); return true; } catch { return false; }
}
