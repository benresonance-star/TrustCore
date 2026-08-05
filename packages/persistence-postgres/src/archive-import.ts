import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { appendAuditEvent } from "@trust-core/audit";
import {
  archiveImportCheckpoints,
  canonicalJson,
  type ArchiveImportAction,
  type ArchiveImportCheckpoint,
  type ArchiveImportExecutionTarget,
  type ArchiveImportInventory,
  type ArchiveImportOperation,
  type ArchiveImportOperationStore,
  type ArchiveImportPlan,
  type ArchiveIssue,
} from "@trust-core/archive";
import { canonicalObjectKey, type ObjectStorage } from "@trust-core/storage";
import { inTransaction, type DatabasePool, type Queryable } from "./db.js";
import { deterministicUuid } from "./ids.js";

export class PostgresArchiveImportOperationStore implements ArchiveImportOperationStore {
  constructor(
    private readonly pool: DatabasePool,
    private readonly workspaceId: string,
    private readonly request?: {
      readonly principalType: "user" | "service" | "application";
      readonly idempotencyKey: string;
      readonly fingerprint: string;
    },
  ) {}

  begin(input: {
    planId: string;
    archiveExportId: string;
    requestedBy: string;
    at: string;
  }): Promise<ArchiveImportOperation> {
    if (!this.request)
      throw new Error(
        "Import request identity is required to begin execution.",
      );
    const request = this.request;
    return inTransaction(this.pool, async (db) => {
      await scope(db, this.workspaceId);
      await db.query(
        "INSERT INTO portability_import_operations (id,workspace_id,plan_id,archive_export_id,requested_by,requested_by_principal_type,idempotency_key,request_fingerprint,checkpoint,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'authorised',$9,$9) ON CONFLICT DO NOTHING",
        [
          deterministicUuid(
            `archive-import:${this.workspaceId}:${input.planId}`,
          ),
          this.workspaceId,
          input.planId,
          input.archiveExportId,
          input.requestedBy,
          request.principalType,
          request.idempotencyKey,
          request.fingerprint,
          input.at,
        ],
      );
      const result = await db.query<ImportOperationRow>(
        "SELECT * FROM portability_import_operations WHERE workspace_id=$1 AND (plan_id=$2 OR (requested_by_principal_type=$3 AND requested_by=$4 AND idempotency_key=$5)) ORDER BY (plan_id=$2 AND requested_by_principal_type=$3 AND requested_by=$4 AND idempotency_key=$5) DESC LIMIT 1",
        [
          this.workspaceId,
          input.planId,
          request.principalType,
          input.requestedBy,
          request.idempotencyKey,
        ],
      );
      const row = requiredOperation(result.rows[0]);
      if (
        row.plan_id !== input.planId ||
        row.archive_export_id !== input.archiveExportId ||
        row.requested_by !== input.requestedBy ||
        row.requested_by_principal_type !== request.principalType ||
        row.idempotency_key !== request.idempotencyKey ||
        row.request_fingerprint !== request.fingerprint
      )
        throw Object.assign(
          new Error("Import plan already belongs to another request."),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
      return mapOperation(row);
    });
  }

  advance(input: {
    operationId: string;
    planId: string;
    expected: ArchiveImportCheckpoint;
    next: ArchiveImportCheckpoint;
    at: string;
  }): Promise<ArchiveImportOperation> {
    const expectedIndex = archiveImportCheckpoints.indexOf(input.expected);
    if (archiveImportCheckpoints[expectedIndex + 1] !== input.next)
      throw new Error("Import checkpoint transition is not sequential.");
    return inTransaction(this.pool, async (db) => {
      await scope(db, this.workspaceId);
      const result = await db.query<ImportOperationRow>(
        "UPDATE portability_import_operations SET checkpoint=$5,updated_at=$6,completed_at=CASE WHEN $5='completed' THEN $6 ELSE completed_at END WHERE workspace_id=$1 AND id=$2 AND plan_id=$3 AND checkpoint=$4 RETURNING *",
        [
          this.workspaceId,
          input.operationId,
          input.planId,
          input.expected,
          input.next,
          input.at,
        ],
      );
      if (result.rows[0]) return mapOperation(result.rows[0]);
      const current = await db.query<ImportOperationRow>(
        "SELECT * FROM portability_import_operations WHERE workspace_id=$1 AND id=$2 AND plan_id=$3",
        [this.workspaceId, input.operationId, input.planId],
      );
      return mapOperation(requiredOperation(current.rows[0]));
    });
  }

  get(operationId: string): Promise<ArchiveImportOperation | undefined> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, this.workspaceId);
      const result = await db.query<ImportOperationRow>(
        "SELECT * FROM portability_import_operations WHERE workspace_id=$1 AND id=$2",
        [this.workspaceId, operationId],
      );
      return result.rows[0] ? mapOperation(result.rows[0]) : undefined;
    });
  }
}

export class PostgresArchiveImportTarget implements ArchiveImportExecutionTarget {
  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ObjectStorage,
    private readonly workspaceId: string,
    private readonly storageProvider: string,
  ) {}

  async inventory(): Promise<ArchiveImportInventory> {
    return loadArchiveImportInventory(this.pool, this.workspaceId);
  }

  async revalidate(plan: ArchiveImportPlan): Promise<readonly ArchiveIssue[]> {
    const inventory = await this.inventory();
    const issues: ArchiveIssue[] = [];
    for (const action of plan.actions) {
      if (action.kind === "blob-bytes") {
        const exists =
          inventory.blobDigests?.includes(action.targetId) ?? false;
        if (
          (action.disposition === "insert" && exists) ||
          (action.disposition === "already_present" && !exists)
        )
          issues.push(staleIssue(action));
        continue;
      }
      if (action.kind === "retention" && action.disposition === "insert") {
        issues.push({
          code: "IMPORT_RETENTION_ADAPTER_UNAVAILABLE",
          message: "The target schema has no durable retention-policy table.",
        });
        continue;
      }
      if (
        action.kind === "workspaces" &&
        plan.mode === "mapped_workspace" &&
        action.disposition === "already_present"
      ) {
        if (!inventory.records?.workspaces?.[action.targetId])
          issues.push(staleIssue(action));
        continue;
      }
      const current = inventory.records?.[action.kind]?.[action.targetId];
      const same =
        current !== undefined &&
        action.record !== undefined &&
        canonicalJson(current) === canonicalJson(action.record);
      if (
        (action.disposition === "insert" && current !== undefined) ||
        (action.disposition === "already_present" && !same)
      )
        issues.push(staleIssue(action));
    }
    return issues;
  }

  async stageBlob(input: {
    operationId: string;
    sha256: string;
    bytes: Uint8Array;
  }): Promise<void> {
    const temporary = await this.storage.createTemporaryUpload({
      workspaceId: this.workspaceId,
      operationId: temporaryOperationId(input.operationId, input.sha256),
    });
    await this.storage.writeTemporary({
      locator: temporary,
      body: Readable.from([input.bytes]),
      mediaType: "application/octet-stream",
    });
  }

  async verifyStagedBlob(input: {
    operationId: string;
    sha256: string;
    byteLength: number;
  }): Promise<boolean> {
    const temporary = await this.temporary(input.operationId, input.sha256);
    const metadata = await this.storage.head(temporary);
    const digest = await hashStream(
      await this.storage.openReadStream(temporary),
    );
    return metadata.byteLength === input.byteLength && digest === input.sha256;
  }

  async commitBlob(input: {
    operationId: string;
    sha256: string;
  }): Promise<void> {
    const temporary = await this.temporary(input.operationId, input.sha256);
    const metadata = await this.storage.head(temporary);
    const digest = await hashStream(
      await this.storage.openReadStream(temporary),
    );
    if (digest !== input.sha256)
      throw new Error("Staged blob digest changed before immutable commit.");
    await this.storage.commitImmutable({
      temporary,
      workspaceId: this.workspaceId,
      sha256: input.sha256,
      byteLength: metadata.byteLength,
      mediaType: metadata.mediaType,
    });
  }

  async commitMetadata(input: {
    operationId: string;
    plan: ArchiveImportPlan;
    actions: readonly ArchiveImportAction[];
  }): Promise<void> {
    await this.assertCommittedBlobs(input.actions);
    await inTransaction(this.pool, async (db) => {
      await scope(db, this.workspaceId);
      await db.query("SET CONSTRAINTS ALL DEFERRED");
      for (const action of input.actions)
        await this.commitAction(db, input.operationId, input.plan, action);
    });
  }

  async appendAudit(input: {
    operationId: string;
    plan: ArchiveImportPlan;
    requestedBy: string;
    at: string;
    sourceAuditLineage: {
      readonly mode: "source_chain";
      readonly sourceWorkspaceId: string;
      readonly eventCount: number;
      readonly firstEventHash: string | null;
      readonly lastEventHash: string | null;
    };
  }): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      await scope(db, this.workspaceId);
      const auditId = deterministicUuid(
        `archive-import-audit:${input.operationId}`,
      );
      const existing = await db.query(
        "SELECT id FROM audit_events WHERE workspace_id=$1 AND id=$2",
        [this.workspaceId, auditId],
      );
      if (existing.rowCount === 1) return;
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        this.workspaceId,
      ]);
      const previous = await db.query<{ event_hash: string }>(
        "SELECT event_hash FROM audit_events WHERE workspace_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1",
        [this.workspaceId],
      );
      const metadata = {
        planId: input.plan.planId,
        archiveExportId: input.plan.archiveExportId,
        sourceWorkspaceId: input.plan.sourceWorkspaceId,
        sourceAuditLineage: input.sourceAuditLineage,
      };
      const event = appendAuditEvent(
        {
          id: auditId,
          workspaceId: this.workspaceId,
          actorType: "user",
          actorId: input.requestedBy,
          action: "archive.imported",
          subjectKind: "archive",
          subjectId: input.plan.archiveExportId,
          timestamp: input.at,
          requestId: deterministicUuid(
            `archive-import-request:${input.operationId}`,
          ),
          correlationId: input.operationId,
          metadata,
        },
        previous.rows[0]?.event_hash ?? "",
      );
      await db.query(
        "INSERT INTO audit_events (id,workspace_id,actor_type,actor_id,action,subject_kind,subject_id,occurred_at,request_id,correlation_id,previous_event_hash,event_hash,metadata_json) VALUES ($1,$2,'user',$3,'archive.imported','archive',$4,$5,$6,$7,$8,$9,$10::jsonb)",
        [
          event.id,
          event.workspaceId,
          event.actorId,
          event.subjectId,
          event.timestamp,
          event.requestId,
          event.correlationId,
          event.previousEventHash || null,
          event.eventHash,
          JSON.stringify(event.metadata),
        ],
      );
    });
  }

  private async temporary(operationId: string, sha256: string) {
    return this.storage.createTemporaryUpload({
      workspaceId: this.workspaceId,
      operationId: temporaryOperationId(operationId, sha256),
    });
  }

  private async assertCommittedBlobs(
    actions: readonly ArchiveImportAction[],
  ): Promise<void> {
    for (const action of actions) {
      if (action.kind !== "blobs" || action.disposition !== "insert") continue;
      const digest = text(action.record, "sha256");
      if (
        !(await this.storage.exists({
          key: canonicalObjectKey(this.workspaceId, digest),
        }))
      )
        throw new Error(
          "Blob metadata cannot commit before immutable bytes exist.",
        );
    }
  }

  private async commitAction(
    db: Queryable,
    operationId: string,
    plan: ArchiveImportPlan,
    action: ArchiveImportAction,
  ): Promise<void> {
    if (!action.record || action.disposition !== "insert") return;
    const record = action.record;
    switch (action.kind) {
      case "workspaces":
        return;
      case "schema-packages":
        await db.query(
          "INSERT INTO schema_packages (id,namespace,name,semantic_version,schema_digest,manifest_json,status,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT (id) DO NOTHING",
          [
            id(action.targetId),
            text(record, "namespace"),
            text(record, "name"),
            text(record, "semanticVersion"),
            text(record, "schemaDigest"),
            json(record, "manifest"),
            optionalText(record, "status") ?? "active",
            optionalText(record, "createdAt") ?? new Date().toISOString(),
          ],
        );
        return;
      case "datasets":
        await db.query(
          "INSERT INTO datasets (id,workspace_id,schema_package_id,dataset_type,name,status,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING",
          [
            id(action.targetId),
            this.workspaceId,
            id(text(record, "schemaPackageId")),
            text(record, "datasetType"),
            text(record, "name"),
            optionalText(record, "status") ?? "active",
            text(record, "createdBy"),
            text(record, "createdAt"),
            text(record, "updatedAt"),
          ],
        );
        return;
      case "resources":
        await db.query(
          "INSERT INTO resources (id,workspace_id,dataset_id,resource_type,title,status,current_revision_id,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING",
          [
            id(action.targetId),
            this.workspaceId,
            id(text(record, "datasetId")),
            text(record, "resourceType"),
            optionalText(record, "title"),
            optionalText(record, "status") ?? "active",
            optionalText(record, "currentRevisionId")
              ? id(text(record, "currentRevisionId"))
              : null,
            text(record, "createdBy"),
            text(record, "createdAt"),
            text(record, "updatedAt"),
          ],
        );
        return;
      case "blobs":
        await db.query(
          "INSERT INTO blob_objects (id,workspace_id,sha256,byte_length,media_type,storage_provider,storage_key,encryption_key_ref,encryption_state,verification_state,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',$10) ON CONFLICT (workspace_id,sha256) DO NOTHING",
          [
            id(action.targetId),
            this.workspaceId,
            text(record, "sha256"),
            number(record, "byteLength"),
            text(record, "mediaType"),
            this.storageProvider,
            canonicalObjectKey(this.workspaceId, text(record, "sha256")),
            optionalText(record, "encryptionKeyRef"),
            optionalText(record, "encryptionState") ?? "provider_managed",
            text(record, "createdAt"),
          ],
        );
        return;
      case "revisions":
        await db.query(
          "INSERT INTO revisions (id,workspace_id,dataset_id,resource_id,revision_number,parent_revision_id,merge_parent_revision_ids,schema_package_id,schema_version,canonical_payload_json,canonical_payload_hash,created_by,created_on_device_id,source,change_note,restored_from_revision_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO NOTHING",
          [
            id(action.targetId),
            this.workspaceId,
            id(text(record, "datasetId")),
            id(text(record, "resourceId")),
            number(record, "revisionNumber"),
            optionalText(record, "parentRevisionId")
              ? id(text(record, "parentRevisionId"))
              : null,
            stringArray(record, "mergeParentRevisionIds").map(id),
            id(text(record, "schemaPackageId")),
            text(record, "schemaVersion"),
            json(record, "canonicalPayload"),
            text(record, "canonicalPayloadHash"),
            text(record, "createdBy"),
            optionalText(record, "createdOnDeviceId")
              ? id(text(record, "createdOnDeviceId"))
              : null,
            optionalText(record, "source") ?? "import",
            optionalText(record, "changeNote"),
            optionalText(record, "restoredFromRevisionId")
              ? id(text(record, "restoredFromRevisionId"))
              : null,
            text(record, "createdAt"),
          ],
        );
        return;
      case "revision-blobs":
        await db.query(
          "INSERT INTO revision_blobs (id,workspace_id,revision_id,blob_object_id,role,logical_name,metadata_json,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (id) DO NOTHING",
          [
            id(action.targetId),
            this.workspaceId,
            id(text(record, "revisionId")),
            id(text(record, "blobObjectId")),
            text(record, "role"),
            optionalText(record, "logicalName"),
            json(record, "metadata", {}),
            text(record, "createdAt"),
          ],
        );
        return;
      case "relations":
        await db.query(
          "INSERT INTO relations (id,workspace_id,dataset_id,source_kind,source_id,target_kind,target_id,relation_type,metadata_json,created_by,created_at,ended_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12) ON CONFLICT (id) DO NOTHING",
          [
            id(action.targetId),
            this.workspaceId,
            id(text(record, "datasetId")),
            text(record, "sourceKind"),
            referenceId(record, "sourceKind", "sourceId"),
            text(record, "targetKind"),
            referenceId(record, "targetKind", "targetId"),
            text(record, "relationType"),
            json(record, "metadata", {}),
            text(record, "createdBy"),
            text(record, "createdAt"),
            optionalText(record, "endedAt"),
          ],
        );
        return;
      case "tombstones":
        await db.query(
          "INSERT INTO tombstones (id,workspace_id,dataset_id,subject_kind,subject_id,deleted_by,deleted_at,reason,recover_until,prior_revision_id,purge_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING",
          [
            id(action.targetId),
            this.workspaceId,
            id(text(record, "datasetId")),
            text(record, "subjectKind"),
            id(text(record, "subjectId")),
            text(record, "deletedBy"),
            text(record, "deletedAt"),
            optionalText(record, "reason"),
            optionalText(record, "recoverUntil"),
            optionalText(record, "priorRevisionId")
              ? id(text(record, "priorRevisionId"))
              : null,
            optionalText(record, "purgeState") ?? "not_eligible",
          ],
        );
        return;
      case "audit-events":
        await db.query(
          "INSERT INTO imported_archive_audit_events (id,workspace_id,import_operation_id,source_workspace_id,source_event_id,source_previous_event_hash,source_event_hash,source_event_json,imported_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now()) ON CONFLICT (workspace_id,import_operation_id,source_event_id) DO NOTHING",
          [
            deterministicUuid(
              `imported-audit:${operationId}:${text(record, "id")}`,
            ),
            this.workspaceId,
            operationId,
            plan.sourceWorkspaceId,
            text(record, "id"),
            optionalText(record, "previousEventHash"),
            text(record, "eventHash"),
            JSON.stringify(record),
          ],
        );
        return;
      case "retention":
        throw new Error("Retention metadata adapter is unavailable.");
      case "blob-bytes":
        return;
      default: {
        const exhaustive: never = action.kind;
        throw new Error(`Unsupported archive record kind: ${exhaustive}`);
      }
    }
  }
}

export async function loadArchiveImportInventory(
  pool: DatabasePool,
  workspaceId: string,
): Promise<ArchiveImportInventory> {
  return inTransaction(pool, async (db) => {
    await scope(db, workspaceId);
    const workspace = await db.query<Record<string, unknown>>(
      'SELECT id::text,name,slug,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM workspaces WHERE id=$1',
      [workspaceId],
    );
    const schemas = await db.query<Record<string, unknown>>(
      'SELECT id::text,namespace,name,semantic_version AS "semanticVersion",schema_digest AS "schemaDigest",manifest_json AS manifest,status,created_at AS "createdAt" FROM schema_packages',
    );
    const datasets = await db.query<Record<string, unknown>>(
      'SELECT id::text,workspace_id::text AS "workspaceId",schema_package_id::text AS "schemaPackageId",dataset_type AS "datasetType",name,status,created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM datasets WHERE workspace_id=$1',
      [workspaceId],
    );
    const resources = await db.query<Record<string, unknown>>(
      'SELECT id::text,workspace_id::text AS "workspaceId",dataset_id::text AS "datasetId",resource_type AS "resourceType",title,status,current_revision_id::text AS "currentRevisionId",created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM resources WHERE workspace_id=$1',
      [workspaceId],
    );
    const revisions = await db.query<Record<string, unknown>>(
      'SELECT id::text,workspace_id::text AS "workspaceId",dataset_id::text AS "datasetId",resource_id::text AS "resourceId",revision_number AS "revisionNumber",parent_revision_id::text AS "parentRevisionId",merge_parent_revision_ids::text[] AS "mergeParentRevisionIds",schema_package_id::text AS "schemaPackageId",schema_version AS "schemaVersion",canonical_payload_json AS "canonicalPayload",canonical_payload_hash AS "canonicalPayloadHash",created_by AS "createdBy",created_on_device_id::text AS "createdOnDeviceId",source,change_note AS "changeNote",restored_from_revision_id::text AS "restoredFromRevisionId",created_at AS "createdAt" FROM revisions WHERE workspace_id=$1',
      [workspaceId],
    );
    const attachments = await db.query<Record<string, unknown>>(
      'SELECT id::text,workspace_id::text AS "workspaceId",revision_id::text AS "revisionId",blob_object_id::text AS "blobObjectId",role,logical_name AS "logicalName",metadata_json AS metadata,created_at AS "createdAt" FROM revision_blobs WHERE workspace_id=$1',
      [workspaceId],
    );
    const blobs = await db.query<Record<string, unknown>>(
      'SELECT id::text,workspace_id::text AS "workspaceId",sha256,byte_length AS "byteLength",media_type AS "mediaType",storage_provider AS "storageProvider",storage_key AS "storageKey",encryption_key_ref AS "encryptionKeyRef",encryption_state AS "encryptionState",verification_state AS "verificationState",created_at AS "createdAt" FROM blob_objects WHERE workspace_id=$1',
      [workspaceId],
    );
    const relations = await db.query<Record<string, unknown>>(
      'SELECT id::text,workspace_id::text AS "workspaceId",dataset_id::text AS "datasetId",source_kind AS "sourceKind",source_id AS "sourceId",target_kind AS "targetKind",target_id AS "targetId",relation_type AS "relationType",metadata_json AS metadata,created_by AS "createdBy",created_at AS "createdAt",ended_at AS "endedAt" FROM relations WHERE workspace_id=$1',
      [workspaceId],
    );
    const tombstones = await db.query<Record<string, unknown>>(
      'SELECT id::text,workspace_id::text AS "workspaceId",dataset_id::text AS "datasetId",subject_kind AS "subjectKind",subject_id AS "subjectId",deleted_by AS "deletedBy",deleted_at AS "deletedAt",reason,recover_until AS "recoverUntil",prior_revision_id::text AS "priorRevisionId",purge_state AS "purgeState" FROM tombstones WHERE workspace_id=$1',
      [workspaceId],
    );
    return {
      workspaceId,
      records: {
        workspaces: index(workspace.rows),
        "schema-packages": index(schemas.rows),
        datasets: index(datasets.rows),
        resources: index(resources.rows),
        revisions: index(revisions.rows),
        "revision-blobs": index(attachments.rows),
        blobs: index(blobs.rows),
        relations: index(relations.rows),
        tombstones: index(tombstones.rows),
      },
      blobDigests: blobs.rows.map((row) => String(row.sha256)),
    };
  });
}

interface ImportOperationRow {
  id: string;
  plan_id: string;
  archive_export_id: string;
  requested_by: string;
  requested_by_principal_type: "user" | "service" | "application";
  idempotency_key: string;
  request_fingerprint: string;
  checkpoint: ArchiveImportCheckpoint;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
}

function mapOperation(row: ImportOperationRow): ArchiveImportOperation {
  return {
    id: row.id,
    planId: row.plan_id,
    archiveExportId: row.archive_export_id,
    requestedBy: row.requested_by,
    checkpoint: row.checkpoint,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
  };
}

function requiredOperation(
  row: ImportOperationRow | undefined,
): ImportOperationRow {
  if (!row) throw new Error("Import operation was not found.");
  return row;
}

function staleIssue(action: ArchiveImportAction): ArchiveIssue {
  return {
    code: "IMPORT_TARGET_STALE",
    message: `Target changed for ${action.kind}:${action.targetId}.`,
  };
}

function temporaryOperationId(operationId: string, digest: string): string {
  return deterministicUuid(`archive-import-blob:${operationId}:${digest}`);
}

function id(value: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : deterministicUuid(value);
}

function text(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
) {
  const value = record?.[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Imported ${key} must be a non-empty string.`);
  return value;
}

function optionalText(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error(`Imported ${key} must be a safe integer.`);
  return value;
}

function json(
  record: Readonly<Record<string, unknown>>,
  key: string,
  fallback?: unknown,
): string {
  const value = record[key] ?? fallback;
  if (value === undefined) throw new Error(`Imported ${key} is required.`);
  return JSON.stringify(value);
}

function stringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string[] {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`Imported ${key} must be a string array.`);
  return value as string[];
}

function referenceId(
  record: Readonly<Record<string, unknown>>,
  kindKey: string,
  idKey: string,
): string {
  return record[kindKey] === "external"
    ? text(record, idKey)
    : id(text(record, idKey));
}

function index(
  rows: readonly Record<string, unknown>[],
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  return Object.fromEntries(
    rows
      .filter((row) => typeof row.id === "string")
      .map((row) => [String(row.id), normalizeDates(row)]),
  );
}

function normalizeDates(
  row: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

async function scope(db: Queryable, workspaceId: string): Promise<void> {
  await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
    workspaceId,
  ]);
}

async function hashStream(stream: Readable): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(Buffer.from(chunk));
  return hash.digest("hex");
}
