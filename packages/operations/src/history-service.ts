import { createHash, randomUUID } from "node:crypto";
import { assertNextRevision, type Resource, type Revision, type Tombstone } from "@trust-core/core";

export interface HistoryRepository {
  transaction<T>(work: (repository: HistoryRepository) => Promise<T>): Promise<T>;
  getResource(workspaceId: string, resourceId: string): Promise<Resource | undefined>;
  getRevision(workspaceId: string, revisionId: string): Promise<Revision | undefined>;
  appendRevision(revision: Revision): Promise<void>;
  setResourceHead(input: { workspaceId: string; resourceId: string; expectedRevisionId: string | null; nextRevisionId: string | null; status: Resource["status"]; updatedAt: string }): Promise<boolean>;
  addTombstone(tombstone: Tombstone): Promise<void>;
  getOpenTombstone(workspaceId: string, resourceId: string): Promise<Tombstone | undefined>;
  closeTombstone(workspaceId: string, tombstoneId: string): Promise<void>;
  appendAudit(event: HistoryAuditEvent): Promise<void>;
  enqueueOutbox?(event: HistoryOutboxEvent): Promise<void>;
}
export interface HistoryAuditEvent { workspaceId: string; datasetId: string; actorId: string; action: string; subjectId: string; occurredAt: string; metadata: Readonly<Record<string, unknown>>; }
export interface HistoryOutboxEvent { id: string; workspaceId: string; actorId: string; eventType: "resource.revision_created" | "resource.deleted" | "resource.restored"; subjectId: string; occurredAt: string; payload: Readonly<Record<string, unknown>>; }
export interface CreateRevisionInput { workspaceId: string; resourceId: string; expectedRevisionId: string | null; schemaPackageId: string; schemaVersion: string; canonicalPayload: Readonly<Record<string, unknown>>; actorId: string; source?: Revision["source"]; changeNote?: string | null; restoredFromRevisionId?: string | null; }

export class HistoryConflictError extends Error {
  readonly code = "BASE_REVISION_CONFLICT";
  constructor() { super("The resource changed after the supplied base revision."); this.name = "HistoryConflictError"; }
}

export class ResourceHistoryService {
  constructor(private readonly repository: HistoryRepository, private readonly now: () => string = () => new Date().toISOString(), private readonly nextId: () => string = () => randomUUID()) {}

  createRevision(input: CreateRevisionInput): Promise<Revision> {
    return this.repository.transaction((repository) => this.createRevisionWithin(repository, input));
  }

  private async createRevisionWithin(repository: HistoryRepository, input: CreateRevisionInput): Promise<Revision> {
      const resource = await requiredResource(repository, input.workspaceId, input.resourceId);
      const current = resource.currentRevisionId ? await requiredRevision(repository, input.workspaceId, resource.currentRevisionId) : null;
      if (resource.currentRevisionId !== input.expectedRevisionId) throw new HistoryConflictError();
      const createdAt = this.now();
      const revision: Revision = { id: this.nextId(), workspaceId: resource.workspaceId, datasetId: resource.datasetId, resourceId: resource.id, revisionNumber: (current?.revisionNumber ?? 0) + 1, parentRevisionId: current?.id ?? null, mergeParentRevisionIds: [], schemaPackageId: input.schemaPackageId, schemaVersion: input.schemaVersion, canonicalPayload: input.canonicalPayload, canonicalPayloadHash: hashCanonical(input.canonicalPayload), createdBy: input.actorId, createdOnDeviceId: null, source: input.source ?? "user", changeNote: input.changeNote ?? null, restoredFromRevisionId: input.restoredFromRevisionId ?? null, createdAt };
      assertNextRevision({ resource, currentRevision: current, proposed: revision });
      await repository.appendRevision(revision);
      if (!await repository.setResourceHead({ workspaceId: resource.workspaceId, resourceId: resource.id, expectedRevisionId: input.expectedRevisionId, nextRevisionId: revision.id, status: "active", updatedAt: createdAt })) throw new HistoryConflictError();
      await repository.appendAudit({ workspaceId: resource.workspaceId, datasetId: resource.datasetId, actorId: input.actorId, action: "revision.created", subjectId: resource.id, occurredAt: createdAt, metadata: { revisionId: revision.id, revisionNumber: revision.revisionNumber, source: revision.source } });
      await repository.enqueueOutbox?.({ id: revision.id, workspaceId: resource.workspaceId, actorId: input.actorId, eventType: revision.source === "restore" ? "resource.restored" : "resource.revision_created", subjectId: resource.id, occurredAt: createdAt, payload: { datasetId: resource.datasetId, revisionId: revision.id, revisionNumber: revision.revisionNumber, source: revision.source } });
      return revision;
  }

  deleteResource(input: { workspaceId: string; resourceId: string; expectedRevisionId: string | null; actorId: string; recoverUntil: string | null }): Promise<Tombstone> {
    return this.repository.transaction(async (repository) => {
      const resource = await requiredResource(repository, input.workspaceId, input.resourceId);
      if (resource.currentRevisionId !== input.expectedRevisionId) throw new HistoryConflictError();
      const deletedAt = this.now();
      const tombstone: Tombstone = { id: this.nextId(), workspaceId: resource.workspaceId, datasetId: resource.datasetId, subjectKind: "resource", subjectId: resource.id, deletedBy: input.actorId, deletedAt, recoverUntil: input.recoverUntil, priorRevisionId: resource.currentRevisionId, purgeState: "not_eligible" };
      await repository.addTombstone(tombstone);
      if (!await repository.setResourceHead({ workspaceId: resource.workspaceId, resourceId: resource.id, expectedRevisionId: input.expectedRevisionId, nextRevisionId: resource.currentRevisionId, status: "deleted_logically", updatedAt: deletedAt })) throw new HistoryConflictError();
      await repository.appendAudit({ workspaceId: resource.workspaceId, datasetId: resource.datasetId, actorId: input.actorId, action: "resource.deleted_logically", subjectId: resource.id, occurredAt: deletedAt, metadata: { tombstoneId: tombstone.id, recoverUntil: tombstone.recoverUntil } });
      await repository.enqueueOutbox?.({ id: tombstone.id, workspaceId: resource.workspaceId, actorId: input.actorId, eventType: "resource.deleted", subjectId: resource.id, occurredAt: deletedAt, payload: { datasetId: resource.datasetId, tombstoneId: tombstone.id, recoverUntil: tombstone.recoverUntil } });
      return tombstone;
    });
  }

  restoreResource(input: { workspaceId: string; resourceId: string; actorId: string; changeNote?: string }): Promise<Revision> {
    return this.repository.transaction(async (repository) => {
      const resource = await requiredResource(repository, input.workspaceId, input.resourceId);
      const tombstone = await repository.getOpenTombstone(input.workspaceId, input.resourceId);
      if (!tombstone?.priorRevisionId) throw new Error("No recoverable deletion exists for this resource.");
      if (tombstone.recoverUntil && tombstone.recoverUntil < this.now()) throw new Error("The recovery window has expired.");
      const prior = await requiredRevision(repository, input.workspaceId, tombstone.priorRevisionId);
      const restored = await this.createRevisionWithin(repository, { workspaceId: input.workspaceId, resourceId: input.resourceId, expectedRevisionId: resource.currentRevisionId, schemaPackageId: prior.schemaPackageId, schemaVersion: prior.schemaVersion, canonicalPayload: prior.canonicalPayload, actorId: input.actorId, source: "restore", changeNote: input.changeNote ?? "Restored deleted resource", restoredFromRevisionId: prior.id });
      await repository.closeTombstone(input.workspaceId, tombstone.id);
      return restored;
    });
  }
}

export function hashCanonical(payload: Readonly<Record<string, unknown>>): string { return createHash("sha256").update(canonicalJson(payload)).digest("hex"); }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`; }
async function requiredResource(repository: HistoryRepository, workspaceId: string, resourceId: string): Promise<Resource> { const value = await repository.getResource(workspaceId, resourceId); if (!value) throw new Error("Resource not found."); return value; }
async function requiredRevision(repository: HistoryRepository, workspaceId: string, revisionId: string): Promise<Revision> { const value = await repository.getRevision(workspaceId, revisionId); if (!value) throw new Error("Revision not found."); return value; }
