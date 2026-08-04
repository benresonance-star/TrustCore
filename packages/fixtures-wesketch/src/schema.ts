import type { SchemaPackageManifest } from "@trust-core/schema-registry";

const commonFields = {
  createdAt: {
    kind: "timestamp",
    required: true,
    description: "Original creation time",
  },
  modifiedAt: {
    kind: "timestamp",
    required: true,
    description: "Last application modification time",
  },
} as const;

export const weSketchSchema: SchemaPackageManifest = {
  namespace: "app",
  name: "wesketch",
  version: "1.0.0",
  title: "WeSketch",
  description:
    "Portable collaborative canvas and creative-generation provenance.",
  classification: "application",
  compatibleArchiveFormat: "trust-core-archive/1.0.0",
  resourceTypes: [
    {
      name: "Project",
      description: "Creative project container",
      additionalFields: "reject",
      fields: { ...commonFields, name: { kind: "string", required: true } },
    },
    {
      name: "Canvas",
      description: "Versioned compositing surface",
      additionalFields: "reject",
      fields: {
        ...commonFields,
        width: { kind: "number", required: true },
        height: { kind: "number", required: true },
        background: { kind: "string", required: true },
        layerOrder: { kind: "array", required: true },
      },
    },
    {
      name: "Layer",
      description: "Destination or source canvas layer",
      additionalFields: "reject",
      fields: {
        ...commonFields,
        name: { kind: "string", required: true },
        layerKind: { kind: "string", required: true },
        opacity: { kind: "number", required: true },
        blendMode: { kind: "string", required: true },
      },
    },
    {
      name: "SelectionMask",
      description: "Selection bounds and referenced mask raster",
      additionalFields: "reject",
      fields: {
        ...commonFields,
        bounds: { kind: "object", required: true },
        featherPixels: { kind: "number", required: true },
        blobSha256: { kind: "string", required: true, format: "sha256" },
      },
    },
    {
      name: "GenerationRequest",
      description: "Prompt and immutable generation settings",
      additionalFields: "reject",
      fields: {
        ...commonFields,
        prompt: { kind: "string", required: true },
        negativePrompt: { kind: "string", required: true },
        settings: { kind: "object", required: true },
        model: { kind: "string", required: true },
        requestSeed: { kind: "number", required: true },
      },
    },
    {
      name: "GeneratedImage",
      description: "Generated visual output with a referenced canonical blob",
      additionalFields: "reject",
      fields: {
        ...commonFields,
        blobSha256: { kind: "string", required: true, format: "sha256" },
        mediaType: { kind: "string", required: true, format: "media-type" },
        width: { kind: "number", required: true },
        height: { kind: "number", required: true },
        generationStatus: { kind: "string", required: true },
      },
    },
    {
      name: "Placement",
      description: "Transform placing generated content on a destination layer",
      additionalFields: "reject",
      fields: {
        ...commonFields,
        transform: { kind: "object", required: true },
        compositeMode: { kind: "string", required: true },
      },
    },
    {
      name: "ConversationTurn",
      description: "Creative assistant conversation turn",
      additionalFields: "reject",
      fields: {
        ...commonFields,
        role: { kind: "string", required: true },
        text: { kind: "string", required: true },
        sequence: { kind: "number", required: true },
      },
    },
    {
      name: "StrokeDocument",
      description: "Referenced vector stroke guidance",
      additionalFields: "reject",
      fields: {
        ...commonFields,
        blobSha256: { kind: "string", required: true, format: "sha256" },
        mediaType: { kind: "string", required: true, format: "media-type" },
        strokeCount: { kind: "number", required: true },
      },
    },
  ],
  relationships: [
    {
      type: "contains",
      sourceTypes: ["Project"],
      targetTypes: ["Canvas", "ConversationTurn"],
      cardinality: "one-to-many",
    },
    {
      type: "contains",
      sourceTypes: ["Canvas"],
      targetTypes: ["Layer", "SelectionMask"],
      cardinality: "one-to-many",
    },
    {
      type: "drawn_on",
      sourceTypes: ["StrokeDocument"],
      targetTypes: ["Layer"],
      cardinality: "many-to-many",
    },
    {
      type: "initiates",
      sourceTypes: ["ConversationTurn"],
      targetTypes: ["GenerationRequest"],
      cardinality: "one-to-many",
    },
    {
      type: "uses_selection",
      sourceTypes: ["GenerationRequest"],
      targetTypes: ["SelectionMask"],
      cardinality: "many-to-many",
    },
    {
      type: "uses_guidance",
      sourceTypes: ["GenerationRequest"],
      targetTypes: ["StrokeDocument"],
      cardinality: "many-to-many",
    },
    {
      type: "uses_canvas_revision",
      sourceTypes: ["GenerationRequest"],
      targetTypes: ["Canvas"],
      cardinality: "many-to-many",
    },
    {
      type: "produces",
      sourceTypes: ["GenerationRequest"],
      targetTypes: ["GeneratedImage"],
      cardinality: "one-to-many",
    },
    {
      type: "placed_by",
      sourceTypes: ["GeneratedImage"],
      targetTypes: ["Placement"],
      cardinality: "one-to-one",
    },
    {
      type: "targets_layer",
      sourceTypes: ["Placement"],
      targetTypes: ["Layer"],
      cardinality: "many-to-many",
    },
    {
      type: "results_in",
      sourceTypes: ["Placement"],
      targetTypes: ["Canvas"],
      cardinality: "one-to-one",
    },
    {
      type: "derived_from",
      sourceTypes: ["Canvas"],
      targetTypes: ["Canvas"],
      cardinality: "many-to-many",
    },
  ],
};
