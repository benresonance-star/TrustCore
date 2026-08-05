import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type {
  ArchiveImportPlan,
  ArchiveVerificationReport,
  TrustArchiveManifest,
} from "@trust-core/archive";
import { appendAuditEvent } from "@trust-core/audit";
import type { ObjectStorage } from "@trust-core/storage";
import { inTransaction, type DatabasePool, type Queryable } from "./db.js";
import { deterministicUuid } from "./ids.js";

const maxArchiveBytes = 8_000_000;

export type PortabilityPrincipalType = "user" | "service" | "application";

export interface PortabilityStorageLocation {
  readonly provider: string;
  readonly key: string;
}

export interface DurablePortabilityExport {
  readonly id: string;
  readonly workspaceId: string;
  readonly datasetIds: readonly string[];
  readonly status: "pending" | "ready" | "failed";
  readonly signatureProfile: "unsigned";
  readonly archiveSha256?: string;
  readonly byteLength?: number;
  readonly storage?: PortabilityStorageLocation;
  readonly manifest?: TrustArchiveManifest;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface DurablePortabilityArchive {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceExportId: string;
  readonly sourceWorkspaceId: string;
  readonly status: "verified" | "rejected";
  readonly signatureProfile: "unsigned";
  readonly checkedEntries: number;
  readonly issueCount: number;
  readonly archiveSha256: string;
  readonly byteLength: number;
  readonly storage: PortabilityStorageLocation;
  readonly manifest: TrustArchiveManifest;
  readonly verification: ArchiveVerificationReport;
  readonly createdAt: string;
}

export interface DurablePortabilityPlan {
  readonly workspaceId: string;
  readonly archiveId: string;
  readonly plan: ArchiveImportPlan;
  readonly createdAt: string;
}

interface RequestIdentity {
  readonly requestedBy: string;
  readonly principalType: PortabilityPrincipalType;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
}

export class PortabilityArchiveObjectStore {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly provider: string,
  ) {}

  async persist(input: {
    workspaceId: string;
    requestId: string;
    bytes: Uint8Array;
  }): Promise<{
    readonly sha256: string;
    readonly byteLength: number;
    readonly storage: PortabilityStorageLocation;
  }> {
    if (input.bytes.byteLength > maxArchiveBytes)
      throw Object.assign(
        new Error("Archive exceeds the bounded 0.2H container limit."),
        { code: "REQUEST_TOO_LARGE" },
      );
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const temporary = await this.storage.createTemporaryUpload({
      workspaceId: input.workspaceId,
      operationId: deterministicUuid(
        `portability-archive:${input.workspaceId}:${input.requestId}`,
      ),
    });
    const written = await this.storage.writeTemporary({
      locator: temporary,
      body: Readable.from([input.bytes]),
      mediaType: "application/vnd.trust-core.archive+zip",
    });
    if (
      written.byteLength !== input.bytes.byteLength ||
      (written.sha256 !== undefined && written.sha256 !== sha256)
    )
      throw new Error(
        "Persisted archive bytes do not match their declaration.",
      );
    const committed = await this.storage.commitImmutable({
      temporary,
      workspaceId: input.workspaceId,
      sha256,
      byteLength: input.bytes.byteLength,
      mediaType: "application/vnd.trust-core.archive+zip",
    });
    return {
      sha256,
      byteLength: input.bytes.byteLength,
      storage: { provider: this.provider, key: committed.key },
    };
  }

  async read(location: PortabilityStorageLocation): Promise<Uint8Array> {
    if (location.provider !== this.provider)
      throw new Error("Archive belongs to a different storage provider.");
    const stream = await this.storage.openReadStream({ key: location.key });
    const chunks: Buffer[] = [];
    let byteLength = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      byteLength += bytes.byteLength;
      if (byteLength > maxArchiveBytes)
        throw new Error("Durable archive exceeds its bounded read limit.");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }
}

export class PostgresPortabilityStore {
  constructor(
    private readonly pool: DatabasePool,
    private readonly options: { readonly allowLocalUnsignedProfile: boolean },
  ) {}

  async saveExport(
    input: DurablePortabilityExport & RequestIdentity,
  ): Promise<DurablePortabilityExport> {
    this.assertProfile(input.signatureProfile);
    return inTransaction(this.pool, async (db) => {
      await scope(db, input.workspaceId);
      const result = await db.query<ExportRow>(
        "INSERT INTO portability_exports (id,workspace_id,dataset_ids,status,signature_profile,archive_sha256,byte_length,storage_provider,storage_key,requested_by,requested_by_principal_type,idempotency_key,request_fingerprint,manifest_json,created_at,updated_at,completed_at) VALUES ($1,$2,$3::uuid[],$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$15,$16) ON CONFLICT (workspace_id,requested_by_principal_type,requested_by,idempotency_key) DO UPDATE SET updated_at=portability_exports.updated_at RETURNING *",
        [
          input.id,
          input.workspaceId,
          input.datasetIds,
          input.status,
          input.signatureProfile,
          input.archiveSha256 ?? null,
          input.byteLength ?? null,
          input.storage?.provider ?? null,
          input.storage?.key ?? null,
          input.requestedBy,
          input.principalType,
          input.idempotencyKey,
          input.requestFingerprint,
          input.manifest ? JSON.stringify(input.manifest) : null,
          input.createdAt,
          input.completedAt ?? null,
        ],
      );
      const row = required(result.rows[0], "Portability export was not saved.");
      assertFingerprint(row.request_fingerprint, input.requestFingerprint);
      return mapExport(row);
    });
  }

  getExport(
    workspaceId: string,
    exportId: string,
  ): Promise<DurablePortabilityExport | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<ExportRow>(
        "SELECT * FROM portability_exports WHERE workspace_id=$1 AND id=$2",
        [workspaceId, exportId],
      );
      return result.rows[0] ? mapExport(result.rows[0]) : undefined;
    });
  }

  completeExport(input: {
    workspaceId: string;
    exportId: string;
    archiveSha256: string;
    byteLength: number;
    storage: PortabilityStorageLocation;
    manifest: TrustArchiveManifest;
    completedAt: string;
  }): Promise<DurablePortabilityExport> {
    return this.scoped(input.workspaceId, async (db) => {
      this.assertProfile(input.manifest.signatureProfile);
      const result = await db.query<ExportRow>(
        "UPDATE portability_exports SET status='ready',archive_sha256=$3,byte_length=$4,storage_provider=$5,storage_key=$6,manifest_json=$7::jsonb,updated_at=$8,completed_at=$8 WHERE workspace_id=$1 AND id=$2 AND status IN ('pending','ready','failed') AND (archive_sha256 IS NULL OR archive_sha256=$3) RETURNING *",
        [
          input.workspaceId,
          input.exportId,
          input.archiveSha256,
          input.byteLength,
          input.storage.provider,
          input.storage.key,
          JSON.stringify(input.manifest),
          input.completedAt,
        ],
      );
      return mapExport(
        required(result.rows[0], "Portability export could not be completed."),
      );
    });
  }

  failExport(workspaceId: string, exportId: string, at: string): Promise<void> {
    return this.scoped(workspaceId, async (db) => {
      await db.query(
        "UPDATE portability_exports SET status='failed',updated_at=$3 WHERE workspace_id=$1 AND id=$2 AND status='pending'",
        [workspaceId, exportId, at],
      );
    });
  }

  async saveArchive(
    input: DurablePortabilityArchive & RequestIdentity,
  ): Promise<DurablePortabilityArchive> {
    this.assertProfile(input.signatureProfile);
    return inTransaction(this.pool, async (db) => {
      await scope(db, input.workspaceId);
      const result = await db.query<ArchiveRow>(
        "INSERT INTO portability_archives (id,workspace_id,source_export_id,source_workspace_id,status,signature_profile,checked_entries,issue_count,archive_sha256,byte_length,storage_provider,storage_key,manifest_json,verification_json,uploaded_by,uploaded_by_principal_type,idempotency_key,request_fingerprint,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19) ON CONFLICT (workspace_id,uploaded_by_principal_type,uploaded_by,idempotency_key) DO UPDATE SET created_at=portability_archives.created_at RETURNING *",
        [
          input.id,
          input.workspaceId,
          input.sourceExportId,
          input.sourceWorkspaceId,
          input.status,
          input.signatureProfile,
          input.checkedEntries,
          input.issueCount,
          input.archiveSha256,
          input.byteLength,
          input.storage.provider,
          input.storage.key,
          JSON.stringify(input.manifest),
          JSON.stringify(input.verification),
          input.requestedBy,
          input.principalType,
          input.idempotencyKey,
          input.requestFingerprint,
          input.createdAt,
        ],
      );
      const row = required(
        result.rows[0],
        "Portability archive was not saved.",
      );
      assertFingerprint(row.request_fingerprint, input.requestFingerprint);
      return mapArchive(row);
    });
  }

  getArchive(
    workspaceId: string,
    archiveId: string,
  ): Promise<DurablePortabilityArchive | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<ArchiveRow>(
        "SELECT * FROM portability_archives WHERE workspace_id=$1 AND id=$2",
        [workspaceId, archiveId],
      );
      return result.rows[0] ? mapArchive(result.rows[0]) : undefined;
    });
  }

  savePlan(
    input: DurablePortabilityPlan & RequestIdentity,
  ): Promise<DurablePortabilityPlan> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, input.workspaceId);
      const plan = input.plan;
      const result = await db.query<PlanRow>(
        "INSERT INTO portability_plans (id,workspace_id,archive_id,source_workspace_id,mode,conflict_mode,status,plan_json,requested_by,requested_by_principal_type,idempotency_key,request_fingerprint,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13) ON CONFLICT (workspace_id,requested_by_principal_type,requested_by,idempotency_key) DO UPDATE SET created_at=portability_plans.created_at RETURNING *",
        [
          plan.planId,
          input.workspaceId,
          input.archiveId,
          plan.sourceWorkspaceId,
          plan.mode,
          plan.conflictMode,
          plan.status,
          JSON.stringify(plan),
          input.requestedBy,
          input.principalType,
          input.idempotencyKey,
          input.requestFingerprint,
          input.createdAt,
        ],
      );
      const row = required(result.rows[0], "Portability plan was not saved.");
      assertFingerprint(row.request_fingerprint, input.requestFingerprint);
      return mapPlan(row);
    });
  }

  getPlan(
    workspaceId: string,
    planId: string,
  ): Promise<DurablePortabilityPlan | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<PlanRow>(
        "SELECT * FROM portability_plans WHERE workspace_id=$1 AND id=$2",
        [workspaceId, planId],
      );
      return result.rows[0] ? mapPlan(result.rows[0]) : undefined;
    });
  }

  appendAudit(input: {
    workspaceId: string;
    actorId: string;
    principalType: PortabilityPrincipalType;
    action: string;
    subjectKind: "archive" | "export" | "import-plan" | "import-operation";
    subjectId: string;
    requestId: string;
    correlationId: string;
    outcome: "succeeded" | "failed";
    errorCode?: string;
    at: string;
  }): Promise<void> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, input.workspaceId);
      const auditId = deterministicUuid(
        `portability-audit:${input.workspaceId}:${input.action}:${input.requestId}:${input.outcome}`,
      );
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        input.workspaceId,
      ]);
      const existing = await db.query(
        "SELECT id FROM audit_events WHERE workspace_id=$1 AND id=$2",
        [input.workspaceId, auditId],
      );
      if (existing.rowCount === 1) return;
      const previous = await db.query<{ event_hash: string }>(
        "SELECT event_hash FROM audit_events WHERE workspace_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1",
        [input.workspaceId],
      );
      const event = appendAuditEvent(
        {
          id: auditId,
          workspaceId: input.workspaceId,
          actorType: input.principalType,
          actorId: input.actorId,
          action: input.action,
          subjectKind: input.subjectKind,
          subjectId: input.subjectId,
          timestamp: input.at,
          requestId: input.requestId,
          correlationId: input.correlationId,
          metadata: {
            outcome: input.outcome,
            ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          },
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
          event.previousEventHash || null,
          event.eventHash,
          JSON.stringify(event.metadata),
        ],
      );
    });
  }

  private scoped<T>(
    workspaceId: string,
    work: (db: Queryable) => Promise<T>,
  ): Promise<T> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      return work(db);
    });
  }

  private assertProfile(profile: TrustArchiveManifest["signatureProfile"]) {
    if (profile === "unsigned" && !this.options.allowLocalUnsignedProfile)
      throw Object.assign(
        new Error(
          "Unsigned trust archives are disabled outside the explicit local profile.",
        ),
        { code: "UNSIGNED_ARCHIVE_PROFILE_DISABLED" },
      );
  }
}

interface ExportRow {
  id: string;
  workspace_id: string;
  dataset_ids: string[];
  status: DurablePortabilityExport["status"];
  signature_profile: "unsigned";
  archive_sha256: string | null;
  byte_length: string | number | null;
  storage_provider: string | null;
  storage_key: string | null;
  manifest_json: TrustArchiveManifest | null;
  request_fingerprint: string;
  created_at: string | Date;
  completed_at: string | Date | null;
}

interface ArchiveRow {
  id: string;
  workspace_id: string;
  source_export_id: string;
  source_workspace_id: string;
  status: DurablePortabilityArchive["status"];
  signature_profile: "unsigned";
  checked_entries: number;
  issue_count: number;
  archive_sha256: string;
  byte_length: string | number;
  storage_provider: string;
  storage_key: string;
  manifest_json: TrustArchiveManifest;
  verification_json: ArchiveVerificationReport;
  request_fingerprint: string;
  created_at: string | Date;
}

interface PlanRow {
  workspace_id: string;
  archive_id: string;
  plan_json: ArchiveImportPlan;
  request_fingerprint: string;
  created_at: string | Date;
}

function mapExport(row: ExportRow): DurablePortabilityExport {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    datasetIds: row.dataset_ids,
    status: row.status,
    signatureProfile: row.signature_profile,
    ...(row.archive_sha256 ? { archiveSha256: row.archive_sha256 } : {}),
    ...(row.byte_length !== null
      ? { byteLength: Number(row.byte_length) }
      : {}),
    ...(row.storage_provider && row.storage_key
      ? { storage: { provider: row.storage_provider, key: row.storage_key } }
      : {}),
    ...(row.manifest_json ? { manifest: row.manifest_json } : {}),
    createdAt: iso(row.created_at),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
  };
}

function mapArchive(row: ArchiveRow): DurablePortabilityArchive {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceExportId: row.source_export_id,
    sourceWorkspaceId: row.source_workspace_id,
    status: row.status,
    signatureProfile: row.signature_profile,
    checkedEntries: row.checked_entries,
    issueCount: row.issue_count,
    archiveSha256: row.archive_sha256,
    byteLength: Number(row.byte_length),
    storage: { provider: row.storage_provider, key: row.storage_key },
    manifest: row.manifest_json,
    verification: row.verification_json,
    createdAt: iso(row.created_at),
  };
}

function mapPlan(row: PlanRow): DurablePortabilityPlan {
  return {
    workspaceId: row.workspace_id,
    archiveId: row.archive_id,
    plan: row.plan_json,
    createdAt: iso(row.created_at),
  };
}

function required<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}

function assertFingerprint(actual: string, expected: string): void {
  if (actual !== expected)
    throw Object.assign(
      new Error(
        "Idempotency key was already used for a different portability request.",
      ),
      { code: "IDEMPOTENCY_CONFLICT" },
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
