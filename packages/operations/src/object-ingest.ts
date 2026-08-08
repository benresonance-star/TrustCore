import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { BlobObject } from "@trust-core/core";
import type { AuthenticatedActor, OperationState } from "@trust-core/protocol";
import type { ObjectStorage } from "@trust-core/storage";
export type IngestPrincipalType = NonNullable<
  AuthenticatedActor["principalType"]
>;
export const ingestCheckpoints = [
  "authorised",
  "temporary_upload_created",
  "bytes_received",
  "hash_verified",
  "immutable_object_committed",
  "metadata_committed",
  "audit_committed",
  "completed",
] as const;
export type IngestCheckpoint = (typeof ingestCheckpoints)[number];
export interface IngestOperation {
  id: string;
  workspaceId: string;
  requestHash: string;
  state: OperationState;
  checkpoints: readonly IngestCheckpoint[];
  context: Readonly<Record<string, unknown>>;
  result?: Readonly<Record<string, unknown>>;
}
export interface IngestOperationStore {
  begin(input: {
    workspaceId: string;
    idempotencyKey: string;
    actorId: string;
    principalType: IngestPrincipalType;
    requestHash: string;
    request: Readonly<Record<string, unknown>>;
  }): Promise<IngestOperation>;
  saveContext(
    workspaceId: string,
    operationId: string,
    context: Readonly<Record<string, unknown>>,
    state: OperationState,
  ): Promise<void>;
  markCheckpoint(
    workspaceId: string,
    operationId: string,
    checkpoint: IngestCheckpoint,
  ): Promise<void>;
  complete(
    workspaceId: string,
    operationId: string,
    result: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  fail(workspaceId: string, operationId: string, error: string): Promise<void>;
}
export interface BlobCatalog {
  findByHash(
    workspaceId: string,
    sha256: string,
  ): Promise<BlobObject | undefined>;
  recordVerified(blob: BlobObject): Promise<BlobObject>;
  commitVerifiedIngest?(input: {
    blob: BlobObject;
    operationId: string;
    actorId: string;
    actorType: IngestPrincipalType;
    occurredAt: string;
  }): Promise<BlobObject>;
}
export interface ObjectIngestResult {
  operationId: string;
  blob: BlobObject;
  deduplicated: boolean;
  resumed: boolean;
}

export class ObjectIngestService {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly catalog: BlobCatalog,
    private readonly operations: IngestOperationStore,
    private readonly provider = "s3-compatible",
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly nextId: () => string = () => randomUUID(),
    private readonly afterEffect: (
      checkpoint: IngestCheckpoint,
    ) => Promise<void> = async () => undefined,
  ) {}

  async ingest(input: {
    workspaceId: string;
    actorId: string;
    principalType: IngestPrincipalType;
    idempotencyKey: string;
    bytes: Uint8Array;
    mediaType: string;
    /** Optional binding-scoped storage; defaults to constructor platform storage. */
    storage?: ObjectStorage;
    storageBindingId?: string | null;
    storageBindingGeneration?: number | null;
  }): Promise<ObjectIngestResult> {
    const storage = input.storage ?? this.storage;
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          workspaceId: input.workspaceId,
          mediaType: input.mediaType,
          sha256,
        }),
      )
      .digest("hex");
    const operation = await this.operations.begin({
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      principalType: input.principalType,
      requestHash,
      request: {
        mediaType: input.mediaType,
        sha256,
        byteLength: input.bytes.byteLength,
      },
    });
    if (operation.requestHash !== requestHash)
      throw new Error(
        "Idempotency key was already used for a different ingest request.",
      );
    const completed = new Set(operation.checkpoints);
    const context: Record<string, unknown> = { ...operation.context };
    const resumed = completed.size > 0;
    let blob = blobFromResult(operation.result);
    let deduplicated = Boolean(operation.result?.deduplicated);
    const checkpoint = async (
      name: IngestCheckpoint,
      effect: () => Promise<void>,
    ) => {
      if (completed.has(name)) return;
      await effect();
      await this.afterEffect(name);
      await this.operations.markCheckpoint(
        input.workspaceId,
        operation.id,
        name,
      );
      completed.add(name);
    };
    try {
      await checkpoint("authorised", async () => {
        if (
          !input.workspaceId ||
          !input.actorId ||
          !input.idempotencyKey ||
          !input.mediaType
        )
          throw new Error("Ingest authorization context is incomplete.");
      });
      const existing = await this.catalog.findByHash(input.workspaceId, sha256);
      if (existing) {
        blob = existing;
        deduplicated = true;
        for (const name of ingestCheckpoints.slice(1, 5))
          await checkpoint(name, async () => undefined);
        await checkpoint("metadata_committed", async () => {
          if (this.catalog.commitVerifiedIngest)
            blob = await this.catalog.commitVerifiedIngest({
              blob: existing,
              operationId: operation.id,
              actorId: input.actorId,
              actorType: input.principalType,
              occurredAt: this.now(),
            });
        });
        await checkpoint("audit_committed", async () => undefined);
      } else {
        await checkpoint("temporary_upload_created", async () => {
          const temporary = await storage.createTemporaryUpload({
            workspaceId: input.workspaceId,
            operationId: operation.id,
          });
          context.temporaryKey = temporary.key;
          await this.operations.saveContext(
            input.workspaceId,
            operation.id,
            context,
            "temporary_upload_created",
          );
        });
        await checkpoint("bytes_received", async () => {
          const temporaryKey = requiredContextString(context, "temporaryKey");
          const received = await storage.writeTemporary({
            locator: { key: temporaryKey },
            body: Readable.from(input.bytes),
            mediaType: input.mediaType,
          });
          if (received.byteLength !== input.bytes.byteLength)
            throw new Error(
              "Stored byte length does not match the supplied object.",
            );
        });
        await checkpoint("hash_verified", async () => {
          context.sha256 = sha256;
          context.byteLength = input.bytes.byteLength;
          await this.operations.saveContext(
            input.workspaceId,
            operation.id,
            context,
            "hash_verified",
          );
        });
        await checkpoint("immutable_object_committed", async () => {
          const stored = await storage.commitImmutable({
            temporary: { key: requiredContextString(context, "temporaryKey") },
            workspaceId: input.workspaceId,
            sha256,
            byteLength: input.bytes.byteLength,
            mediaType: input.mediaType,
          });
          if (
            stored.sha256 !== sha256 ||
            stored.byteLength !== input.bytes.byteLength
          )
            throw new Error("Immutable object verification failed.");
          context.storageKey = stored.key;
          await this.operations.saveContext(
            input.workspaceId,
            operation.id,
            context,
            "immutable_object_committed",
          );
        });
        await checkpoint("metadata_committed", async () => {
          const candidate: BlobObject = {
            id: this.nextId(),
            workspaceId: input.workspaceId,
            sha256,
            byteLength: input.bytes.byteLength,
            mediaType: input.mediaType,
            storageProvider: this.provider,
            storageKey: requiredContextString(context, "storageKey"),
            encryptionState: "provider_managed",
            encryptionKeyRef: null,
            verificationState: "verified",
            createdAt: this.now(),
            ...(input.storageBindingId
              ? { storageBindingId: input.storageBindingId }
              : {}),
            ...(input.storageBindingGeneration != null
              ? { storageBindingGeneration: input.storageBindingGeneration }
              : {}),
          };
          blob = this.catalog.commitVerifiedIngest
            ? await this.catalog.commitVerifiedIngest({
                blob: candidate,
                operationId: operation.id,
                actorId: input.actorId,
                actorType: input.principalType,
                occurredAt: candidate.createdAt,
              })
            : await this.catalog.recordVerified(candidate);
        });
        await checkpoint("audit_committed", async () => undefined);
      }
      if (!blob)
        throw new Error("Ingest completed without canonical blob metadata.");
      await checkpoint("completed", () =>
        this.operations.complete(input.workspaceId, operation.id, {
          blob,
          deduplicated,
        }),
      );
      return { operationId: operation.id, blob, deduplicated, resumed };
    } catch (error) {
      await this.operations
        .fail(
          input.workspaceId,
          operation.id,
          error instanceof Error ? error.message : String(error),
        )
        .catch(() => undefined);
      throw error;
    }
  }
}

export class ImmutableObjectIngestor {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly catalog: BlobCatalog,
    private readonly provider = "s3-compatible",
  ) {}
  async ingest(input: {
    workspaceId: string;
    bytes: Uint8Array;
    mediaType: string;
    operationId?: string;
  }): Promise<{ blob: BlobObject; deduplicated: boolean }> {
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const existing = await this.catalog.findByHash(input.workspaceId, sha256);
    if (existing) return { blob: existing, deduplicated: true };
    const temporary = await this.storage.createTemporaryUpload({
      workspaceId: input.workspaceId,
      operationId: input.operationId ?? randomUUID(),
    });
    try {
      const received = await this.storage.writeTemporary({
        locator: temporary,
        body: Readable.from(input.bytes),
        mediaType: input.mediaType,
      });
      if (received.byteLength !== input.bytes.byteLength)
        throw new Error(
          "Stored byte length does not match the supplied object.",
        );
      const stored = await this.storage.commitImmutable({
        temporary,
        workspaceId: input.workspaceId,
        sha256,
        byteLength: input.bytes.byteLength,
        mediaType: input.mediaType,
      });
      if (
        stored.sha256 !== sha256 ||
        stored.byteLength !== input.bytes.byteLength
      )
        throw new Error("Immutable object verification failed.");
      const blob: BlobObject = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        sha256,
        byteLength: input.bytes.byteLength,
        mediaType: input.mediaType,
        storageProvider: this.provider,
        storageKey: stored.key,
        encryptionState: "provider_managed",
        encryptionKeyRef: null,
        verificationState: "verified",
        createdAt: new Date().toISOString(),
      };
      return {
        blob: await this.catalog.recordVerified(blob),
        deduplicated: false,
      };
    } catch (error) {
      await this.storage.deleteTemporary(temporary).catch(() => undefined);
      throw error;
    }
  }
}

function requiredContextString(
  context: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = context[key];
  if (typeof value !== "string" || !value)
    throw new Error(`Ingest operation is missing ${key}.`);
  return value;
}
function blobFromResult(
  result: Readonly<Record<string, unknown>> | undefined,
): BlobObject | undefined {
  const value = result?.blob;
  if (!value || typeof value !== "object") return undefined;
  return value as BlobObject;
}
