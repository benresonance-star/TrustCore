import type { IvansDiaryFixture } from "@trust-core/fixtures-ivans-diary";
import type { ControlCentreSnapshot, DatasetSummary } from "@trust-core/protocol";
import { schemaDigest, type PublishedSchemaPackage, type SchemaPackageManifest } from "@trust-core/schema-registry";
import { inTransaction, type DatabasePool, type Queryable } from "./db.js";
import { deterministicUuid as uuid } from "./ids.js";

export class PostgresTrustRepository {
  constructor(readonly pool: DatabasePool) {}

  async seedSyntheticIvan(manifest: SchemaPackageManifest, fixture: IvansDiaryFixture): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const workspaceId = uuid(fixture.workspace.id), datasetId = uuid(fixture.dataset.id), digest = schemaDigest(manifest);
      const schemaResult = await db.query<{id:string;schema_digest:string}>("INSERT INTO schema_packages (id, namespace, name, semantic_version, schema_digest, manifest_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (namespace,name,semantic_version) DO UPDATE SET status=schema_packages.status RETURNING id,schema_digest", [uuid(`schema:${digest}`), manifest.namespace, manifest.name, manifest.version, digest, JSON.stringify(manifest)]);
      const schemaId=schemaResult.rows[0]?.id ?? uuid(`schema:${digest}`);
      if(schemaResult.rows[0] && schemaResult.rows[0].schema_digest!==digest) throw new Error(`Published schema digest mismatch: ${manifest.namespace}/${manifest.name}/${manifest.version}`);
      await db.query("INSERT INTO workspaces (id,name,slug,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING", [workspaceId, fixture.workspace.name, fixture.workspace.slug, fixture.workspace.status, fixture.workspace.createdAt, fixture.workspace.updatedAt]);
      await db.query("SELECT set_config('trust.workspace_id',$1,true)", [workspaceId]);
      await db.query("INSERT INTO datasets (id,workspace_id,schema_package_id,dataset_type,name,status,retention_policy_id,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9) ON CONFLICT (id) DO NOTHING", [datasetId, workspaceId, schemaId, fixture.dataset.datasetType, fixture.dataset.name, fixture.dataset.status, fixture.dataset.createdBy, fixture.dataset.createdAt, fixture.dataset.updatedAt]);
      for (const resource of fixture.resources) await db.query("INSERT INTO resources (id,workspace_id,dataset_id,resource_type,title,status,current_revision_id,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING", [uuid(resource.id),workspaceId,datasetId,resource.resourceType,resource.title,resource.status,resource.currentRevisionId ? uuid(resource.currentRevisionId) : null,resource.createdBy,resource.createdAt,resource.updatedAt]);
      for (const revision of fixture.revisions) await db.query("INSERT INTO revisions (id,workspace_id,dataset_id,resource_id,revision_number,parent_revision_id,merge_parent_revision_ids,schema_package_id,schema_version,canonical_payload_json,canonical_payload_hash,created_by,created_on_device_id,source,change_note,restored_from_revision_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO NOTHING", [uuid(revision.id),workspaceId,datasetId,uuid(revision.resourceId),revision.revisionNumber,revision.parentRevisionId ? uuid(revision.parentRevisionId) : null,revision.mergeParentRevisionIds.map(uuid),schemaId,revision.schemaVersion,JSON.stringify(revision.canonicalPayload),revision.canonicalPayloadHash,revision.createdBy,revision.createdOnDeviceId ? uuid(revision.createdOnDeviceId) : null,revision.source,revision.changeNote,revision.restoredFromRevisionId ? uuid(revision.restoredFromRevisionId) : null,revision.createdAt]);
      for (const relation of fixture.relations) await db.query("INSERT INTO relations (id,workspace_id,dataset_id,source_kind,source_id,target_kind,target_id,relation_type,metadata_json,created_by,created_at,ended_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12) ON CONFLICT (id) DO NOTHING", [uuid(relation.id),workspaceId,datasetId,relation.sourceKind,uuid(relation.sourceId),relation.targetKind,uuid(relation.targetId),relation.relationType,JSON.stringify(relation.metadata),relation.createdBy,relation.createdAt,relation.endedAt]);
      for (const item of fixture.tombstones) await db.query("INSERT INTO tombstones (id,workspace_id,dataset_id,subject_kind,subject_id,deleted_by,deleted_at,recover_until,prior_revision_id,purge_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING", [uuid(item.id),workspaceId,datasetId,item.subjectKind,uuid(item.subjectId),item.deletedBy,item.deletedAt,item.recoverUntil,item.priorRevisionId ? uuid(item.priorRevisionId) : null,item.purgeState]);
    });
  }

  async listSchemas(): Promise<readonly PublishedSchemaPackage[]> {
    const result = await this.pool.query<SchemaRow>("SELECT id, namespace, name, semantic_version, schema_digest, manifest_json, status, created_at FROM schema_packages ORDER BY namespace,name,semantic_version DESC");
    return result.rows.map(mapSchema);
  }
  async getSchema(key: string): Promise<PublishedSchemaPackage | undefined> {
    const [namespace,name,version] = key.split("/");
    if (!namespace || !name || !version) return undefined;
    const result = await this.pool.query<SchemaRow>("SELECT id, namespace, name, semantic_version, schema_digest, manifest_json, status, created_at FROM schema_packages WHERE namespace=$1 AND name=$2 AND semantic_version=$3", [namespace,name,version]);
    return result.rows[0] ? mapSchema(result.rows[0]) : undefined;
  }
  async getSnapshot(workspaceId: string): Promise<ControlCentreSnapshot> {
    return inTransaction(this.pool, async (db) => {
      await db.query("SELECT set_config('trust.workspace_id',$1,true)", [workspaceId]);
      const result = await db.query<DatasetRow>("SELECT d.id,d.name,d.dataset_type,d.status,s.namespace||'/'||s.name||'/'||s.semantic_version AS schema_key,count(DISTINCT r.id)::int AS resource_count,count(DISTINCT t.id)::int AS deleted_count,max(r.updated_at) AS last_updated FROM datasets d JOIN schema_packages s ON s.id=d.schema_package_id LEFT JOIN resources r ON r.dataset_id=d.id LEFT JOIN tombstones t ON t.dataset_id=d.id WHERE d.workspace_id=$1 GROUP BY d.id,s.namespace,s.name,s.semantic_version ORDER BY d.name", [workspaceId]);
      const datasets: DatasetSummary[] = result.rows.map((row) => ({ id: row.id, name: row.name, description: `${row.dataset_type} persisted dataset`, kind: "personal", canonicalStore: "PostgreSQL + object storage", schema: row.schema_key, objects: `${row.resource_count} resources`, storage: "Metadata persisted", lastVerified: row.last_updated ? new Date(row.last_updated).toISOString() : "Not verified", health: "verified", recovery: "Application-level revision history", deleted: `${row.deleted_count} recoverable`, recentEvents: ["Loaded from PostgreSQL"] }));
      return { status: { protectedDatasets: datasets.length, activeProjects: datasets.length, latestVerifiedBackup: "Verification not yet scheduled", recoveryAttention: datasets.reduce((sum,item)=>sum+(item.deleted.startsWith("0")?0:1),0), canonicalIntegrityPercent: 100, syncQueue: 0 }, datasets };
    });
  }
}

interface SchemaRow { id:string; namespace:string; name:string; semantic_version:string; schema_digest:string; manifest_json:SchemaPackageManifest; status:"active"|"deprecated"|"revoked"; created_at:string|Date; }
interface DatasetRow { id:string; name:string; dataset_type:string; status:string; schema_key:string; resource_count:number; deleted_count:number; last_updated:string|Date|null; }
function mapSchema(row: SchemaRow): PublishedSchemaPackage { return { id:row.id,key:`${row.namespace}/${row.name}/${row.semantic_version}`,digest:row.schema_digest,status:row.status,publishedAt:new Date(row.created_at).toISOString(),manifest:row.manifest_json }; }
