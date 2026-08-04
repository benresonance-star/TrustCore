import { randomUUID } from "node:crypto";
import type { IngestCheckpoint, IngestOperation, IngestOperationStore } from "@trust-core/operations";
import { inTransaction, type DatabasePool, type Queryable } from "./db.js";

interface OperationEnvelope {
  checkpoints?: readonly IngestCheckpoint[];
  context?: Readonly<Record<string, unknown>>;
  result?: Readonly<Record<string, unknown>>;
}
interface OperationRow {
  id: string;
  workspace_id: string;
  state: string;
  request_json: { requestHash?: string };
  result_json: OperationEnvelope | null;
}

export class PostgresIngestOperationStore implements IngestOperationStore {
  constructor(private readonly pool: DatabasePool) {}

  begin(input: { workspaceId: string; idempotencyKey: string; actorId: string; requestHash: string; request: Readonly<Record<string, unknown>> }): Promise<IngestOperation> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, input.workspaceId);
      const request = { ...input.request, requestHash: input.requestHash };
      const result = await db.query<OperationRow>(
        "INSERT INTO operations (id,workspace_id,operation_type,idempotency_key,state,requested_by,request_json,result_json) VALUES ($1,$2,'object.ingest',$3,'requested',$4,$5::jsonb,$6::jsonb) ON CONFLICT (operation_type,workspace_id,idempotency_key) DO UPDATE SET updated_at=operations.updated_at RETURNING id,workspace_id,state,request_json,result_json",
        [randomUUID(), input.workspaceId, input.idempotencyKey, input.actorId, JSON.stringify(request), JSON.stringify({ checkpoints: [], context: {} })],
      );
      const row = requiredRow(result.rows[0]);
      return mapOperation(row);
    });
  }

  saveContext(workspaceId: string, operationId: string, context: Readonly<Record<string, unknown>>, state: string): Promise<void> {
    return this.update(workspaceId, operationId, "UPDATE operations SET state=$2,result_json=jsonb_set(COALESCE(result_json,'{}'::jsonb),'{context}',$3::jsonb,true),updated_at=now() WHERE id=$1", [operationId, state, JSON.stringify(context)]);
  }

  markCheckpoint(workspaceId: string, operationId: string, checkpoint: IngestCheckpoint): Promise<void> {
    return this.update(workspaceId, operationId, "UPDATE operations SET result_json=jsonb_set(COALESCE(result_json,'{}'::jsonb),'{checkpoints}',COALESCE(result_json->'checkpoints','[]'::jsonb)||to_jsonb($2::text),true),state=$2,updated_at=now() WHERE id=$1 AND NOT COALESCE(result_json->'checkpoints','[]'::jsonb) ? $2", [operationId, checkpoint]);
  }

  complete(workspaceId: string, operationId: string, result: Readonly<Record<string, unknown>>): Promise<void> {
    return this.update(workspaceId, operationId, "UPDATE operations SET state='completed',result_json=jsonb_set(COALESCE(result_json,'{}'::jsonb),'{result}',$2::jsonb,true),completed_at=COALESCE(completed_at,now()),updated_at=now(),error_code=NULL WHERE id=$1", [operationId, JSON.stringify(result)]);
  }

  fail(workspaceId: string, operationId: string, error: string): Promise<void> {
    return this.update(workspaceId, operationId, "UPDATE operations SET state=CASE WHEN state='completed' THEN state ELSE 'failed_retryable' END,error_code=CASE WHEN state='completed' THEN error_code ELSE $2 END,retry_count=CASE WHEN state='completed' THEN retry_count ELSE retry_count+1 END,updated_at=now() WHERE id=$1", [operationId, error.slice(0, 512)]);
  }

  private update(workspaceId: string, operationId: string, sql: string, values: readonly unknown[]): Promise<void> {
    return inTransaction(this.pool, async (db) => {
      await scope(db, workspaceId);
      const changed = await db.query(sql, values);
      if (changed.rowCount !== 1 && !sql.includes("NOT COALESCE")) throw new Error("Ingest operation update was not applied.");
    });
  }
}

async function scope(db: Queryable, workspaceId: string): Promise<void> {
  await db.query("SELECT set_config('trust.workspace_id',$1,true)", [workspaceId]);
}
function requiredRow(row: OperationRow | undefined): OperationRow {
  if (!row) throw new Error("Ingest operation could not be created.");
  return row;
}
function mapOperation(row: OperationRow): IngestOperation {
  const envelope = row.result_json ?? {};
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    requestHash: row.request_json.requestHash ?? "",
    state: row.state,
    checkpoints: envelope.checkpoints ?? [],
    context: envelope.context ?? {},
    ...(envelope.result ? { result: envelope.result } : {}),
  };
}
