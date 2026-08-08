import type { BlobObject } from "@trust-core/core";
import { appendAuditEvent } from "@trust-core/audit";
import type { BlobCatalog, IngestPrincipalType } from "@trust-core/operations";
import { inTransaction, type DatabasePool, type Queryable } from "./db.js";
import { deterministicUuid } from "./ids.js";

export class PostgresBlobCatalog implements BlobCatalog {
  constructor(private readonly pool: DatabasePool) {}
  findByHash(
    workspaceId: string,
    sha256: string,
  ): Promise<BlobObject | undefined> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const result = await db.query<BlobRow>(
        `${selectBlob} WHERE workspace_id=$1 AND sha256=$2`,
        [workspaceId, sha256],
      );
      return result.rows[0] ? mapBlob(result.rows[0]) : undefined;
    });
  }
  findById(
    workspaceId: string,
    blobId: string,
  ): Promise<BlobObject | undefined> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const result = await db.query<BlobRow>(
        `${selectBlob} WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, blobId],
      );
      return result.rows[0] ? mapBlob(result.rows[0]) : undefined;
    });
  }
  recordVerified(blob: BlobObject): Promise<BlobObject> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, blob.workspaceId);
      const result = await recordBlob(db, blob);
      return mapBlob(requiredBlobRow(result.rows[0]));
    });
  }
  commitVerifiedIngest(input: {
    blob: BlobObject;
    operationId: string;
    actorId: string;
    actorType: IngestPrincipalType;
    occurredAt: string;
  }): Promise<BlobObject> {
    return inTransaction(this.pool, async (db) => {
      const blob = input.blob;
      await scope(db, blob.workspaceId);
      const recorded = await recordBlob(db, blob);
      const canonical = mapBlob(requiredBlobRow(recorded.rows[0]));
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        blob.workspaceId,
      ]);
      const previous = await db.query<{ event_hash: string }>(
        "SELECT event_hash FROM audit_events WHERE workspace_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1",
        [blob.workspaceId],
      );
      const auditId = deterministicUuid(`ingest-audit:${input.operationId}`);
      const requestId = deterministicUuid(
        `ingest-request:${input.operationId}`,
      );
      const correlationId = input.operationId;
      const metadata = {
        sha256: canonical.sha256,
        byteLength: canonical.byteLength,
        storageKey: canonical.storageKey,
      };
      const chained = appendAuditEvent(
        {
          id: auditId,
          workspaceId: blob.workspaceId,
          actorType: input.actorType,
          actorId: input.actorId,
          action: "blob.ingested",
          subjectKind: "blob",
          subjectId: canonical.id,
          timestamp: input.occurredAt,
          requestId,
          correlationId,
          metadata,
        },
        previous.rows[0]?.event_hash ?? "",
      );
      await db.query(
        "INSERT INTO audit_events (id,workspace_id,actor_type,actor_id,action,subject_kind,subject_id,occurred_at,request_id,correlation_id,operation_id,previous_event_hash,event_hash,metadata_json) VALUES ($1,$2,$3,$4,'blob.ingested','blob',$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT (id) DO NOTHING",
        [
          auditId,
          blob.workspaceId,
          input.actorType,
          input.actorId,
          canonical.id,
          input.occurredAt,
          requestId,
          correlationId,
          input.operationId,
          chained.previousEventHash || null,
          chained.eventHash,
          JSON.stringify(metadata),
        ],
      );
      await db.query(
        "INSERT INTO outbox_events (id,workspace_id,operation_id,event_type,payload_json) VALUES ($1,$2,$3,'blob.reconcile_requested',$4::jsonb) ON CONFLICT (id) DO NOTHING",
        [
          deterministicUuid(`ingest-outbox:${input.operationId}`),
          blob.workspaceId,
          input.operationId,
          JSON.stringify({
            storageKey: canonical.storageKey,
            sha256: canonical.sha256,
            byteLength: canonical.byteLength,
          }),
        ],
      );
      return canonical;
    });
  }
}
const selectBlob =
  "SELECT id,workspace_id,sha256,byte_length,media_type,storage_provider,storage_key,encryption_state,encryption_key_ref,verification_state,created_at,storage_binding_id,storage_binding_generation FROM blob_objects";
function recordBlob(db: Queryable, blob: BlobObject) {
  return db.query<BlobRow>(
    `INSERT INTO blob_objects (id,workspace_id,sha256,byte_length,media_type,storage_provider,storage_key,encryption_state,encryption_key_ref,verification_state,created_at,storage_binding_id,storage_binding_generation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',$10,$11,$12) ON CONFLICT (workspace_id,sha256) DO UPDATE SET verification_state='verified', storage_binding_id=COALESCE(EXCLUDED.storage_binding_id, blob_objects.storage_binding_id), storage_binding_generation=COALESCE(EXCLUDED.storage_binding_generation, blob_objects.storage_binding_generation) RETURNING id,workspace_id,sha256,byte_length,media_type,storage_provider,storage_key,encryption_state,encryption_key_ref,verification_state,created_at,storage_binding_id,storage_binding_generation`,
    [
      blob.id,
      blob.workspaceId,
      blob.sha256,
      blob.byteLength,
      blob.mediaType,
      blob.storageProvider,
      blob.storageKey,
      blob.encryptionState,
      blob.encryptionKeyRef,
      blob.createdAt,
      blob.storageBindingId ?? null,
      blob.storageBindingGeneration ?? null,
    ],
  );
}
async function scope(db: Queryable, workspaceId: string) {
  await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
    workspaceId,
  ]);
}
function requiredBlobRow(row: BlobRow | undefined): BlobRow {
  if (!row) throw new Error("Blob metadata was not recorded.");
  return row;
}
interface BlobRow {
  id: string;
  workspace_id: string;
  sha256: string;
  byte_length: number | string;
  media_type: string;
  storage_provider: string;
  storage_key: string;
  encryption_state: BlobObject["encryptionState"];
  encryption_key_ref: string | null;
  verification_state: BlobObject["verificationState"];
  created_at: string | Date;
  storage_binding_id: string | null;
  storage_binding_generation: number | string | null;
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
    encryptionState: row.encryption_state,
    encryptionKeyRef: row.encryption_key_ref,
    verificationState: row.verification_state,
    createdAt: new Date(row.created_at).toISOString(),
    storageBindingId: row.storage_binding_id,
    storageBindingGeneration:
      row.storage_binding_generation == null
        ? null
        : Number(row.storage_binding_generation),
  };
}
