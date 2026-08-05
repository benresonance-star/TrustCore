import { createHash } from "node:crypto";
import type {
  BlobObject,
  Dataset,
  Relation,
  Resource,
  Revision,
  Tombstone,
  Workspace,
} from "@trust-core/core";

const at = "2026-08-04T10:00:00.000Z";
const completedAt = "2026-08-04T10:00:08.000Z";
const workspaceId = "workspace-demo-wesketch";
const datasetId = "dataset-demo-wesketch-001";
const schemaPackageId = "schema-placeholder:app/wesketch/1.0.0";
const actorId = "user-demo-mira";
const encoder = new TextEncoder();

const maskBytes = encoder.encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><ellipse cx="256" cy="278" rx="190" ry="128" fill="white"/></svg>',
);
const generatedBytes = encoder.encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#12324a"/><path d="M120 650 Q512 260 904 650" fill="#efb366"/></svg>',
);
const rejectedBytes = encoder.encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#402030"/><circle cx="512" cy="512" r="280" fill="#d88"/></svg>',
);
const strokeBytes = encoder.encode(
  '{"version":1,"strokes":[{"points":[[120,650],[512,260],[904,650]],"brush":"graphite","width":18}]}',
);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function payloadHash(payload: Readonly<Record<string, unknown>>): string {
  return sha256(JSON.stringify(payload));
}

export interface FixtureRevisionBlob {
  readonly id: string;
  readonly workspaceId: string;
  readonly revisionId: string;
  readonly blobObjectId: string;
  readonly role: string;
  readonly logicalName: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface FixtureBlobContent {
  readonly blobObjectId: string;
  readonly bytes: Uint8Array;
}

export interface WeSketchFixture {
  readonly classification: "synthetic-demo";
  readonly workspace: Workspace;
  readonly dataset: Dataset;
  readonly resources: readonly Resource[];
  readonly revisions: readonly Revision[];
  readonly blobs: readonly BlobObject[];
  readonly revisionBlobs: readonly FixtureRevisionBlob[];
  readonly blobContents: readonly FixtureBlobContent[];
  readonly relations: readonly Relation[];
  readonly tombstones: readonly Tombstone[];
}

interface ResourceDefinition {
  readonly id: string;
  readonly resourceType: string;
  readonly title: string;
  readonly status?: Resource["status"];
  readonly payload: Readonly<Record<string, unknown>>;
}

export function createWeSketchFixture(): WeSketchFixture {
  const maskSha256 = sha256(maskBytes);
  const generatedSha256 = sha256(generatedBytes);
  const rejectedSha256 = sha256(rejectedBytes);
  const strokeSha256 = sha256(strokeBytes);
  const definitions: readonly ResourceDefinition[] = [
    {
      id: "project-sunrise-campaign",
      resourceType: "Project",
      title: "Sunrise Campaign",
      payload: {
        name: "Sunrise Campaign",
        createdAt: at,
        modifiedAt: completedAt,
      },
    },
    {
      id: "canvas-hero",
      resourceType: "Canvas",
      title: "Hero concept",
      payload: {
        width: 2048,
        height: 1536,
        background: "#f4efe7",
        layerOrder: ["layer-sketch", "layer-generated"],
        createdAt: at,
        modifiedAt: at,
      },
    },
    {
      id: "layer-sketch",
      resourceType: "Layer",
      title: "Graphite guide",
      payload: {
        name: "Graphite guide",
        layerKind: "vector",
        opacity: 0.72,
        blendMode: "multiply",
        createdAt: at,
        modifiedAt: at,
      },
    },
    {
      id: "layer-generated",
      resourceType: "Layer",
      title: "Generated sunrise",
      payload: {
        name: "Generated sunrise",
        layerKind: "raster",
        opacity: 1,
        blendMode: "normal",
        createdAt: at,
        modifiedAt: completedAt,
      },
    },
    {
      id: "selection-horizon",
      resourceType: "SelectionMask",
      title: "Horizon selection",
      payload: {
        bounds: { x: 320, y: 180, width: 1408, height: 980 },
        featherPixels: 24,
        blobSha256: maskSha256,
        createdAt: at,
        modifiedAt: at,
      },
    },
    {
      id: "generation-sunrise-001",
      resourceType: "GenerationRequest",
      title: "Warm geometric sunrise",
      payload: {
        prompt:
          "A warm geometric sunrise emerging behind a graphite mountain arc",
        negativePrompt: "text, logos, photorealistic clouds",
        settings: {
          width: 1024,
          height: 1024,
          steps: 28,
          guidanceScale: 6.5,
          sampler: "dpmpp-2m",
        },
        model: "synthetic-demo-image-model/1",
        requestSeed: 184729,
        createdAt: at,
        modifiedAt: completedAt,
      },
    },
    {
      id: "generated-sunrise-001",
      resourceType: "GeneratedImage",
      title: "Selected sunrise output",
      payload: {
        blobSha256: generatedSha256,
        mediaType: "image/svg+xml",
        width: 1024,
        height: 1024,
        generationStatus: "selected",
        createdAt: completedAt,
        modifiedAt: completedAt,
      },
    },
    {
      id: "generated-sunrise-rejected",
      resourceType: "GeneratedImage",
      title: "Rejected sunrise variation",
      status: "deleted_logically",
      payload: {
        blobSha256: rejectedSha256,
        mediaType: "image/svg+xml",
        width: 1024,
        height: 1024,
        generationStatus: "rejected",
        createdAt: completedAt,
        modifiedAt: completedAt,
      },
    },
    {
      id: "placement-sunrise-001",
      resourceType: "Placement",
      title: "Sunrise placement",
      payload: {
        transform: {
          translateX: 384,
          translateY: 220,
          scaleX: 1.25,
          scaleY: 1.25,
          rotationDegrees: 0,
        },
        compositeMode: "source-over",
        createdAt: completedAt,
        modifiedAt: completedAt,
      },
    },
    {
      id: "turn-sunrise-001",
      resourceType: "ConversationTurn",
      title: "Generate sunrise request",
      payload: {
        role: "user",
        text: "Fill my horizon selection with a warm geometric sunrise and preserve the pencil arc.",
        sequence: 4,
        createdAt: at,
        modifiedAt: at,
      },
    },
    {
      id: "strokes-mountain-guide",
      resourceType: "StrokeDocument",
      title: "Mountain arc guidance",
      payload: {
        blobSha256: strokeSha256,
        mediaType: "application/vnd.wesketch.strokes+json",
        strokeCount: 1,
        createdAt: at,
        modifiedAt: at,
      },
    },
  ];

  const resources: Resource[] = definitions.map(
    ({ id, resourceType, title, status = "active" }) => ({
      id,
      workspaceId,
      datasetId,
      resourceType,
      title,
      status,
      currentRevisionId:
        id === "canvas-hero" ? "revision-canvas-hero-2" : `revision-${id}-1`,
      createdBy: actorId,
      createdAt: at,
      updatedAt: id === "canvas-hero" ? completedAt : at,
    }),
  );
  const revisions: Revision[] = definitions.map(({ id, payload }) =>
    revision(id, 1, payload, null, at),
  );
  const resultingCanvasPayload = {
    width: 2048,
    height: 1536,
    background: "#f4efe7",
    layerOrder: ["layer-sketch", "layer-generated"],
    createdAt: at,
    modifiedAt: completedAt,
  };
  revisions.push(
    revision(
      "canvas-hero",
      2,
      resultingCanvasPayload,
      "revision-canvas-hero-1",
      completedAt,
    ),
  );

  const blobDefinitions = [
    [
      "blob-selection-mask",
      maskBytes,
      "image/svg+xml",
      "fixtures/wesketch/selection-horizon.svg",
    ],
    [
      "blob-generated-sunrise",
      generatedBytes,
      "image/svg+xml",
      "fixtures/wesketch/generated-sunrise.svg",
    ],
    [
      "blob-generated-rejected",
      rejectedBytes,
      "image/svg+xml",
      "fixtures/wesketch/generated-sunrise-rejected.svg",
    ],
    [
      "blob-stroke-document",
      strokeBytes,
      "application/vnd.wesketch.strokes+json",
      "fixtures/wesketch/mountain-guide.json",
    ],
  ] as const;
  const blobs: BlobObject[] = blobDefinitions.map(
    ([id, bytes, mediaType, storageKey]) => ({
      id,
      workspaceId,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
      mediaType,
      storageProvider: "minio",
      storageKey,
      encryptionState: "provider_managed",
      encryptionKeyRef: null,
      verificationState: "pending",
      createdAt: at,
    }),
  );
  const blobContents: FixtureBlobContent[] = blobDefinitions.map(
    ([blobObjectId, bytes]) => ({ blobObjectId, bytes }),
  );
  const revisionBlobs: FixtureRevisionBlob[] = [
    attachment(
      "attachment-selection-mask",
      "revision-selection-horizon-1",
      "blob-selection-mask",
      "selection-mask",
      "selection-horizon.svg",
    ),
    attachment(
      "attachment-generated-sunrise",
      "revision-generated-sunrise-001-1",
      "blob-generated-sunrise",
      "primary",
      "generated-sunrise.svg",
    ),
    attachment(
      "attachment-generated-rejected",
      "revision-generated-sunrise-rejected-1",
      "blob-generated-rejected",
      "primary",
      "generated-sunrise-rejected.svg",
    ),
    attachment(
      "attachment-stroke-document",
      "revision-strokes-mountain-guide-1",
      "blob-stroke-document",
      "stroke-document",
      "mountain-guide.json",
    ),
  ];

  const relations = [
    relation(
      "rel-project-canvas",
      "resource",
      "project-sunrise-campaign",
      "resource",
      "canvas-hero",
      "contains",
    ),
    relation(
      "rel-project-turn",
      "resource",
      "project-sunrise-campaign",
      "resource",
      "turn-sunrise-001",
      "contains",
    ),
    relation(
      "rel-canvas-sketch-layer",
      "resource",
      "canvas-hero",
      "resource",
      "layer-sketch",
      "contains",
    ),
    relation(
      "rel-canvas-generated-layer",
      "resource",
      "canvas-hero",
      "resource",
      "layer-generated",
      "contains",
    ),
    relation(
      "rel-canvas-selection",
      "resource",
      "canvas-hero",
      "resource",
      "selection-horizon",
      "contains",
    ),
    relation(
      "rel-strokes-layer",
      "resource",
      "strokes-mountain-guide",
      "resource",
      "layer-sketch",
      "drawn_on",
    ),
    relation(
      "rel-turn-generation",
      "resource",
      "turn-sunrise-001",
      "resource",
      "generation-sunrise-001",
      "initiates",
    ),
    relation(
      "rel-generation-selection",
      "resource",
      "generation-sunrise-001",
      "resource",
      "selection-horizon",
      "uses_selection",
    ),
    relation(
      "rel-generation-guidance",
      "resource",
      "generation-sunrise-001",
      "resource",
      "strokes-mountain-guide",
      "uses_guidance",
    ),
    relation(
      "rel-generation-input-revision",
      "resource",
      "generation-sunrise-001",
      "revision",
      "revision-canvas-hero-1",
      "uses_canvas_revision",
    ),
    relation(
      "rel-generation-output",
      "resource",
      "generation-sunrise-001",
      "resource",
      "generated-sunrise-001",
      "produces",
    ),
    relation(
      "rel-generation-rejected-output",
      "resource",
      "generation-sunrise-001",
      "resource",
      "generated-sunrise-rejected",
      "produces",
    ),
    relation(
      "rel-image-placement",
      "resource",
      "generated-sunrise-001",
      "resource",
      "placement-sunrise-001",
      "placed_by",
    ),
    relation(
      "rel-placement-layer",
      "resource",
      "placement-sunrise-001",
      "resource",
      "layer-generated",
      "targets_layer",
    ),
    relation(
      "rel-placement-result",
      "resource",
      "placement-sunrise-001",
      "revision",
      "revision-canvas-hero-2",
      "results_in",
    ),
    relation(
      "rel-result-parent",
      "revision",
      "revision-canvas-hero-2",
      "revision",
      "revision-canvas-hero-1",
      "derived_from",
    ),
  ];

  return {
    classification: "synthetic-demo",
    workspace: {
      id: workspaceId,
      name: "WeSketch Synthetic Demo",
      slug: "wesketch-synthetic-demo",
      status: "active",
      createdAt: at,
      updatedAt: completedAt,
    },
    dataset: {
      id: datasetId,
      workspaceId,
      schemaPackageId,
      datasetType: "wesketch-project",
      name: "Sunrise Campaign Provenance",
      status: "active",
      retentionPolicyId: null,
      createdBy: actorId,
      createdAt: at,
      updatedAt: completedAt,
    },
    resources,
    revisions,
    blobs,
    revisionBlobs,
    blobContents,
    relations,
    tombstones: [
      {
        id: "tombstone-generated-rejected",
        workspaceId,
        datasetId,
        subjectKind: "resource",
        subjectId: "generated-sunrise-rejected",
        deletedBy: actorId,
        deletedAt: "2026-08-04T10:05:00.000Z",
        recoverUntil: "2026-11-02T10:05:00.000Z",
        priorRevisionId: "revision-generated-sunrise-rejected-1",
        purgeState: "not_eligible",
      },
    ],
  };
}

function revision(
  resourceId: string,
  revisionNumber: number,
  canonicalPayload: Readonly<Record<string, unknown>>,
  parentRevisionId: string | null,
  createdAt: string,
): Revision {
  return {
    id: `revision-${resourceId}-${revisionNumber}`,
    workspaceId,
    datasetId,
    resourceId,
    revisionNumber,
    parentRevisionId,
    mergeParentRevisionIds: [],
    schemaPackageId,
    schemaVersion: "1.0.0",
    canonicalPayload,
    canonicalPayloadHash: payloadHash(canonicalPayload),
    createdBy: actorId,
    createdOnDeviceId: "device-demo-wesketch-tablet",
    source: "application",
    changeNote:
      revisionNumber === 1
        ? "Synthetic WeSketch fixture seed"
        : "Placed generated sunrise on destination layer",
    restoredFromRevisionId: null,
    createdAt,
  };
}

function attachment(
  id: string,
  revisionId: string,
  blobObjectId: string,
  role: string,
  logicalName: string,
): FixtureRevisionBlob {
  return {
    id,
    workspaceId,
    revisionId,
    blobObjectId,
    role,
    logicalName,
    metadata: { classification: "synthetic-demo" },
    createdAt: at,
  };
}

function relation(
  id: string,
  sourceKind: Relation["sourceKind"],
  sourceId: string,
  targetKind: Relation["targetKind"],
  targetId: string,
  relationType: string,
): Relation {
  return {
    id,
    workspaceId,
    datasetId,
    sourceKind,
    sourceId,
    targetKind,
    targetId,
    relationType,
    metadata: { provenance: true },
    createdBy: actorId,
    createdAt: completedAt,
    endedAt: null,
  };
}
