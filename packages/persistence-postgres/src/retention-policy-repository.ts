import { createHash } from "node:crypto";
import {
  assertRetentionPolicy,
  type RetentionPolicy,
} from "@trust-core/core";
import { inTransaction, type DatabasePool, type Queryable } from "./db.js";

export interface RetentionPolicyWrite {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly recoveryWindowDays: number;
  readonly minimumHistoryDays: number;
  readonly backupRetentionDays: number;
  readonly purgeEnabled: false;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly at: string;
}

export class PostgresRetentionPolicyRepository {
  constructor(private readonly pool: DatabasePool) {}

  list(workspaceId: string): Promise<readonly RetentionPolicy[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<RetentionPolicyRow>(
        `${selectPolicy} WHERE workspace_id=$1 ORDER BY name,id`,
        [workspaceId],
      );
      return result.rows.map(mapPolicy);
    });
  }

  get(
    workspaceId: string,
    policyId: string,
  ): Promise<RetentionPolicy | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<RetentionPolicyRow>(
        `${selectPolicy} WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, policyId],
      );
      return result.rows[0] ? mapPolicy(result.rows[0]) : undefined;
    });
  }

  create(input: RetentionPolicyWrite): Promise<RetentionPolicy> {
    assertRetentionPolicy(input);
    return this.write(input, "create", async (db) => {
      const result = await db.query<RetentionPolicyRow>(
        "INSERT INTO retention_policies (id,workspace_id,name,recovery_window_days,minimum_history_days,backup_retention_days,purge_enabled,extensions_json,created_by,updated_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9,$10,$10) RETURNING *",
        [
          input.id,
          input.workspaceId,
          input.name,
          input.recoveryWindowDays,
          input.minimumHistoryDays,
          input.backupRetentionDays,
          input.purgeEnabled,
          JSON.stringify(input.extensions),
          input.actorId,
          input.at,
        ],
      );
      return mapPolicy(required(result.rows[0]));
    });
  }

  update(
    policyId: string,
    input: RetentionPolicyWrite & { readonly expectedUpdatedAt: string },
  ): Promise<RetentionPolicy> {
    assertRetentionPolicy(input);
    return this.write(input, `update:${policyId}`, async (db) => {
      const result = await db.query<RetentionPolicyRow>(
        "UPDATE retention_policies SET name=$3,recovery_window_days=$4,minimum_history_days=$5,backup_retention_days=$6,purge_enabled=$7,extensions_json=$8::jsonb,updated_by=$9,updated_at=$10 WHERE workspace_id=$1 AND id=$2 AND updated_at=$11 RETURNING *",
        [
          input.workspaceId,
          policyId,
          input.name,
          input.recoveryWindowDays,
          input.minimumHistoryDays,
          input.backupRetentionDays,
          input.purgeEnabled,
          JSON.stringify(input.extensions),
          input.actorId,
          input.at,
          input.expectedUpdatedAt,
        ],
      );
      if (!result.rows[0]) {
        const exists = await db.query(
          "SELECT id FROM retention_policies WHERE workspace_id=$1 AND id=$2",
          [input.workspaceId, policyId],
        );
        throw codedError(
          exists.rowCount === 0
            ? "RETENTION_POLICY_NOT_FOUND"
            : "RETENTION_POLICY_CONFLICT",
        );
      }
      return mapPolicy(result.rows[0]);
    });
  }

  private scoped<T>(
    workspaceId: string,
    work: (db: Queryable) => Promise<T>,
  ): Promise<T> {
    return inTransaction(this.pool, async (db) => {
      await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
        workspaceId,
      ]);
      return work(db);
    });
  }

  private scopedWrite<T>(
    workspaceId: string,
    work: (db: Queryable) => Promise<T>,
  ): Promise<T> {
    return this.scoped(workspaceId, work);
  }

  private write(
    input: RetentionPolicyWrite,
    operation: string,
    apply: (db: Queryable) => Promise<RetentionPolicy>,
  ): Promise<RetentionPolicy> {
    return this.scopedWrite(input.workspaceId, async (db) => {
      const fingerprint = createHash("sha256")
        .update(
          stableJson({
            operation,
            name: input.name,
            recoveryWindowDays: input.recoveryWindowDays,
            minimumHistoryDays: input.minimumHistoryDays,
            backupRetentionDays: input.backupRetentionDays,
            purgeEnabled: input.purgeEnabled,
            extensions: input.extensions,
            ...("expectedUpdatedAt" in input
              ? { expectedUpdatedAt: input.expectedUpdatedAt }
              : {}),
          }),
        )
        .digest("hex");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${input.workspaceId}:${input.actorId}:${input.idempotencyKey}`,
      ]);
      const replay = await db.query<RequestRow>(
        "SELECT request_fingerprint,result_json FROM retention_policy_requests WHERE workspace_id=$1 AND actor_id=$2 AND idempotency_key=$3",
        [input.workspaceId, input.actorId, input.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_fingerprint !== fingerprint)
          throw codedError("IDEMPOTENCY_CONFLICT");
        return replay.rows[0].result_json;
      }
      const result = await apply(db);
      await db.query(
        "INSERT INTO retention_policy_requests (workspace_id,actor_id,idempotency_key,request_fingerprint,result_json,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)",
        [
          input.workspaceId,
          input.actorId,
          input.idempotencyKey,
          fingerprint,
          JSON.stringify(result),
          input.at,
        ],
      );
      return result;
    });
  }
}

const selectPolicy =
  "SELECT id,workspace_id,name,recovery_window_days,minimum_history_days,backup_retention_days,purge_enabled,extensions_json,created_by,updated_by,created_at,updated_at FROM retention_policies";

interface RetentionPolicyRow {
  id: string;
  workspace_id: string;
  name: string;
  recovery_window_days: number;
  minimum_history_days: number;
  backup_retention_days: number;
  purge_enabled: false;
  extensions_json: Readonly<Record<string, unknown>>;
  created_by: string;
  updated_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}
interface RequestRow {
  request_fingerprint: string;
  result_json: RetentionPolicy;
}
function mapPolicy(row: RetentionPolicyRow): RetentionPolicy {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    recoveryWindowDays: row.recovery_window_days,
    minimumHistoryDays: row.minimum_history_days,
    backupRetentionDays: row.backup_retention_days,
    purgeEnabled: row.purge_enabled,
    extensions: row.extensions_json,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
function required(row: RetentionPolicyRow | undefined): RetentionPolicyRow {
  if (!row) throw new Error("Retention policy was not persisted.");
  return row;
}
function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
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
