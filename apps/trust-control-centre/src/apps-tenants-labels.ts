import type {
  ApplicationTenant,
  EffectiveStorageSummary,
  StorageBindingRollup,
  StorageBindingSummary,
  StoragePlanSyncState,
} from "@trust-core/protocol";
import {
  FOUNDATION_APP_ID,
  foundationAppDefaultBinding,
  foundationEffectiveAppDefault,
  foundationEffectiveForTenant,
  foundationStorageRollup,
  foundationTenants,
  foundationTenantBindings,
} from "./foundation-storage-fixture";

export type DemoTenantState = {
  tenants: ApplicationTenant[];
  appDefault: StorageBindingSummary;
  tenantBindings: StorageBindingSummary[];
};

export function createDemoTenantState(): DemoTenantState {
  return {
    tenants: foundationTenants.map((tenant) => ({ ...tenant })),
    appDefault: structuredClone(foundationAppDefaultBinding),
    tenantBindings: foundationTenantBindings.map((binding) =>
      structuredClone(binding),
    ),
  };
}

export function demoEffectiveAppDefault(
  state: DemoTenantState,
): EffectiveStorageSummary {
  const base = foundationEffectiveAppDefault();
  return {
    ...base,
    status: state.appDefault.status,
    binding: state.appDefault,
    provider: state.appDefault.profile.provider,
    tier: state.appDefault.profile.tier,
    region: state.appDefault.profile.region,
    bucket: state.appDefault.profile.bucket,
    prefix: state.appDefault.profile.prefix,
    credentialMode: state.appDefault.profile.credentialMode,
    costPosture: state.appDefault.costPosture,
    planSyncState: state.appDefault.planSyncState,
    declaredCapacityBytes: state.appDefault.profile.declaredCapacityBytes,
    observedUsageBytes: state.appDefault.observedUsageBytes,
    observedQuotaBytes: state.appDefault.observedQuotaBytes,
  };
}

export function demoEffectiveForTenant(
  state: DemoTenantState,
  tenantId: string,
): EffectiveStorageSummary {
  const override = state.tenantBindings.find(
    (binding) => binding.applicationTenantId === tenantId,
  );
  if (!override) {
    const app = demoEffectiveAppDefault(state);
    return {
      ...app,
      scope: "app",
      inheritedFrom: "app",
    };
  }
  const base = foundationEffectiveForTenant(tenantId);
  return {
    ...base,
    status: override.status,
    inheritedFrom: "none",
    binding: override,
    provider: override.profile.provider,
    tier: override.profile.tier,
    region: override.profile.region,
    bucket: override.profile.bucket,
    prefix: override.profile.prefix,
    credentialMode: override.profile.credentialMode,
    costPosture: override.costPosture,
    planSyncState: override.planSyncState,
    declaredCapacityBytes: override.profile.declaredCapacityBytes,
    observedUsageBytes: override.observedUsageBytes,
    observedQuotaBytes: override.observedQuotaBytes,
  };
}

export function demoStorageRollup(state: DemoTenantState): StorageBindingRollup {
  let connected = 0;
  let attention = 0;
  let configured = 0;
  const topIssues: {
    applicationTenantId: string | null;
    externalTenantKey: string | null;
    issueClass: string | null;
    summary: string;
  }[] = [];
  for (const tenant of state.tenants) {
    const effective = demoEffectiveForTenant(state, tenant.id);
    if (effective.status === "connected") connected += 1;
    else if (effective.status === "needs_attention") {
      attention += 1;
      topIssues.push({
        applicationTenantId: tenant.id,
        externalTenantKey: tenant.externalTenantKey,
        issueClass: effective.binding?.lastIssueClass ?? null,
        summary:
          effective.binding?.lastProbeSummary ??
          "Customer storage needs attention",
      });
    } else configured += 1;
  }
  return {
    platformStatus: "healthy",
    platformSummary: "Platform object storage connected.",
    applications: [
      {
        applicationId: FOUNDATION_APP_ID,
        applicationName: "Foundation",
        connected,
        attention,
        configured,
        notSetUp: 0,
        topIssues: topIssues.slice(0, 5),
      },
    ],
    attentionTotal: attention,
  };
}

export function humanStorageStatus(status: string): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "configured":
      return "Ready to test";
    case "needs_attention":
      return "Needs attention";
    case "not_configured":
      return "Not set up";
    case "disabled":
      return "Paused";
    case "migrating":
      return "Moving data";
    case "draft":
      return "Draft";
    case "awaiting_customer_role":
      return "Waiting on customer";
    default:
      return status;
  }
}

export function humanProvider(provider: string | null | undefined): string {
  switch (provider) {
    case "s3":
      return "Amazon S3";
    case "minio":
      return "MinIO";
    default:
      return provider ?? "—";
  }
}

export function humanTier(tier: string | null | undefined): string {
  switch (tier) {
    case "managed":
      return "Trust-managed";
    case "byob":
      return "Customer-provided";
    case "premium":
      return "Premium";
    default:
      return tier ?? "—";
  }
}

export function humanInheritance(
  inheritedFrom: string | null | undefined,
): string {
  switch (inheritedFrom) {
    case "none":
      return "Custom for this customer";
    case "app":
      return "App default";
    case "platform":
      return "Platform default";
    default:
      return "—";
  }
}

export function humanPlanSync(state: StoragePlanSyncState | string | null | undefined): string {
  switch (state) {
    case "synced":
      return "Up to date";
    case "upgrade_recognised":
      return "Capacity change found";
    case "drift_detected":
      return "Settings differ";
    case "over_capacity":
      return "Over capacity";
    case "unknown":
      return "Not checked";
    default:
      return state ?? "—";
  }
}

export function humanWhoPays(costPosture: string | null | undefined): string {
  switch (costPosture) {
    case "customer_billed_byob":
      return "Customer pays the cloud bill";
    case "platform_managed":
      return "Included with Trust";
    default:
      return "Not specified";
  }
}

export function bindingAttentionMessage(summary: EffectiveStorageSummary): string {
  const issue = summary.binding?.lastIssueClass;
  if (issue === "wrong_region") {
    return "The region on this setup does not match where the bucket lives. Update the region below to match the bucket, then test the connection again.";
  }
  if (issue === "permission" || issue === "auth") {
    return "Trust Core could not access this bucket with the current access setup. Ask the customer to confirm access, then test the connection again.";
  }
  if (issue === "not_found") {
    return "The bucket could not be found. Check the bucket name and region, then test the connection again.";
  }
  return (
    summary.binding?.lastProbeSummary ??
    "This customer storage needs attention before it can be used safely."
  );
}

export { foundationStorageRollup, FOUNDATION_APP_ID };
