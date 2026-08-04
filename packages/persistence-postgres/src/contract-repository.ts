import { createHash, randomUUID } from "node:crypto";
import { appendAuditEvent } from "@trust-core/audit";
import { isBreakGlassEligibleAction } from "@trust-core/policy";
import type { PolicyAction } from "@trust-core/policy";
import type {
  ApplicationRegistration,
  AuditEventRecord,
  AuthenticatedActor,
  BreakGlassGrant,
  DatasetRecord,
  OperationState,
  OperationStatus,
  OperationSummary,
  PolicyAssignment,
  RelationRecord,
  ResourceRecord,
  RevisionGraph,
  RevisionRecord,
  UploadSession,
  WorkspaceSummary,
} from "@trust-core/protocol";
import { inTransaction, type DatabasePool } from "./db.js";

export interface RelationQuery {
  datasetId?: string;
  subjectKind?: RelationRecord["sourceKind"];
  subjectId?: string;
  includeEnded?: boolean;
}

export class PostgresContractRepository {
  constructor(private readonly pool: DatabasePool) {}

  registerApplication(
    registration: ApplicationRegistration & { idempotencyKey: string },
  ): Promise<ApplicationRegistration> {
    return this.scoped(registration.workspaceId, async (db) => {
      const requestFingerprint = createHash("sha256")
        .update(
          stableJson({
            namespace: registration.namespace,
            name: registration.name,
            applicationVersion: registration.applicationVersion,
            schemaPackageIds: registration.schemaPackageIds,
            capabilities: registration.capabilities,
          }),
        )
        .digest("hex");
      try {
        const result = await db.query<ApplicationRow>(
          "INSERT INTO application_registrations (id,workspace_id,namespace,name,application_version,schema_package_ids,capabilities_json,status,idempotency_key,request_fingerprint,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6::uuid[],$7::jsonb,$8,$9,$10,$11,$12) ON CONFLICT (workspace_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET updated_at=application_registrations.updated_at RETURNING *",
          [
            registration.id,
            registration.workspaceId,
            registration.namespace,
            registration.name,
            registration.applicationVersion,
            registration.schemaPackageIds,
            JSON.stringify(registration.capabilities),
            registration.status,
            registration.idempotencyKey,
            requestFingerprint,
            registration.createdAt,
            registration.updatedAt,
          ],
        );
        const row = required(
          result.rows[0],
          "Application registration was not persisted.",
        );
        if (row.request_fingerprint !== requestFingerprint)
          throw codedError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for a different application registration.",
          );
        return mapApplication(row);
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          throw codedError(
            "IDEMPOTENCY_CONFLICT",
            "Application namespace or idempotency key is already registered with different input.",
          );
        throw error;
      }
    });
  }

  listApplications(
    workspaceId: string,
  ): Promise<readonly ApplicationRegistration[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<ApplicationRow>(
        "SELECT * FROM application_registrations WHERE workspace_id=$1 ORDER BY namespace",
        [workspaceId],
      );
      return result.rows.map(mapApplication);
    });
  }

  listWorkspaces(workspaceId: string): Promise<readonly WorkspaceSummary[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<WorkspaceRow>(
        "SELECT id,name,slug,status,created_at,updated_at FROM workspaces WHERE id=$1",
        [workspaceId],
      );
      return result.rows.map(mapWorkspace);
    });
  }

  listDatasets(workspaceId: string): Promise<readonly DatasetRecord[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<DatasetRow>(
        "SELECT id,workspace_id,schema_package_id,dataset_type,name,status,created_at,updated_at FROM datasets WHERE workspace_id=$1 ORDER BY created_at,id",
        [workspaceId],
      );
      return result.rows.map(mapDataset);
    });
  }

  getDataset(
    workspaceId: string,
    datasetId: string,
  ): Promise<DatasetRecord | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<DatasetRow>(
        "SELECT id,workspace_id,schema_package_id,dataset_type,name,status,created_at,updated_at FROM datasets WHERE workspace_id=$1 AND id=$2",
        [workspaceId, datasetId],
      );
      return result.rows[0] ? mapDataset(result.rows[0]) : undefined;
    });
  }

  listResources(
    workspaceId: string,
    datasetId?: string,
  ): Promise<readonly ResourceRecord[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<ResourceRow>(
        `SELECT id,workspace_id,dataset_id,resource_type,title,status,current_revision_id,created_at,updated_at FROM resources WHERE workspace_id=$1${datasetId ? " AND dataset_id=$2" : ""} ORDER BY created_at,id`,
        datasetId ? [workspaceId, datasetId] : [workspaceId],
      );
      return result.rows.map(mapResource);
    });
  }

  getResource(
    workspaceId: string,
    resourceId: string,
  ): Promise<ResourceRecord | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<ResourceRow>(
        "SELECT id,workspace_id,dataset_id,resource_type,title,status,current_revision_id,created_at,updated_at FROM resources WHERE workspace_id=$1 AND id=$2",
        [workspaceId, resourceId],
      );
      return result.rows[0] ? mapResource(result.rows[0]) : undefined;
    });
  }

  getRevisionGraph(
    workspaceId: string,
    resourceId: string,
  ): Promise<RevisionGraph | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const resource = await db.query<{ current_revision_id: string | null }>(
        "SELECT current_revision_id FROM resources WHERE workspace_id=$1 AND id=$2",
        [workspaceId, resourceId],
      );
      if (!resource.rows[0]) return undefined;
      const revisions = await db.query<RevisionRow>(
        "SELECT id,workspace_id,dataset_id,resource_id,revision_number,parent_revision_id,merge_parent_revision_ids,schema_package_id,schema_version,canonical_payload_json,canonical_payload_hash,created_by,source,change_note,restored_from_revision_id,created_at FROM revisions WHERE workspace_id=$1 AND resource_id=$2 ORDER BY revision_number",
        [workspaceId, resourceId],
      );
      return {
        resourceId,
        headRevisionId: resource.rows[0].current_revision_id,
        revisions: revisions.rows.map(mapRevision),
      };
    });
  }

  listAuditEvents(
    workspaceId: string,
    datasetId?: string,
  ): Promise<readonly AuditEventRecord[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<AuditRow>(
        `SELECT id,workspace_id,dataset_id,actor_type,actor_id,action,subject_kind,subject_id,occurred_at,request_id,correlation_id,operation_id,event_hash,metadata_json FROM audit_events WHERE workspace_id=$1${datasetId ? " AND dataset_id=$2" : ""} ORDER BY occurred_at DESC,id DESC LIMIT 100`,
        datasetId ? [workspaceId, datasetId] : [workspaceId],
      );
      return result.rows.map(mapAudit);
    });
  }

  listPolicyAssignments(
    workspaceId: string,
    principalId?: string,
  ): Promise<readonly PolicyAssignment[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<PolicyRow>(
        `SELECT * FROM policy_assignments WHERE workspace_id=$1 AND revoked_at IS NULL${principalId ? " AND principal_id=$2" : ""} ORDER BY created_at,id`,
        principalId ? [workspaceId, principalId] : [workspaceId],
      );
      return result.rows.map(mapPolicy);
    });
  }

  createPolicyAssignment(
    assignment: PolicyAssignment,
  ): Promise<PolicyAssignment> {
    return this.scoped(assignment.workspaceId, async (db) => {
      const result = await db.query<PolicyRow>(
        "INSERT INTO policy_assignments (id,workspace_id,principal_type,principal_id,role,scope_kind,scope_id,created_by,created_at,revoked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          assignment.id,
          assignment.workspaceId,
          assignment.principalType,
          assignment.principalId,
          assignment.role,
          assignment.scopeKind,
          assignment.scopeId,
          assignment.createdBy,
          assignment.createdAt,
          assignment.revokedAt ?? null,
        ],
      );
      return mapPolicy(
        required(result.rows[0], "Policy assignment was not persisted."),
      );
    });
  }

  revokePolicyAssignment(
    workspaceId: string,
    assignmentId: string,
    revokedAt: string,
  ): Promise<void> {
    return this.scoped(workspaceId, async (db) => {
      await db.query(
        "UPDATE policy_assignments SET revoked_at=$3 WHERE workspace_id=$1 AND id=$2 AND revoked_at IS NULL",
        [workspaceId, assignmentId, revokedAt],
      );
    });
  }

  createBreakGlassGrant(grant: BreakGlassGrant): Promise<BreakGlassGrant> {
    if (
      !grant.reason.trim() ||
      grant.actions.length === 0 ||
      grant.actions.some((action) => !isBreakGlassEligibleAction(action))
    )
      throw new Error(
        "Break-glass grants require a reason and eligible actions.",
      );
    if (Date.parse(grant.expiresAt) <= Date.parse(grant.grantedAt))
      throw new Error("Break-glass expiry must follow grant time.");
    return this.scoped(grant.workspaceId, async (db) => {
      const result = await db.query<BreakGlassRow>(
        "INSERT INTO break_glass_grants (id,workspace_id,principal_id,reason,actions_json,granted_by,granted_at,expires_at,revoked_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING *",
        [
          grant.id,
          grant.workspaceId,
          grant.principalId,
          grant.reason,
          JSON.stringify(grant.actions),
          grant.grantedBy,
          grant.grantedAt,
          grant.expiresAt,
          grant.revokedAt ?? null,
        ],
      );
      return mapBreakGlass(
        required(result.rows[0], "Break-glass grant was not persisted."),
      );
    });
  }

  revokeBreakGlassGrant(
    workspaceId: string,
    grantId: string,
    revokedAt: string,
  ): Promise<void> {
    return this.scoped(workspaceId, async (db) => {
      await db.query(
        "UPDATE break_glass_grants SET revoked_at=$3 WHERE workspace_id=$1 AND id=$2 AND revoked_at IS NULL",
        [workspaceId, grantId, revokedAt],
      );
    });
  }

  listActiveBreakGlassGrants(
    workspaceId: string,
    at: string,
    principalId?: string,
  ): Promise<readonly BreakGlassGrant[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<BreakGlassRow>(
        `SELECT * FROM break_glass_grants WHERE workspace_id=$1 AND revoked_at IS NULL AND granted_at<=$2 AND expires_at>$2${principalId ? " AND principal_id=$3" : ""} ORDER BY expires_at`,
        principalId ? [workspaceId, at, principalId] : [workspaceId, at],
      );
      return result.rows.map(mapBreakGlass);
    });
  }

  recordBreakGlassUse(input: {
    workspaceId: string;
    principalId: string;
    grantId: string;
    action: PolicyAction;
    reason: string;
    requestId?: string;
    occurredAt: string;
  }): Promise<void> {
    return this.scoped(input.workspaceId, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        input.workspaceId,
      ]);
      const previous = await db.query<{ event_hash: string }>(
        "SELECT event_hash FROM audit_events WHERE workspace_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1",
        [input.workspaceId],
      );
      const requestId = input.requestId ?? randomUUID();
      const event = appendAuditEvent(
        {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          actorType: "user",
          actorId: input.principalId,
          action: "break_glass.used",
          subjectKind: "break_glass_grant",
          subjectId: input.grantId,
          timestamp: input.occurredAt,
          requestId,
          correlationId: requestId,
          metadata: { authorizedAction: input.action, reason: input.reason },
        },
        previous.rows[0]?.event_hash ?? "",
      );
      await db.query(
        "INSERT INTO audit_events (id,workspace_id,actor_type,actor_id,action,subject_kind,subject_id,occurred_at,request_id,correlation_id,previous_event_hash,event_hash,metadata_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)",
        [
          event.id,
          event.workspaceId,
          event.actorType,
          event.actorId,
          event.action,
          event.subjectKind,
          event.subjectId,
          event.timestamp,
          event.requestId,
          event.correlationId,
          event.previousEventHash,
          event.eventHash,
          JSON.stringify(event.metadata),
        ],
      );
    });
  }

  listRelations(
    workspaceId: string,
    query: RelationQuery = {},
  ): Promise<readonly RelationRecord[]> {
    return this.scoped(workspaceId, async (db) => {
      const values: unknown[] = [workspaceId];
      const clauses = ["workspace_id=$1"];
      if (query.datasetId) {
        values.push(query.datasetId);
        clauses.push(`dataset_id=$${values.length}`);
      }
      if (!query.includeEnded) clauses.push("ended_at IS NULL");
      if (query.subjectKind && query.subjectId) {
        values.push(query.subjectKind, query.subjectId);
        clauses.push(
          `((source_kind=$${values.length - 1} AND source_id=$${values.length}) OR (target_kind=$${values.length - 1} AND target_id=$${values.length}))`,
        );
      }
      const result = await db.query<RelationRow>(
        `SELECT * FROM relations WHERE ${clauses.join(" AND ")} ORDER BY created_at,id`,
        values,
      );
      return result.rows.map(mapRelation);
    });
  }

  getOperation(
    workspaceId: string,
    operationId: string,
  ): Promise<OperationSummary | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<OperationRow>(
        "SELECT id,workspace_id,operation_type,state,requested_by,retry_count,error_code,created_at,updated_at,completed_at FROM operations WHERE workspace_id=$1 AND id=$2",
        [workspaceId, operationId],
      );
      return result.rows[0] ? mapOperation(result.rows[0]) : undefined;
    });
  }

  getUploadSession(
    workspaceId: string,
    uploadId: string,
    actor: AuthenticatedActor,
  ): Promise<UploadSession | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<UploadRow>(
        `${uploadSelect} WHERE u.workspace_id=$1 AND u.id=$2${applicationOwnerClause(actor, 3)}`,
        actor.principalType === "application"
          ? [workspaceId, uploadId, actor.id]
          : [workspaceId, uploadId],
      );
      return result.rows[0] ? mapUpload(result.rows[0]) : undefined;
    }, actor);
  }

  createUploadSession(input: {
    workspaceId: string;
    actorId: string;
    principalType: NonNullable<AuthenticatedActor["principalType"]>;
    idempotencyKey: string;
    mediaType: string;
    expectedByteLength: number;
    expectedSha256: string;
    expiresInSeconds: number;
    expiresAt: string;
    now: string;
  }): Promise<UploadSession> {
    const actor: AuthenticatedActor = {
      id: input.actorId,
      displayName: input.actorId,
      roles: [],
      workspaceIds: [input.workspaceId],
      principalType: input.principalType,
    };
    return this.scoped(input.workspaceId, async (db) => {
      const idempotencyScope = `${input.principalType}:${input.actorId}`;
      const request = {
        mediaType: input.mediaType,
        expectedByteLength: input.expectedByteLength,
        expectedSha256: input.expectedSha256,
        expiresInSeconds: input.expiresInSeconds,
      };
      const operation = await db.query<{
        id: string;
        request_json: Record<string, unknown>;
      }>(
        "INSERT INTO operations (workspace_id,operation_type,idempotency_key,idempotency_scope,state,requested_by,requested_by_principal_type,request_json,created_at,updated_at) VALUES ($1,'upload.session',$2,$3,'requested',$4,$5,$6::jsonb,$7,$7) ON CONFLICT (operation_type,workspace_id,idempotency_key,idempotency_scope) DO UPDATE SET updated_at=operations.updated_at RETURNING id,request_json",
        [
          input.workspaceId,
          input.idempotencyKey,
          idempotencyScope,
          input.actorId,
          input.principalType,
          JSON.stringify(request),
          input.now,
        ],
      );
      const row = required(
        operation.rows[0],
        "Upload operation was not persisted.",
      );
      if (stableJson(row.request_json) !== stableJson(request))
        throw codedError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for a different upload.",
        );
      await db.query(
        "INSERT INTO upload_sessions (workspace_id,operation_id,state,media_type,expected_byte_length,expected_sha256,expires_at,created_at,updated_at) VALUES ($1,$2,'requested',$3,$4,$5,$6,$7,$7) ON CONFLICT (operation_id) DO NOTHING",
        [
          input.workspaceId,
          row.id,
          input.mediaType,
          input.expectedByteLength,
          input.expectedSha256,
          input.expiresAt,
          input.now,
        ],
      );
      const result = await db.query<UploadRow>(
        `${uploadSelect} WHERE u.workspace_id=$1 AND u.operation_id=$2`,
        [input.workspaceId, row.id],
      );
      return mapUpload(
        required(result.rows[0], "Upload session was not persisted."),
      );
    }, actor);
  }

  completeUploadSession(input: {
    workspaceId: string;
    uploadId: string;
    actor: AuthenticatedActor;
    blobId: string;
    ingestOperationId: string;
    completedAt: string;
  }): Promise<UploadSession> {
    return this.scoped(input.workspaceId, async (db) => {
      const ownerClause = applicationOwnerClause(input.actor, 4);
      const ownerValues =
        input.actor.principalType === "application" ? [input.actor.id] : [];
      const updated = await db.query(
        `UPDATE upload_sessions u SET state='completed',updated_at=$3 FROM operations o WHERE u.workspace_id=$1 AND u.id=$2 AND u.state<>'completed' AND o.id=u.operation_id AND o.workspace_id=u.workspace_id${ownerClause}`,
        [input.workspaceId, input.uploadId, input.completedAt, ...ownerValues],
      );
      if (updated.rowCount === 1) {
        await db.query(
          "UPDATE operations SET state='completed',result_json=$3::jsonb,updated_at=$4,completed_at=$4 WHERE workspace_id=$1 AND id=(SELECT operation_id FROM upload_sessions WHERE id=$2)",
          [
            input.workspaceId,
            input.uploadId,
            JSON.stringify({
              blobId: input.blobId,
              ingestOperationId: input.ingestOperationId,
            }),
            input.completedAt,
          ],
        );
      }
      const result = await db.query<UploadRow>(
        `${uploadSelect} WHERE u.workspace_id=$1 AND u.id=$2${applicationOwnerClause(input.actor, 3)}`,
        input.actor.principalType === "application"
          ? [input.workspaceId, input.uploadId, input.actor.id]
          : [input.workspaceId, input.uploadId],
      );
      if (!result.rows[0])
        throw codedError("OPERATION_NOT_FOUND", "Upload session was not found.");
      return mapUpload(result.rows[0]);
    }, input.actor);
  }

  private scoped<T>(
    workspaceId: string,
    work: (db: Awaited<ReturnType<DatabasePool["connect"]>>) => Promise<T>,
    actor?: AuthenticatedActor,
  ): Promise<T> {
    return inTransaction(this.pool, async (db) => {
      await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
        workspaceId,
      ]);
      await db.query(
        "SELECT set_config('trust.principal_type',$1,true),set_config('trust.principal_id',$2,true)",
        [actor?.principalType ?? "user", actor?.id ?? ""],
      );
      return work(db);
    });
  }
}

interface ApplicationRow {
  id: string;
  workspace_id: string;
  namespace: string;
  name: string;
  application_version: string;
  schema_package_ids: string[];
  capabilities_json: string[];
  idempotency_key: string | null;
  request_fingerprint: string | null;
  status: ApplicationRegistration["status"];
  created_at: string | Date;
  updated_at: string | Date;
}
interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceSummary["status"];
  created_at: string | Date;
  updated_at: string | Date;
}
interface DatasetRow {
  id: string;
  workspace_id: string;
  schema_package_id: string;
  dataset_type: string;
  name: string;
  status: DatasetRecord["status"];
  created_at: string | Date;
  updated_at: string | Date;
}
interface ResourceRow {
  id: string;
  workspace_id: string;
  dataset_id: string;
  resource_type: string;
  title: string | null;
  status: ResourceRecord["status"];
  current_revision_id: string | null;
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
  source: RevisionRecord["source"];
  change_note: string | null;
  restored_from_revision_id: string | null;
  created_at: string | Date;
}
interface AuditRow {
  id: string;
  workspace_id: string;
  dataset_id: string | null;
  actor_type: AuditEventRecord["actorType"];
  actor_id: string;
  action: string;
  subject_kind: string;
  subject_id: string;
  occurred_at: string | Date;
  request_id: string;
  correlation_id: string;
  operation_id: string | null;
  event_hash: string;
  metadata_json: Readonly<Record<string, unknown>>;
}
interface PolicyRow {
  id: string;
  workspace_id: string;
  principal_type: PolicyAssignment["principalType"];
  principal_id: string;
  role: string;
  scope_kind: PolicyAssignment["scopeKind"];
  scope_id: string;
  created_by: string;
  created_at: string | Date;
  revoked_at: string | Date | null;
}
interface BreakGlassRow {
  id: string;
  workspace_id: string;
  principal_id: string;
  reason: string;
  actions_json: string[];
  granted_by: string;
  granted_at: string | Date;
  expires_at: string | Date;
  revoked_at: string | Date | null;
}
interface RelationRow {
  id: string;
  workspace_id: string;
  dataset_id: string;
  source_kind: RelationRecord["sourceKind"];
  source_id: string;
  target_kind: RelationRecord["targetKind"];
  target_id: string;
  relation_type: string;
  metadata_json: Record<string, unknown>;
  created_by: string;
  created_at: string | Date;
  ended_at: string | Date | null;
}
interface OperationRow {
  id: string;
  workspace_id: string;
  operation_type: string;
  state: OperationState;
  requested_by: string;
  retry_count: number;
  error_code: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
}
interface UploadRow {
  id: string;
  workspace_id: string;
  operation_id: string;
  state: OperationState;
  media_type: string;
  expected_byte_length: number | string;
  expected_sha256: string;
  expires_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
  result_json: { blobId?: string } | null;
}
const uploadSelect =
  "SELECT u.*,o.completed_at,o.result_json FROM upload_sessions u JOIN operations o ON o.id=u.operation_id AND o.workspace_id=u.workspace_id";
function applicationOwnerClause(
  actor: AuthenticatedActor,
  parameter: number,
): string {
  return actor.principalType === "application"
    ? ` AND o.requested_by_principal_type='application' AND o.requested_by=$${parameter}`
    : "";
}
const iso = (value: string | Date) => new Date(value).toISOString();
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
function mapApplication(row: ApplicationRow): ApplicationRegistration {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    namespace: row.namespace,
    name: row.name,
    applicationVersion: row.application_version,
    schemaPackageIds: row.schema_package_ids,
    capabilities: row.capabilities_json,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapWorkspace(row: WorkspaceRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapDataset(row: DatasetRow): DatasetRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    schemaPackageId: row.schema_package_id,
    datasetType: row.dataset_type,
    name: row.name,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapResource(row: ResourceRow): ResourceRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    resourceType: row.resource_type,
    title: row.title,
    status: row.status,
    currentRevisionId: row.current_revision_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapRevision(row: RevisionRow): RevisionRecord {
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
    source: row.source,
    changeNote: row.change_note,
    restoredFromRevisionId: row.restored_from_revision_id,
    createdAt: iso(row.created_at),
  };
}
function mapAudit(row: AuditRow): AuditEventRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    occurredAt: iso(row.occurred_at),
    requestId: row.request_id,
    correlationId: row.correlation_id,
    operationId: row.operation_id,
    eventHash: row.event_hash,
    metadata: row.metadata_json,
  };
}
function mapPolicy(row: PolicyRow): PolicyAssignment {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    role: row.role,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    ...(row.revoked_at ? { revokedAt: iso(row.revoked_at) } : {}),
  };
}
function mapBreakGlass(row: BreakGlassRow): BreakGlassGrant {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    principalId: row.principal_id,
    reason: row.reason,
    actions: row.actions_json,
    grantedBy: row.granted_by,
    grantedAt: iso(row.granted_at),
    expiresAt: iso(row.expires_at),
    ...(row.revoked_at ? { revokedAt: iso(row.revoked_at) } : {}),
  };
}
function mapRelation(row: RelationRow): RelationRecord {
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
    endedAt: row.ended_at ? iso(row.ended_at) : null,
  };
}
function operationStatus(state: OperationState): OperationStatus {
  switch (state) {
    case "requested":
      return "pending";
    case "authorised":
    case "temporary_upload_created":
    case "bytes_received":
    case "hash_verified":
    case "immutable_object_committed":
    case "metadata_committed":
    case "audit_committed":
      return "running";
    case "completed":
      return "succeeded";
    case "rejected":
    case "failed_retryable":
    case "failed_terminal":
      return "failed";
    case "quarantined":
      return "quarantined";
    default:
      return assertNever(state);
  }
}
function mapOperation(row: OperationRow): OperationSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.operation_type,
    state: row.state,
    status: operationStatus(row.state),
    requestedBy: row.requested_by,
    retryCount: row.retry_count,
    errorCode: row.error_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
  };
}
function mapUpload(row: UploadRow): UploadSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    operationId: row.operation_id,
    state: row.state,
    status: operationStatus(row.state),
    mediaType: row.media_type,
    expectedByteLength: Number(row.expected_byte_length),
    expectedSha256: row.expected_sha256,
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    blobId: row.result_json?.blobId ?? null,
  };
}
function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
function stableJson(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}
function assertNever(value: never): never {
  throw new Error(`Unhandled operation state: ${String(value)}`);
}
