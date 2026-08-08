import type {
  GovernedPublicationRequest,
  SchemaPackageManifest,
} from "@trust-core/schema-registry";

const commonFields = {
  createdAt: { kind: "timestamp", required: true, description: "Original creation time" },
  modifiedAt: { kind: "timestamp", required: true, description: "Last app-level modification time" },
} as const;

export const ivansDiarySchema: SchemaPackageManifest = {
  namespace: "app",
  name: "ivans-diary",
  version: "1.0.0",
  title: "Ivan’s Diary",
  description: "Portable diary, journal page and multipage sketchbook data.",
  classification: "application",
  compatibleArchiveFormat: "trust-core-archive/1.0.0",
  resourceTypes: [
    { name: "Diary", description: "A chronological journal container", additionalFields: "preserve", fields: { ...commonFields, title: { kind: "string", required: true } } },
    { name: "Entry", description: "A dated diary entry", additionalFields: "preserve", fields: { ...commonFields, entryDate: { kind: "timestamp", required: true }, title: { kind: "string", required: true }, favourite: { kind: "boolean" } } },
    { name: "JournalPage", description: "One ordered diary page", additionalFields: "preserve", fields: { ...commonFields, pageNumber: { kind: "number", required: true }, title: { kind: "string" } } },
    { name: "Sketchbook", description: "An ordered multipage sketchbook", additionalFields: "preserve", fields: { ...commonFields, title: { kind: "string", required: true } } },
    { name: "SketchPage", description: "One ordered drawing surface", additionalFields: "preserve", fields: { ...commonFields, pageNumber: { kind: "number", required: true }, canvasWidth: { kind: "number", required: true }, canvasHeight: { kind: "number", required: true } } },
    { name: "TextBlock", description: "Typed or transcribed text", additionalFields: "preserve", fields: { ...commonFields, text: { kind: "string", required: true }, source: { kind: "string", required: true } } },
    { name: "Drawing", description: "Apple Pencil or pointer stroke document", additionalFields: "preserve", fields: { ...commonFields, blobSha256: { kind: "string", required: true, format: "sha256" }, mediaType: { kind: "string", required: true, format: "media-type" } } },
    { name: "Photo", description: "Original photographic attachment", additionalFields: "preserve", fields: { ...commonFields, blobSha256: { kind: "string", required: true, format: "sha256" }, mediaType: { kind: "string", required: true, format: "media-type" }, caption: { kind: "string" } } },
    { name: "Audio", description: "Original voice recording", additionalFields: "preserve", fields: { ...commonFields, blobSha256: { kind: "string", required: true, format: "sha256" }, mediaType: { kind: "string", required: true, format: "media-type" }, durationSeconds: { kind: "number", required: true } } },
    { name: "Bookmark", description: "Named reference to another resource", additionalFields: "preserve", fields: { ...commonFields, label: { kind: "string", required: true } } },
  ],
  relationships: [
    { type: "contains", sourceTypes: ["Diary"], targetTypes: ["Entry"], cardinality: "one-to-many" },
    { type: "contains", sourceTypes: ["Entry"], targetTypes: ["JournalPage", "SketchPage", "TextBlock", "Drawing", "Photo", "Audio"], cardinality: "one-to-many" },
    { type: "contains", sourceTypes: ["Sketchbook"], targetTypes: ["SketchPage"], cardinality: "one-to-many" },
    { type: "references", sourceTypes: ["Bookmark"], targetTypes: ["Entry", "JournalPage", "SketchPage"], cardinality: "many-to-many" },
  ],
};

export function createIvansDiaryPublicationRequest(
  approval: GovernedPublicationRequest["approval"],
  idempotencyKey: string,
): GovernedPublicationRequest {
  return {
    manifest: ivansDiarySchema,
    application: {
      protocolVersion: "TCAP/1.0",
      namespace: "app/ivans-diary",
      applicationVersion: "1.0.0",
      schemaPackage: {
        key: "app/ivans-diary/1.0.0",
        version: "1.0.0",
        resourceTypes: ivansDiarySchema.resourceTypes.map(({ name }) => name),
        relationTypes: ivansDiarySchema.relationships.map(({ type }) => type),
        additionalFields: "preserve",
      },
    },
    approval,
    idempotencyKey,
    expectedCompatibility: "initial",
  };
}
