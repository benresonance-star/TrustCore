import type { BlobObject } from "@trust-core/core";
import type { VerificationCatalog,VerificationRun } from "@trust-core/verification";
import { inTransaction,type DatabasePool } from "./db.js";
export class PostgresVerificationCatalog implements VerificationCatalog {
  constructor(private readonly pool:DatabasePool){}
  listBlobs(workspaceId:string):Promise<readonly BlobObject[]>{return inTransaction(this.pool,async db=>{await scope(db,workspaceId);const r=await db.query<BlobRow>("SELECT id,workspace_id,sha256,byte_length,media_type,storage_provider,storage_key,verification_state,created_at FROM blob_objects WHERE workspace_id=$1 ORDER BY id",[workspaceId]);return r.rows.map(mapBlob);});}
  recordRun(run:VerificationRun):Promise<void>{return inTransaction(this.pool,async db=>{await scope(db,run.workspaceId);await db.query("INSERT INTO verification_runs (id,workspace_id,verification_level,status,started_at,completed_at,objects_checked,bytes_read,issues_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",[run.id,run.workspaceId,run.level,run.status,run.startedAt,run.completedAt,run.objectsChecked,run.bytesRead,JSON.stringify(run.issues)]);});}
  setBlobVerification(workspaceId:string,blobId:string,state:BlobObject["verificationState"]):Promise<void>{return inTransaction(this.pool,async db=>{await scope(db,workspaceId);const r=await db.query("UPDATE blob_objects SET verification_state=$3 WHERE workspace_id=$1 AND id=$2",[workspaceId,blobId,state]);if(r.rowCount!==1)throw new Error("Blob verification state update did not resolve one object.");});}
}
async function scope(db:{query:(text:string,values?:readonly unknown[])=>Promise<unknown>},workspaceId:string){await db.query("SELECT set_config('trust.workspace_id',$1,true)",[workspaceId]);}
interface BlobRow{id:string;workspace_id:string;sha256:string;byte_length:number|string;media_type:string;storage_provider:string;storage_key:string;verification_state:BlobObject["verificationState"];created_at:string|Date;}
function mapBlob(r:BlobRow):BlobObject{return{id:r.id,workspaceId:r.workspace_id,sha256:r.sha256,byteLength:Number(r.byte_length),mediaType:r.media_type,storageProvider:r.storage_provider,storageKey:r.storage_key,verificationState:r.verification_state,createdAt:new Date(r.created_at).toISOString()};}
