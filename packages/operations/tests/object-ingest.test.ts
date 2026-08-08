import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { BlobObject } from "@trust-core/core";
import type {
  ObjectLocator,
  ObjectMetadata,
  ObjectStorage,
  StoredObject,
  TemporaryObject,
} from "@trust-core/storage";
import {
  ImmutableObjectIngestor,
  ObjectIngestService,
  ingestCheckpoints,
  type BlobCatalog,
  type IngestCheckpoint,
  type IngestOperation,
  type IngestOperationStore,
  type IngestPrincipalType,
} from "../src/index.js";

class MemoryStorage implements ObjectStorage {
  objects = new Map<string, Uint8Array>();
  temporaryDeleted = 0;
  corruptLength = false;
  async createTemporaryUpload(input: {
    workspaceId: string;
    operationId: string;
  }): Promise<TemporaryObject> {
    return {
      key: `${input.workspaceId}/temporary/${input.operationId}`,
      expiresAt: "later",
    };
  }
  async writeTemporary(input: {
    locator: ObjectLocator;
    body: Readable;
    mediaType: string;
  }): Promise<ObjectMetadata> {
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    this.objects.set(input.locator.key, bytes);
    return {
      key: input.locator.key,
      byteLength: this.corruptLength ? bytes.length + 1 : bytes.length,
      mediaType: input.mediaType,
    };
  }
  async commitImmutable(input: {
    temporary: ObjectLocator;
    workspaceId: string;
    sha256: string;
    byteLength: number;
    mediaType: string;
  }): Promise<StoredObject> {
    const key = `${input.workspaceId}/objects/${input.sha256}`;
    this.objects.set(
      key,
      this.objects.get(input.temporary.key) ?? new Uint8Array(),
    );
    await this.deleteTemporary(input.temporary);
    return {
      key,
      sha256: input.sha256,
      byteLength: input.byteLength,
      mediaType: input.mediaType,
    };
  }
  async openReadStream(input: ObjectLocator) {
    return Readable.from(this.objects.get(input.key) ?? new Uint8Array());
  }
  async head(input: ObjectLocator): Promise<ObjectMetadata> {
    const bytes = this.objects.get(input.key);
    if (!bytes) throw new Error("missing");
    return {
      key: input.key,
      byteLength: bytes.length,
      mediaType: "application/octet-stream",
    };
  }
  async exists(input: ObjectLocator) {
    return this.objects.has(input.key);
  }
  async deleteTemporary(input: ObjectLocator) {
    this.objects.delete(input.key);
    this.temporaryDeleted += 1;
  }
}
class MemoryCatalog implements BlobCatalog {
  blobs = new Map<string, BlobObject>();
  actorTypes: IngestPrincipalType[] = [];
  async findByHash(workspaceId: string, sha256: string) {
    return this.blobs.get(`${workspaceId}:${sha256}`);
  }
  async recordVerified(blob: BlobObject) {
    this.blobs.set(`${blob.workspaceId}:${blob.sha256}`, blob);
    return blob;
  }
  async commitVerifiedIngest(
    input: Parameters<NonNullable<BlobCatalog["commitVerifiedIngest"]>>[0],
  ) {
    this.actorTypes.push(input.actorType);
    return this.recordVerified(input.blob);
  }
}
class MemoryOperations implements IngestOperationStore {
  operation?: IngestOperation;
  principalTypes: IngestPrincipalType[] = [];
  failAt?: IngestCheckpoint;
  failed = false;
  async begin(input: Parameters<IngestOperationStore["begin"]>[0]) {
    this.principalTypes.push(input.principalType);
    this.operation ??= {
      id: "00000000-0000-4000-8000-000000000001",
      workspaceId: input.workspaceId,
      requestHash: input.requestHash,
      state: "requested",
      checkpoints: [],
      context: {},
    };
    return this.operation;
  }
  async saveContext(
    _workspaceId: string,
    _operationId: string,
    context: Readonly<Record<string, unknown>>,
    state: IngestOperation["state"],
  ) {
    this.operation = { ...this.operation!, context: { ...context }, state };
  }
  async markCheckpoint(
    _workspaceId: string,
    _operationId: string,
    checkpoint: IngestCheckpoint,
  ) {
    if (this.failAt === checkpoint && !this.failed) {
      this.failed = true;
      throw new Error(`process stopped at ${checkpoint}`);
    }
    this.operation = {
      ...this.operation!,
      state: checkpoint,
      checkpoints: [...this.operation!.checkpoints, checkpoint],
    };
  }
  async complete(
    _workspaceId: string,
    _operationId: string,
    result: Readonly<Record<string, unknown>>,
  ) {
    this.operation = { ...this.operation!, state: "completed", result };
  }
  async fail() {
    return;
  }
}

describe("immutable object ingestion", () => {
  it("hashes, verifies, commits and deduplicates equal bytes", async () => {
    const storage = new MemoryStorage(),
      catalog = new MemoryCatalog(),
      service = new ImmutableObjectIngestor(storage, catalog);
    const first = await service.ingest({
      workspaceId: "workspace",
      bytes: Buffer.from("drawing"),
      mediaType: "image/png",
      operationId: "one",
    });
    const second = await service.ingest({
      workspaceId: "workspace",
      bytes: Buffer.from("drawing"),
      mediaType: "image/png",
      operationId: "two",
    });
    expect(first.blob.verificationState).toBe("verified");
    expect(first.blob.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toEqual({ blob: first.blob, deduplicated: true });
    expect(catalog.blobs.size).toBe(1);
  });
  it("cleans temporary bytes and records no blob after verification failure", async () => {
    const storage = new MemoryStorage();
    storage.corruptLength = true;
    const catalog = new MemoryCatalog();
    const service = new ImmutableObjectIngestor(storage, catalog);
    await expect(
      service.ingest({
        workspaceId: "workspace",
        bytes: Buffer.from("broken"),
        mediaType: "image/png",
        operationId: "bad",
      }),
    ).rejects.toThrow("byte length");
    expect(storage.temporaryDeleted).toBe(1);
    expect(catalog.blobs.size).toBe(0);
  });
  it("resumes safely after process interruption at all eight durable checkpoints", async () => {
    for (const failure of ingestCheckpoints) {
      const storage = new MemoryStorage(),
        catalog = new MemoryCatalog(),
        operations = new MemoryOperations();
      operations.failAt = failure;
      const first = new ObjectIngestService(
        storage,
        catalog,
        operations,
        "test",
        () => "2026-08-04T00:00:00.000Z",
        () => "00000000-0000-4000-8000-000000000002",
      );
      await expect(
        first.ingest({
          workspaceId: "workspace",
          actorId: "actor",
          principalType: "user",
          idempotencyKey: "same",
          bytes: Buffer.from("restart-safe"),
          mediaType: "text/plain",
        }),
      ).rejects.toThrow(`process stopped at ${failure}`);
      const restarted = new ObjectIngestService(
        storage,
        catalog,
        operations,
        "test",
        () => "2026-08-04T00:00:01.000Z",
        () => "00000000-0000-4000-8000-000000000003",
      );
      const result = await restarted.ingest({
        workspaceId: "workspace",
        actorId: "actor",
        principalType: "user",
        idempotencyKey: "same",
        bytes: Buffer.from("restart-safe"),
        mediaType: "text/plain",
      });
      expect(result.blob.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(operations.operation?.checkpoints).toEqual(ingestCheckpoints);
      expect(catalog.blobs.size).toBe(1);
    }
  });
  it("preserves application and user principal types through operation and audit writes", async () => {
    const storage = new MemoryStorage();
    const catalog = new MemoryCatalog();
    for (const principalType of ["application", "user"] as const) {
      const operations = new MemoryOperations();
      const service = new ObjectIngestService(
        storage,
        catalog,
        operations,
        "test",
        () => "2026-08-04T00:00:00.000Z",
      );
      await service.ingest({
        workspaceId: "workspace",
        actorId: `${principalType}-actor`,
        principalType,
        idempotencyKey: `${principalType}-ingest`,
        bytes: Buffer.from(`${principalType}-bytes`),
        mediaType: "text/plain",
      });
      expect(operations.principalTypes).toEqual([principalType]);
    }
    expect(catalog.actorTypes).toEqual(["application", "user"]);
  });

  it("stamps sticky binding metadata when provided on ingest", async () => {
    const storage = new MemoryStorage();
    const catalog = new MemoryCatalog();
    const operations = new MemoryOperations();
    const service = new ObjectIngestService(
      storage,
      catalog,
      operations,
      "test",
      () => "2026-08-04T00:00:00.000Z",
      () => "00000000-0000-4000-8000-000000000099",
    );
    const result = await service.ingest({
      workspaceId: "workspace",
      actorId: "actor",
      principalType: "application",
      idempotencyKey: "sticky",
      bytes: Buffer.from("sticky-bytes"),
      mediaType: "text/plain",
      storageBindingId: "33333333-3333-3333-3333-333333333333",
      storageBindingGeneration: 7,
    });
    expect(result.blob.storageBindingId).toBe(
      "33333333-3333-3333-3333-333333333333",
    );
    expect(result.blob.storageBindingGeneration).toBe(7);
  });
});
