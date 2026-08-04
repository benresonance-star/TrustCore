import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createIvansDiaryFixture, ivansDiarySchema } from "@trust-core/fixtures-ivans-diary";
import { PostgresTrustRepository, runMigrations, type DatabasePool, type QueryResult, type TransactionClient } from "@trust-core/persistence-postgres";

const migrationsDirectory=fileURLToPath(new URL("../../../migrations/",import.meta.url));
const url=process.env.TRUST_MIGRATION_DATABASE_URL??process.env.DATABASE_URL;
if(!url) throw new Error("TRUST_MIGRATION_DATABASE_URL or DATABASE_URL is required");
const source=new Pool({connectionString:url});
const pool:DatabasePool={query:querySource(source),async connect(){const client=await source.connect();return {query:querySource(client),release:()=>client.release()} satisfies TransactionClient;},end:()=>source.end()};
const command=process.argv[2];
try{
  if(command==="migrate") console.log("Applied:",(await runMigrations(pool,migrationsDirectory)).join(", ")||"none");
  else if(command==="provision"){await provisionLocalRoles();console.log("Least-privilege local roles provisioned");}
  else if(command==="seed-demo"){await new PostgresTrustRepository(pool).seedSyntheticIvan(ivansDiarySchema,createIvansDiaryFixture());console.log("Synthetic Ivan dataset seeded");}
  else throw new Error("Use: admin.ts migrate | provision | seed-demo");
}finally{await pool.end();}
async function provisionLocalRoles(){const client=await source.connect();try{await client.query("SELECT set_config('trust.provision_app_password',$1,false),set_config('trust.provision_worker_password',$2,false),set_config('trust.provision_verifier_password',$3,false),set_config('trust.provision_audit_reader_password',$4,false),set_config('trust.provision_audit_writer_password',$5,false),set_config('trust.provision_backup_password',$6,false)",[process.env.TRUST_APP_DB_PASSWORD??"trust_app_local_only",process.env.TRUST_WORKER_DB_PASSWORD??"trust_worker_local_only",process.env.TRUST_VERIFIER_DB_PASSWORD??"trust_verifier_local_only",process.env.TRUST_AUDIT_READER_DB_PASSWORD??"trust_audit_reader_local_only",process.env.TRUST_AUDIT_WRITER_DB_PASSWORD??"trust_audit_writer_local_only",process.env.TRUST_BACKUP_DB_PASSWORD??"trust_backup_local_only"]);await client.query(await readFile(new URL("../../../migrations/provisioning.sql",import.meta.url),"utf8"));}finally{client.release();}}
function querySource(source:{query(text:string,values?:unknown[]):Promise<{rows:unknown[];rowCount:number|null}>}){return async<Row>(text:string,values?:readonly unknown[]):Promise<QueryResult<Row>>=>{const result=await source.query(text,values?[...values]:undefined);return {rows:result.rows as Row[],rowCount:result.rowCount};};}
