export type FieldKind = "string" | "number" | "boolean" | "timestamp" | "object" | "array";

export interface FieldDefinition {
  readonly kind: FieldKind;
  readonly required?: boolean;
  readonly format?: "uri" | "sha256" | "media-type";
  readonly description?: string;
}

export interface ResourceTypeDefinition {
  readonly name: string;
  readonly description: string;
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  readonly additionalFields: "preserve" | "reject";
}

export interface RelationshipDefinition {
  readonly type: string;
  readonly sourceTypes: readonly string[];
  readonly targetTypes: readonly string[];
  readonly cardinality: "one-to-one" | "one-to-many" | "many-to-many";
}

export interface SchemaPackageManifest {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly classification: "system" | "application";
  readonly resourceTypes: readonly ResourceTypeDefinition[];
  readonly relationships: readonly RelationshipDefinition[];
  readonly compatibleArchiveFormat: string;
}

export interface PublishedSchemaPackage {
  readonly id: string;
  readonly key: string;
  readonly digest: string;
  readonly status: "active" | "deprecated" | "revoked";
  readonly publishedAt: string;
  readonly manifest: SchemaPackageManifest;
}

export interface ValidationIssue {
  readonly path: string;
  readonly code: "unknown_resource_type" | "missing_required_field" | "invalid_field_type" | "invalid_format" | "unknown_field";
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly preservedUnknownFields: readonly string[];
}
