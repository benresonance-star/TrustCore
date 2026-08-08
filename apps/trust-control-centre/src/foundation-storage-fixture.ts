import type {
  ApplicationTenant,
  EffectiveStorageSummary,
  StorageBindingRollup,
  StorageBindingSummary,
} from "@trust-core/protocol";

const FOUNDATION_APP_ID = "fixture-app-foundation";
const WORKSPACE_ID = "workspace-demo";

const tenant1Id = "fixture-tenant-1";
const tenant2Id = "fixture-tenant-2";
const tenant3Id = "fixture-tenant-003";

export const foundationFixtureApp = {
  id: FOUNDATION_APP_ID,
  workspaceId: WORKSPACE_ID,
  namespace: "app/foundation",
  name: "Foundation",
  applicationVersion: "1.0.0",
  schemaPackageIds: [] as string[],
  capabilities: ["dataset:read", "resource:read", "object:ingest"],
  status: "active" as const,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

export const foundationTenants: ApplicationTenant[] = [
  {
    id: tenant1Id,
    workspaceId: WORKSPACE_ID,
    applicationId: FOUNDATION_APP_ID,
    externalTenantKey: "1",
    displayName: "Tenant 1",
    status: "active",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
  {
    id: tenant2Id,
    workspaceId: WORKSPACE_ID,
    applicationId: FOUNDATION_APP_ID,
    externalTenantKey: "2",
    displayName: "Tenant 2",
    status: "active",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
  {
    id: tenant3Id,
    workspaceId: WORKSPACE_ID,
    applicationId: FOUNDATION_APP_ID,
    externalTenantKey: "003",
    displayName: "Tenant 003",
    status: "active",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
];

function binding(partial: StorageBindingSummary): StorageBindingSummary {
  return partial;
}

export const foundationAppDefaultBinding = binding({
  id: "fixture-binding-foundation-app",
  workspaceId: WORKSPACE_ID,
  applicationId: FOUNDATION_APP_ID,
  applicationTenantId: null,
  profile: {
    id: "fixture-profile-foundation-app",
    provider: "s3",
    region: "ap-southeast-2",
    bucket: "foundation-managed",
    prefix: "",
    tier: "managed",
    credentialMode: "platform_iam",
    expectedBucketOwner: null,
    endpointHost: null,
    roleArn: null,
    declaredPlanCode: "platform",
    declaredCapacityBytes: null,
  },
  status: "connected",
  generation: 1,
  lastProbeOk: true,
  lastProbeAt: "2026-08-04T02:14:00.000Z",
  lastProbeSummary: "Foundation app default connected",
  lastIssueClass: null,
  planSyncState: "unknown",
  observedUsageBytes: null,
  observedQuotaBytes: null,
  observedAt: null,
  disabled: false,
  costPosture: "platform_managed",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-04T02:14:00.000Z",
});

export const foundationTenantBindings: StorageBindingSummary[] = [
  binding({
    id: "fixture-binding-t1",
    workspaceId: WORKSPACE_ID,
    applicationId: FOUNDATION_APP_ID,
    applicationTenantId: tenant1Id,
    profile: {
      id: "fixture-profile-t1",
      provider: "s3",
      region: "ap-southeast-2",
      bucket: "foundation-tenant-1",
      prefix: "apps/foundation/tenants/1",
      tier: "byob",
      credentialMode: "cross_account_role",
      expectedBucketOwner: "111111111111",
      endpointHost: null,
      roleArn: "arn:aws:iam::111111111111:role/TrustCoreAccess",
      declaredPlanCode: "5tb",
      declaredCapacityBytes: 5 * 1024 ** 4,
    },
    status: "connected",
    generation: 1,
    lastProbeOk: true,
    lastProbeAt: "2026-08-04T02:14:00.000Z",
    lastProbeSummary: "Tenant 1 BYOB connected",
    lastIssueClass: null,
    planSyncState: "synced",
    observedUsageBytes: 1.2 * 1024 ** 4,
    observedQuotaBytes: 5 * 1024 ** 4,
    observedAt: "2026-08-04T02:14:00.000Z",
    disabled: false,
    costPosture: "customer_billed_byob",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-04T02:14:00.000Z",
  }),
  binding({
    id: "fixture-binding-t2",
    workspaceId: WORKSPACE_ID,
    applicationId: FOUNDATION_APP_ID,
    applicationTenantId: tenant2Id,
    profile: {
      id: "fixture-profile-t2",
      provider: "s3",
      region: "eu-west-1",
      bucket: "foundation-tenant-2",
      prefix: "apps/foundation/tenants/2",
      tier: "byob",
      credentialMode: "cross_account_role",
      expectedBucketOwner: "222222222222",
      endpointHost: null,
      roleArn: "arn:aws:iam::222222222222:role/TrustCoreAccess",
      declaredPlanCode: null,
      declaredCapacityBytes: null,
    },
    status: "needs_attention",
    generation: 1,
    lastProbeOk: false,
    lastProbeAt: "2026-08-04T02:14:00.000Z",
    lastProbeSummary: "Bucket region does not match configured region.",
    lastIssueClass: "wrong_region",
    planSyncState: "unknown",
    observedUsageBytes: null,
    observedQuotaBytes: null,
    observedAt: null,
    disabled: false,
    costPosture: "customer_billed_byob",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-04T02:14:00.000Z",
  }),
  binding({
    id: "fixture-binding-t3",
    workspaceId: WORKSPACE_ID,
    applicationId: FOUNDATION_APP_ID,
    applicationTenantId: tenant3Id,
    profile: {
      id: "fixture-profile-t3",
      provider: "s3",
      region: "ap-southeast-2",
      bucket: "foundation-tenant-003",
      prefix: "apps/foundation/tenants/003",
      tier: "byob",
      credentialMode: "cross_account_role",
      expectedBucketOwner: "333333333333",
      endpointHost: null,
      roleArn: "arn:aws:iam::333333333333:role/TrustCoreAccess",
      declaredPlanCode: "5tb",
      declaredCapacityBytes: 5 * 1024 ** 4,
    },
    status: "connected",
    generation: 2,
    lastProbeOk: true,
    lastProbeAt: "2026-08-04T02:14:00.000Z",
    lastProbeSummary: "Tenant 003 connected",
    lastIssueClass: null,
    planSyncState: "upgrade_recognised",
    observedUsageBytes: 4.2 * 1024 ** 4,
    observedQuotaBytes: 10 * 1024 ** 4,
    observedAt: "2026-08-04T02:20:00.000Z",
    disabled: false,
    costPosture: "customer_billed_byob",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-04T02:20:00.000Z",
  }),
];

export function foundationEffectiveAppDefault(): EffectiveStorageSummary {
  const b = foundationAppDefaultBinding;
  return {
    scope: "app",
    status: b.status,
    inheritedFrom: "none",
    binding: b,
    provider: b.profile.provider,
    tier: b.profile.tier,
    region: b.profile.region,
    bucket: b.profile.bucket,
    prefix: b.profile.prefix,
    credentialMode: b.profile.credentialMode,
    usage: { cataloguedObjects: 1200, failedVerificationObjects: 0 },
    costPosture: b.costPosture,
    planSyncState: b.planSyncState,
    declaredCapacityBytes: b.profile.declaredCapacityBytes,
    observedUsageBytes: b.observedUsageBytes,
    observedQuotaBytes: b.observedQuotaBytes,
  };
}

export function foundationEffectiveForTenant(
  tenantId: string,
): EffectiveStorageSummary {
  const b =
    foundationTenantBindings.find((x) => x.applicationTenantId === tenantId) ??
    foundationAppDefaultBinding;
  const inherited = b.applicationTenantId ? "none" : "app";
  return {
    scope: b.applicationTenantId ? "tenant" : "app",
    status: b.status,
    inheritedFrom: inherited,
    binding: b,
    provider: b.profile.provider,
    tier: b.profile.tier,
    region: b.profile.region,
    bucket: b.profile.bucket,
    prefix: b.profile.prefix,
    credentialMode: b.profile.credentialMode,
    usage: {
      cataloguedObjects: tenantId === tenant2Id ? 0 : 420,
      failedVerificationObjects: 0,
    },
    costPosture: b.costPosture,
    planSyncState: b.planSyncState,
    declaredCapacityBytes: b.profile.declaredCapacityBytes,
    observedUsageBytes: b.observedUsageBytes,
    observedQuotaBytes: b.observedQuotaBytes,
  };
}

export function foundationStorageRollup(
  platformStatus: StorageBindingRollup["platformStatus"] = "healthy",
): StorageBindingRollup {
  return {
    platformStatus,
    platformSummary: "Platform object storage connected.",
    applications: [
      {
        applicationId: FOUNDATION_APP_ID,
        applicationName: "Foundation",
        connected: 2,
        attention: 1,
        configured: 0,
        notSetUp: 0,
        topIssues: [
          {
            applicationTenantId: tenant2Id,
            externalTenantKey: "2",
            issueClass: "wrong_region",
            summary: "Bucket region does not match configured region.",
          },
        ],
      },
    ],
    attentionTotal: 1,
  };
}

export { FOUNDATION_APP_ID, WORKSPACE_ID as FOUNDATION_WORKSPACE_ID };
