import type {
  QuarantineScanRecord,
  QuarantineScanStore,
  QuarantineScanState,
  ScanOutcome,
} from "@trust-core/operations";
import {
  QuarantineScanConflictError,
  resolveQuarantineScanSave,
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
      try {
        const byJob = await db.query<ScanRow>(
          "SELECT id,workspace_id,upload_id,storage_key,state,outcome,created_at,updated_at FROM quarantine_scan_jobs WHERE workspace_id=$1 AND id=$2",
          [record.workspaceId, record.scanJobId],
        );
        const byUpload = await db.query<ScanRow>(
          "SELECT id,workspace_id,upload_id,storage_key,state,outcome,created_at,updated_at FROM quarantine_scan_jobs WHERE workspace_id=$1 AND upload_id=$2",
          [record.workspaceId, record.uploadId],
        );
        const action = resolveQuarantineScanSave(
          byJob.rows[0] ? mapRow(byJob.rows[0]) : undefined,
          byUpload.rows[0] ? mapRow(byUpload.rows[0]) : undefined,
          record,
        );
        if (action === "insert") {
          const inserted = await db.query(
            `INSERT INTO quarantine_scan_jobs (
              id,workspace_id,upload_id,storage_key,state,outcome,created_at,updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
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
          if (inserted.rowCount !== 1) {
            throw new QuarantineScanConflictError(
              "Quarantine scan insert did not persist exactly one row.",
            );
          }
          return;
        }

        const updated = await db.query(
          `UPDATE quarantine_scan_jobs
           SET state=$1, outcome=$2, updated_at=$3
           WHERE id=$4
             AND workspace_id=$5
             AND upload_id=$6
             AND storage_key=$7
             AND created_at=$8::timestamptz`,
          [
            record.state,
            record.outcome ?? null,
            record.updatedAt,
            record.scanJobId,
            record.workspaceId,
            record.uploadId,
            record.storageKey,
            record.createdAt,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new QuarantineScanConflictError(
            "Quarantine scan update did not match the immutable identity.",
          );
        }
      } catch (error) {
        if (error instanceof QuarantineScanConflictError) throw error;
        const code = (error as { code?: string }).code;
        if (code === "23505" || code === "23503") {
          throw new QuarantineScanConflictError(
            "Quarantine scan identity conflict.",
          );
        }
        throw error;
      }
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
