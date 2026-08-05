import type { Dataset, Relation, Resource, Revision, Tombstone, Workspace } from "@trust-core/core";
import { createHash } from "node:crypto";

const at = "2026-08-04T09:00:00.000Z";
const workspaceId = "workspace-demo-ivan";
const datasetId = "dataset-demo-ivan-001";
const schemaPackageId = "schema-placeholder:app/ivans-diary/1.0.0";
const actorId = "user-demo-ivan";

function payloadHash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

export interface IvansDiaryFixture {
  readonly classification: "synthetic-demo";
  readonly workspace: Workspace;
  readonly dataset: Dataset;
  readonly resources: readonly Resource[];
  readonly revisions: readonly Revision[];
  readonly relations: readonly Relation[];
  readonly tombstones: readonly Tombstone[];
}

export function createIvansDiaryFixture(): IvansDiaryFixture {
  const definitions = [
    ["diary-main", "Diary", "Ivan’s Demo Diary", { title: "Ivan’s Demo Diary", createdAt: at, modifiedAt: at }],
    ["entry-hospital", "Entry", "Hospital Visit", { entryDate: "2026-08-03T10:30:00.000Z", title: "Hospital Visit", favourite: true, createdAt: at, modifiedAt: at }],
    ["page-hospital-1", "JournalPage", "Hospital Visit · page 1", { pageNumber: 1, title: "Hospital Visit", createdAt: at, modifiedAt: at }],
    ["text-hospital-1", "TextBlock", "Voice transcription", { text: "Today I drew the boat I remembered from the waiting room.", source: "voice-transcription", createdAt: at, modifiedAt: at, transcriptionConfidence: 0.91 }],
    ["sketchbook-stories", "Sketchbook", "Stories for Tuesday", { title: "Stories for Tuesday", createdAt: at, modifiedAt: at }],
    ["sketch-boat", "SketchPage", "Boat sketch", { pageNumber: 1, canvasWidth: 2048, canvasHeight: 1536, createdAt: at, modifiedAt: at }],
    ["drawing-boat", "Drawing", "Boat drawing strokes", { blobSha256: "a".repeat(64), mediaType: "application/vnd.apple.pencilkit", createdAt: at, modifiedAt: at }],
    ["photo-boat", "Photo", "Boat reference photo", { blobSha256: "c".repeat(64), mediaType: "image/jpeg", caption: "Synthetic boat reference", createdAt: at, modifiedAt: at }],
    ["audio-reflection", "Audio", "Hospital reflection", { blobSha256: "b".repeat(64), mediaType: "audio/mp4", durationSeconds: 43.2, createdAt: at, modifiedAt: at }],
    ["bookmark-tuesday", "Bookmark", "Show on Tuesday", { label: "Show on Tuesday", createdAt: at, modifiedAt: at }],
  ] as const;

  const resources: Resource[] = definitions.map(([id, resourceType, title]) => ({ id, workspaceId, datasetId, resourceType, title, status: id === "audio-reflection" ? "deleted_logically" : "active", currentRevisionId: `revision-${id}-1`, createdBy: actorId, createdAt: at, updatedAt: at }));
  const revisions: Revision[] = definitions.map(([id, resourceType, , payload]) => ({ id: `revision-${id}-1`, workspaceId, datasetId, resourceId: id, revisionNumber: 1, parentRevisionId: null, mergeParentRevisionIds: [], schemaPackageId, schemaVersion: "1.0.0", canonicalPayload: payload, canonicalPayloadHash: payloadHash(id), createdBy: actorId, createdOnDeviceId: "device-demo-ipad", source: "import", changeNote: "Synthetic fixture seed", restoredFromRevisionId: null, createdAt: at }));
  const relationData = [
    ["rel-diary-entry", "diary-main", "entry-hospital", "contains"], ["rel-entry-page", "entry-hospital", "page-hospital-1", "contains"],
    ["rel-entry-text", "entry-hospital", "text-hospital-1", "contains"], ["rel-sketchbook-page", "sketchbook-stories", "sketch-boat", "contains"],
    ["rel-entry-drawing", "entry-hospital", "drawing-boat", "contains"], ["rel-entry-photo", "entry-hospital", "photo-boat", "contains"],
    ["rel-entry-audio", "entry-hospital", "audio-reflection", "contains"],
    ["rel-bookmark-page", "bookmark-tuesday", "sketch-boat", "references"],
  ] as const;
  const relations: Relation[] = relationData.map(([id, sourceId, targetId, relationType]) => ({ id, workspaceId, datasetId, sourceKind: "resource", sourceId, targetKind: "resource", targetId, relationType, metadata: {}, createdBy: actorId, createdAt: at, endedAt: null }));
  return {
    classification: "synthetic-demo",
    workspace: { id: workspaceId, name: "Ivan’s Synthetic Demo", slug: "ivan-synthetic-demo", status: "active", createdAt: at, updatedAt: at },
    dataset: { id: datasetId, workspaceId, schemaPackageId, datasetType: "ivans-diary", name: "Ivan’s Demo Archive", status: "active", retentionPolicyId: null, createdBy: actorId, createdAt: at, updatedAt: at },
    resources, revisions, relations,
    tombstones: [{ id: "tombstone-audio-reflection", workspaceId, datasetId, subjectKind: "resource", subjectId: "audio-reflection", deletedBy: actorId, deletedAt: at, recoverUntil: "2026-11-02T09:00:00.000Z", priorRevisionId: "revision-audio-reflection-1", purgeState: "not_eligible" }],
  };
}
