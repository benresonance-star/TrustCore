import type {
  ApplicationRegistration,
  HistorySnapshot,
  PolicyAssignment,
  ServiceHealth,
} from "@trust-core/protocol";
import type { ControlCentreGateway, ControlCentreSnapshot } from "./model";

function fixtureHealthyStorage(): ServiceHealth {
  return {
    status: "healthy",
    checkedAt: "2026-08-04T02:14:00.000Z",
    summary: "Fixture provider connectivity succeeded.",
    details: {
      provider: "s3",
      region: "ap-southeast-2",
      bucket: "trust-core-fixture",
      credentialMode: "iam_role",
      endpointHost: null,
      transferSignerConfigured: true,
      objectStorageConfigured: true,
      cataloguedObjects: 18_426,
      failedVerificationObjects: 0,
      consoleLinks: [
        {
          id: "s3_bucket",
          label: "Open in Amazon S3",
          url: "https://ap-southeast-2.console.aws.amazon.com/s3/buckets/trust-core-fixture?region=ap-southeast-2",
        },
        {
          id: "iam",
          label: "Open IAM",
          url: "https://ap-southeast-2.console.aws.amazon.com/iam/home#/home",
        },
      ],
      probe: {
        probeId: "fixture-probe-ok",
        tier: "connectivity",
        ok: true,
        latencyMs: 12,
        issueClass: null,
        issueCode: null,
        checkedAt: "2026-08-04T02:14:00.000Z",
        summary: "Fixture provider connectivity succeeded.",
        bucketRegion: "ap-southeast-2",
        regionMatch: true,
      },
      minimalIamActions: [
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
      ],
      scannerConfigured: false,
    },
  };
}

const snapshot: ControlCentreSnapshot = {
  status: {
    protectedDatasets: 128,
    activeProjects: 41,
    latestVerifiedBackup: "Today, 02:14",
    recoveryAttention: 2,
    canonicalIntegrityPercent: 100,
    canonicalIntegrityStatus: "verified",
    syncQueue: 1,
  },
  datasets: [
    {
      id: "moorabbin",
      name: "2417 — Moorabbin Apartments",
      description: "Foundation project",
      kind: "foundation",
      canonicalStore: "S3 Australia",
      schema: "foundation-project/1.4",
      objects: "18,426 versions",
      storage: "1.42 TB",
      lastVerified: "Today, 02:14",
      health: "verified",
      recovery: "Daily + Glacier",
      deleted: "7 recoverable",
      recentEvents: [
        "Backup integrity verified",
        "Drawing A-204 restored as a new version",
      ],
    },
    {
      id: "brighton",
      name: "2409 — Brighton Courtyard Houses",
      description: "Foundation project",
      kind: "foundation",
      canonicalStore: "S3 Australia",
      schema: "foundation-project/1.4",
      objects: "6,842 versions",
      storage: "684 GB",
      lastVerified: "Today, 02:12",
      health: "verified",
      recovery: "Daily + Glacier",
      deleted: "3 recoverable",
      recentEvents: [
        "Backup integrity verified",
        "Planning issue package added as a new version",
      ],
    },
    {
      id: "ivan",
      name: "Ivan’s Archive",
      description: "Diary and sketchbooks",
      kind: "personal",
      canonicalStore: "Cloud continuity",
      schema: "ivan-diary/1.2",
      objects: "3,284 objects",
      storage: "18.6 GB",
      lastVerified: "Today, 02:11",
      health: "verified",
      recovery: "Daily + weekly archive",
      deleted: "4 recoverable",
      recentEvents: [
        "Continuity copy verified",
        "Sketchbook page restored by owner",
      ],
    },
    {
      id: "wesketch",
      name: "WeSketch — Courtyard Study",
      description: "Creative project",
      kind: "creative",
      canonicalStore: "Cloud continuity",
      schema: "wesketch-project/1.1",
      objects: "846 versions",
      storage: "6.8 GB",
      lastVerified: "Yesterday, 23:42",
      health: "review",
      recovery: "Daily + weekly archive",
      deleted: "12 recoverable",
      recentEvents: [
        "Generated image checksum verified",
        "One canvas revision awaiting sync",
      ],
    },
    {
      id: "standards",
      name: "Office Standards Library",
      description: "Shared practice resource",
      kind: "shared",
      canonicalStore: "S3 Australia",
      schema: "foundation-library/1.3",
      objects: "9,731 versions",
      storage: "386 GB",
      lastVerified: "Today, 02:13",
      health: "verified",
      recovery: "Daily + Glacier",
      deleted: "23 recoverable",
      recentEvents: [
        "Monthly archive snapshot completed",
        "Access policy updated",
      ],
    },
  ],
};

export const fixtureGateway: ControlCentreGateway = {
  mode: "fixture",
  workspaceId: "workspace-demo",
  async getSnapshot() {
    return structuredClone(snapshot);
  },
  async getOperationalSnapshot() {
    return {
      storage: fixtureHealthyStorage(),
      backup: {
        status: "healthy",
        checkedAt: "2026-08-04T02:14:00.000Z",
        summary: "Fixture backup is verified.",
        details: {},
      },
      latestVerification: null,
    };
  },
  async probeStorage(input = {}) {
    const tier = input.tier === "ingest" ? "ingest" : "connectivity";
    return {
      ...fixtureHealthyStorage(),
      summary:
        tier === "ingest"
          ? "Fixture connectivity and upload path succeeded."
          : "Fixture provider connectivity succeeded.",
      details: {
        ...fixtureHealthyStorage().details,
        probe: {
          probeId: "fixture-probe-ok",
          tier,
          ok: true,
          latencyMs: 12,
          issueClass: null,
          issueCode: null,
          checkedAt: "2026-08-04T02:15:00.000Z",
          summary:
            tier === "ingest"
              ? "Fixture connectivity and upload path succeeded."
              : "Fixture provider connectivity succeeded.",
        },
      },
    };
  },
  async getHistory(workspaceId) {
    return structuredClone({
      ...history,
      recoverable: history.recoverable.filter(
        (item) => item.workspaceId === workspaceId,
      ),
    });
  },
  async createArchiveExport(workspaceId, datasetIds) {
    return {
      id: "fixture-preview-export",
      workspaceId,
      datasetIds,
      status: "ready",
      sha256: "0".repeat(64),
      byteLength: 23,
      createdAt: new Date().toISOString(),
    };
  },
  async downloadArchiveExport(_workspaceId, exportId) {
    return {
      filename: `${exportId}.trustarchive`,
      mediaType: "application/vnd.trust-core.archive+zip",
      bytes: new TextEncoder().encode("fixture preview archive"),
    };
  },
  async listApplications(workspaceId) {
    return structuredClone(
      fixtureApplications.filter((app) => app.workspaceId === workspaceId),
    );
  },
  async registerApplication(workspaceId, input) {
    const existing = fixtureApplications.find(
      (app) =>
        app.workspaceId === workspaceId && app.namespace === input.namespace,
    );
    if (existing) return structuredClone(existing);
    const now = new Date().toISOString();
    const registered: ApplicationRegistration = {
      id: `fixture-app-${fixtureApplications.length + 1}`,
      workspaceId,
      namespace: input.namespace,
      name: input.name,
      applicationVersion: input.applicationVersion,
      schemaPackageIds: [...input.schemaPackageIds],
      capabilities: [...input.capabilities],
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    fixtureApplications = [...fixtureApplications, registered];
    return structuredClone(registered);
  },
  async listPolicyAssignments(workspaceId) {
    return structuredClone(
      fixturePolicyAssignments.filter(
        (assignment) => assignment.workspaceId === workspaceId,
      ),
    );
  },
  async createPolicyAssignment(workspaceId, input) {
    const created: PolicyAssignment = {
      id: `fixture-preview-${Date.now()}`,
      workspaceId,
      ...input,
      createdBy: "fixture-admin",
      createdAt: new Date().toISOString(),
    };
    fixturePolicyAssignments = [...fixturePolicyAssignments, created];
    return structuredClone(created);
  },
  async revokePolicyAssignment(workspaceId, assignmentId) {
    const assignment = fixturePolicyAssignments.find(
      (candidate) =>
        candidate.workspaceId === workspaceId && candidate.id === assignmentId,
    );
    if (!assignment) throw new Error("Preview assignment was not found.");
    const revoked = { ...assignment, revokedAt: new Date().toISOString() };
    fixturePolicyAssignments = fixturePolicyAssignments.map((candidate) =>
      candidate.id === assignmentId ? revoked : candidate,
    );
    return structuredClone(revoked);
  },
  async restoreResource(workspaceId, resourceId) {
    const item = history.recoverable.find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.resourceId === resourceId,
    );
    if (!item) throw new Error("This item is no longer recoverable.");
    history.recoverable = history.recoverable.filter(
      (candidate) => candidate !== item,
    );
    const createdAt = new Date().toISOString();
    history.events.unshift({
      id: `event-restore-${resourceId}`,
      action: "revision.created",
      subjectId: resourceId,
      actorId: "fixture-admin",
      occurredAt: createdAt,
      metadata: {
        source: "restore",
        restoredFromRevisionId: item.priorRevisionId,
      },
    });
    return {
      resourceId,
      revisionId: `restored-${resourceId}`,
      revisionNumber: 18,
      source: "restore",
      createdAt,
    };
  },
  async startAdminSession() {
    return {
      actor: {
        id: "fixture-admin",
        displayName: "Fixture administrator",
        roles: ["admin"],
        workspaceIds: ["workspace-demo"],
      },
      csrfToken: "fixture-csrf",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
  },
  async endAdminSession() {},
  beginFederatedLogin() {},
  async runVerification(workspaceId, level) {
    const now = new Date().toISOString();
    return {
      id: `fixture-verification-${level}`,
      workspaceId,
      level,
      scope: { kind: "workspace", id: workspaceId },
      status: "passed",
      startedAt: now,
      completedAt: now,
      objectsChecked: 3284,
      bytesRead: level === "full_blob" ? 19971597926 : 0,
      issues: [],
    };
  },
  async uploadArchive(workspaceId) {
    return {
      id: "fixture-archive-wesketch",
      workspaceId,
      exportId: "fixture-export-wesketch",
      status: "verified",
      checkedEntries: 18,
      issueCount: 0,
      recordCounts: { resources: 14, revisions: 19, relations: 11 },
      blobCount: 6,
      totalBlobBytes: 284_912,
      createdAt: new Date().toISOString(),
    };
  },
  async createImportPlan(workspaceId, archiveId, mode) {
    return {
      id: "fixture-plan-wesketch",
      archiveId,
      workspaceId,
      sourceWorkspaceId: "workspace-wesketch-source",
      mode,
      conflictMode: "reject_on_error",
      status: "ready",
      issueCount: 0,
      counts: { insert: 50, alreadyPresent: 0, blocked: 0 },
      createdAt: new Date().toISOString(),
    };
  },
  async executeImportPlan(workspaceId, planId) {
    const updatedAt = new Date().toISOString();
    return {
      id: "fixture-import-operation",
      workspaceId,
      planId,
      archiveId: "fixture-archive-wesketch",
      checkpoint: "completed",
      status: "completed",
      resumed: false,
      updatedAt,
      completedAt: updatedAt,
    };
  },
  async getImportOperation(workspaceId, operationId) {
    const updatedAt = new Date().toISOString();
    return {
      id: operationId,
      workspaceId,
      planId: "fixture-plan-wesketch",
      archiveId: "fixture-archive-wesketch",
      checkpoint: "completed",
      status: "completed",
      resumed: true,
      updatedAt,
      completedAt: updatedAt,
    };
  },
  async createDownloadGrant(workspaceId, input) {
    if (!input.objectId.trim()) {
      throw Object.assign(new Error("objectId is required"), { status: 400 });
    }
    if (input.objectId.startsWith("quarantine:")) {
      throw Object.assign(
        new Error("Download refused while object is quarantined."),
        { status: 409 },
      );
    }
    const expiresAt = new Date(
      Date.now() + (input.requestedTtlSeconds ?? 300) * 1000,
    ).toISOString();
    return {
      grantId: `fixture-grant-${Date.now()}`,
      objectId: input.objectId,
      workspaceId,
      expiresAt,
      transfer: {
        method: "GET",
        url: `https://fixture.storage.local/${encodeURIComponent(input.objectId)}?expires=${encodeURIComponent(expiresAt)}`,
        headers: {},
      },
    };
  },
  async getUploadScanStatus(workspaceId, uploadId) {
    return {
      uploadId,
      workspaceId,
      state: "scanning",
      updatedAt: "2026-08-04T02:10:00.000Z",
    };
  },
  async getQuarantineScanSummary(workspaceId) {
    return {
      available: true,
      summary: `Fixture quarantine queue for ${workspaceId}.`,
      items: [
        {
          objectId: "fixture-object-pending-scan",
          state: "pending",
          updatedAt: "2026-08-04T02:10:00.000Z",
        },
      ],
    };
  },
};

let fixtureApplications: ApplicationRegistration[] = [
  {
    id: "fixture-app-wesketch",
    workspaceId: "workspace-demo",
    namespace: "app/wesketch",
    name: "WeSketch",
    applicationVersion: "1.0.0",
    schemaPackageIds: ["wesketch-project/1.1"],
    capabilities: ["dataset:read", "resource:read", "revision:create"],
    status: "active",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
];

let fixturePolicyAssignments: PolicyAssignment[] = [
  {
    id: "fixture-policy-owner",
    workspaceId: "workspace-demo",
    principalType: "user",
    principalId: "Ben Resonance",
    role: "owner",
    scopeKind: "workspace",
    scopeId: "workspace-demo",
    createdBy: "fixture-seed",
    createdAt: "2026-08-03T00:00:00.000Z",
  },
  {
    id: "fixture-policy-admin",
    workspaceId: "workspace-demo",
    principalType: "user",
    principalId: "Trust Core operator",
    role: "admin",
    scopeKind: "workspace",
    scopeId: "workspace-demo",
    createdBy: "fixture-seed",
    createdAt: "2026-08-03T00:00:00.000Z",
  },
  {
    id: "fixture-policy-wesketch",
    workspaceId: "workspace-demo",
    principalType: "application",
    principalId: "WeSketch application",
    role: "editor",
    scopeKind: "dataset",
    scopeId: "wesketch",
    createdBy: "fixture-seed",
    createdAt: "2026-08-03T00:00:00.000Z",
  },
];

let history: {
  recoverable: HistorySnapshot["recoverable"][number][];
  events: HistorySnapshot["events"][number][];
} = {
  recoverable: [
    {
      tombstoneId: "tombstone-sketch",
      workspaceId: "workspace-demo",
      datasetId: "ivan",
      resourceId: "sketch-hospital",
      resourceTitle: "Hospital Visit",
      resourceType: "SketchPage",
      deletedAt: "2026-08-03T08:42:00.000Z",
      recoverUntil: "2026-11-01T00:00:00.000Z",
      deletedBy: "Ivan",
      priorRevisionId: "revision-17",
    },
    {
      tombstoneId: "tombstone-drawing",
      workspaceId: "workspace-demo",
      datasetId: "foundation",
      resourceId: "drawing-a204",
      resourceTitle: "Drawing A-204",
      resourceType: "Drawing",
      deletedAt: "2026-08-02T04:38:00.000Z",
      recoverUntil: "2026-11-01T00:00:00.000Z",
      deletedBy: "Ben",
      priorRevisionId: "revision-a204-6",
    },
  ],
  events: [
    {
      id: "event-backup",
      action: "backup.verified",
      subjectId: "moorabbin",
      actorId: "verification-service",
      occurredAt: "2026-08-04T02:14:00.000Z",
      metadata: { objects: 18426 },
    },
    {
      id: "event-delete",
      action: "resource.deleted_logically",
      subjectId: "sketch-hospital",
      actorId: "Ivan",
      occurredAt: "2026-08-03T08:42:00.000Z",
      metadata: { recoveryDays: 90 },
    },
  ],
};
