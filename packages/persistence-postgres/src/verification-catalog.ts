import type { ChainedAuditEvent } from "@trust-core/audit";
import type {
  BlobObject,
  Dataset,
  Relation,
  Resource,
  Revision,
  Tombstone,
} from "@trust-core/core";
import type {
  VerificationRunResult,
  VerificationScope,
} from "@trust-core/protocol";
import type { SchemaPackageManifest } from "@trust-core/schema-registry";
import type {
  StructuralVerificationCatalog,
  VerificationRun,
  VerificationSchemaPackage,
  VerificationSnapshot,
} from "@trust-core/verification";
import { inTransaction, type DatabasePool, type Queryable } from "./db.js";

export class PostgresVerificationCatalog implements StructuralVerificationCatalog {
  constructor(private readonly pool: DatabasePool) {}

  workspaceExists(workspaceId: string): Promise<boolean> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const result = await db.query("SELECT 1 FROM workspaces WHERE id=$1", [
        workspaceId,
      ]);
      return result.rowCount === 1;
    });
  }

  listBlobs(workspaceId: string): Promise<readonly BlobObject[]> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const result = await db.query<BlobRow>(
        "SELECT id,workspace_id,sha256,byte_length,media_type,storage_provider,storage_key,verification_state,created_at FROM blob_objects WHERE workspace_id=$1 ORDER BY id",
        [workspaceId],
      );
      return result.rows.map(mapBlob);
    });
  }

  recordRun(run: VerificationRun): Promise<void> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, run.workspaceId);
      await db.query(
        "INSERT INTO verification_runs (id,workspace_id,verification_level,scope_kind,scope_id,status,started_at,completed_at,objects_checked,bytes_read,issues_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)",
        [
          run.id,
          run.workspaceId,
          run.level,
          run.scope.kind,
          run.scope.id,
          run.status,
          run.startedAt,
          run.completedAt,
          run.objectsChecked,
          run.bytesRead,
          JSON.stringify(run.issues),
        ],
      );
    });
  }

  setBlobVerification(
    workspaceId: string,
    blobId: string,
    state: BlobObject["verificationState"],
  ): Promise<void> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const result = await db.query(
        "UPDATE blob_objects SET verification_state=$3 WHERE workspace_id=$1 AND id=$2",
        [workspaceId, blobId, state],
      );
      if (result.rowCount !== 1)
        throw new Error(
          "Blob verification state update did not resolve one object.",
        );
    });
  }

  getReport(
    workspaceId: string,
    reportId: string,
  ): Promise<VerificationRunResult | undefined> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const result = await db.query<RunRow>(
        `${reportSelect} WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, reportId],
      );
      return result.rows[0] ? mapRun(result.rows[0]) : undefined;
    });
  }

  listReports(
    workspaceId: string,
    scopeFilter?: VerificationScope,
  ): Promise<readonly VerificationRunResult[]> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const values: unknown[] = [workspaceId];
      let filter = "workspace_id=$1";
      if (scopeFilter) {
        values.push(scopeFilter.kind, scopeFilter.id);
        filter += " AND scope_kind=$2 AND scope_id=$3";
      }
      const result = await db.query<RunRow>(
        `${reportSelect} WHERE ${filter} ORDER BY started_at DESC,id DESC`,
        values,
      );
      return result.rows.map(mapRun);
    });
  }

  loadSnapshot(workspaceId: string): Promise<VerificationSnapshot> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const workspace = await db.query<{ id: string }>(
        "SELECT id FROM workspaces WHERE id=$1",
        [workspaceId],
      );
      const datasets = await db.query<DatasetRow>(
        "SELECT id,workspace_id,schema_package_id,dataset_type,name,status,retention_policy_id,created_by,created_at,updated_at FROM datasets WHERE workspace_id=$1 ORDER BY id",
        [workspaceId],
      );
      const resources = await db.query<ResourceRow>(
        "SELECT id,workspace_id,dataset_id,resource_type,title,status,current_revision_id,created_by,created_at,updated_at FROM resources WHERE workspace_id=$1 ORDER BY id",
        [workspaceId],
      );
      const revisions = await db.query<RevisionRow>(
        "SELECT id,workspace_id,dataset_id,resource_id,revision_number,parent_revision_id,merge_parent_revision_ids,schema_package_id,schema_version,canonical_payload_json,canonical_payload_hash,created_by,created_on_device_id,source,change_note,restored_from_revision_id,created_at FROM revisions WHERE workspace_id=$1 ORDER BY resource_id,revision_number",
        [workspaceId],
      );
      const blobs = await db.query<BlobRow>(
        "SELECT id,workspace_id,sha256,byte_length,media_type,storage_provider,storage_key,verification_state,created_at FROM blob_objects WHERE workspace_id=$1 ORDER BY id",
        [workspaceId],
      );
      const revisionBlobs = await db.query<RevisionBlobRow>(
        "SELECT id,workspace_id,revision_id,blob_object_id,role FROM revision_blobs WHERE workspace_id=$1 ORDER BY id",
        [workspaceId],
      );
      const relations = await db.query<RelationRow>(
        "SELECT id,workspace_id,dataset_id,source_kind,source_id,target_kind,target_id,relation_type,metadata_json,created_by,created_at,ended_at FROM relations WHERE workspace_id=$1 ORDER BY id",
        [workspaceId],
      );
      const tombstones = await db.query<TombstoneRow>(
        "SELECT id,workspace_id,dataset_id,subject_kind,subject_id,deleted_by,deleted_at,recover_until,prior_revision_id,purge_state FROM tombstones WHERE workspace_id=$1 AND restored_at IS NULL ORDER BY id",
        [workspaceId],
      );
      const auditEvents = await db.query<AuditRow>(
        "SELECT id,workspace_id,actor_type,actor_id,action,subject_kind,subject_id,occurred_at,request_id,correlation_id,previous_event_hash,event_hash,metadata_json FROM audit_events WHERE workspace_id=$1 ORDER BY occurred_at,id",
        [workspaceId],
      );
      const schemaPackages = await db.query<SchemaRow>(
        "SELECT s.id,s.semantic_version,s.manifest_json,s.status FROM schema_packages s WHERE s.id IN (SELECT schema_package_id FROM datasets WHERE workspace_id=$1 UNION SELECT schema_package_id FROM revisions WHERE workspace_id=$1) ORDER BY s.id",
        [workspaceId],
      );
      return {
        workspaceExists: workspace.rowCount === 1,
        datasets: datasets.rows.map(mapDataset),
        resources: resources.rows.map(mapResource),
        revisions: revisions.rows.map(mapRevision),
        blobs: blobs.rows.map(mapBlob),
        revisionBlobs: revisionBlobs.rows.map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          revisionId: row.revision_id,
          blobObjectId: row.blob_object_id,
          role: row.role,
        })),
        relations: relations.rows.map(mapRelation),
        tombstones: tombstones.rows.map(mapTombstone),
        auditEvents: auditEvents.rows.map(mapAuditEvent),
        schemaPackages: schemaPackages.rows.map(mapSchema),
      };
    });
  }
}

async function scope(db: Queryable, workspaceId: string): Promise<void> {
  await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
    workspaceId,
  ]);
}

interface DatasetRow {
  id: string;
  workspace_id: string;
  schema_package_id: string;
  dataset_type: string;
  name: string;
  status: Dataset["status"];
  retention_policy_id: string | null;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
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
  canonical_payload_json: Readonly<Record<string, unknown>>;
  canonical_payload_hash: string;
  created_by: string;
  created_on_device_id: string | null;
  source: Revision["source"];
  change_note: string | null;
  restored_from_revision_id: string | null;
  created_at: string | Date;
}
interface BlobRow {
  id: string;
  workspace_id: string;
  sha256: string;
  byte_length: number | string;
  media_type: string;
  storage_provider: string;
  storage_key: string;
  verification_state: BlobObject["verificationState"];
  created_at: string | Date;
}
interface RevisionBlobRow {
  id: string;
  workspace_id: string;
  revision_id: string;
  blob_object_id: string;
  role: string;
}
interface RelationRow {
  id: string;
  workspace_id: string;
  dataset_id: string;
  source_kind: Relation["sourceKind"];
  source_id: string;
  target_kind: Relation["targetKind"];
  target_id: string;
  relation_type: string;
  metadata_json: Readonly<Record<string, unknown>>;
  created_by: string;
  created_at: string | Date;
  ended_at: string | Date | null;
}
interface TombstoneRow {
  id: string;
  workspace_id: string;
  dataset_id: string;
  subject_kind: Tombstone["subjectKind"];
  subject_id: string;
  deleted_by: string;
  deleted_at: string | Date;
  recover_until: string | Date | null;
  prior_revision_id: string | null;
  purge_state: Tombstone["purgeState"];
}
interface AuditRow {
  id: string;
  workspace_id: string;
  actor_type: ChainedAuditEvent["actorType"];
  actor_id: string;
  action: string;
  subject_kind: string;
  subject_id: string;
  occurred_at: string | Date;
  request_id: string;
  correlation_id: string;
  previous_event_hash: string | null;
  event_hash: string;
  metadata_json: Readonly<Record<string, unknown>>;
}
interface SchemaRow {
  id: string;
  semantic_version: string;
  manifest_json: SchemaPackageManifest;
  status: VerificationSchemaPackage["status"];
}
interface RunRow {
  id: string;
  workspace_id: string;
  verification_level: VerificationRunResult["level"];
  scope_kind: VerificationScope["kind"];
  scope_id: string;
  status: VerificationRunResult["status"];
  started_at: string | Date;
  completed_at: string | Date | null;
  objects_checked: number;
  bytes_read: number | string;
  issues_json: VerificationRunResult["issues"];
}

const reportSelect =
  "SELECT id,workspace_id,verification_level,scope_kind,scope_id,status,started_at,completed_at,objects_checked,bytes_read,issues_json FROM verification_runs";
const iso = (value: string | Date): string => new Date(value).toISOString();
const nullableIso = (value: string | Date | null): string | null =>
  value === null ? null : iso(value);

function mapDataset(row: DatasetRow): Dataset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    schemaPackageId: row.schema_package_id,
    datasetType: row.dataset_type,
    name: row.name,
    status: row.status,
    retentionPolicyId: row.retention_policy_id,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    resourceType: row.resource_type,
    title: row.title,
    status: row.status,
    currentRevisionId: row.current_revision_id,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapRevision(row: RevisionRow): Revision {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    resourceId: row.resource_id,
    revisionNumber: row.revision_number,
    parentRevisionId: row.parent_revision_id,
    mergeParentRevisionIds: row.merge_parent_revision_ids,
    schemaPackageId: row.schema_package_id,
    schemaVersion: row.schema_version,
    canonicalPayload: row.canonical_payload_json,
    canonicalPayloadHash: row.canonical_payload_hash,
    createdBy: row.created_by,
    createdOnDeviceId: row.created_on_device_id,
    source: row.source,
    changeNote: row.change_note,
    restoredFromRevisionId: row.restored_from_revision_id,
    createdAt: iso(row.created_at),
  };
}
function mapBlob(row: BlobRow): BlobObject {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sha256: row.sha256,
    byteLength: Number(row.byte_length),
    mediaType: row.media_type,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    verificationState: row.verification_state,
    createdAt: iso(row.created_at),
  };
}
function mapRelation(row: RelationRow): Relation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    relationType: row.relation_type,
    metadata: row.metadata_json,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    endedAt: nullableIso(row.ended_at),
  };
}
function mapTombstone(row: TombstoneRow): Tombstone {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    deletedBy: row.deleted_by,
    deletedAt: iso(row.deleted_at),
    recoverUntil: nullableIso(row.recover_until),
    priorRevisionId: row.prior_revision_id,
    purgeState: row.purge_state,
  };
}
function mapAuditEvent(row: AuditRow): ChainedAuditEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    timestamp: iso(row.occurred_at),
    requestId: row.request_id,
    correlationId: row.correlation_id,
    previousEventHash: row.previous_event_hash ?? "",
    eventHash: row.event_hash,
    metadata: row.metadata_json,
  };
}
function mapSchema(row: SchemaRow): VerificationSchemaPackage {
  return {
    id: row.id,
    version: row.semantic_version,
    manifest: row.manifest_json,
    status: row.status,
  };
}
function mapRun(row: RunRow): VerificationRunResult {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    level: row.verification_level,
    scope: { kind: row.scope_kind, id: row.scope_id },
    status: row.status,
    startedAt: iso(row.started_at),
    completedAt: nullableIso(row.completed_at),
    objectsChecked: row.objects_checked,
    bytesRead: Number(row.bytes_read),
    issues: row.issues_json,
  };
}
