import { describe, expect, it, vi } from "vitest";
import type { ObjectStorage } from "@trust-core/storage";
import type { TransferSigner } from "@trust-core/operations";
import { BindingStorageRouter } from "../src/storage-router.js";
import {
  createObjectStorageFromProfile,
  isStorageBindingRoutingEnabled,
} from "../src/storage-factory.js";
import { InMemoryAppStorageRegistry } from "../src/app-storage-bindings.js";
import { createAppStorageCommandMethods } from "../src/app-storage-commands.js";

function memoryStorage(): ObjectStorage {
  return {
    async createTemporaryUpload() {
      return { key: "tmp", expiresAt: "later" };
    },
    async writeTemporary() {
      return { key: "tmp", byteLength: 1, mediaType: "text/plain" };
    },
    async commitImmutable(input) {
      return {
        key: `objects/${input.sha256}`,
        sha256: input.sha256,
        byteLength: input.byteLength,
        mediaType: input.mediaType,
      };
    },
    async deleteTemporary() {},
    async exists() {
      return false;
    },
    async head() {
      return { key: "x", byteLength: 1, mediaType: "text/plain" };
    },
    async openReadStream() {
      throw new Error("unused");
    },
  };
}

describe("BindingStorageRouter", () => {
  it("uses platform storage when routing is disabled", async () => {
    const platform = memoryStorage();
    const binding = memoryStorage();
    const router = new BindingStorageRouter({
      enabled: false,
      platformStorage: platform,
      resolveRoute: async () => {
        throw new Error("should not resolve");
      },
      createStorage: () => binding,
      createSigner: () => undefined,
    });
    const route = await router.forIngest({
      workspaceId: "ws",
      applicationId: "app",
      purpose: "ingest",
    });
    expect(route.storage).toBe(platform);
    expect(route.bindingId).toBeNull();
  });

  it("fail-closes ingest when binding is not Connected", async () => {
    const registry = new InMemoryAppStorageRegistry();
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    const applicationId = "22222222-2222-2222-2222-222222222222";
    registry.upsertBinding(
      {
        workspaceId,
        applicationId,
        provider: "s3",
        region: "ap-southeast-2",
        bucket: "managed-app",
        tier: "managed",
        credentialMode: "platform_iam",
        idempotencyKey: "app",
      },
      "admin",
    );
    const cmds = createAppStorageCommandMethods(registry, {
      allowSyntheticConnectedProbe: true,
    });
    const platform = memoryStorage();
    const bindingStorage = memoryStorage();
    const router = new BindingStorageRouter({
      enabled: true,
      platformStorage: platform,
      resolveRoute: (ctx) => cmds.resolveStorageRoute(ctx),
      createStorage: () => bindingStorage,
      createSigner: () => undefined,
    });
    await expect(
      router.forIngest({
        workspaceId,
        applicationId,
        purpose: "ingest",
      }),
    ).rejects.toThrow(/not_connected|denied/i);
  });

  it("routes ingest to binding storage and stamps sticky ids when Connected", async () => {
    const registry = new InMemoryAppStorageRegistry();
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    const applicationId = "22222222-2222-2222-2222-222222222222";
    const created = registry.upsertBinding(
      {
        workspaceId,
        applicationId,
        provider: "s3",
        region: "ap-southeast-2",
        bucket: "managed-app",
        tier: "managed",
        credentialMode: "platform_iam",
        idempotencyKey: "app",
      },
      "admin",
    );
    registry.recordProbe(created.binding.id, {
      ok: true,
      summary: "ok",
      expectedOwnerMatch: true,
    });
    const cmds = createAppStorageCommandMethods(registry, {
      allowSyntheticConnectedProbe: true,
    });
    const platform = memoryStorage();
    const bindingStorage = memoryStorage();
    const router = new BindingStorageRouter({
      enabled: true,
      platformStorage: platform,
      resolveRoute: (ctx) => cmds.resolveStorageRoute(ctx),
      createStorage: () => bindingStorage,
      createSigner: () => undefined,
    });
    const route = await router.forIngest({
      workspaceId,
      applicationId,
      purpose: "ingest",
    });
    expect(route.storage).toBe(bindingStorage);
    expect(route.bindingId).toBe(created.binding.id);
    expect(route.generation).toBe(created.binding.generation);
  });

  it("routes sticky download via blob storageBindingId", async () => {
    const registry = new InMemoryAppStorageRegistry();
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    const applicationId = "22222222-2222-2222-2222-222222222222";
    const created = registry.upsertBinding(
      {
        workspaceId,
        applicationId,
        provider: "s3",
        region: "ap-southeast-2",
        bucket: "managed-app",
        tier: "managed",
        credentialMode: "platform_iam",
        idempotencyKey: "app",
      },
      "admin",
    );
    registry.recordProbe(created.binding.id, {
      ok: true,
      summary: "ok",
    });
    const cmds = createAppStorageCommandMethods(registry, {
      allowSyntheticConnectedProbe: true,
    });
    const platformSigner: TransferSigner = {
      async signUpload() {
        return { url: "platform", headers: {} };
      },
      async signDownload() {
        return { url: "platform", headers: {} };
      },
    };
    const bindingSigner: TransferSigner = {
      async signUpload() {
        return { url: "binding", headers: {} };
      },
      async signDownload() {
        return { url: "binding", headers: {} };
      },
    };
    const router = new BindingStorageRouter({
      enabled: true,
      platformStorage: memoryStorage(),
      platformSigner,
      resolveRoute: (ctx) => cmds.resolveStorageRoute(ctx),
      createStorage: () => memoryStorage(),
      createSigner: () => bindingSigner,
    });
    const blob = {
      storageBindingId: created.binding.id,
    };
    const route = await router.forDownload({ workspaceId, blob });
    expect(route.signer).toBe(bindingSigner);
  });
});

describe("binding storage factory helpers", () => {
  it("builds managed S3 storage from profile + host env", () => {
    const storage = createObjectStorageFromProfile(
      {
        provider: "s3",
        region: "eu-west-1",
        bucket: "tenant-bucket",
        credentialMode: "platform_iam",
      },
      {
        TRUST_STORAGE_ACCESS_KEY: "AKIA",
        TRUST_STORAGE_SECRET_KEY: "secret",
      },
    );
    expect(storage).toBeDefined();
  });

  it("refuses cross_account_role without STS", () => {
    expect(
      createObjectStorageFromProfile({
        provider: "s3",
        region: "eu-west-1",
        bucket: "byob",
        credentialMode: "cross_account_role",
        roleArn: "arn:aws:iam::1:role/x",
      }),
    ).toBeUndefined();
  });

  it("keeps routing flag off by default", () => {
    expect(isStorageBindingRoutingEnabled({})).toBe(false);
  });
});

describe("live managed probe option", () => {
  it("records Connected when probeBindingLive succeeds", async () => {
    const registry = new InMemoryAppStorageRegistry();
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    const applicationId = "22222222-2222-2222-2222-222222222222";
    const created = registry.upsertBinding(
      {
        workspaceId,
        applicationId,
        provider: "s3",
        region: "ap-southeast-2",
        bucket: "managed-app",
        tier: "managed",
        credentialMode: "platform_iam",
        idempotencyKey: "app",
      },
      "admin",
    );
    const probeBindingLive = vi.fn(async () => ({
      ok: true,
      summary: "HeadBucket ok",
      expectedOwnerMatch: true,
    }));
    const cmds = createAppStorageCommandMethods(registry, { probeBindingLive });
    const summary = await cmds.probeStorageBinding(
      {
        id: "admin",
        displayName: "Admin",
        roles: ["admin"],
        workspaceIds: [workspaceId],
      },
      {
        workspaceId,
        bindingId: created.binding.id,
        tier: "connectivity",
      },
    );
    expect(probeBindingLive).toHaveBeenCalled();
    expect(summary.status).toBe("connected");
    expect(summary.lastProbeOk).toBe(true);
  });
});
