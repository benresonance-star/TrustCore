import { describe, expect, it } from "vitest";
import {
  InMemoryAppStorageRegistry,
  assertExternalIdHardening,
  canonicalAppTenantObjectKey,
  evaluatePlanSync,
  operatorErrorForIssue,
} from "../src/app-storage-bindings.js";

function seedFoundation(registry: InMemoryAppStorageRegistry) {
  const workspaceId = "11111111-1111-1111-1111-111111111111";
  const applicationId = "22222222-2222-2222-2222-222222222222";
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
    "admin",
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
    "admin",
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
    "admin",
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
    "admin",
  );
  registry.recordProbe(t3Bind.binding.id, {
    ok: true,
    summary: "Tenant 003 connected",
  });

  return { workspaceId, applicationId, t1, t2, t3, t1Bind, t2Bind, t3Bind, appDefault };
}

describe("app storage bindings — security", () => {
  it("S1 rejects roles assumable without ExternalId", () => {
    expect(
      assertExternalIdHardening({ assumeWithoutExternalIdSucceeds: true }).ok,
    ).toBe(false);
    expect(
      assertExternalIdHardening({ assumeWithoutExternalIdSucceeds: false }).ok,
    ).toBe(true);
  });

  it("S2 owner mismatch fails probe closed", () => {
    const registry = new InMemoryAppStorageRegistry();
    const { t1Bind } = seedFoundation(registry);
    const summary = registry.recordProbe(t1Bind.binding.id, {
      ok: true,
      summary: "should not connect",
      expectedOwnerMatch: false,
    });
    expect(summary.status).toBe("needs_attention");
    expect(summary.lastProbeSummary).toContain("ExpectedBucketOwner");
  });

  it("S3 summaries omit ExternalId secrets", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    const summary = registry.effectiveSummary({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: seeded.t1.id,
    });
    expect(() => registry.assertNoSecrets(summary)).not.toThrow();
    expect(JSON.stringify(summary)).not.toMatch(/externalId/i);
  });

  it("S12 one-time ExternalId then redacted", () => {
    const registry = new InMemoryAppStorageRegistry();
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    const applicationId = "22222222-2222-2222-2222-222222222222";
    const created = registry.upsertBinding(
      {
        workspaceId,
        applicationId,
        provider: "s3",
        region: "ap-southeast-2",
        bucket: "b",
        tier: "byob",
        credentialMode: "cross_account_role",
        roleArn: "arn:aws:iam::1:role/R",
        idempotencyKey: "x",
      },
      "admin",
    );
    expect(created.externalId).toBeTruthy();
    const profileId = created.binding.profile.id;
    // Mark revealed after create response
    registry.profiles.get(profileId)!.externalIdRevealed = true;
    expect(registry.revealExternalId(profileId)).toBeNull();
  });
});

describe("app storage bindings — routing matrix", () => {
  it("R1 platform fallback without app context", () => {
    const registry = new InMemoryAppStorageRegistry();
    seedFoundation(registry);
    const r = registry.resolve({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      purpose: "ingest",
    });
    expect(r.inheritedFrom).toBe("platform");
    expect(r.allowWrite).toBe(true);
  });

  it("R3 tenant override Connected allows write", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    const r = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: seeded.t1.id,
      purpose: "ingest",
    });
    expect(r.allowWrite).toBe(true);
    expect(r.bindingId).toBe(seeded.t1Bind.binding.id);
  });

  it("R4 configured-only refuses write", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    // Reset t1 to configured without probe
    const b = registry.bindings.get(seeded.t1Bind.binding.id)!;
    b.status = "configured";
    b.lastProbeOk = null;
    const r = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: seeded.t1.id,
      purpose: "ingest",
    });
    expect(r.allowWrite).toBe(false);
  });

  it("R5 tenant without override inherits app default", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    const orphan = registry.createTenant({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      externalTenantKey: "orphan",
      displayName: "Orphan",
    });
    const r = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: orphan.id,
      purpose: "ingest",
    });
    expect(r.inheritedFrom).toBe("app");
    expect(r.bindingId).toBe(seeded.appDefault.binding.id);
  });

  it("R6 sticky download after switch", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    registry.commitBlob({
      objectId: "obj-1",
      workspaceId: seeded.workspaceId,
      sha256: "a".repeat(64),
      bindingId: seeded.t1Bind.binding.id,
      generation: 1,
    });
    // Switch effective binding status but sticky read stays
    const r = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: seeded.t2.id,
      purpose: "download",
      blobStorageBindingId: seeded.t1Bind.binding.id,
    });
    expect(r.bindingId).toBe(seeded.t1Bind.binding.id);
    expect(r.allowWrite).toBe(false);
    expect(r.reason).toBe("sticky_read");
  });

  it("R7 separate keys for same digest across tenants", () => {
    const digest = "b".repeat(64);
    const k1 = canonicalAppTenantObjectKey({
      workspaceId: "w",
      applicationId: "a",
      tenantKey: "1",
      sha256: digest,
      mode: "silo",
    });
    const k2 = canonicalAppTenantObjectKey({
      workspaceId: "w",
      applicationId: "a",
      tenantKey: "2",
      sha256: digest,
      mode: "silo",
    });
    expect(k1).not.toBe(k2);
  });

  it("R8 spoofed externalTenantKey without mapped id rejected", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    const r = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      externalTenantKey: "1",
      purpose: "ingest",
    });
    expect(r.reason).toBe("tenant_spoof_rejected");
    expect(r.allowWrite).toBe(false);
  });

  it("R11 disabled binding refuses writes", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    registry.bindings.get(seeded.t1Bind.binding.id)!.disabled = true;
    const r = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: seeded.t1.id,
      purpose: "ingest",
    });
    expect(r.allowWrite).toBe(false);
    expect(r.status).toBe("disabled");
  });

  it("R2 app default Connected allows write without tenant", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    const r = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      purpose: "ingest",
    });
    expect(r.allowWrite).toBe(true);
    expect(r.bindingId).toBe(seeded.appDefault.binding.id);
    expect(r.scope).toBe("app");
  });

  it("R9 worker and API resolve identical bindingId", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    const ctx = {
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: seeded.t1.id,
      purpose: "ingest" as const,
    };
    const api = registry.resolve(ctx);
    const worker = registry.resolve(ctx);
    expect(api.bindingId).toBe(worker.bindingId);
    expect(api.generation).toBe(worker.generation);
  });

  it("R10 mid-migrate epoch mismatch refuses write", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    const migrating = registry.beginMigrate(seeded.t1Bind.binding.id);
    const stale = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: seeded.t1.id,
      purpose: "ingest",
      bindingGeneration: migrating.generation - 1,
    });
    expect(stale.allowWrite).toBe(false);
    expect(stale.reason).toBe("epoch_mismatch");
    const quarantine = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: seeded.t1.id,
      purpose: "ingest",
      bindingGeneration: migrating.generation,
    });
    expect(quarantine.allowWrite).toBe(false);
    expect(quarantine.reason).toBe("migrate_quarantine");
  });

  it("R12 Tier B probe lands under binding probe prefix", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    const key = registry.probeTempObjectKey(
      seeded.t1Bind.binding.id,
      "probe-abc",
    );
    expect(key).toContain(seeded.t1Bind.binding.id);
    expect(key).toContain(".trust-probe/");
    expect(key).toContain("probe-abc");
  });
});

describe("migrate cutover", () => {
  it("S9 refuses cutover on digest mismatch", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    registry.beginMigrate(seeded.t1Bind.binding.id);
    registry.commitBlob({
      objectId: "obj-m",
      workspaceId: seeded.workspaceId,
      sha256: "c".repeat(64),
      bindingId: seeded.t1Bind.binding.id,
      generation: 1,
    });
    expect(() =>
      registry.cutoverMigrate({
        sourceBindingId: seeded.t1Bind.binding.id,
        targetBindingId: seeded.appDefault.binding.id,
        objectDigests: [{ objectId: "obj-m", sha256: "d".repeat(64) }],
        actorId: "admin",
      }),
    ).toThrow(/digest mismatch/i);
  });

  it("cutover updates sticky routes after digest proof", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    registry.beginMigrate(seeded.t1Bind.binding.id);
    const digest = "e".repeat(64);
    registry.commitBlob({
      objectId: "obj-ok",
      workspaceId: seeded.workspaceId,
      sha256: digest,
      bindingId: seeded.t1Bind.binding.id,
      generation: 1,
    });
    registry.cutoverMigrate({
      sourceBindingId: seeded.t1Bind.binding.id,
      targetBindingId: seeded.appDefault.binding.id,
      objectDigests: [{ objectId: "obj-ok", sha256: digest }],
      actorId: "admin",
    });
    expect(registry.readBlobRoute("obj-ok")?.storageBindingId).toBe(
      seeded.appDefault.binding.id,
    );
  });
});

describe("handshake extras", () => {
  it("S13 Connected only after Tier A probe ok", () => {
    const registry = new InMemoryAppStorageRegistry();
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    const applicationId = "22222222-2222-2222-2222-222222222222";
    const created = registry.upsertBinding(
      {
        workspaceId,
        applicationId,
        provider: "s3",
        region: "ap-southeast-2",
        bucket: "b",
        tier: "managed",
        credentialMode: "platform_iam",
        idempotencyKey: "s13",
      },
      "admin",
    );
    expect(created.binding.status).toBe("configured");
    expect(created.binding.status).not.toBe("connected");
    const connected = registry.recordProbe(created.binding.id, {
      ok: true,
      summary: "tier a ok",
    });
    expect(connected.status).toBe("connected");
  });

  it("S15 disable invalidates assume cache flag", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    registry.assumeWithoutExternalId.set(seeded.t1Bind.binding.id, false);
    registry.disableBinding(seeded.t1Bind.binding.id);
    expect(registry.assumeWithoutExternalId.has(seeded.t1Bind.binding.id)).toBe(
      false,
    );
    const r = registry.resolve({
      workspaceId: seeded.workspaceId,
      applicationId: seeded.applicationId,
      applicationTenantId: seeded.t1.id,
      purpose: "ingest",
    });
    expect(r.allowWrite).toBe(false);
  });

  it("S1 via runHandshakeHardening", () => {
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    registry.assumeWithoutExternalId.set(seeded.t1Bind.binding.id, true);
    const result = registry.runHandshakeHardening(seeded.t1Bind.binding.id);
    expect(result.ok).toBe(false);
    expect(registry.bindings.get(seeded.t1Bind.binding.id)?.status).toBe(
      "needs_attention",
    );
  });
});

describe("plan sync", () => {
  it("recognises upgrade and requires accept for declared change", () => {
    expect(
      evaluatePlanSync({
        declaredCapacityBytes: 5,
        observedUsageBytes: 2,
        observedQuotaBytes: 10,
        previousQuotaBytes: 5,
      }),
    ).toBe("upgrade_recognised");
    const registry = new InMemoryAppStorageRegistry();
    const seeded = seedFoundation(registry);
    const before = registry.refreshPlan(seeded.t3Bind.binding.id, {
      observedUsageBytes: 4 * 1024 ** 4,
      observedQuotaBytes: 10 * 1024 ** 4,
    });
    expect(before.planSyncState).toBe("upgrade_recognised");
    expect(before.profile.declaredCapacityBytes).toBe(5 * 1024 ** 4);
    const accepted = registry.acceptPlan(
      seeded.t3Bind.binding.id,
      10 * 1024 ** 4,
      "10tb",
    );
    expect(accepted.profile.declaredCapacityBytes).toBe(10 * 1024 ** 4);
  });

  it("S14 over_capacity when usage exceeds declared", () => {
    expect(
      evaluatePlanSync({
        declaredCapacityBytes: 5,
        observedUsageBytes: 9,
        observedQuotaBytes: null,
        previousQuotaBytes: null,
      }),
    ).toBe("over_capacity");
  });
});

describe("operator errors", () => {
  it("returns handshake guidance strings", () => {
    expect(operatorErrorForIssue("external_id")).toMatch(/confused deputy/i);
    expect(operatorErrorForIssue("owner_mismatch")).toMatch(/ExpectedBucketOwner/);
  });
});

describe("dummy performance smoke", () => {
  it("resolves 1000 tenants under warm path quickly", () => {
    const registry = new InMemoryAppStorageRegistry();
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    const applicationId = "22222222-2222-2222-2222-222222222222";
    registry.upsertBinding(
      {
        workspaceId,
        applicationId,
        provider: "s3",
        region: "ap-southeast-2",
        bucket: "managed",
        tier: "managed",
        credentialMode: "platform_iam",
        idempotencyKey: "app",
      },
      "admin",
    );
    for (let i = 0; i < 1000; i += 1) {
      const t = registry.createTenant({
        workspaceId,
        applicationId,
        externalTenantKey: String(i),
        displayName: `T${i}`,
      });
      if (i % 10 === 0) {
        const b = registry.upsertBinding(
          {
            workspaceId,
            applicationId,
            applicationTenantId: t.id,
            provider: "s3",
            region: "ap-southeast-2",
            bucket: `b-${i}`,
            tier: "byob",
            credentialMode: "cross_account_role",
            roleArn: `arn:aws:iam::${i}:role/R`,
            idempotencyKey: `b-${i}`,
          },
          "admin",
        );
        registry.recordProbe(b.binding.id, { ok: true, summary: "ok" });
      }
    }
    const started = Date.now();
    for (let i = 0; i < 500; i += 1) {
      const tenants = registry.listTenants(workspaceId, applicationId);
      const t = tenants[i % tenants.length]!;
      registry.resolve({
        workspaceId,
        applicationId,
        applicationTenantId: t.id,
        purpose: "ingest",
      });
    }
    expect(Date.now() - started).toBeLessThan(500);
  });
});
