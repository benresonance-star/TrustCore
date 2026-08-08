import type {
  AcceptStoragePlanCommand,
  ApplicationTenant,
  AuthenticatedActor,
  CloseApplicationTenantCommand,
  CreateApplicationTenantCommand,
  CutoverStorageMigrateCommand,
  EffectiveStorageSummary,
  ProbeStorageBindingCommand,
  RefreshStoragePlanCommand,
  StorageBindingRollup,
  StorageBindingSummary,
  SuspendApplicationTenantCommand,
  UpdateApplicationTenantCommand,
  UpsertStorageBindingCommand,
} from "@trust-core/protocol";
import {
  type AppStorageRegistry,
  InMemoryAppStorageRegistry,
  type ResolveResult,
  type RoutingContext,
} from "./app-storage-bindings.js";

export interface AppStorageCommandMethods {
  listApplicationTenants(
    workspaceId: string,
    applicationId: string,
  ): Promise<{ items: ApplicationTenant[] }>;
  getApplicationTenant(
    workspaceId: string,
    applicationId: string,
    tenantId: string,
  ): Promise<ApplicationTenant>;
  createApplicationTenant(
    actor: AuthenticatedActor,
    command: CreateApplicationTenantCommand,
  ): Promise<ApplicationTenant>;
  updateApplicationTenant(
    actor: AuthenticatedActor,
    tenantId: string,
    command: UpdateApplicationTenantCommand,
  ): Promise<ApplicationTenant>;
  suspendApplicationTenant(
    actor: AuthenticatedActor,
    tenantId: string,
    command: SuspendApplicationTenantCommand,
  ): Promise<ApplicationTenant>;
  closeApplicationTenant(
    actor: AuthenticatedActor,
    tenantId: string,
    command: CloseApplicationTenantCommand,
  ): Promise<ApplicationTenant>;
  getEffectiveStorage(
    workspaceId: string,
    applicationId: string,
    applicationTenantId?: string,
  ): Promise<EffectiveStorageSummary>;
  getStorageBindingRollup(
    workspaceId: string,
    applications: readonly { id: string; name: string }[],
    platform?: { status: StorageBindingRollup["platformStatus"]; summary: string },
  ): Promise<StorageBindingRollup>;
  listStorageBindings(
    workspaceId: string,
    query?: { applicationId?: string; applicationTenantId?: string | null },
  ): Promise<{ items: StorageBindingSummary[] }>;
  getStorageBinding(
    workspaceId: string,
    bindingId: string,
  ): Promise<StorageBindingSummary>;
  upsertStorageBinding(
    actor: AuthenticatedActor,
    command: UpsertStorageBindingCommand,
  ): Promise<{
    binding: StorageBindingSummary;
    externalId?: string;
    onboardingTemplate: string;
  }>;
  deleteStorageBinding(
    actor: AuthenticatedActor,
    bindingId: string,
    workspaceId: string,
    options?: { force?: boolean },
  ): Promise<StorageBindingSummary>;
  probeStorageBinding(
    actor: AuthenticatedActor,
    command: ProbeStorageBindingCommand,
  ): Promise<StorageBindingSummary>;
  refreshStoragePlan(
    actor: AuthenticatedActor,
    command: RefreshStoragePlanCommand,
  ): Promise<StorageBindingSummary>;
  acceptStoragePlan(
    actor: AuthenticatedActor,
    command: AcceptStoragePlanCommand,
  ): Promise<StorageBindingSummary>;
  disableStorageBinding(
    actor: AuthenticatedActor,
    bindingId: string,
    workspaceId: string,
  ): Promise<StorageBindingSummary>;
  rollbackStorageBinding(
    actor: AuthenticatedActor,
    bindingId: string,
    workspaceId: string,
  ): Promise<StorageBindingSummary>;
  cutoverStorageMigrate(
    actor: AuthenticatedActor,
    command: CutoverStorageMigrateCommand,
  ): Promise<StorageBindingSummary>;
  resolveStorageRoute(context: RoutingContext): Promise<ResolveResult>;
}

export function createAppStorageCommandMethods(
  registry: AppStorageRegistry,
  options: {
    allowSyntheticConnectedProbe?: boolean;
    /** Live Tier-A probe for managed / platform_iam bindings. */
    probeBindingLive?: (input: {
      bindingId: string;
      profile: StorageBindingSummary["profile"];
    }) => Promise<{
      ok: boolean;
      summary: string;
      issueClass?: string | null;
      expectedOwnerMatch?: boolean;
    }>;
  } = {},
): AppStorageCommandMethods {
  const allowSyntheticConnectedProbe =
    options.allowSyntheticConnectedProbe === true;
  const hydrate = async (workspaceId: string) => {
    await registry.ensureHydrated?.(workspaceId);
  };
  const requireWorkspaceBinding = async (
    bindingId: string,
    workspaceId: string,
  ) => {
    await hydrate(workspaceId);
    const binding = registry.getBinding(bindingId);
    if (!binding || binding.workspaceId !== workspaceId) {
      throw Object.assign(new Error("Storage binding was not found."), {
        code: "RESOURCE_NOT_FOUND",
      });
    }
    return binding;
  };

  return {
    async listApplicationTenants(workspaceId, applicationId) {
      await hydrate(workspaceId);
      return { items: registry.listTenants(workspaceId, applicationId) };
    },
    async getApplicationTenant(workspaceId, applicationId, tenantId) {
      await hydrate(workspaceId);
      const tenant = registry.getTenant(workspaceId, applicationId, tenantId);
      if (!tenant) {
        throw Object.assign(new Error("Application tenant was not found."), {
          code: "RESOURCE_NOT_FOUND",
        });
      }
      return tenant;
    },
    async createApplicationTenant(_actor, command) {
      await hydrate(command.workspaceId);
      const tenant = registry.createTenant({
        workspaceId: command.workspaceId,
        applicationId: command.applicationId,
        externalTenantKey: command.externalTenantKey,
        displayName: command.displayName,
      });
      await registry.persistTenant?.(tenant);
      return tenant;
    },
    async updateApplicationTenant(_actor, tenantId, command) {
      await hydrate(command.workspaceId);
      const tenant = registry.updateTenant({
        workspaceId: command.workspaceId,
        applicationId: command.applicationId,
        tenantId,
        displayName: command.displayName,
        expectedUpdatedAt: command.expectedUpdatedAt,
      });
      await registry.persistTenant?.(tenant, {
        expectedUpdatedAt: command.expectedUpdatedAt,
      });
      return tenant;
    },
    async suspendApplicationTenant(_actor, tenantId, command) {
      await hydrate(command.workspaceId);
      const tenant = registry.setTenantStatus({
        workspaceId: command.workspaceId,
        applicationId: command.applicationId,
        tenantId,
        status: "suspended",
        expectedUpdatedAt: command.expectedUpdatedAt,
      });
      await registry.persistTenant?.(tenant, {
        expectedUpdatedAt: command.expectedUpdatedAt,
      });
      return tenant;
    },
    async closeApplicationTenant(_actor, tenantId, command) {
      await hydrate(command.workspaceId);
      const tenant = registry.setTenantStatus({
        workspaceId: command.workspaceId,
        applicationId: command.applicationId,
        tenantId,
        status: "closed",
        expectedUpdatedAt: command.expectedUpdatedAt,
      });
      await registry.persistTenant?.(tenant, {
        expectedUpdatedAt: command.expectedUpdatedAt,
      });
      return tenant;
    },
    async getEffectiveStorage(workspaceId, applicationId, applicationTenantId) {
      await hydrate(workspaceId);
      const summary = registry.effectiveSummary({
        workspaceId,
        applicationId,
        applicationTenantId,
      });
      registry.assertNoSecrets(summary);
      return summary;
    },
    async getStorageBindingRollup(workspaceId, applications, platform) {
      await hydrate(workspaceId);
      const rollup = registry.rollup({
        workspaceId,
        platformStatus: platform?.status ?? "not_configured",
        platformSummary: platform?.summary ?? "Platform storage status unknown",
        applications,
      });
      registry.assertNoSecrets(rollup);
      return rollup;
    },
    async listStorageBindings(workspaceId, query) {
      await hydrate(workspaceId);
      const items = registry.listBindings({
        workspaceId,
        applicationId: query?.applicationId,
        applicationTenantId: query?.applicationTenantId,
      });
      registry.assertNoSecrets(items);
      return { items };
    },
    async getStorageBinding(workspaceId, bindingId) {
      const binding = await requireWorkspaceBinding(bindingId, workspaceId);
      const summary = registry.toSummary(binding);
      registry.assertNoSecrets(summary);
      return summary;
    },
    async upsertStorageBinding(actor, command) {
      await hydrate(command.workspaceId);
      const hardeningOk =
        command.credentialMode !== "cross_account_role" ||
        command.roleArn == null ||
        assertSafeRolePlaceholder(command.roleArn);
      if (!hardeningOk) {
        throw Object.assign(
          new Error(
            "This role is unsafe (confused deputy). Update trust policy using the template, then retry.",
          ),
          { code: "COMMAND_REJECTED" },
        );
      }
      const created = registry.upsertBinding(command, actor.id);
      await registry.persistBinding?.(created.binding.id, actor.id, true);
      registry.assertNoSecrets(created.binding);
      return created;
    },
    async deleteStorageBinding(_actor, bindingId, workspaceId, options) {
      await requireWorkspaceBinding(bindingId, workspaceId);
      if (!options?.force && registry.countStickyBlobs) {
        const sticky = await registry.countStickyBlobs(workspaceId, bindingId);
        if (sticky > 0) {
          throw Object.assign(
            new Error(
              "Binding still referenced by sticky blob routes; disable or force-delete.",
            ),
            { code: "COMMAND_REJECTED" },
          );
        }
      }
      const summary = registry.deleteBinding(bindingId, options);
      await registry.deletePersistedBinding?.(workspaceId, bindingId);
      registry.assertNoSecrets(summary);
      return summary;
    },
    async probeStorageBinding(_actor, command) {
      await requireWorkspaceBinding(command.bindingId, command.workspaceId);
      const hardening = registry.runHandshakeHardening(command.bindingId);
      if (!hardening.ok) {
        await registry.persistBindingState?.(command.bindingId);
        return registry.toSummary(registry.getBinding(command.bindingId)!);
      }
      const binding = registry.getBinding(command.bindingId)!;
      const profile = registry.toSummary(binding).profile;
      if (options.probeBindingLive) {
        if (profile.credentialMode === "cross_account_role") {
          const summary = registry.markProbeDeferred(
            command.bindingId,
            "Live BYOB probe requires STS AssumeRole (not yet enabled); status remains configured (not Connected).",
          );
          await registry.persistBindingState?.(command.bindingId);
          registry.assertNoSecrets(summary);
          return summary;
        }
        try {
          const live = await options.probeBindingLive({
            bindingId: command.bindingId,
            profile,
          });
          const summary = registry.recordProbe(command.bindingId, {
            ok: live.ok,
            summary: live.summary,
            ...(live.issueClass != null ? { issueClass: live.issueClass } : {}),
            ...(live.expectedOwnerMatch !== undefined
              ? { expectedOwnerMatch: live.expectedOwnerMatch }
              : {}),
          });
          await registry.persistBindingState?.(command.bindingId);
          registry.assertNoSecrets(summary);
          return summary;
        } catch (error) {
          const summary = registry.recordProbe(command.bindingId, {
            ok: false,
            summary:
              error instanceof Error
                ? error.message
                : "Binding connectivity probe failed.",
            issueClass: "network",
          });
          await registry.persistBindingState?.(command.bindingId);
          registry.assertNoSecrets(summary);
          return summary;
        }
      }
      if (!allowSyntheticConnectedProbe) {
        const summary = registry.markProbeDeferred(
          command.bindingId,
          "Live Tier-A connectivity probe is not configured for durable bindings; status remains configured (not Connected).",
        );
        await registry.persistBindingState?.(command.bindingId);
        registry.assertNoSecrets(summary);
        return summary;
      }
      const summary = registry.recordProbe(command.bindingId, {
        ok: true,
        summary: `Binding connectivity probe (${command.tier ?? "connectivity"})`,
        expectedOwnerMatch: true,
      });
      await registry.persistBindingState?.(command.bindingId);
      registry.assertNoSecrets(summary);
      return summary;
    },
    async refreshStoragePlan(_actor, command) {
      await requireWorkspaceBinding(command.bindingId, command.workspaceId);
      const summary = registry.refreshPlan(command.bindingId, {
        observedUsageBytes: command.observedUsageBytes,
        observedQuotaBytes: command.observedQuotaBytes,
      });
      await registry.persistBindingState?.(command.bindingId);
      registry.assertNoSecrets(summary);
      return summary;
    },
    async acceptStoragePlan(_actor, command) {
      await requireWorkspaceBinding(command.bindingId, command.workspaceId);
      const summary = registry.acceptPlan(
        command.bindingId,
        command.declaredCapacityBytes,
        command.planCode,
      );
      await registry.persistPlan?.(command.bindingId);
      registry.assertNoSecrets(summary);
      return summary;
    },
    async disableStorageBinding(_actor, bindingId, workspaceId) {
      await requireWorkspaceBinding(bindingId, workspaceId);
      const summary = registry.disableBinding(bindingId);
      await registry.persistBindingState?.(bindingId);
      registry.assertNoSecrets(summary);
      return summary;
    },
    async rollbackStorageBinding(actor, bindingId, workspaceId) {
      await requireWorkspaceBinding(bindingId, workspaceId);
      const summary = registry.rollbackBinding(bindingId, actor.id);
      await registry.persistBinding?.(bindingId, actor.id, true);
      registry.assertNoSecrets(summary);
      return summary;
    },
    async cutoverStorageMigrate(actor, command) {
      await requireWorkspaceBinding(command.sourceBindingId, command.workspaceId);
      await requireWorkspaceBinding(command.targetBindingId, command.workspaceId);
      try {
        const summary = registry.cutoverMigrate({
          sourceBindingId: command.sourceBindingId,
          targetBindingId: command.targetBindingId,
          objectDigests: command.objectDigests,
          actorId: actor.id,
        });
        await registry.persistStickyCutover?.({
          workspaceId: command.workspaceId,
          targetBindingId: command.targetBindingId,
          targetGeneration: summary.generation,
          objectIds: command.objectDigests.map((item) => item.objectId),
        });
        await registry.persistBindingState?.(command.sourceBindingId);
        await registry.persistBinding?.(
          command.targetBindingId,
          actor.id,
          true,
        );
        registry.assertNoSecrets(summary);
        return summary;
      } catch (error) {
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          {
            code:
              error instanceof Error &&
              "code" in error &&
              typeof (error as { code?: unknown }).code === "string"
                ? (error as { code: string }).code
                : "COMMAND_REJECTED",
          },
        );
      }
    },
    async resolveStorageRoute(context) {
      await hydrate(context.workspaceId);
      return registry.resolve(context);
    },
  };
}

function assertSafeRolePlaceholder(roleArn: string): boolean {
  return !roleArn.includes("*") && roleArn.includes(":role/");
}

export function seedFoundationAppStorage(
  registry: InMemoryAppStorageRegistry,
  input: {
    workspaceId: string;
    applicationId: string;
  },
): void {
  const { workspaceId, applicationId } = input;
  const appDefault = registry.upsertBinding(
    {
      workspaceId,
      applicationId,
      provider: "s3",
      region: "ap-southeast-2",
      bucket: "trust-foundation-default",
      tier: "managed",
      credentialMode: "platform_iam",
      idempotencyKey: "seed-app-default",
    },
    "system",
  );
  registry.recordProbe(appDefault.binding.id, {
    ok: true,
    summary: "App-default connected",
    expectedOwnerMatch: true,
  });

  const t1 = registry.createTenant({
    workspaceId,
    applicationId,
    externalTenantKey: "1",
    displayName: "Tenant 1",
  });
  const t1Bind = registry.upsertBinding(
    {
      workspaceId,
      applicationId,
      applicationTenantId: t1.id,
      provider: "s3",
      region: "ap-southeast-2",
      bucket: "byob-tenant-1",
      tier: "byob",
      credentialMode: "cross_account_role",
      roleArn: "arn:aws:iam::111111111111:role/TrustCoreTenant1",
      expectedBucketOwner: "111111111111",
      idempotencyKey: "seed-t1",
    },
    "system",
  );
  registry.recordProbe(t1Bind.binding.id, {
    ok: true,
    summary: "Tenant 1 connected",
    expectedOwnerMatch: true,
  });

  const t2 = registry.createTenant({
    workspaceId,
    applicationId,
    externalTenantKey: "2",
    displayName: "Tenant 2",
  });
  const t2Bind = registry.upsertBinding(
    {
      workspaceId,
      applicationId,
      applicationTenantId: t2.id,
      provider: "s3",
      region: "us-east-1",
      bucket: "byob-tenant-2",
      tier: "byob",
      credentialMode: "cross_account_role",
      roleArn: "arn:aws:iam::222222222222:role/TrustCoreTenant2",
      expectedBucketOwner: "222222222222",
      idempotencyKey: "seed-t2",
    },
    "system",
  );
  registry.recordProbe(t2Bind.binding.id, {
    ok: false,
    summary: "Bucket region does not match configured region.",
    issueClass: "wrong_region",
  });

  const t3 = registry.createTenant({
    workspaceId,
    applicationId,
    externalTenantKey: "003",
    displayName: "Tenant 003",
  });
  const t3Bind = registry.upsertBinding(
    {
      workspaceId,
      applicationId,
      applicationTenantId: t3.id,
      provider: "s3",
      region: "ap-southeast-2",
      bucket: "byob-tenant-003",
      tier: "premium",
      credentialMode: "cross_account_role",
      roleArn: "arn:aws:iam::333333333333:role/TrustCoreTenant003",
      expectedBucketOwner: "333333333333",
      declaredPlanCode: "premium-1tb",
      declaredCapacityBytes: 1_000_000_000_000,
      idempotencyKey: "seed-t3",
    },
    "system",
  );
  registry.recordProbe(t3Bind.binding.id, {
    ok: true,
    summary: "Tenant 003 connected",
    expectedOwnerMatch: true,
  });
  registry.refreshPlan(t3Bind.binding.id, {
    observedQuotaBytes: 2_000_000_000_000,
    observedUsageBytes: 100_000_000,
  });
}
