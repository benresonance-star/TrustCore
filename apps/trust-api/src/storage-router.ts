import type { ObjectStorage } from "@trust-core/storage";
import type { TransferSigner } from "@trust-core/operations";
import type { StorageProfileSummary } from "@trust-core/protocol";
import type {
  ResolveResult,
  RoutingContext,
} from "./app-storage-bindings.js";

export type IngestStorageRoute = {
  storage: ObjectStorage;
  bindingId: string | null;
  generation: number | null;
  reason?: string;
};

export type DownloadStorageRoute = {
  signer: TransferSigner | undefined;
  bindingId: string | null;
  generation: number | null;
  reason?: string;
};

export type BindingStorageRouterOptions = {
  enabled: boolean;
  platformStorage: ObjectStorage;
  platformSigner?: TransferSigner;
  resolveRoute: (context: RoutingContext) => Promise<ResolveResult>;
  createStorage: (profile: StorageProfileSummary) => ObjectStorage | undefined;
  createSigner: (
    profile: StorageProfileSummary,
  ) => TransferSigner | undefined;
};

/**
 * Resolves ObjectStorage / transfer signer for ingest and sticky download
 * when TRUST_STORAGE_BINDING_ROUTING is enabled.
 */
export class BindingStorageRouter {
  constructor(private readonly options: BindingStorageRouterOptions) {}

  async forIngest(context: RoutingContext): Promise<IngestStorageRoute> {
    if (!this.options.enabled || !context.applicationId) {
      return {
        storage: this.options.platformStorage,
        bindingId: null,
        generation: null,
        reason: "platform_default",
      };
    }
    const resolved = await this.options.resolveRoute(context);
    if (
      resolved.inheritedFrom === "platform" ||
      !resolved.bindingId ||
      !resolved.profile
    ) {
      return {
        storage: this.options.platformStorage,
        bindingId: null,
        generation: null,
        reason: resolved.reason ?? "platform_fallback",
      };
    }
    if (!resolved.allowWrite) {
      throw Object.assign(
        new Error(
          `Storage routing denied for ingest (${resolved.reason ?? "not_connected"}).`,
        ),
        { code: "COMMAND_REJECTED" },
      );
    }
    const storage = this.options.createStorage(resolved.profile);
    if (!storage) {
      throw Object.assign(
        new Error(
          "Binding ObjectStorage could not be constructed (credential mode unsupported or host credentials missing).",
        ),
        { code: "COMMAND_REJECTED" },
      );
    }
    return {
      storage,
      bindingId: resolved.bindingId,
      generation: resolved.generation,
      reason: resolved.reason,
    };
  }

  async forDownload(input: {
    workspaceId: string;
    blob: { storageBindingId?: string | null };
  }): Promise<DownloadStorageRoute> {
    if (!this.options.enabled || !input.blob.storageBindingId) {
      return {
        signer: this.options.platformSigner,
        bindingId: null,
        generation: null,
        reason: "platform_default",
      };
    }
    const resolved = await this.options.resolveRoute({
      workspaceId: input.workspaceId,
      purpose: "download",
      blobStorageBindingId: input.blob.storageBindingId,
    });
    if (!resolved.bindingId || !resolved.profile) {
      return {
        signer: this.options.platformSigner,
        bindingId: null,
        generation: null,
        reason: resolved.reason ?? "platform_fallback",
      };
    }
    const signer = this.options.createSigner(resolved.profile);
    if (!signer) {
      throw Object.assign(
        new Error(
          "Binding transfer signer could not be constructed for sticky download.",
        ),
        { code: "COMMAND_REJECTED" },
      );
    }
    return {
      signer,
      bindingId: resolved.bindingId,
      generation: resolved.generation,
      reason: resolved.reason,
    };
  }
}
