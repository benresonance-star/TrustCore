import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inTransaction, type DatabasePool } from "./db.js";

export async function runMigrations(pool: DatabasePool, directory: string): Promise<readonly string[]> {
  const files = (await readdir(directory)).filter((name)=>/^\d+.*\.sql$/.test(name)).sort();
  await pool.query("CREATE TABLE IF NOT EXISTS trust_schema_migrations (name text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied:string[]=[];
  for(const name of files){ const sql=await readFile(join(directory,name),"utf8"); const digest=createHash("sha256").update(sql).digest("hex");
    const transactionalSql=sql.replace(/^\s*BEGIN\s*;/i,"").replace(/COMMIT\s*;\s*$/i,"");
    await inTransaction(pool,async(db)=>{ const found=await db.query<{sha256:string}>("SELECT sha256 FROM trust_schema_migrations WHERE name=$1",[name]); if(found.rows[0]){if(found.rows[0].sha256!==digest)throw new Error(`Applied migration changed: ${name}`);return;} await db.query(transactionalSql); await db.query("INSERT INTO trust_schema_migrations (name,sha256) VALUES ($1,$2)",[name,digest]); applied.push(name); }); }
  return applied;
}
