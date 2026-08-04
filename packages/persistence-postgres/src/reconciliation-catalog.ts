import type { ReconciliationCatalog } from "@trust-core/reconciliation";
import { inTransaction,type DatabasePool } from "./db.js";
export class PostgresReconciliationCatalog implements ReconciliationCatalog {
  constructor(private readonly pool:DatabasePool){}
  findBlob(input:{workspaceId:string;storageKey:string;sha256:string}):Promise<{id:string;byteLength:number}|undefined>{return inTransaction(this.pool,async db=>{await db.query("SELECT set_config('trust.workspace_id',$1,true)",[input.workspaceId]);const r=await db.query<{id:string;byte_length:number|string}>("SELECT id,byte_length FROM blob_objects WHERE workspace_id=$1 AND storage_key=$2 AND sha256=$3",[input.workspaceId,input.storageKey,input.sha256]);return r.rows[0]?{id:r.rows[0].id,byteLength:Number(r.rows[0].byte_length)}:undefined;});}
  recordIncident(input:{workspaceId:string;operationId:string;severity:"warning"|"critical";code:string;message:string;metadata:Readonly<Record<string,unknown>>}):Promise<void>{return inTransaction(this.pool,async db=>{await db.query("SELECT set_config('trust.workspace_id',$1,true)",[input.workspaceId]);await db.query("INSERT INTO reconciliation_incidents (workspace_id,operation_id,severity,code,message,metadata_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",[input.workspaceId,input.operationId,input.severity,input.code,input.message,JSON.stringify(input.metadata)]);});}
}
