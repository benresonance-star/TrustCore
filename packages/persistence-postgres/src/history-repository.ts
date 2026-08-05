import type { Resource, Revision, Tombstone } from "@trust-core/core";
import { appendAuditEvent } from "@trust-core/audit";
import type {
  HistoryAuditEvent,
  HistoryOutboxEvent,
  HistoryRepository,
} from "@trust-core/operations";
import { randomUUID } from "node:crypto";
import { inTransaction, type DatabasePool, type Queryable } from "./db.js";
import { deterministicUuid } from "./ids.js";

export class PostgresHistoryRepository implements HistoryRepository {
  constructor(
    private readonly pool: DatabasePool,
    private readonly bound?: Queryable,
  ) {}
  transaction<T>(
    work: (repository: HistoryRepository) => Promise<T>,
  ): Promise<T> {
    return this.bound
      ? work(this)
      : inTransaction(this.pool, (client) =>
          work(new PostgresHistoryRepository(this.pool, client)),
        );
  }
  async getResource(
    workspaceId: string,
    resourceId: string,
  ): Promise<Resource | undefined> {
    const db = this.db();
    await scope(db, workspaceId);
    const r = await db.query<ResourceRow>(
      "SELECT id,workspace_id,dataset_id,resource_type,title,status,current_revision_id,created_by,created_at,updated_at FROM resources WHERE workspace_id=$1 AND id=$2",
      [workspaceId, resourceId],
    );
    return r.rows[0] ? mapResource(r.rows[0]) : undefined;
  }
  async getRevision(
    workspaceId: string,
    revisionId: string,
  ): Promise<Revision | undefined> {
    const db = this.db();
    await scope(db, workspaceId);
    const r = await db.query<RevisionRow>(
      "SELECT id,workspace_id,dataset_id,resource_id,revision_number,parent_revision_id,merge_parent_revision_ids,schema_package_id,schema_version,canonical_payload_json,canonical_payload_hash,created_by,created_on_device_id,source,change_note,restored_from_revision_id,created_at FROM revisions WHERE workspace_id=$1 AND id=$2",
      [workspaceId, revisionId],
    );
    return r.rows[0] ? mapRevision(r.rows[0]) : undefined;
  }
  async appendRevision(v: Revision): Promise<void> {
    const db = this.db();
    await scope(db, v.workspaceId);
    await db.query(
      "INSERT INTO revisions (id,workspace_id,dataset_id,resource_id,revision_number,parent_revision_id,merge_parent_revision_ids,schema_package_id,schema_version,canonical_payload_json,canonical_payload_hash,created_by,created_on_device_id,source,change_note,restored_from_revision_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17)",
      [
        v.id,
        v.workspaceId,
        v.datasetId,
        v.resourceId,
        v.revisionNumber,
        v.parentRevisionId,
        v.mergeParentRevisionIds,
        v.schemaPackageId,
        v.schemaVersion,
        JSON.stringify(v.canonicalPayload),
        v.canonicalPayloadHash,
        v.createdBy,
        v.createdOnDeviceId,
        v.source,
        v.changeNote,
        v.restoredFromRevisionId,
        v.createdAt,
      ],
    );
  }
  async setResourceHead(i: {
    workspaceId: string;
    resourceId: string;
    expectedRevisionId: string | null;
    nextRevisionId: string | null;
    status: Resource["status"];
    updatedAt: string;
  }): Promise<boolean> {
    const db = this.db();
    await scope(db, i.workspaceId);
    const r = await db.query(
      "UPDATE resources SET current_revision_id=$4,status=$5,updated_at=$6 WHERE workspace_id=$1 AND id=$2 AND current_revision_id IS NOT DISTINCT FROM $3",
      [
        i.workspaceId,
        i.resourceId,
        i.expectedRevisionId,
        i.nextRevisionId,
        i.status,
        i.updatedAt,
      ],
    );
    return r.rowCount === 1;
  }
  async addTombstone(v: Tombstone): Promise<void> {
    const db = this.db();
    await scope(db, v.workspaceId);
    await db.query(
      "INSERT INTO tombstones (id,workspace_id,dataset_id,subject_kind,subject_id,deleted_by,deleted_at,reason,recover_until,prior_revision_id,purge_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        v.id,
        v.workspaceId,
        v.datasetId,
        v.subjectKind,
        v.subjectId,
        v.deletedBy,
        v.deletedAt,
        v.reason ?? null,
        v.recoverUntil,
        v.priorRevisionId,
        v.purgeState,
      ],
    );
  }
  async getOpenTombstone(
    workspaceId: string,
    resourceId: string,
  ): Promise<Tombstone | undefined> {
    const db = this.db();
    await scope(db, workspaceId);
    const r = await db.query<TombstoneRow>(
      "SELECT id,workspace_id,dataset_id,subject_kind,subject_id,deleted_by,deleted_at,reason,recover_until,prior_revision_id,restored_at,restored_by,purge_state FROM tombstones WHERE workspace_id=$1 AND subject_kind='resource' AND subject_id=$2 AND restored_at IS NULL AND purge_state<>'purged' ORDER BY deleted_at DESC LIMIT 1",
      [workspaceId, resourceId],
    );
    return r.rows[0] ? mapTombstone(r.rows[0]) : undefined;
  }
  async closeTombstone(
    workspaceId: string,
    tombstoneId: string,
    restoredBy: string,
  ): Promise<void> {
    const db = this.db();
    await scope(db, workspaceId);
    await db.query(
      "UPDATE tombstones SET restored_at=now(),restored_by=$3 WHERE workspace_id=$1 AND id=$2 AND restored_at IS NULL",
      [workspaceId, tombstoneId, restoredBy],
    );
  }
  async appendAudit(event: HistoryAuditEvent): Promise<void> {
    const db = this.db();
    await scope(db, event.workspaceId);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      event.workspaceId,
    ]);
    const previous = await db.query<{ event_hash: string }>(
      "SELECT event_hash FROM audit_events WHERE workspace_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1",
      [event.workspaceId],
    );
    const id = randomUUID(),
      requestId = randomUUID(),
      correlationId = randomUUID();
    const chained = appendAuditEvent(
      {
        id,
        workspaceId: event.workspaceId,
        actorType: "user",
        actorId: event.actorId,
        action: event.action,
        subjectKind: "resource",
        subjectId: event.subjectId,
        timestamp: event.occurredAt,
        requestId,
        correlationId,
        metadata: event.metadata,
      },
      previous.rows[0]?.event_hash ?? "",
    );
    await db.query(
      "INSERT INTO audit_events (id,workspace_id,dataset_id,actor_type,actor_id,action,subject_kind,subject_id,occurred_at,request_id,correlation_id,previous_event_hash,event_hash,metadata_json) VALUES ($1,$2,$3,'user',$4,$5,'resource',$6,$7,$8,$9,$10,$11,$12::jsonb)",
      [
        id,
        event.workspaceId,
        event.datasetId,
        event.actorId,
        event.action,
        event.subjectId,
        event.occurredAt,
        requestId,
        correlationId,
        chained.previousEventHash || null,
        chained.eventHash,
        JSON.stringify(event.metadata),
      ],
    );
  }
  async enqueueOutbox(event: HistoryOutboxEvent): Promise<void> {
    const db = this.db();
    await scope(db, event.workspaceId);
    const operationId = event.id;
    await db.query(
      "INSERT INTO operations (id,workspace_id,operation_type,idempotency_key,state,requested_by,request_json,result_json,completed_at) VALUES ($1,$2,$3,$4,'completed',$5,$6::jsonb,$7::jsonb,$8) ON CONFLICT (operation_type,workspace_id,idempotency_key,idempotency_scope) DO NOTHING",
      [
        operationId,
        event.workspaceId,
        event.eventType,
        event.id,
        event.actorId,
        JSON.stringify({ subjectId: event.subjectId }),
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );
    await db.query(
      "INSERT INTO outbox_events (id,workspace_id,operation_id,event_type,payload_json,available_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT (id) DO NOTHING",
      [
        deterministicUuid(`history-outbox:${event.id}`),
        event.workspaceId,
        operationId,
        event.eventType,
        JSON.stringify({ subjectId: event.subjectId, ...event.payload }),
        event.occurredAt,
      ],
    );
  }
  private db(): Queryable {
    return this.bound ?? this.pool;
  }
}
async function scope(db: Queryable, workspaceId: string) {
  await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
    workspaceId,
  ]);
}
interface ResourceRow {
  id: string;
  workspace_id: string;
  dataset_id: string;
  resource_type: string;
  title: string | null;
  status: Resource["status"];
  current_revision_id: string | null;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}
interface RevisionRow {
  id: string;
  workspace_id: string;
  dataset_id: string;
  resource_id: string;
  revision_number: number;
  parent_revision_id: string | null;
  merge_parent_revision_ids: string[];
  schema_package_id: string;
  schema_version: string;
  canonical_payload_json: Record<string, unknown>;
  canonical_payload_hash: string;
  created_by: string;
  created_on_device_id: string | null;
  source: Revision["source"];
  change_note: string | null;
  restored_from_revision_id: string | null;
  created_at: string | Date;
}
interface TombstoneRow {
  id: string;
  workspace_id: string;
  dataset_id: string;
  subject_kind: Tombstone["subjectKind"];
  subject_id: string;
  deleted_by: string;
  deleted_at: string | Date;
  reason: string | null;
  recover_until: string | Date | null;
  prior_revision_id: string | null;
  restored_at: string | Date | null;
  restored_by: string | null;
  purge_state: Tombstone["purgeState"];
}
const iso = (v: string | Date) => new Date(v).toISOString();
function mapResource(r: ResourceRow): Resource {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    datasetId: r.dataset_id,
    resourceType: r.resource_type,
    title: r.title,
    status: r.status,
    currentRevisionId: r.current_revision_id,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function mapRevision(r: RevisionRow): Revision {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    datasetId: r.dataset_id,
    resourceId: r.resource_id,
    revisionNumber: r.revision_number,
    parentRevisionId: r.parent_revision_id,
    mergeParentRevisionIds: r.merge_parent_revision_ids,
    schemaPackageId: r.schema_package_id,
    schemaVersion: r.schema_version,
    canonicalPayload: r.canonical_payload_json,
    canonicalPayloadHash: r.canonical_payload_hash,
    createdBy: r.created_by,
    createdOnDeviceId: r.created_on_device_id,
    source: r.source,
    changeNote: r.change_note,
    restoredFromRevisionId: r.restored_from_revision_id,
    createdAt: iso(r.created_at),
  };
}
function mapTombstone(r: TombstoneRow): Tombstone {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    datasetId: r.dataset_id,
    subjectKind: r.subject_kind,
    subjectId: r.subject_id,
    deletedBy: r.deleted_by,
    deletedAt: iso(r.deleted_at),
    reason: r.reason,
    recoverUntil: r.recover_until ? iso(r.recover_until) : null,
    priorRevisionId: r.prior_revision_id,
    restoredAt: r.restored_at ? iso(r.restored_at) : null,
    restoredBy: r.restored_by,
    purgeState: r.purge_state,
  };
}
