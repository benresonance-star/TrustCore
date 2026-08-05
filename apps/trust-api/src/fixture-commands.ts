import { createHash, randomUUID } from "node:crypto";
import type {
  ApplicationRegistration,
  AuthenticatedActor,
  DeleteResourceResult,
  RecoverableItem,
  RevisionCommandResult,
  TrustEventSummary,
  UploadSession,
  VerificationRunResult,
} from "@trust-core/protocol";
import type { CommandProvider } from "./app.js";

export function createFixtureCommands(
  clock: () => Date = () => new Date(),
): CommandProvider {
  const workspace = {
    id: "workspace-demo",
    name: "Trust Core demo",
    slug: "trust-core-demo",
    status: "active" as const,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
  const dataset = {
    id: "ivan",
    workspaceId: workspace.id,
    schemaPackageId: "schema-demo",
    datasetType: "diary",
    name: "Ivan's diary",
    status: "active" as const,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
  const resource = {
    id: "diary-main",
    workspaceId: workspace.id,
    datasetId: dataset.id,
    resourceType: "Diary",
    title: "Ivan's diary",
    status: "active" as const,
    currentRevisionId: "revision-17",
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
  const recoverable: RecoverableItem[] = [
    {
      tombstoneId: "demo-tombstone-sketch",
      workspaceId: workspace.id,
      datasetId: dataset.id,
      resourceId: "sketch-page-18",
      resourceTitle: "Hospital Visit",
      resourceType: "SketchPage",
      deletedAt: "2026-08-03T08:42:00.000Z",
      recoverUntil: "2026-11-01T00:00:00.000Z",
      deletedBy: "ivan",
      priorRevisionId: "revision-17",
    },
  ];
  const events: TrustEventSummary[] = [
    {
      id: "event-1",
      action: "resource.deleted_logically",
      subjectId: "sketch-page-18",
      actorId: "ivan",
      occurredAt: "2026-08-03T08:42:00.000Z",
      metadata: { retentionDays: 90 },
    },
  ];
  const applications: ApplicationRegistration[] = [];
  const applicationRequests = new Map<
    string,
    { fingerprint: string; registration: ApplicationRegistration }
  >();
  const reports: VerificationRunResult[] = [];
  const uploads = new Map<string, UploadSession>();
  const uploadOwners = new Map<string, string>();
  const uploadRequests = new Map<
    string,
    { fingerprint: string; session: UploadSession }
  >();
  let revisionNumber = 17;
  const event = (
    action: string,
    subjectId: string,
    actorId: string,
    metadata: Record<string, unknown>,
  ) =>
    events.unshift({
      id: randomUUID(),
      action,
      subjectId,
      actorId,
      occurredAt: clock().toISOString(),
      metadata,
    });
  return {
    async listWorkspaces(workspaceId) {
      return { items: workspaceId === workspace.id ? [workspace] : [] };
    },
    async listApplications(workspaceId) {
      return {
        items: applications.filter((item) => item.workspaceId === workspaceId),
      };
    },
    async registerApplication(_actor, command) {
      const now = clock().toISOString();
      const requestKey = `${command.workspaceId}:${command.idempotencyKey}`;
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            namespace: command.namespace,
            name: command.name,
            applicationVersion: command.applicationVersion,
            schemaPackageIds: command.schemaPackageIds,
            capabilities: command.capabilities,
          }),
        )
        .digest("hex");
      const replay = applicationRequests.get(requestKey);
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw Object.assign(
            new Error(
              "Idempotency key was already used for a different application registration.",
            ),
            { code: "IDEMPOTENCY_CONFLICT" },
          );
        return replay.registration;
      }
      const existing = applications.find(
        (item) =>
          item.workspaceId === command.workspaceId &&
          item.namespace === command.namespace,
      );
      if (existing)
        throw Object.assign(
          new Error(
            "Application namespace is already registered under a different idempotency key.",
          ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
      const registration: ApplicationRegistration = {
        id: randomUUID(),
        workspaceId: command.workspaceId,
        namespace: command.namespace,
        name: command.name,
        applicationVersion: command.applicationVersion,
        schemaPackageIds: command.schemaPackageIds,
        capabilities: command.capabilities,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      applications.push(registration);
      applicationRequests.set(requestKey, { fingerprint, registration });
      return registration;
    },
    async listDatasets(workspaceId) {
      return { items: workspaceId === workspace.id ? [dataset] : [] };
    },
    async getDataset(workspaceId, datasetId) {
      return workspaceId === workspace.id && datasetId === dataset.id
        ? dataset
        : undefined;
    },
    async listResources(workspaceId, datasetId) {
      return {
        items:
          workspaceId === workspace.id &&
          (!datasetId || datasetId === dataset.id)
            ? [resource]
            : [],
      };
    },
    async getResource(workspaceId, resourceId) {
      return workspaceId === workspace.id && resourceId === resource.id
        ? resource
        : undefined;
    },
    async getRevisionGraph(workspaceId, resourceId) {
      return workspaceId === workspace.id && resourceId === resource.id
        ? {
            resourceId,
            headRevisionId: resource.currentRevisionId,
            revisions: [],
          }
        : undefined;
    },
    async listRelations() {
      return { items: [] };
    },
    async listDeletedResources(workspaceId, datasetId) {
      return {
        items: recoverable.filter(
          (item) =>
            item.workspaceId === workspaceId &&
            (!datasetId || item.datasetId === datasetId),
        ),
      };
    },
    async listAuditEvents(_workspaceId, datasetId) {
      return { items: datasetId && datasetId !== dataset.id ? [] : events };
    },
    async getHistory(workspaceId, datasetId) {
      return {
        recoverable: recoverable.filter(
          (item) =>
            item.workspaceId === workspaceId &&
            (!datasetId || item.datasetId === datasetId),
        ),
        events: datasetId && datasetId !== dataset.id ? [] : [...events],
      };
    },
    async createRevision(resourceId, actor, _command) {
      revisionNumber += 1;
      const result = {
        resourceId,
        revisionId: randomUUID(),
        revisionNumber,
        source: "user" as const,
        createdAt: clock().toISOString(),
      };
      event("revision.created", resourceId, actor.id, {
        revisionId: result.revisionId,
      });
      return result;
    },
    async deleteResource(resourceId, actor, command) {
      const result: DeleteResourceResult = {
        resourceId,
        tombstoneId: randomUUID(),
        deletedAt: clock().toISOString(),
        recoverUntil: command.recoverUntil,
      };
      recoverable.unshift({
        tombstoneId: result.tombstoneId,
        workspaceId: command.workspaceId,
        datasetId: dataset.id,
        resourceId,
        resourceTitle: command.reason ?? "Deleted fixture resource",
        resourceType: "Resource",
        deletedAt: result.deletedAt,
        recoverUntil: result.recoverUntil,
        deletedBy: actor.id,
        priorRevisionId: command.expectedRevisionId,
      });
      event("resource.deleted_logically", resourceId, actor.id, {
        tombstoneId: result.tombstoneId,
      });
      return result;
    },
    async restoreResource(resourceId, actor, _command) {
      const index = recoverable.findIndex(
        (item) => item.resourceId === resourceId,
      );
      if (index < 0)
        throw new Error("No recoverable deletion exists for this resource.");
      recoverable.splice(index, 1);
      revisionNumber += 1;
      const result: RevisionCommandResult = {
        resourceId,
        revisionId: randomUUID(),
        revisionNumber,
        source: "restore",
        createdAt: clock().toISOString(),
      };
      event("revision.created", resourceId, actor.id, {
        source: "restore",
        revisionId: result.revisionId,
      });
      return result;
    },
    async runVerification(_actor, command) {
      const now = clock().toISOString();
      const result: VerificationRunResult = {
        id: randomUUID(),
        workspaceId: command.workspaceId,
        level: command.level,
        scope: command.scope ?? { kind: "workspace", id: command.workspaceId },
        status: "passed",
        startedAt: now,
        completedAt: now,
        objectsChecked: 3284,
        bytesRead: command.level === "full_blob" ? 19971597926 : 0,
        issues: [],
      };
      reports.unshift(result);
      return result;
    },
    async listVerificationReports(workspaceId) {
      return {
        items: reports.filter((item) => item.workspaceId === workspaceId),
      };
    },
    async getVerificationReport(workspaceId, reportId) {
      return reports.find(
        (item) => item.workspaceId === workspaceId && item.id === reportId,
      );
    },
    async getOperation(workspaceId, operationId) {
      const upload = [...uploads.values()].find(
        (item) =>
          item.workspaceId === workspaceId && item.operationId === operationId,
      );
      return upload
        ? {
            id: upload.operationId,
            workspaceId,
            type: "upload.session",
            state: upload.state,
            status: upload.status,
            requestedBy: "fixture",
            retryCount: 0,
            errorCode: null,
            createdAt: upload.createdAt,
            updatedAt: upload.updatedAt,
            completedAt: upload.completedAt,
          }
        : undefined;
    },
    async getStorageHealth() {
      return {
        status: "not_configured",
        checkedAt: clock().toISOString(),
        summary: "Fixture mode has no object storage.",
        details: { objectStorageConfigured: false },
      };
    },
    async getBackupHealth() {
      return {
        status: "not_configured",
        checkedAt: clock().toISOString(),
        summary: "Fixture mode has no backup telemetry.",
        details: { backupTelemetryConfigured: false },
      };
    },
    async createUpload(actor, command) {
      const requestKey = `${command.workspaceId}:${principalIdentity(actor)}:${command.idempotencyKey}`;
      const fingerprint = uploadFingerprint(command);
      const replay = uploadRequests.get(requestKey);
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw codedError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for a different upload.",
          );
        return replay.session;
      }
      const now = clock(),
        session: UploadSession = {
          id: randomUUID(),
          workspaceId: command.workspaceId,
          operationId: randomUUID(),
          state: "requested",
          status: "pending",
          mediaType: command.mediaType,
          expectedByteLength: command.expectedByteLength,
          expectedSha256: command.expectedSha256,
          expiresAt: new Date(
            now.getTime() + (command.expiresInSeconds ?? 900) * 1000,
          ).toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          completedAt: null,
          blobId: null,
        };
      uploads.set(session.id, session);
      uploadOwners.set(session.id, principalIdentity(actor));
      uploadRequests.set(requestKey, { fingerprint, session });
      return session;
    },
    async getUpload(workspaceId, uploadId, actor) {
      const session = uploads.get(uploadId);
      return session?.workspaceId === workspaceId &&
        actorMayAccessUpload(actor, uploadOwners.get(uploadId))
        ? session
        : undefined;
    },
    async completeUpload(uploadId, actor, command) {
      const session = uploads.get(uploadId);
      if (
        !session ||
        session.workspaceId !== command.workspaceId ||
        !actorMayAccessUpload(actor, uploadOwners.get(uploadId))
      )
        throw codedError(
          "OPERATION_NOT_FOUND",
          "Upload session was not found.",
        );
      const bytes = Buffer.from(command.bytesBase64, "base64");
      if (
        bytes.byteLength !== session.expectedByteLength ||
        createHash("sha256").update(bytes).digest("hex") !==
          session.expectedSha256
      )
        throw new Error("Upload expectation mismatch.");
      if (session.state === "completed") return session;
      const completed = {
        ...session,
        state: "completed" as const,
        status: "succeeded" as const,
        updatedAt: clock().toISOString(),
        completedAt: clock().toISOString(),
        blobId: `fixture-${session.expectedSha256}`,
      };
      uploads.set(uploadId, completed);
      for (const [key, request] of uploadRequests)
        if (request.session.id === uploadId)
          uploadRequests.set(key, { ...request, session: completed });
      return completed;
    },
  };
}

function uploadFingerprint(command: {
  mediaType: string;
  expectedByteLength: number;
  expectedSha256: string;
  expiresInSeconds?: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        mediaType: command.mediaType,
        expectedByteLength: command.expectedByteLength,
        expectedSha256: command.expectedSha256,
        expiresInSeconds: command.expiresInSeconds ?? 900,
      }),
    )
    .digest("hex");
}

function actorMayAccessUpload(
  actor: AuthenticatedActor,
  ownerId: string | undefined,
): boolean {
  return (
    actor.principalType !== "application" ||
    principalIdentity(actor) === ownerId
  );
}

function principalIdentity(actor: AuthenticatedActor): string {
  return `${actor.principalType ?? "user"}:${actor.id}`;
}

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
