import type {
  QuarantineScanRecord,
  QuarantineScanStore,
  QuarantineScanState,
  ScanOutcome,
} from "@trust-core/operations";
import { inTransaction, type DatabasePool } from "./db.js";

interface ScanRow {
  id: string;
  workspace_id: string;
  upload_id: string;
  storage_key: string;
  state: QuarantineScanState;
  outcome: ScanOutcome | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresQuarantineScanStore implements QuarantineScanStore {
  constructor(private readonly pool: DatabasePool) {}

  getByUploadId(
    workspaceId: string,
    uploadId: string,
  ): Promise<QuarantineScanRecord | undefined> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const result = await db.query<ScanRow>(
        "SELECT id,workspace_id,upload_id,storage_key,state,outcome,created_at,updated_at FROM quarantine_scan_jobs WHERE workspace_id=$1 AND upload_id=$2",
        [workspaceId, uploadId],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : undefined;
    });
  }

  getByScanJobId(
    workspaceId: string,
    scanJobId: string,
  ): Promise<QuarantineScanRecord | undefined> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const result = await db.query<ScanRow>(
        "SELECT id,workspace_id,upload_id,storage_key,state,outcome,created_at,updated_at FROM quarantine_scan_jobs WHERE workspace_id=$1 AND id=$2",
        [workspaceId, scanJobId],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : undefined;
    });
  }

  save(record: QuarantineScanRecord): Promise<void> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, record.workspaceId);
      await db.query(
        `INSERT INTO quarantine_scan_jobs (
          id,workspace_id,upload_id,storage_key,state,outcome,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET
          state=EXCLUDED.state,
          outcome=EXCLUDED.outcome,
          storage_key=EXCLUDED.storage_key,
          updated_at=EXCLUDED.updated_at
        WHERE quarantine_scan_jobs.workspace_id=EXCLUDED.workspace_id
          AND quarantine_scan_jobs.upload_id=EXCLUDED.upload_id`,
        [
          record.scanJobId,
          record.workspaceId,
          record.uploadId,
          record.storageKey,
          record.state,
          record.outcome ?? null,
          record.createdAt,
          record.updatedAt,
        ],
      );
    });
  }
}

async function scope(
  db: { query(text: string, values?: readonly unknown[]): Promise<unknown> },
  workspaceId: string,
): Promise<void> {
  await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
    workspaceId,
  ]);
}

function mapRow(row: ScanRow): QuarantineScanRecord {
  return {
    scanJobId: row.id,
    workspaceId: row.workspace_id,
    uploadId: row.upload_id,
    storageKey: row.storage_key,
    state: row.state,
    ...(row.outcome ? { outcome: row.outcome } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
