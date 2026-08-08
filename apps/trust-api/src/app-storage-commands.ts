import type {
  AcceptStoragePlanCommand,
  ApplicationTenant,
  AuthenticatedActor,
  CreateApplicationTenantCommand,
  CutoverStorageMigrateCommand,
  EffectiveStorageSummary,
  ProbeStorageBindingCommand,
  RefreshStoragePlanCommand,
  StorageBindingRollup,
  StorageBindingSummary,
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
  createApplicationTenant(
    actor: AuthenticatedActor,
    command: CreateApplicationTenantCommand,
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
  upsertStorageBinding(
    actor: AuthenticatedActor,
    command: UpsertStorageBindingCommand,
  ): Promise<{
    binding: StorageBindingSummary;
    externalId?: string;
    onboardingTemplate: string;
  }>;
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
): AppStorageCommandMethods {
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
    async probeStorageBinding(_actor, command) {
      await requireWorkspaceBinding(command.bindingId, command.workspaceId);
      const hardening = registry.runHandshakeHardening(command.bindingId);
      if (!hardening.ok) {
        await registry.persistBindingState?.(command.bindingId);
        return registry.toSummary(registry.getBinding(command.bindingId)!);
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
        await registry.persistBindingState?.(command.sourceBindingId);
        await registry.persistBinding?.(
          command.targetBindingId,
          actor.id,
          true,
        );
        registry.assertNoSecrets(summary);
        return summary;
      } catch (error) {
        if (
          error instanceof Error &&
          (error as { code?: string }).code === "MIGRATE_DIGEST_MISMATCH"
        ) {
          throw Object.assign(error, { code: "COMMAND_REJECTED" });
        }
        throw error;
      }
    },
    async resolveStorageRoute(context) {
      await hydrate(context.workspaceId);
      return registry.resolve(context);
    },
  };
}

function assertSafeRolePlaceholder(roleArn: string): boolean {
  // Real STS assume-without-ExternalId check is Partial until dual-account staging.
  // Reject obviously malformed ARNs; handshake hardening still runs on probe.
  return roleArn.startsWith("arn:aws:iam::") && roleArn.includes(":role/");
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
      bucket: "foundation-managed",
      tier: "managed",
      credentialMode: "platform_iam",
      idempotencyKey: "app-default",
    },
    "fixture-seed",
  );
  registry.recordProbe(appDefault.binding.id, {
    ok: true,
    summary: "App default connected",
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
      bucket: "tenant-1-byob",
      tier: "byob",
      credentialMode: "cross_account_role",
      roleArn: "arn:aws:iam::111111111111:role/TrustCore",
      expectedBucketOwner: "111111111111",
      declaredCapacityBytes: 5 * 1024 ** 4,
      idempotencyKey: "t1",
    },
    "fixture-seed",
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
      bucket: "tenant-2-byob",
      tier: "byob",
      credentialMode: "cross_account_role",
      roleArn: "arn:aws:iam::222222222222:role/TrustCore",
      expectedBucketOwner: "222222222222",
      idempotencyKey: "t2",
    },
    "fixture-seed",
  );
  registry.recordProbe(t2Bind.binding.id, {
    ok: false,
    summary: "wrong region",
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
      bucket: "tenant-003-byob",
      tier: "byob",
      credentialMode: "cross_account_role",
      roleArn: "arn:aws:iam::333333333333:role/TrustCore",
      expectedBucketOwner: "333333333333",
      declaredCapacityBytes: 5 * 1024 ** 4,
      idempotencyKey: "t3",
    },
    "fixture-seed",
  );
  registry.recordProbe(t3Bind.binding.id, {
    ok: true,
    summary: "Tenant 003 connected",
  });
  registry.refreshPlan(t3Bind.binding.id, {
    observedUsageBytes: 4 * 1024 ** 4,
    observedQuotaBytes: 10 * 1024 ** 4,
  });
}
