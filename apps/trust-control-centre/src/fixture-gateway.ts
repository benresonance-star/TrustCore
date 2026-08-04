import type { HistorySnapshot } from "@trust-core/protocol";
import type { ControlCentreGateway, ControlCentreSnapshot } from "./model";

const snapshot: ControlCentreSnapshot = {
  status: {
    protectedDatasets: 128,
    activeProjects: 41,
    latestVerifiedBackup: "Today, 02:14",
    recoveryAttention: 2,
    canonicalIntegrityPercent: 100,
    syncQueue: 1,
  },
  datasets: [
    {
      id: "moorabbin", name: "2417 — Moorabbin Apartments", description: "Foundation project",
      kind: "foundation", canonicalStore: "S3 Australia", schema: "foundation-project/1.4",
      objects: "18,426 versions", storage: "1.42 TB", lastVerified: "Today, 02:14", health: "verified",
      recovery: "Daily + Glacier", deleted: "7 recoverable",
      recentEvents: ["Backup integrity verified", "Drawing A-204 restored as a new version"],
    },
    {
      id: "brighton", name: "2409 — Brighton Courtyard Houses", description: "Foundation project",
      kind: "foundation", canonicalStore: "S3 Australia", schema: "foundation-project/1.4",
      objects: "6,842 versions", storage: "684 GB", lastVerified: "Today, 02:12", health: "verified",
      recovery: "Daily + Glacier", deleted: "3 recoverable",
      recentEvents: ["Backup integrity verified", "Planning issue package added as a new version"],
    },
    {
      id: "ivan", name: "Ivan’s Archive", description: "Diary and sketchbooks",
      kind: "personal", canonicalStore: "Cloud continuity", schema: "ivan-diary/1.2",
      objects: "3,284 objects", storage: "18.6 GB", lastVerified: "Today, 02:11", health: "verified",
      recovery: "Daily + weekly archive", deleted: "4 recoverable",
      recentEvents: ["Continuity copy verified", "Sketchbook page restored by owner"],
    },
    {
      id: "wesketch", name: "WeSketch — Courtyard Study", description: "Creative project",
      kind: "creative", canonicalStore: "Cloud continuity", schema: "wesketch-project/1.1",
      objects: "846 versions", storage: "6.8 GB", lastVerified: "Yesterday, 23:42", health: "review",
      recovery: "Daily + weekly archive", deleted: "12 recoverable",
      recentEvents: ["Generated image checksum verified", "One canvas revision awaiting sync"],
    },
    {
      id: "standards", name: "Office Standards Library", description: "Shared practice resource",
      kind: "shared", canonicalStore: "S3 Australia", schema: "foundation-library/1.3",
      objects: "9,731 versions", storage: "386 GB", lastVerified: "Today, 02:13", health: "verified",
      recovery: "Daily + Glacier", deleted: "23 recoverable",
      recentEvents: ["Monthly archive snapshot completed", "Access policy updated"],
    },
  ],
};

export const fixtureGateway: ControlCentreGateway = {
  async getSnapshot() {
    return structuredClone(snapshot);
  },
  async getHistory(workspaceId) { return structuredClone({ ...history, recoverable: history.recoverable.filter((item) => item.workspaceId === workspaceId) }); },
  async restoreResource(workspaceId, resourceId) {
    const item = history.recoverable.find((candidate) => candidate.workspaceId === workspaceId && candidate.resourceId === resourceId);
    if (!item) throw new Error("This item is no longer recoverable.");
    history.recoverable = history.recoverable.filter((candidate) => candidate !== item);
    const createdAt = new Date().toISOString();
    history.events.unshift({ id: `event-restore-${resourceId}`, action: "revision.created", subjectId: resourceId, actorId: "fixture-admin", occurredAt: createdAt, metadata: { source: "restore", restoredFromRevisionId: item.priorRevisionId } });
    return { resourceId, revisionId: `restored-${resourceId}`, revisionNumber: 18, source: "restore", createdAt };
  },
  async startAdminSession() { return { actor: { id: "fixture-admin", displayName: "Fixture administrator", roles: ["admin"], workspaceIds: ["workspace-demo"] }, csrfToken: "fixture-csrf", expiresAt: "2099-01-01T00:00:00.000Z" }; },
  async endAdminSession() {},
  beginFederatedLogin() {},
  async runVerification(workspaceId,level){const now=new Date().toISOString();return{id:`fixture-verification-${level}`,workspaceId,level,status:"passed",startedAt:now,completedAt:now,objectsChecked:3284,bytesRead:level==="full_blob"?19971597926:0,issues:[]};},
};

let history: { recoverable: HistorySnapshot["recoverable"][number][]; events: HistorySnapshot["events"][number][] } = {
  recoverable: [
    { tombstoneId: "tombstone-sketch", workspaceId: "workspace-demo", datasetId: "ivan", resourceId: "sketch-hospital", resourceTitle: "Hospital Visit", resourceType: "SketchPage", deletedAt: "2026-08-03T08:42:00.000Z", recoverUntil: "2026-11-01T00:00:00.000Z", deletedBy: "Ivan", priorRevisionId: "revision-17" },
    { tombstoneId: "tombstone-drawing", workspaceId: "workspace-demo", datasetId: "foundation", resourceId: "drawing-a204", resourceTitle: "Drawing A-204", resourceType: "Drawing", deletedAt: "2026-08-02T04:38:00.000Z", recoverUntil: "2026-11-01T00:00:00.000Z", deletedBy: "Ben", priorRevisionId: "revision-a204-6" },
  ],
  events: [
    { id: "event-backup", action: "backup.verified", subjectId: "moorabbin", actorId: "verification-service", occurredAt: "2026-08-04T02:14:00.000Z", metadata: { objects: 18426 } },
    { id: "event-delete", action: "resource.deleted_logically", subjectId: "sketch-hospital", actorId: "Ivan", occurredAt: "2026-08-03T08:42:00.000Z", metadata: { recoveryDays: 90 } },
  ],
};
