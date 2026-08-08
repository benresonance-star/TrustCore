import { randomUUID } from "node:crypto";
import type {
  ApplicationTenant,
  StorageBindingCredentialMode,
  StorageBindingStatus,
  StorageBindingSummary,
  StorageBindingTier,
  StoragePlanSyncState,
  StorageProviderName,
} from "@trust-core/protocol";
import { inTransaction, type DatabasePool, type Queryable } from "./db.js";

export interface AppStorageProfileRow {
  id: string;
  workspaceId: string;
  provider: StorageProviderName;
  region: string;
  bucket: string;
  prefix: string;
  tier: StorageBindingTier;
  credentialMode: StorageBindingCredentialMode;
  expectedBucketOwner: string | null;
  endpointHost: string | null;
  roleArn: string | null;
  externalIdHash: string | null;
  declaredPlanCode: string | null;
  declaredCapacityBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppStorageBindingRow {
  id: string;
  workspaceId: string;
  applicationId: string;
  applicationTenantId: string | null;
  profileId: string;
  status: StorageBindingStatus;
  generation: number;
  lastProbeOk: boolean | null;
  lastProbeAt: string | null;
  lastProbeSummary: string | null;
  lastIssueClass: string | null;
  planSyncState: StoragePlanSyncState;
  observedUsageBytes: number | null;
  observedQuotaBytes: number | null;
  observedAt: string | null;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export class PostgresAppStorageRepository {
  constructor(private readonly pool: DatabasePool) {}

  listTenants(
    workspaceId: string,
    applicationId: string,
  ): Promise<ApplicationTenant[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<TenantRow>(
        `${selectTenant} WHERE workspace_id=$1 AND application_id=$2 ORDER BY external_tenant_key`,
        [workspaceId, applicationId],
      );
      return result.rows.map(mapTenant);
    });
  }

  listAllTenants(workspaceId: string): Promise<ApplicationTenant[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<TenantRow>(
        `${selectTenant} WHERE workspace_id=$1 ORDER BY application_id,external_tenant_key`,
        [workspaceId],
      );
      return result.rows.map(mapTenant);
    });
  }

  createTenant(input: {
    id: string;
    workspaceId: string;
    applicationId: string;
    externalTenantKey: string;
    displayName: string;
    status: ApplicationTenant["status"];
    createdAt: string;
    updatedAt: string;
  }): Promise<ApplicationTenant> {
    return this.scoped(input.workspaceId, async (db) => {
      const existing = await db.query<TenantRow>(
        `${selectTenant} WHERE workspace_id=$1 AND application_id=$2 AND external_tenant_key=$3`,
        [input.workspaceId, input.applicationId, input.externalTenantKey],
      );
      if (existing.rows[0]) return mapTenant(existing.rows[0]);
      const result = await db.query<TenantRow>(
        `INSERT INTO application_tenants (id,workspace_id,application_id,external_tenant_key,display_name,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.applicationId,
          input.externalTenantKey,
          input.displayName,
          input.status,
          input.createdAt,
          input.updatedAt,
        ],
      );
      return mapTenant(required(result.rows[0]));
    });
  }

  getTenant(
    workspaceId: string,
    applicationId: string,
    tenantId: string,
  ): Promise<ApplicationTenant | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<TenantRow>(
        `${selectTenant} WHERE workspace_id=$1 AND application_id=$2 AND id=$3`,
        [workspaceId, applicationId, tenantId],
      );
      return result.rows[0] ? mapTenant(result.rows[0]) : undefined;
    });
  }

  updateTenant(input: {
    workspaceId: string;
    applicationId: string;
    tenantId: string;
    displayName?: string;
    status?: ApplicationTenant["status"];
    expectedUpdatedAt: string;
    updatedAt: string;
  }): Promise<ApplicationTenant> {
    return this.scoped(input.workspaceId, async (db) => {
      const result = await db.query<TenantRow>(
        `UPDATE application_tenants
         SET display_name=COALESCE($5, display_name),
             status=COALESCE($6, status),
             updated_at=$7
         WHERE workspace_id=$1 AND application_id=$2 AND id=$3 AND updated_at=$4
         RETURNING *`,
        [
          input.workspaceId,
          input.applicationId,
          input.tenantId,
          input.expectedUpdatedAt,
          input.displayName ?? null,
          input.status ?? null,
          input.updatedAt,
        ],
      );
      if (!result.rows[0]) {
        throw Object.assign(new Error("Application tenant update conflict."), {
          code: "CONFLICT",
        });
      }
      return mapTenant(result.rows[0]);
    });
  }

  listProfiles(workspaceId: string): Promise<AppStorageProfileRow[]> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<ProfileRow>(
        `${selectProfile} WHERE workspace_id=$1`,
        [workspaceId],
      );
      return result.rows.map(mapProfile);
    });
  }

  listBindings(
    workspaceId: string,
    filter?: { applicationId?: string; applicationTenantId?: string | null },
  ): Promise<AppStorageBindingRow[]> {
    return this.scoped(workspaceId, async (db) => {
      const clauses = ["workspace_id=$1"];
      const params: unknown[] = [workspaceId];
      if (filter?.applicationId != null) {
        params.push(filter.applicationId);
        clauses.push(`application_id=$${params.length}`);
      }
      if (filter && "applicationTenantId" in filter) {
        if (filter.applicationTenantId == null) {
          clauses.push("application_tenant_id IS NULL");
        } else {
          params.push(filter.applicationTenantId);
          clauses.push(`application_tenant_id=$${params.length}`);
        }
      }
      const result = await db.query<BindingRow>(
        `${selectBinding} WHERE ${clauses.join(" AND ")} ORDER BY created_at`,
        params,
      );
      return result.rows.map(mapBinding);
    });
  }

  getBinding(
    workspaceId: string,
    bindingId: string,
  ): Promise<AppStorageBindingRow | undefined> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<BindingRow>(
        `${selectBinding} WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, bindingId],
      );
      return result.rows[0] ? mapBinding(result.rows[0]) : undefined;
    });
  }

  upsertProfileAndBinding(input: {
    workspaceId: string;
    profile: AppStorageProfileRow;
    binding: AppStorageBindingRow;
    version?: {
      id: string;
      snapshot: StorageBindingSummary;
      createdBy: string;
      createdAt: string;
    };
  }): Promise<void> {
    return this.scoped(input.workspaceId, async (db) => {
      await db.query(
        `INSERT INTO storage_profiles (
          id,workspace_id,provider,region,bucket,prefix,tier,credential_mode,
          expected_bucket_owner,endpoint_host,role_arn,external_id_hash,
          declared_plan_code,declared_capacity_bytes,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (id) DO UPDATE SET
          provider=EXCLUDED.provider,
          region=EXCLUDED.region,
          bucket=EXCLUDED.bucket,
          prefix=EXCLUDED.prefix,
          tier=EXCLUDED.tier,
          credential_mode=EXCLUDED.credential_mode,
          expected_bucket_owner=EXCLUDED.expected_bucket_owner,
          endpoint_host=EXCLUDED.endpoint_host,
          role_arn=EXCLUDED.role_arn,
          external_id_hash=COALESCE(EXCLUDED.external_id_hash, storage_profiles.external_id_hash),
          declared_plan_code=EXCLUDED.declared_plan_code,
          declared_capacity_bytes=EXCLUDED.declared_capacity_bytes,
          updated_at=EXCLUDED.updated_at`,
        [
          input.profile.id,
          input.profile.workspaceId,
          input.profile.provider,
          input.profile.region,
          input.profile.bucket,
          input.profile.prefix,
          input.profile.tier,
          input.profile.credentialMode,
          input.profile.expectedBucketOwner,
          input.profile.endpointHost,
          input.profile.roleArn,
          input.profile.externalIdHash,
          input.profile.declaredPlanCode,
          input.profile.declaredCapacityBytes,
          input.profile.createdAt,
          input.profile.updatedAt,
        ],
      );
      await db.query(
        `INSERT INTO storage_bindings (
          id,workspace_id,application_id,application_tenant_id,profile_id,status,generation,
          last_probe_ok,last_probe_at,last_probe_summary,last_issue_class,plan_sync_state,
          observed_usage_bytes,observed_quota_bytes,observed_at,disabled,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (id) DO UPDATE SET
          profile_id=EXCLUDED.profile_id,
          status=EXCLUDED.status,
          generation=EXCLUDED.generation,
          last_probe_ok=EXCLUDED.last_probe_ok,
          last_probe_at=EXCLUDED.last_probe_at,
          last_probe_summary=EXCLUDED.last_probe_summary,
          last_issue_class=EXCLUDED.last_issue_class,
          plan_sync_state=EXCLUDED.plan_sync_state,
          observed_usage_bytes=EXCLUDED.observed_usage_bytes,
          observed_quota_bytes=EXCLUDED.observed_quota_bytes,
          observed_at=EXCLUDED.observed_at,
          disabled=EXCLUDED.disabled,
          updated_at=EXCLUDED.updated_at`,
        [
          input.binding.id,
          input.binding.workspaceId,
          input.binding.applicationId,
          input.binding.applicationTenantId,
          input.binding.profileId,
          input.binding.status,
          input.binding.generation,
          input.binding.lastProbeOk,
          input.binding.lastProbeAt,
          input.binding.lastProbeSummary,
          input.binding.lastIssueClass,
          input.binding.planSyncState,
          input.binding.observedUsageBytes,
          input.binding.observedQuotaBytes,
          input.binding.observedAt,
          input.binding.disabled,
          input.binding.createdAt,
          input.binding.updatedAt,
        ],
      );
      if (input.version) {
        await db.query(
          `INSERT INTO storage_binding_versions (
            id,workspace_id,binding_id,generation,snapshot_json,created_by,created_at
          ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
          [
            input.version.id,
            input.workspaceId,
            input.binding.id,
            input.binding.generation,
            JSON.stringify(input.version.snapshot),
            input.version.createdBy,
            input.version.createdAt,
          ],
        );
      }
    });
  }

  updateBindingState(binding: AppStorageBindingRow): Promise<void> {
    return this.scoped(binding.workspaceId, async (db) => {
      await db.query(
        `UPDATE storage_bindings SET
          status=$3,generation=$4,last_probe_ok=$5,last_probe_at=$6,last_probe_summary=$7,
          last_issue_class=$8,plan_sync_state=$9,observed_usage_bytes=$10,observed_quota_bytes=$11,
          observed_at=$12,disabled=$13,updated_at=$14
         WHERE workspace_id=$1 AND id=$2`,
        [
          binding.workspaceId,
          binding.id,
          binding.status,
          binding.generation,
          binding.lastProbeOk,
          binding.lastProbeAt,
          binding.lastProbeSummary,
          binding.lastIssueClass,
          binding.planSyncState,
          binding.observedUsageBytes,
          binding.observedQuotaBytes,
          binding.observedAt,
          binding.disabled,
          binding.updatedAt,
        ],
      );
    });
  }

  updateProfilePlan(input: {
    workspaceId: string;
    profileId: string;
    declaredCapacityBytes: number | null;
    declaredPlanCode: string | null;
    updatedAt: string;
  }): Promise<void> {
    return this.scoped(input.workspaceId, async (db) => {
      await db.query(
        `UPDATE storage_profiles SET declared_capacity_bytes=$3,declared_plan_code=$4,updated_at=$5
         WHERE workspace_id=$1 AND id=$2`,
        [
          input.workspaceId,
          input.profileId,
          input.declaredCapacityBytes,
          input.declaredPlanCode,
          input.updatedAt,
        ],
      );
    });
  }

  deleteBinding(workspaceId: string, bindingId: string): Promise<void> {
    return this.scoped(workspaceId, async (db) => {
      await db.query(
        `DELETE FROM storage_binding_versions WHERE workspace_id=$1 AND binding_id=$2`,
        [workspaceId, bindingId],
      );
      const binding = await db.query<{ profile_id: string }>(
        `DELETE FROM storage_bindings WHERE workspace_id=$1 AND id=$2 RETURNING profile_id`,
        [workspaceId, bindingId],
      );
      const profileId = binding.rows[0]?.profile_id;
      if (profileId) {
        await db.query(
          `DELETE FROM storage_profiles WHERE workspace_id=$1 AND id=$2
           AND NOT EXISTS (SELECT 1 FROM storage_bindings b WHERE b.profile_id=$2)`,
          [workspaceId, profileId],
        );
      }
    });
  }

  countStickyBlobs(workspaceId: string, bindingId: string): Promise<number> {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM blob_objects
         WHERE workspace_id=$1 AND storage_binding_id=$2`,
        [workspaceId, bindingId],
      );
      return Number(result.rows[0]?.count ?? 0);
    });
  }

  updateStickyBindings(input: {
    workspaceId: string;
    targetBindingId: string;
    targetGeneration: number;
    objectIds: readonly string[];
  }): Promise<number> {
    if (input.objectIds.length === 0) return Promise.resolve(0);
    return this.scoped(input.workspaceId, async (db) => {
      const result = await db.query(
        `UPDATE blob_objects
         SET storage_binding_id=$2, storage_binding_generation=$3
         WHERE workspace_id=$1 AND id = ANY($4::uuid[])`,
        [
          input.workspaceId,
          input.targetBindingId,
          input.targetGeneration,
          [...input.objectIds],
        ],
      );
      return result.rowCount ?? 0;
    });
  }

  listBindingVersions(
    workspaceId: string,
    bindingId: string,
  ): Promise<
    { id: string; generation: number; snapshot: StorageBindingSummary; createdBy: string; createdAt: string }[]
  > {
    return this.scoped(workspaceId, async (db) => {
      const result = await db.query<VersionRow>(
        `SELECT id,generation,snapshot_json,created_by,created_at FROM storage_binding_versions
         WHERE workspace_id=$1 AND binding_id=$2 ORDER BY generation DESC`,
        [workspaceId, bindingId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        generation: Number(row.generation),
        snapshot: row.snapshot_json,
        createdBy: row.created_by,
        createdAt: iso(row.created_at),
      }));
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
}

export function newAppStorageIds() {
  return { id: randomUUID() };
}

const selectTenant =
  "SELECT id,workspace_id,application_id,external_tenant_key,display_name,status,created_at,updated_at FROM application_tenants";
const selectProfile =
  "SELECT id,workspace_id,provider,region,bucket,prefix,tier,credential_mode,expected_bucket_owner,endpoint_host,role_arn,external_id_hash,declared_plan_code,declared_capacity_bytes,created_at,updated_at FROM storage_profiles";
const selectBinding =
  "SELECT id,workspace_id,application_id,application_tenant_id,profile_id,status,generation,last_probe_ok,last_probe_at,last_probe_summary,last_issue_class,plan_sync_state,observed_usage_bytes,observed_quota_bytes,observed_at,disabled,created_at,updated_at FROM storage_bindings";

interface TenantRow {
  id: string;
  workspace_id: string;
  application_id: string;
  external_tenant_key: string;
  display_name: string;
  status: ApplicationTenant["status"];
  created_at: string | Date;
  updated_at: string | Date;
}
interface ProfileRow {
  id: string;
  workspace_id: string;
  provider: StorageProviderName;
  region: string;
  bucket: string;
  prefix: string;
  tier: StorageBindingTier;
  credential_mode: StorageBindingCredentialMode;
  expected_bucket_owner: string | null;
  endpoint_host: string | null;
  role_arn: string | null;
  external_id_hash: string | null;
  declared_plan_code: string | null;
  declared_capacity_bytes: number | string | null;
  created_at: string | Date;
  updated_at: string | Date;
}
interface BindingRow {
  id: string;
  workspace_id: string;
  application_id: string;
  application_tenant_id: string | null;
  profile_id: string;
  status: StorageBindingStatus;
  generation: number | string;
  last_probe_ok: boolean | null;
  last_probe_at: string | Date | null;
  last_probe_summary: string | null;
  last_issue_class: string | null;
  plan_sync_state: StoragePlanSyncState;
  observed_usage_bytes: number | string | null;
  observed_quota_bytes: number | string | null;
  observed_at: string | Date | null;
  disabled: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}
interface VersionRow {
  id: string;
  generation: number | string;
  snapshot_json: StorageBindingSummary;
  created_by: string;
  created_at: string | Date;
}

function mapTenant(row: TenantRow): ApplicationTenant {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    applicationId: row.application_id,
    externalTenantKey: row.external_tenant_key,
    displayName: row.display_name,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapProfile(row: ProfileRow): AppStorageProfileRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    region: row.region,
    bucket: row.bucket,
    prefix: row.prefix,
    tier: row.tier,
    credentialMode: row.credential_mode,
    expectedBucketOwner: row.expected_bucket_owner,
    endpointHost: row.endpoint_host,
    roleArn: row.role_arn,
    externalIdHash: row.external_id_hash,
    declaredPlanCode: row.declared_plan_code,
    declaredCapacityBytes:
      row.declared_capacity_bytes == null
        ? null
        : Number(row.declared_capacity_bytes),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapBinding(row: BindingRow): AppStorageBindingRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    applicationId: row.application_id,
    applicationTenantId: row.application_tenant_id,
    profileId: row.profile_id,
    status: row.status,
    generation: Number(row.generation),
    lastProbeOk: row.last_probe_ok,
    lastProbeAt: row.last_probe_at ? iso(row.last_probe_at) : null,
    lastProbeSummary: row.last_probe_summary,
    lastIssueClass: row.last_issue_class,
    planSyncState: row.plan_sync_state,
    observedUsageBytes:
      row.observed_usage_bytes == null ? null : Number(row.observed_usage_bytes),
    observedQuotaBytes:
      row.observed_quota_bytes == null ? null : Number(row.observed_quota_bytes),
    observedAt: row.observed_at ? iso(row.observed_at) : null,
    disabled: row.disabled,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function iso(value: string | Date): string {
  return new Date(value).toISOString();
}
function required<T>(value: T | undefined): T {
  if (!value) throw new Error("Expected row was not returned.");
  return value;
}
