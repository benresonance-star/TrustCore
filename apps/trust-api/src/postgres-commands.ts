import { createHash, randomUUID } from "node:crypto";
import {
  ResourceHistoryService,
  type ObjectIngestResult,
  type ObjectIngestService,
} from "@trust-core/operations";
import { isPolicyAction } from "@trust-core/policy";
import {
  PostgresContractRepository,
  PostgresHistoryRepository,
  PostgresVerificationCatalog,
  inTransaction,
  type DatabasePool,
} from "@trust-core/persistence-postgres";
import type {
  ApplicationRegistration,
  AuthenticatedActor,
  CompleteUploadCommand,
  CreateUploadCommand,
  DeleteResourceCommand,
  DeleteResourceResult,
  HistorySnapshot,
  RecoverableItem,
  RegisterApplicationCommand,
  RestoreResourceCommand,
  RevisionCommand,
  RevisionCommandResult,
  RunVerificationCommand,
  ServiceHealth,
  TrustEventSummary,
  VerificationRunResult,
} from "@trust-core/protocol";
import type {
  BlobVerificationService,
  StructuralVerificationService,
} from "@trust-core/verification";
import type { CommandProvider, ObjectIngestCommand } from "./app.js";

const maxUploadBytes = 750_000;

export class PostgresCommandProvider implements CommandProvider {
  private readonly history: ResourceHistoryService;
  private readonly contracts: PostgresContractRepository;
  private readonly reports: PostgresVerificationCatalog;
  constructor(
    private readonly pool: DatabasePool,
    private readonly verification?: {
      blob: BlobVerificationService;
      structural: StructuralVerificationService;
    },
    private readonly ingest?: ObjectIngestService,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.history = new ResourceHistoryService(
      new PostgresHistoryRepository(pool),
    );
    this.contracts = new PostgresContractRepository(pool);
    this.reports = new PostgresVerificationCatalog(pool);
  }

  async listWorkspaces(workspaceId: string) {
    return { items: await this.contracts.listWorkspaces(workspaceId) };
  }
  async listApplications(workspaceId: string) {
    return { items: await this.contracts.listApplications(workspaceId) };
  }
  async registerApplication(
    _actor: AuthenticatedActor,
    command: RegisterApplicationCommand,
  ): Promise<ApplicationRegistration> {
    if (command.capabilities.some((capability) => !isPolicyAction(capability)))
      throw codedError(
        "INVALID_COMMAND",
        "Application capability is not recognized.",
      );
    const now = this.clock().toISOString();
    return this.contracts.registerApplication({
      id: randomUUID(),
      workspaceId: command.workspaceId,
      namespace: command.namespace,
      name: command.name,
      applicationVersion: command.applicationVersion,
      schemaPackageIds: command.schemaPackageIds,
      capabilities: command.capabilities,
      idempotencyKey: command.idempotencyKey,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
  async listDatasets(workspaceId: string) {
    return { items: await this.contracts.listDatasets(workspaceId) };
  }
  getDataset(workspaceId: string, datasetId: string) {
    return this.contracts.getDataset(workspaceId, datasetId);
  }
  async listResources(workspaceId: string, datasetId?: string) {
    return {
      items: await this.contracts.listResources(workspaceId, datasetId),
    };
  }
  getResource(workspaceId: string, resourceId: string) {
    return this.contracts.getResource(workspaceId, resourceId);
  }
  getRevisionGraph(workspaceId: string, resourceId: string) {
    return this.contracts.getRevisionGraph(workspaceId, resourceId);
  }
  async listRelations(workspaceId: string, datasetId?: string) {
    return {
      items: await this.contracts.listRelations(workspaceId, {
        ...(datasetId ? { datasetId } : {}),
      }),
    };
  }
  async listDeletedResources(workspaceId: string, datasetId?: string) {
    return {
      items: (await this.getHistory(workspaceId, datasetId)).recoverable,
    };
  }
  async listAuditEvents(workspaceId: string, datasetId?: string) {
    return {
      items: await this.contracts.listAuditEvents(workspaceId, datasetId),
    };
  }

  async getHistory(
    workspaceId: string,
    datasetId?: string,
  ): Promise<HistorySnapshot> {
    return inTransaction(this.pool, async (db) => {
      await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
        workspaceId,
      ]);
      const values = datasetId ? [workspaceId, datasetId] : [workspaceId];
      const datasetFilter = datasetId ? " AND t.dataset_id=$2" : "";
      const deleted = await db.query<RecoverableRow>(
        `SELECT t.id AS tombstone_id,t.workspace_id,t.dataset_id,t.subject_id AS resource_id,r.title AS resource_title,r.resource_type,t.deleted_at,t.recover_until,t.deleted_by,t.prior_revision_id FROM tombstones t JOIN resources r ON r.id=t.subject_id::uuid AND r.workspace_id=t.workspace_id WHERE t.workspace_id=$1${datasetFilter} AND t.subject_kind='resource' AND t.restored_at IS NULL AND t.purge_state<>'purged' ORDER BY t.deleted_at DESC LIMIT 100`,
        values,
      );
      const events = await db.query<EventRow>(
        `SELECT id,action,subject_id,actor_id,occurred_at,metadata_json FROM audit_events WHERE workspace_id=$1${datasetId ? " AND dataset_id=$2" : ""} ORDER BY occurred_at DESC,id DESC LIMIT 100`,
        values,
      );
      return {
        recoverable: deleted.rows.map(mapRecoverable),
        events: events.rows.map(mapEvent),
      };
    });
  }
  async createRevision(
    resourceId: string,
    actor: AuthenticatedActor,
    command: RevisionCommand,
  ): Promise<RevisionCommandResult> {
    return revisionResult(
      await this.history.createRevision({
        ...command,
        resourceId,
        actorId: actor.id,
      }),
    );
  }
  async deleteResource(
    resourceId: string,
    actor: AuthenticatedActor,
    command: DeleteResourceCommand,
  ): Promise<DeleteResourceResult> {
    const tombstone = await this.history.deleteResource({
      workspaceId: command.workspaceId,
      resourceId,
      expectedRevisionId: command.expectedRevisionId,
      actorId: actor.id,
      recoverUntil: command.recoverUntil,
    });
    return {
      resourceId,
      tombstoneId: tombstone.id,
      deletedAt: tombstone.deletedAt,
      recoverUntil: tombstone.recoverUntil,
    };
  }
  async restoreResource(
    resourceId: string,
    actor: AuthenticatedActor,
    command: RestoreResourceCommand,
  ): Promise<RevisionCommandResult> {
    return revisionResult(
      await this.history.restoreResource({
        workspaceId: command.workspaceId,
        resourceId,
        actorId: actor.id,
        ...(command.changeNote ? { changeNote: command.changeNote } : {}),
      }),
    );
  }

  async runVerification(
    _actor: AuthenticatedActor,
    command: RunVerificationCommand,
  ): Promise<VerificationRunResult> {
    if (!this.verification)
      throw new Error("Object verification adapter is not configured.");
    switch (command.level) {
      case "metadata":
      case "full_blob":
        return this.verification.blob.run({
          workspaceId: command.workspaceId,
          level: command.level,
        });
      case "resource":
      case "dataset":
      case "workspace":
        return this.verification.structural.run({
          workspaceId: command.workspaceId,
          level: command.level,
          ...(command.scope ? { scope: command.scope } : {}),
        });
      default:
        return assertNever(command.level);
    }
  }
  async listVerificationReports(workspaceId: string) {
    return { items: await this.reports.listReports(workspaceId) };
  }
  getVerificationReport(workspaceId: string, reportId: string) {
    return this.reports.getReport(workspaceId, reportId);
  }
  getOperation(workspaceId: string, operationId: string) {
    return this.contracts.getOperation(workspaceId, operationId);
  }

  async getStorageHealth(workspaceId: string): Promise<ServiceHealth> {
    const counts = await inTransaction(this.pool, async (db) => {
      await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
        workspaceId,
      ]);
      return db.query<{ objects: number; failed: number }>(
        "SELECT count(*)::int AS objects,count(*) FILTER (WHERE verification_state='failed')::int AS failed FROM blob_objects WHERE workspace_id=$1",
        [workspaceId],
      );
    });
    const row = counts.rows[0] ?? { objects: 0, failed: 0 };
    return {
      status: this.ingest && row.failed === 0 ? "healthy" : "degraded",
      checkedAt: this.clock().toISOString(),
      summary: this.ingest
        ? "Immutable object ingest is configured."
        : "Object storage is not configured for this API process.",
      details: {
        cataloguedObjects: row.objects,
        failedVerificationObjects: row.failed,
        objectStorageConfigured: Boolean(this.ingest),
      },
    };
  }
  async getBackupHealth(_workspaceId: string): Promise<ServiceHealth> {
    return {
      status: "not_configured",
      checkedAt: this.clock().toISOString(),
      summary: "No backup telemetry provider is configured.",
      details: { backupTelemetryConfigured: false },
    };
  }

  createUpload(actor: AuthenticatedActor, command: CreateUploadCommand) {
    if (command.expectedByteLength > maxUploadBytes)
      throw codedError(
        "REQUEST_TOO_LARGE",
        "Upload exceeds the bounded facade limit.",
      );
    const now = this.clock();
    const expiresInSeconds = command.expiresInSeconds ?? 900;
    return this.contracts.createUploadSession({
      ...command,
      expiresInSeconds,
      actorId: actor.id,
      principalType: actor.principalType ?? "user",
      now: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + expiresInSeconds * 1000,
      ).toISOString(),
    });
  }
  getUpload(
    workspaceId: string,
    uploadId: string,
    actor: AuthenticatedActor,
  ) {
    return this.contracts.getUploadSession(workspaceId, uploadId, actor);
  }
  async completeUpload(
    uploadId: string,
    actor: AuthenticatedActor,
    command: CompleteUploadCommand,
  ) {
    if (!this.ingest)
      throw new Error("Object ingest adapter is not configured.");
    const session = await this.contracts.getUploadSession(
      command.workspaceId,
      uploadId,
      actor,
    );
    if (!session)
      throw codedError("OPERATION_NOT_FOUND", "Upload session was not found.");
    const bytes = decodeBase64(command.bytesBase64);
    if (bytes.byteLength !== session.expectedByteLength)
      throw codedError(
        "COMMAND_REJECTED",
        "Upload byte length does not match the session expectation.",
      );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== session.expectedSha256)
      throw codedError(
        "COMMAND_REJECTED",
        "Upload hash does not match the session expectation.",
      );
    if (session.state === "completed") return session;
    if (Date.parse(session.expiresAt) <= this.clock().getTime())
      throw codedError("COMMAND_REJECTED", "Upload session has expired.");
    const result = await this.ingest.ingest({
      workspaceId: command.workspaceId,
      actorId: actor.id,
      principalType: actor.principalType ?? "user",
      idempotencyKey: `upload:${uploadId}`,
      mediaType: session.mediaType,
      bytes,
    });
    return this.contracts.completeUploadSession({
      workspaceId: command.workspaceId,
      uploadId,
      actor,
      blobId: result.blob.id,
      ingestOperationId: result.operationId,
      completedAt: this.clock().toISOString(),
    });
  }
  async ingestObject(
    actor: AuthenticatedActor,
    command: ObjectIngestCommand,
  ): Promise<ObjectIngestResult> {
    if (!this.ingest)
      throw new Error("Object ingest adapter is not configured.");
    const bytes = decodeBase64(command.bytesBase64);
    if (bytes.byteLength > maxUploadBytes)
      throw codedError(
        "REQUEST_TOO_LARGE",
        "Object exceeds the bounded API limit.",
      );
    return this.ingest.ingest({
      workspaceId: command.workspaceId,
      actorId: actor.id,
      principalType: actor.principalType ?? "user",
      idempotencyKey: command.idempotencyKey,
      mediaType: command.mediaType,
      bytes,
    });
  }
}

function decodeBase64(value: string): Buffer {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw codedError("INVALID_COMMAND", "Object bytes are not valid base64.");
  return Buffer.from(value, "base64");
}
function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
function revisionResult(result: {
  resourceId: string;
  id: string;
  revisionNumber: number;
  source: RevisionCommandResult["source"];
  createdAt: string;
}): RevisionCommandResult {
  return {
    resourceId: result.resourceId,
    revisionId: result.id,
    revisionNumber: result.revisionNumber,
    source: result.source,
    createdAt: result.createdAt,
  };
}
interface RecoverableRow {
  tombstone_id: string;
  workspace_id: string;
  dataset_id: string;
  resource_id: string;
  resource_title: string | null;
  resource_type: string;
  deleted_at: string | Date;
  recover_until: string | Date | null;
  deleted_by: string;
  prior_revision_id: string | null;
}
interface EventRow {
  id: string;
  action: string;
  subject_id: string;
  actor_id: string;
  occurred_at: string | Date;
  metadata_json: Record<string, unknown>;
}
const iso = (value: string | Date) => new Date(value).toISOString();
function mapRecoverable(row: RecoverableRow): RecoverableItem {
  return {
    tombstoneId: row.tombstone_id,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    resourceId: row.resource_id,
    resourceTitle: row.resource_title,
    resourceType: row.resource_type,
    deletedAt: iso(row.deleted_at),
    recoverUntil: row.recover_until ? iso(row.recover_until) : null,
    deletedBy: row.deleted_by,
    priorRevisionId: row.prior_revision_id,
  };
}
function mapEvent(row: EventRow): TrustEventSummary {
  return {
    id: row.id,
    action: row.action,
    subjectId: row.subject_id,
    actorId: row.actor_id,
    occurredAt: iso(row.occurred_at),
    metadata: row.metadata_json,
  };
}
function assertNever(value: never): never {
  throw new Error(`Unhandled verification level: ${String(value)}`);
}
