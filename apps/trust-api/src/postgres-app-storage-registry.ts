import { randomUUID } from "node:crypto";
import {
  PostgresAppStorageRepository,
  type DatabasePool,
} from "@trust-core/persistence-postgres";
import type {
  ApplicationTenant,
  EffectiveStorageSummary,
  StorageBindingRollup,
  StorageBindingSummary,
  UpsertStorageBindingCommand,
} from "@trust-core/protocol";
import {
  InMemoryAppStorageRegistry,
  hashExternalId,
  type AppStorageRegistry,
  type ResolveResult,
  type RoutingContext,
  type StoredStorageBinding,
} from "./app-storage-bindings.js";

/**
 * Durable AppStorageRegistry: domain logic stays in InMemoryAppStorageRegistry;
 * command paths must await ensureHydrated / persistBinding.
 */
export class PostgresAppStorageRegistry implements AppStorageRegistry {
  readonly assumeWithoutExternalId = new Map<string, boolean>();
  private readonly repo: PostgresAppStorageRepository;
  private readonly memory = new InMemoryAppStorageRegistry();
  private readonly plaintextExternalIds = new Map<string, string>();
  private readonly hydratedWorkspaces = new Set<string>();

  constructor(pool: DatabasePool) {
    this.repo = new PostgresAppStorageRepository(pool);
    this.memory.assumeWithoutExternalId = this.assumeWithoutExternalId;
  }

  async ensureHydrated(workspaceId: string): Promise<void> {
    if (this.hydratedWorkspaces.has(workspaceId)) return;
    const [tenants, profiles, bindings] = await Promise.all([
      this.repo.listAllTenants(workspaceId),
      this.repo.listProfiles(workspaceId),
      this.repo.listBindings(workspaceId),
    ]);
    for (const tenant of tenants) this.memory.tenants.set(tenant.id, tenant);
    for (const profile of profiles) {
      this.memory.profiles.set(profile.id, {
        id: profile.id,
        workspaceId: profile.workspaceId,
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
        externalIdRevealed: true,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      });
    }
    for (const binding of bindings) {
      this.memory.bindings.set(binding.id, { ...binding });
    }
    this.hydratedWorkspaces.add(workspaceId);
  }

  async persistBinding(
    bindingId: string,
    actorId?: string,
    withVersion = false,
  ): Promise<void> {
    const binding = this.memory.bindings.get(bindingId);
    if (!binding) return;
    const profile = this.memory.profiles.get(binding.profileId);
    if (!profile) return;
    const plaintext =
      this.plaintextExternalIds.get(profile.id) ?? profile.externalId;
    await this.repo.upsertProfileAndBinding({
      workspaceId: binding.workspaceId,
      profile: {
        id: profile.id,
        workspaceId: profile.workspaceId,
        provider: profile.provider,
        region: profile.region,
        bucket: profile.bucket,
        prefix: profile.prefix,
        tier: profile.tier,
        credentialMode: profile.credentialMode,
        expectedBucketOwner: profile.expectedBucketOwner,
        endpointHost: profile.endpointHost,
        roleArn: profile.roleArn,
        externalIdHash: plaintext ? hashExternalId(plaintext) : null,
        declaredPlanCode: profile.declaredPlanCode,
        declaredCapacityBytes: profile.declaredCapacityBytes,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      binding: { ...binding },
      ...(withVersion && actorId
        ? {
            version: {
              id: randomUUID(),
              snapshot: this.memory.toSummary(binding),
              createdBy: actorId,
              createdAt: binding.updatedAt,
            },
          }
        : {}),
    });
  }

  async persistTenant(tenant: ApplicationTenant): Promise<void> {
    await this.repo.createTenant(tenant);
  }

  async persistBindingState(bindingId: string): Promise<void> {
    const binding = this.memory.bindings.get(bindingId);
    if (binding) await this.repo.updateBindingState({ ...binding });
  }

  async persistPlan(bindingId: string): Promise<void> {
    const binding = this.memory.bindings.get(bindingId);
    const profile = binding
      ? this.memory.profiles.get(binding.profileId)
      : undefined;
    if (!binding || !profile) return;
    await this.repo.updateProfilePlan({
      workspaceId: binding.workspaceId,
      profileId: profile.id,
      declaredCapacityBytes: profile.declaredCapacityBytes,
      declaredPlanCode: profile.declaredPlanCode,
      updatedAt: profile.updatedAt,
    });
    await this.repo.updateBindingState({ ...binding });
  }

  listTenants(workspaceId: string, applicationId: string): ApplicationTenant[] {
    return this.memory.listTenants(workspaceId, applicationId);
  }

  createTenant(input: {
    workspaceId: string;
    applicationId: string;
    externalTenantKey: string;
    displayName: string;
  }): ApplicationTenant {
    return this.memory.createTenant(input);
  }

  upsertBinding(command: UpsertStorageBindingCommand, actorId: string) {
    const created = this.memory.upsertBinding(command, actorId);
    if (created.externalId) {
      this.plaintextExternalIds.set(
        created.binding.profile.id,
        created.externalId,
      );
      const profile = this.memory.profiles.get(created.binding.profile.id);
      if (profile) profile.externalId = created.externalId;
    }
    return created;
  }

  getBinding(bindingId: string): StoredStorageBinding | undefined {
    return this.memory.getBinding(bindingId);
  }

  runHandshakeHardening(bindingId: string) {
    return this.memory.runHandshakeHardening(bindingId);
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
    return this.memory.recordProbe(bindingId, input);
  }

  refreshPlan(
    bindingId: string,
    observation: {
      observedUsageBytes?: number;
      observedQuotaBytes?: number;
    },
  ): StorageBindingSummary {
    return this.memory.refreshPlan(bindingId, observation);
  }

  acceptPlan(
    bindingId: string,
    declaredCapacityBytes: number,
    planCode?: string,
  ): StorageBindingSummary {
    return this.memory.acceptPlan(bindingId, declaredCapacityBytes, planCode);
  }

  disableBinding(bindingId: string): StorageBindingSummary {
    return this.memory.disableBinding(bindingId);
  }

  rollbackBinding(bindingId: string, actorId: string): StorageBindingSummary {
    return this.memory.rollbackBinding(bindingId, actorId);
  }

  cutoverMigrate(input: {
    sourceBindingId: string;
    targetBindingId: string;
    objectDigests: readonly { objectId: string; sha256: string }[];
    actorId: string;
  }): StorageBindingSummary {
    return this.memory.cutoverMigrate(input);
  }

  effectiveSummary(input: {
    workspaceId: string;
    applicationId: string;
    applicationTenantId?: string | null;
    cataloguedObjects?: number;
    failedVerificationObjects?: number;
  }): EffectiveStorageSummary {
    return this.memory.effectiveSummary(input);
  }

  rollup(input: {
    workspaceId: string;
    platformStatus: StorageBindingRollup["platformStatus"];
    platformSummary: string;
    applications: readonly { id: string; name: string }[];
  }): StorageBindingRollup {
    return this.memory.rollup(input);
  }

  resolve(context: RoutingContext): ResolveResult {
    return this.memory.resolve(context);
  }

  toSummary(binding: StoredStorageBinding): StorageBindingSummary {
    return this.memory.toSummary(binding);
  }

  assertNoSecrets(payload: unknown): void {
    this.memory.assertNoSecrets(payload);
  }
}
