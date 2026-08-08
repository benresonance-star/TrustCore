import { createHash, randomUUID } from "node:crypto";
import type {
  ApplicationTenant,
  EffectiveStorageSummary,
  StorageBindingCredentialMode,
  StorageBindingRollup,
  StorageBindingStatus,
  StorageBindingSummary,
  StorageBindingTier,
  StorageCostPosture,
  StorageInheritedFrom,
  StoragePlanSyncState,
  StorageProfileSummary,
  StorageProviderName,
  UpsertStorageBindingCommand,
} from "@trust-core/protocol";

export type BindingHandshakeStep =
  | "draft"
  | "awaiting_customer_role"
  | "role_submitted"
  | "external_id_hardening"
  | "connectivity_probe"
  | "ingest_probe"
  | "connected"
  | "needs_attention";

export interface StoredStorageProfile extends StorageProfileSummary {
  workspaceId: string;
  /** Server-only; never serialize to health GET after reveal. */
  externalId?: string;
  externalIdRevealed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredStorageBinding {
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

export interface BindingVersion {
  id: string;
  workspaceId: string;
  bindingId: string;
  generation: number;
  snapshot: StorageBindingSummary;
  createdBy: string;
  createdAt: string;
}

export interface BlobStickyRoute {
  objectId: string;
  workspaceId: string;
  sha256: string;
  storageBindingId: string;
  storageBindingGeneration: number;
}

export interface RoutingContext {
  workspaceId: string;
  applicationId?: string;
  applicationTenantId?: string;
  /** When set, must match authenticated mapping — never trust client alone. */
  externalTenantKey?: string;
  purpose: "ingest" | "download" | "probe" | "migrate" | "portability";
  /** For downloads: sticky binding from catalog. */
  blobStorageBindingId?: string;
  /** When set during migrate, must match binding.generation (R10). */
  bindingGeneration?: number;
}

export interface ResolveResult {
  bindingId: string | null;
  generation: number | null;
  inheritedFrom: StorageInheritedFrom;
  scope: EffectiveStorageSummary["scope"];
  status: StorageBindingStatus | "not_configured";
  allowWrite: boolean;
  reason?: string;
  profile: StorageProfileSummary | null;
}

/** Persistence + routing surface shared by in-memory and Postgres backends. */
export interface AppStorageRegistry {
  ensureHydrated?(workspaceId: string): Promise<void>;
  persistBinding?(
    bindingId: string,
    actorId?: string,
    withVersion?: boolean,
  ): Promise<void>;
  persistTenant?(
    tenant: ApplicationTenant,
    options?: { expectedUpdatedAt?: string },
  ): Promise<void>;
  persistBindingState?(bindingId: string): Promise<void>;
  persistPlan?(bindingId: string): Promise<void>;
  deletePersistedBinding?(
    workspaceId: string,
    bindingId: string,
  ): Promise<void>;
  countStickyBlobs?(
    workspaceId: string,
    bindingId: string,
  ): Promise<number>;
  persistStickyCutover?(input: {
    workspaceId: string;
    targetBindingId: string;
    targetGeneration: number;
    objectIds: readonly string[];
  }): Promise<void>;
  listTenants(workspaceId: string, applicationId: string): ApplicationTenant[];
  getTenant(
    workspaceId: string,
    applicationId: string,
    tenantId: string,
  ): ApplicationTenant | undefined;
  createTenant(input: {
    workspaceId: string;
    applicationId: string;
    externalTenantKey: string;
    displayName: string;
  }): ApplicationTenant;
  updateTenant(input: {
    workspaceId: string;
    applicationId: string;
    tenantId: string;
    displayName: string;
    expectedUpdatedAt: string;
  }): ApplicationTenant;
  setTenantStatus(input: {
    workspaceId: string;
    applicationId: string;
    tenantId: string;
    status: ApplicationTenant["status"];
    expectedUpdatedAt: string;
  }): ApplicationTenant;
  listBindings(input: {
    workspaceId: string;
    applicationId?: string;
    applicationTenantId?: string | null;
  }): StorageBindingSummary[];
  upsertBinding(
    command: UpsertStorageBindingCommand,
    actorId: string,
  ): {
    binding: StorageBindingSummary;
    externalId?: string;
    onboardingTemplate: string;
  };
  getBinding(bindingId: string): StoredStorageBinding | undefined;
  deleteBinding(bindingId: string, options?: { force?: boolean }): StorageBindingSummary;
  markProbeDeferred(bindingId: string, summary: string): StorageBindingSummary;
  runHandshakeHardening(bindingId: string): { ok: boolean; message?: string };
  recordProbe(
    bindingId: string,
    input: {
      ok: boolean;
      summary: string;
      issueClass?: string | null;
      expectedOwnerMatch?: boolean;
    },
  ): StorageBindingSummary;
  refreshPlan(
    bindingId: string,
    observation: {
      observedUsageBytes?: number;
      observedQuotaBytes?: number;
    },
  ): StorageBindingSummary;
  acceptPlan(
    bindingId: string,
    declaredCapacityBytes: number,
    planCode?: string,
  ): StorageBindingSummary;
  disableBinding(bindingId: string): StorageBindingSummary;
  rollbackBinding(bindingId: string, actorId: string): StorageBindingSummary;
  cutoverMigrate(input: {
    sourceBindingId: string;
    targetBindingId: string;
    objectDigests: readonly { objectId: string; sha256: string }[];
    actorId: string;
  }): StorageBindingSummary;
  effectiveSummary(input: {
    workspaceId: string;
    applicationId: string;
    applicationTenantId?: string | null;
    cataloguedObjects?: number;
    failedVerificationObjects?: number;
  }): EffectiveStorageSummary;
  rollup(input: {
    workspaceId: string;
    platformStatus: StorageBindingRollup["platformStatus"];
    platformSummary: string;
    applications: readonly { id: string; name: string }[];
  }): StorageBindingRollup;
  resolve(context: RoutingContext): ResolveResult;
  toSummary(binding: StoredStorageBinding): StorageBindingSummary;
  assertNoSecrets(payload: unknown): void;
  assumeWithoutExternalId: Map<string, boolean>;
}

function costPosture(
  tier: StorageBindingTier,
  mode: StorageBindingCredentialMode,
): StorageCostPosture {
  if (tier === "byob" || mode === "cross_account_role")
    return "customer_billed_byob";
  if (tier === "managed" || mode === "platform_iam") return "platform_managed";
  return "unknown";
}

export function hashExternalId(externalId: string): string {
  return createHash("sha256").update(externalId).digest("hex");
}

/** S1: reject roles that can be assumed without ExternalId. */
export function assertExternalIdHardening(input: {
  assumeWithoutExternalIdSucceeds: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (input.assumeWithoutExternalIdSucceeds) {
    return {
      ok: false,
      message:
        "This role is unsafe (confused deputy). Update trust policy using the template (require sts:ExternalId), then retry.",
    };
  }
  return { ok: true };
}

export function operatorErrorForIssue(issue: string): string {
  switch (issue) {
    case "owner_mismatch":
      return "ExpectedBucketOwner does not match HeadBucket owner — check AWS account id.";
    case "wrong_region":
      return "Bucket region does not match the configured region. Update TRUST region / binding region, then Test connection.";
    case "external_id":
      return "This role is unsafe (confused deputy). Update trust policy using the template, then retry.";
    case "permission":
      return "Identity works but lacks bucket/prefix rights. Grant the minimal IAM actions from the checklist.";
    default:
      return "Storage binding needs attention. Open provider console and re-run Test connection.";
  }
}

export function evaluatePlanSync(input: {
  declaredCapacityBytes: number | null;
  observedUsageBytes: number | null;
  observedQuotaBytes: number | null;
  previousQuotaBytes: number | null;
}): StoragePlanSyncState {
  const {
    declaredCapacityBytes,
    observedUsageBytes,
    observedQuotaBytes,
    previousQuotaBytes,
  } = input;
  if (
    observedQuotaBytes == null &&
    observedUsageBytes == null &&
    declaredCapacityBytes == null
  ) {
    return "unknown";
  }
  if (
    declaredCapacityBytes != null &&
    observedUsageBytes != null &&
    observedUsageBytes > declaredCapacityBytes
  ) {
    return "over_capacity";
  }
  if (
    observedQuotaBytes != null &&
    ((previousQuotaBytes != null && observedQuotaBytes > previousQuotaBytes) ||
      (previousQuotaBytes == null &&
        declaredCapacityBytes != null &&
        observedQuotaBytes > declaredCapacityBytes))
  ) {
    return "upgrade_recognised";
  }
  if (
    declaredCapacityBytes != null &&
    observedQuotaBytes != null &&
    observedQuotaBytes !== declaredCapacityBytes
  ) {
    return "drift_detected";
  }
  if (declaredCapacityBytes != null || observedQuotaBytes != null) {
    return "synced";
  }
  return "unknown";
}

export class InMemoryAppStorageRegistry implements AppStorageRegistry {
  readonly tenants = new Map<string, ApplicationTenant>();
  readonly profiles = new Map<string, StoredStorageProfile>();
  readonly bindings = new Map<string, StoredStorageBinding>();
  readonly versions: BindingVersion[] = [];
  readonly blobs = new Map<string, BlobStickyRoute>();
  /** Fake STS: bindingId → whether assume without ExternalId would succeed */
  assumeWithoutExternalId = new Map<string, boolean>();
  private readonly externalIds = new Map<string, string>();

  now = () => new Date().toISOString();

  getBinding(bindingId: string): StoredStorageBinding | undefined {
    return this.bindings.get(bindingId);
  }

  listTenants(workspaceId: string, applicationId: string): ApplicationTenant[] {
    return [...this.tenants.values()].filter(
      (t) =>
        t.workspaceId === workspaceId && t.applicationId === applicationId,
    );
  }

  getTenant(
    workspaceId: string,
    applicationId: string,
    tenantId: string,
  ): ApplicationTenant | undefined {
    const tenant = this.tenants.get(tenantId);
    if (
      !tenant ||
      tenant.workspaceId !== workspaceId ||
      tenant.applicationId !== applicationId
    ) {
      return undefined;
    }
    return tenant;
  }

  createTenant(input: {
    workspaceId: string;
    applicationId: string;
    externalTenantKey: string;
    displayName: string;
  }): ApplicationTenant {
    const existing = this.listTenants(
      input.workspaceId,
      input.applicationId,
    ).find((t) => t.externalTenantKey === input.externalTenantKey);
    if (existing) return existing;
    const at = this.now();
    const tenant: ApplicationTenant = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      applicationId: input.applicationId,
      externalTenantKey: input.externalTenantKey,
      displayName: input.displayName,
      status: "active",
      createdAt: at,
      updatedAt: at,
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  updateTenant(input: {
    workspaceId: string;
    applicationId: string;
    tenantId: string;
    displayName: string;
    expectedUpdatedAt: string;
  }): ApplicationTenant {
    const tenant = this.requireTenant(
      input.workspaceId,
      input.applicationId,
      input.tenantId,
    );
    this.assertTenantExpectedUpdatedAt(tenant, input.expectedUpdatedAt);
    tenant.displayName = input.displayName;
    tenant.updatedAt = this.now();
    return tenant;
  }

  setTenantStatus(input: {
    workspaceId: string;
    applicationId: string;
    tenantId: string;
    status: ApplicationTenant["status"];
    expectedUpdatedAt: string;
  }): ApplicationTenant {
    const tenant = this.requireTenant(
      input.workspaceId,
      input.applicationId,
      input.tenantId,
    );
    this.assertTenantExpectedUpdatedAt(tenant, input.expectedUpdatedAt);
    tenant.status = input.status;
    tenant.updatedAt = this.now();
    return tenant;
  }

  listBindings(input: {
    workspaceId: string;
    applicationId?: string;
    applicationTenantId?: string | null;
  }): StorageBindingSummary[] {
    return [...this.bindings.values()]
      .filter((b) => {
        if (b.workspaceId !== input.workspaceId) return false;
        if (
          input.applicationId != null &&
          b.applicationId !== input.applicationId
        ) {
          return false;
        }
        if (input.applicationTenantId !== undefined) {
          return b.applicationTenantId === input.applicationTenantId;
        }
        return true;
      })
      .map((b) => this.toSummary(b));
  }

  mapExternalTenantKey(input: {
    workspaceId: string;
    applicationId: string;
    externalTenantKey: string;
  }): string | undefined {
    return this.listTenants(input.workspaceId, input.applicationId).find(
      (t) => t.externalTenantKey === input.externalTenantKey,
    )?.id;
  }

  upsertBinding(
    command: UpsertStorageBindingCommand,
    actorId: string,
  ): {
    binding: StorageBindingSummary;
    externalId?: string;
    onboardingTemplate: string;
  } {
    const at = this.now();
    const tenantId = command.applicationTenantId ?? null;
    const existing = [...this.bindings.values()].find(
      (b) =>
        b.workspaceId === command.workspaceId &&
        b.applicationId === command.applicationId &&
        b.applicationTenantId === tenantId,
    );

    let externalId: string | undefined;
    let profile: StoredStorageProfile;
    if (existing) {
      if (
        command.expectedGeneration != null &&
        command.expectedGeneration !== existing.generation
      ) {
        throw Object.assign(
          new Error("Storage binding generation conflict."),
          { code: "CONFLICT" },
        );
      }
      profile = this.profiles.get(existing.profileId)!;
      profile.provider = command.provider;
      profile.region = command.region;
      profile.bucket = command.bucket;
      profile.prefix = command.prefix ?? "";
      profile.tier = command.tier;
      profile.credentialMode = command.credentialMode;
      profile.expectedBucketOwner = command.expectedBucketOwner ?? null;
      profile.endpointHost = command.endpointHost ?? null;
      profile.roleArn = command.roleArn ?? null;
      profile.declaredPlanCode = command.declaredPlanCode ?? null;
      profile.declaredCapacityBytes = command.declaredCapacityBytes ?? null;
      profile.updatedAt = at;
      existing.generation += 1;
      existing.status =
        command.credentialMode === "cross_account_role" && command.roleArn
          ? "configured"
          : command.credentialMode === "platform_iam"
            ? "configured"
            : "draft";
      existing.updatedAt = at;
      existing.lastProbeOk = null;
      const summary = this.toSummary(existing);
      this.versions.push({
        id: randomUUID(),
        workspaceId: command.workspaceId,
        bindingId: existing.id,
        generation: existing.generation,
        snapshot: summary,
        createdBy: actorId,
        createdAt: at,
      });
      return {
        binding: summary,
        onboardingTemplate: this.onboardingTemplate(profile, existing.id),
      };
    }

    externalId =
      command.credentialMode === "cross_account_role"
        ? randomUUID()
        : undefined;
    const profileId = randomUUID();
    profile = {
      id: profileId,
      workspaceId: command.workspaceId,
      provider: command.provider,
      region: command.region,
      bucket: command.bucket,
      prefix: command.prefix ?? "",
      tier: command.tier,
      credentialMode: command.credentialMode,
      expectedBucketOwner: command.expectedBucketOwner ?? null,
      endpointHost: command.endpointHost ?? null,
      roleArn: command.roleArn ?? null,
      declaredPlanCode: command.declaredPlanCode ?? null,
      declaredCapacityBytes: command.declaredCapacityBytes ?? null,
      externalId,
      externalIdRevealed: Boolean(externalId),
      createdAt: at,
      updatedAt: at,
    };
    this.profiles.set(profileId, profile);
    if (externalId) this.externalIds.set(profileId, externalId);

    const binding: StoredStorageBinding = {
      id: randomUUID(),
      workspaceId: command.workspaceId,
      applicationId: command.applicationId,
      applicationTenantId: tenantId,
      profileId,
      status:
        command.credentialMode === "cross_account_role" && !command.roleArn
          ? "awaiting_customer_role"
          : "configured",
      generation: 1,
      lastProbeOk: null,
      lastProbeAt: null,
      lastProbeSummary: null,
      lastIssueClass: null,
      planSyncState: "unknown",
      observedUsageBytes: null,
      observedQuotaBytes: null,
      observedAt: null,
      disabled: false,
      createdAt: at,
      updatedAt: at,
    };
    this.bindings.set(binding.id, binding);
    const summary = this.toSummary(binding);
    this.versions.push({
      id: randomUUID(),
      workspaceId: command.workspaceId,
      bindingId: binding.id,
      generation: 1,
      snapshot: summary,
      createdBy: actorId,
      createdAt: at,
    });
    return {
      binding: summary,
      ...(externalId && !profile.externalIdRevealed
        ? {}
        : externalId
          ? { externalId }
          : {}),
      externalId,
      onboardingTemplate: this.onboardingTemplate(profile, binding.id),
    };
  }

  /** S12: second reveal redacts ExternalId. */
  revealExternalId(profileId: string): string | null {
    const profile = this.profiles.get(profileId);
    if (!profile?.externalId) return null;
    if (profile.externalIdRevealed && this.externalIds.has(profileId)) {
      // First call after create already revealed; subsequent explicit reveals redact.
    }
    const value = this.externalIds.get(profileId) ?? profile.externalId;
    if (profile.externalIdRevealed) {
      this.externalIds.delete(profileId);
      return null;
    }
    profile.externalIdRevealed = true;
    return value;
  }

  getExternalIdForTests(profileId: string): string | undefined {
    return this.externalIds.get(profileId) ?? this.profiles.get(profileId)?.externalId;
  }

  runHandshakeHardening(bindingId: string): {
    ok: boolean;
    message?: string;
  } {
    const allowUnsafe = this.assumeWithoutExternalId.get(bindingId) === true;
    const result = assertExternalIdHardening({
      assumeWithoutExternalIdSucceeds: allowUnsafe,
    });
    if (!result.ok) {
      const binding = this.bindings.get(bindingId);
      if (binding) {
        binding.status = "needs_attention";
        binding.lastIssueClass = "auth";
        binding.lastProbeSummary = result.message;
        binding.updatedAt = this.now();
      }
      return { ok: false, message: result.message };
    }
    return { ok: true };
  }

  recordProbe(
    bindingId: string,
    input: {
      ok: boolean;
      summary: string;
      issueClass?: string | null;
      expectedOwnerMatch?: boolean;
    },
  ): StorageBindingSummary {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Binding not found");
    if (input.expectedOwnerMatch === false) {
      binding.status = "needs_attention";
      binding.lastProbeOk = false;
      binding.lastIssueClass = "permission";
      binding.lastProbeSummary = operatorErrorForIssue("owner_mismatch");
      binding.lastProbeAt = this.now();
      binding.updatedAt = binding.lastProbeAt;
      return this.toSummary(binding);
    }
    binding.lastProbeOk = input.ok;
    binding.lastProbeAt = this.now();
    binding.lastProbeSummary = input.summary;
    binding.lastIssueClass = input.issueClass ?? null;
    binding.status = input.ok ? "connected" : "needs_attention";
    binding.updatedAt = binding.lastProbeAt;
    return this.toSummary(binding);
  }

  refreshPlan(
    bindingId: string,
    observation: {
      observedUsageBytes?: number;
      observedQuotaBytes?: number;
    },
  ): StorageBindingSummary {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Binding not found");
    const profile = this.profiles.get(binding.profileId)!;
    const previousQuota = binding.observedQuotaBytes;
    binding.observedUsageBytes =
      observation.observedUsageBytes ?? binding.observedUsageBytes;
    binding.observedQuotaBytes =
      observation.observedQuotaBytes ?? binding.observedQuotaBytes;
    binding.observedAt = this.now();
    binding.planSyncState = evaluatePlanSync({
      declaredCapacityBytes: profile.declaredCapacityBytes,
      observedUsageBytes: binding.observedUsageBytes,
      observedQuotaBytes: binding.observedQuotaBytes,
      previousQuotaBytes: previousQuota,
    });
    binding.updatedAt = binding.observedAt;
    return this.toSummary(binding);
  }

  acceptPlan(
    bindingId: string,
    declaredCapacityBytes: number,
    planCode?: string,
  ): StorageBindingSummary {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Binding not found");
    const profile = this.profiles.get(binding.profileId)!;
    profile.declaredCapacityBytes = declaredCapacityBytes;
    if (planCode) profile.declaredPlanCode = planCode;
    profile.updatedAt = this.now();
    binding.planSyncState = evaluatePlanSync({
      declaredCapacityBytes,
      observedUsageBytes: binding.observedUsageBytes,
      observedQuotaBytes: binding.observedQuotaBytes,
      previousQuotaBytes: binding.observedQuotaBytes,
    });
    binding.updatedAt = profile.updatedAt;
    return this.toSummary(binding);
  }

  disableBinding(bindingId: string): StorageBindingSummary {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Binding not found");
    binding.disabled = true;
    binding.status = "disabled";
    binding.generation += 1;
    binding.updatedAt = this.now();
    // S15: invalidate any cached assume sessions keyed by this binding.
    this.assumeWithoutExternalId.delete(bindingId);
    return this.toSummary(binding);
  }

  deleteBinding(
    bindingId: string,
    options?: { force?: boolean },
  ): StorageBindingSummary {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Binding not found");
    if (
      !options?.force &&
      (binding.status === "connected" || binding.status === "migrating")
    ) {
      throw Object.assign(
        new Error(
          "Connected or migrating bindings cannot be deleted without force.",
        ),
        { code: "COMMAND_REJECTED" },
      );
    }
    const sticky = [...this.blobs.values()].some(
      (blob) => blob.storageBindingId === bindingId,
    );
    if (sticky && !options?.force) {
      throw Object.assign(
        new Error(
          "Binding still referenced by sticky blob routes; disable or force-delete.",
        ),
        { code: "COMMAND_REJECTED" },
      );
    }
    const summary = this.toSummary(binding);
    this.bindings.delete(bindingId);
    this.assumeWithoutExternalId.delete(bindingId);
    const profileStillUsed = [...this.bindings.values()].some(
      (b) => b.profileId === binding.profileId,
    );
    if (!profileStillUsed) this.profiles.delete(binding.profileId);
    return summary;
  }

  /** Record that a live probe was requested but not executed (honesty). */
  markProbeDeferred(
    bindingId: string,
    summary: string,
  ): StorageBindingSummary {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Binding not found");
    if (binding.status === "connected") binding.status = "configured";
    else if (
      binding.status === "draft" ||
      binding.status === "awaiting_customer_role"
    ) {
      binding.status = "configured";
    }
    binding.lastProbeOk = null;
    binding.lastProbeAt = this.now();
    binding.lastProbeSummary = summary;
    binding.lastIssueClass = null;
    binding.updatedAt = binding.lastProbeAt;
    return this.toSummary(binding);
  }

  clearTenantOverride(bindingId: string): void {
    const binding = this.bindings.get(bindingId);
    if (!binding?.applicationTenantId)
      throw new Error("Not a tenant override binding");
    this.bindings.delete(bindingId);
  }

  private requireTenant(
    workspaceId: string,
    applicationId: string,
    tenantId: string,
  ): ApplicationTenant {
    const tenant = this.getTenant(workspaceId, applicationId, tenantId);
    if (!tenant) {
      throw Object.assign(new Error("Application tenant was not found."), {
        code: "RESOURCE_NOT_FOUND",
      });
    }
    return tenant;
  }

  private assertTenantExpectedUpdatedAt(
    tenant: ApplicationTenant,
    expectedUpdatedAt: string,
  ): void {
    if (tenant.updatedAt !== expectedUpdatedAt) {
      throw Object.assign(new Error("Application tenant update conflict."), {
        code: "CONFLICT",
      });
    }
  }

  listBindingHistory(bindingId: string, limit = 3): BindingVersion[] {
    return this.versions
      .filter((v) => v.bindingId === bindingId)
      .sort((a, b) => b.generation - a.generation)
      .slice(0, limit);
  }

  rollbackBinding(bindingId: string, actorId: string): StorageBindingSummary {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Binding not found");
    const history = this.listBindingHistory(bindingId, 2);
    const previous = history.find((v) => v.generation < binding.generation);
    if (!previous) throw new Error("No previous binding version");
    const snap = previous.snapshot.profile;
    const profile = this.profiles.get(binding.profileId)!;
    profile.provider = snap.provider;
    profile.region = snap.region;
    profile.bucket = snap.bucket;
    profile.prefix = snap.prefix;
    profile.tier = snap.tier;
    profile.credentialMode = snap.credentialMode;
    profile.expectedBucketOwner = snap.expectedBucketOwner;
    profile.endpointHost = snap.endpointHost;
    profile.roleArn = snap.roleArn;
    profile.declaredPlanCode = snap.declaredPlanCode;
    profile.declaredCapacityBytes = snap.declaredCapacityBytes;
    profile.updatedAt = this.now();
    binding.generation += 1;
    binding.status = "configured";
    binding.lastProbeOk = null;
    binding.disabled = false;
    binding.updatedAt = profile.updatedAt;
    const summary = this.toSummary(binding);
    this.versions.push({
      id: randomUUID(),
      workspaceId: binding.workspaceId,
      bindingId: binding.id,
      generation: binding.generation,
      snapshot: summary,
      createdBy: actorId,
      createdAt: binding.updatedAt,
    });
    return summary;
  }

  beginMigrate(bindingId: string): StorageBindingSummary {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Binding not found");
    if (binding.status !== "connected")
      throw new Error("Migrate requires Connected source binding");
    binding.status = "migrating";
    binding.generation += 1;
    binding.updatedAt = this.now();
    return this.toSummary(binding);
  }

  /**
   * Cut over sticky blob routes to target binding after digest equality proof (S9).
   * Refuses if any digest mismatches.
   */
  cutoverMigrate(input: {
    sourceBindingId: string;
    targetBindingId: string;
    objectDigests: readonly { objectId: string; sha256: string }[];
    actorId: string;
  }): StorageBindingSummary {
    const source = this.bindings.get(input.sourceBindingId);
    const target = this.bindings.get(input.targetBindingId);
    if (!source || !target) throw new Error("Binding not found");
    if (source.status !== "migrating")
      throw new Error("Source binding is not migrating");
    if (target.status !== "connected")
      throw new Error("Target binding must be Connected before cutover");
    for (const item of input.objectDigests) {
      const route = this.blobs.get(item.objectId);
      if (!route || route.sha256 !== item.sha256) {
        throw Object.assign(
          new Error("Migrate cutover refused: digest mismatch"),
          { code: "MIGRATE_DIGEST_MISMATCH" },
        );
      }
      this.blobs.set(item.objectId, {
        ...route,
        storageBindingId: target.id,
        storageBindingGeneration: target.generation,
      });
    }
    source.status = "connected";
    source.updatedAt = this.now();
    target.generation += 1;
    target.updatedAt = this.now();
    const summary = this.toSummary(target);
    this.versions.push({
      id: randomUUID(),
      workspaceId: target.workspaceId,
      bindingId: target.id,
      generation: target.generation,
      snapshot: summary,
      createdBy: input.actorId,
      createdAt: target.updatedAt,
    });
    return summary;
  }

  probeTempObjectKey(bindingId: string, probeId: string): string {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Binding not found");
    const profile = this.profiles.get(binding.profileId)!;
    const prefix = profile.prefix ? `${profile.prefix.replace(/\/$/, "")}/` : "";
    return `${prefix}.trust-probe/${bindingId}/${probeId}`;
  }

  resolve(context: RoutingContext): ResolveResult {
    if (context.blobStorageBindingId) {
      const sticky = this.bindings.get(context.blobStorageBindingId);
      if (sticky && sticky.workspaceId === context.workspaceId) {
        return {
          bindingId: sticky.id,
          generation: sticky.generation,
          inheritedFrom: "none",
          scope: sticky.applicationTenantId ? "tenant" : "app",
          status: sticky.disabled ? "disabled" : sticky.status,
          allowWrite: false,
          reason: "sticky_read",
          profile: this.profiles.get(sticky.profileId) ?? null,
        };
      }
    }

    if (
      context.externalTenantKey &&
      context.applicationId &&
      !context.applicationTenantId
    ) {
      return {
        bindingId: null,
        generation: null,
        inheritedFrom: "platform",
        scope: "platform",
        status: "not_configured",
        allowWrite: false,
        reason: "tenant_spoof_rejected",
        profile: null,
      };
    }

    let applicationTenantId = context.applicationTenantId;
    if (
      !applicationTenantId &&
      context.applicationId &&
      context.externalTenantKey
    ) {
      applicationTenantId = this.mapExternalTenantKey({
        workspaceId: context.workspaceId,
        applicationId: context.applicationId,
        externalTenantKey: context.externalTenantKey,
      });
      if (!applicationTenantId) {
        return {
          bindingId: null,
          generation: null,
          inheritedFrom: "platform",
          scope: "platform",
          status: "not_configured",
          allowWrite: false,
          reason: "unknown_external_tenant",
          profile: null,
        };
      }
    }

    if (applicationTenantId && context.applicationId) {
      const tenant = this.tenants.get(applicationTenantId);
      if (
        tenant &&
        tenant.workspaceId === context.workspaceId &&
        tenant.applicationId === context.applicationId &&
        tenant.status !== "active" &&
        (context.purpose === "ingest" || context.purpose === "probe")
      ) {
        return {
          bindingId: null,
          generation: null,
          inheritedFrom: "none",
          scope: "tenant",
          status: "not_configured",
          allowWrite: false,
          reason:
            tenant.status === "suspended"
              ? "tenant_suspended"
              : "tenant_closed",
          profile: null,
        };
      }
      const tenantBinding = [...this.bindings.values()].find(
        (b) =>
          b.workspaceId === context.workspaceId &&
          b.applicationId === context.applicationId &&
          b.applicationTenantId === applicationTenantId,
      );
      if (tenantBinding) {
        return this.gate(tenantBinding, "none", "tenant", context);
      }
    }

    if (context.applicationId) {
      const appBinding = [...this.bindings.values()].find(
        (b) =>
          b.workspaceId === context.workspaceId &&
          b.applicationId === context.applicationId &&
          b.applicationTenantId === null,
      );
      if (appBinding) {
        return this.gate(
          appBinding,
          applicationTenantId ? "app" : "none",
          "app",
          context,
        );
      }
    }

    return {
      bindingId: null,
      generation: null,
      inheritedFrom: "platform",
      scope: "platform",
      status: "not_configured",
      allowWrite: context.purpose === "ingest" || context.purpose === "probe",
      reason: "platform_fallback",
      profile: null,
    };
  }

  private gate(
    binding: StoredStorageBinding,
    inheritedFrom: StorageInheritedFrom,
    scope: EffectiveStorageSummary["scope"],
    context?: RoutingContext,
  ): ResolveResult {
    const profile = this.profiles.get(binding.profileId) ?? null;
    if (binding.disabled) {
      return {
        bindingId: binding.id,
        generation: binding.generation,
        inheritedFrom,
        scope,
        status: "disabled",
        allowWrite: false,
        reason: "disabled",
        profile,
      };
    }
    if (
      binding.status === "migrating" &&
      context?.bindingGeneration != null &&
      context.bindingGeneration !== binding.generation
    ) {
      return {
        bindingId: binding.id,
        generation: binding.generation,
        inheritedFrom,
        scope,
        status: binding.status,
        allowWrite: false,
        reason: "epoch_mismatch",
        profile,
      };
    }
    if (binding.status === "migrating" && context?.purpose === "ingest") {
      return {
        bindingId: binding.id,
        generation: binding.generation,
        inheritedFrom,
        scope,
        status: binding.status,
        allowWrite: false,
        reason: "migrate_quarantine",
        profile,
      };
    }
    const allowWrite = binding.status === "connected";
    return {
      bindingId: binding.id,
      generation: binding.generation,
      inheritedFrom,
      scope,
      status: binding.status,
      allowWrite,
      reason: allowWrite ? undefined : "not_connected",
      profile,
    };
  }

  commitBlob(input: {
    objectId: string;
    workspaceId: string;
    sha256: string;
    bindingId: string;
    generation: number;
  }): void {
    this.blobs.set(input.objectId, {
      objectId: input.objectId,
      workspaceId: input.workspaceId,
      sha256: input.sha256,
      storageBindingId: input.bindingId,
      storageBindingGeneration: input.generation,
    });
  }

  readBlobRoute(objectId: string): BlobStickyRoute | undefined {
    return this.blobs.get(objectId);
  }

  effectiveSummary(input: {
    workspaceId: string;
    applicationId: string;
    applicationTenantId?: string | null;
    cataloguedObjects?: number;
    failedVerificationObjects?: number;
  }): EffectiveStorageSummary {
    const resolved = this.resolve({
      workspaceId: input.workspaceId,
      applicationId: input.applicationId,
      ...(input.applicationTenantId
        ? { applicationTenantId: input.applicationTenantId }
        : {}),
      purpose: "probe",
    });
    const binding = resolved.bindingId
      ? this.toSummary(this.bindings.get(resolved.bindingId)!)
      : null;
    return {
      scope: resolved.scope,
      status: resolved.status,
      inheritedFrom: resolved.inheritedFrom,
      binding,
      provider: binding?.profile.provider ?? null,
      tier: binding?.profile.tier ?? null,
      region: binding?.profile.region ?? null,
      bucket: binding?.profile.bucket ?? null,
      prefix: binding?.profile.prefix ?? null,
      credentialMode: binding?.profile.credentialMode ?? null,
      usage: {
        cataloguedObjects: input.cataloguedObjects ?? 0,
        failedVerificationObjects: input.failedVerificationObjects ?? 0,
      },
      costPosture: binding?.costPosture ?? "unknown",
      planSyncState: binding?.planSyncState ?? "unknown",
      declaredCapacityBytes: binding?.profile.declaredCapacityBytes ?? null,
      observedUsageBytes: binding?.observedUsageBytes ?? null,
      observedQuotaBytes: binding?.observedQuotaBytes ?? null,
    };
  }

  rollup(input: {
    workspaceId: string;
    platformStatus: StorageBindingRollup["platformStatus"];
    platformSummary: string;
    applications: readonly { id: string; name: string }[];
  }): StorageBindingRollup {
    const applications = input.applications.map((app) => {
      const related = [...this.bindings.values()].filter(
        (b) =>
          b.workspaceId === input.workspaceId && b.applicationId === app.id,
      );
      let connected = 0;
      let attention = 0;
      let configured = 0;
      let notSetUp = related.length === 0 ? 1 : 0;
      const topIssues: {
        applicationTenantId: string | null;
        externalTenantKey: string | null;
        issueClass: string | null;
        summary: string;
      }[] = [];
      for (const b of related) {
        if (b.status === "connected") connected += 1;
        else if (b.status === "configured" || b.status === "awaiting_customer_role")
          configured += 1;
        else {
          attention += 1;
          const tenant = b.applicationTenantId
            ? this.tenants.get(b.applicationTenantId)
            : undefined;
          topIssues.push({
            applicationTenantId: b.applicationTenantId,
            externalTenantKey: tenant?.externalTenantKey ?? null,
            issueClass: b.lastIssueClass,
            summary: b.lastProbeSummary ?? b.status,
          });
        }
      }
      return {
        applicationId: app.id,
        applicationName: app.name,
        connected,
        attention,
        configured,
        notSetUp,
        topIssues: topIssues.slice(0, 5),
      };
    });
    return {
      platformStatus: input.platformStatus,
      platformSummary: input.platformSummary,
      applications,
      attentionTotal: applications.reduce((n, a) => n + a.attention, 0),
    };
  }

  toSummary(binding: StoredStorageBinding): StorageBindingSummary {
    const profile = this.profiles.get(binding.profileId)!;
    const publicProfile: StorageProfileSummary = {
      id: profile.id,
      provider: profile.provider,
      region: profile.region,
      bucket: profile.bucket,
      prefix: profile.prefix,
      tier: profile.tier,
      credentialMode: profile.credentialMode,
      expectedBucketOwner: profile.expectedBucketOwner,
      endpointHost: profile.endpointHost,
      roleArn: profile.roleArn,
      declaredPlanCode: profile.declaredPlanCode,
      declaredCapacityBytes: profile.declaredCapacityBytes,
    };
    return {
      id: binding.id,
      workspaceId: binding.workspaceId,
      applicationId: binding.applicationId,
      applicationTenantId: binding.applicationTenantId,
      profile: publicProfile,
      status: binding.disabled ? "disabled" : binding.status,
      generation: binding.generation,
      lastProbeOk: binding.lastProbeOk,
      lastProbeAt: binding.lastProbeAt,
      lastProbeSummary: binding.lastProbeSummary,
      lastIssueClass: (binding.lastIssueClass as StorageBindingSummary["lastIssueClass"]) ?? null,
      planSyncState: binding.planSyncState,
      observedUsageBytes: binding.observedUsageBytes,
      observedQuotaBytes: binding.observedQuotaBytes,
      observedAt: binding.observedAt,
      disabled: binding.disabled,
      costPosture: costPosture(profile.tier, profile.credentialMode),
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
    };
  }

  onboardingTemplate(profile: StoredStorageProfile, bindingId: string): string {
    const externalId =
      this.externalIds.get(profile.id) ?? profile.externalId ?? "<EXTERNAL_ID>";
    return [
      "# Trust Core BYOB role (CloudFormation-style sketch)",
      `Description: Binding ${bindingId}`,
      `TrustedExternalId: ${externalId}`,
      `Bucket: ${profile.bucket}`,
      `Prefix: ${profile.prefix || "(bucket root)"}`,
      `ExpectedBucketOwner: ${profile.expectedBucketOwner ?? "<ACCOUNT_ID>"}`,
      "Actions: s3:ListBucket, s3:GetObject, s3:PutObject, s3:DeleteObject, multipart equivalents",
      "Condition: sts:ExternalId must match TrustedExternalId",
    ].join("\n");
  }

  assertNoSecrets(payload: unknown): void {
    const text = JSON.stringify(payload);
    if (
      /externalId":"[0-9a-f-]{36}|sessionToken|secretAccessKey|AKIA[0-9A-Z]{16}/i.test(
        text,
      )
    ) {
      throw new Error("Secret material leaked into public payload");
    }
  }
}

export function canonicalAppTenantObjectKey(input: {
  workspaceId: string;
  applicationId: string;
  tenantKey: string;
  sha256: string;
  mode: "pool" | "silo";
}): string {
  const digest = input.sha256.toLowerCase();
  const leaf = `objects/${digest.slice(0, 2)}/${digest}`;
  if (input.mode === "silo") {
    return `apps/${input.applicationId}/tenants/${input.tenantKey}/${leaf}`;
  }
  return `workspaces/${input.workspaceId}/apps/${input.applicationId}/tenants/${input.tenantKey}/${leaf}`;
}

export type { StorageProviderName };
