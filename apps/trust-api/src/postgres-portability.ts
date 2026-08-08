import { createHash } from "node:crypto";
import {
  ArchiveImportExecutor,
  assembleArchiveEntries,
  planArchiveImport,
  readTrustArchive,
  writeTrustArchive,
  type ArchiveImportOperation,
  type ArchiveImportCheckpoint,
} from "@trust-core/archive";
import {
  PortabilityArchiveObjectStore,
  PostgresArchiveImportOperationStore,
  PostgresArchiveImportTarget,
  PostgresPortabilityExportReader,
  PostgresPortabilityStore,
  deterministicUuid,
  loadArchiveImportInventory,
  type DatabasePool,
  type DurablePortabilityArchive,
  type DurablePortabilityExport,
  type DurablePortabilityPlan,
  type PortabilityPrincipalType,
} from "@trust-core/persistence-postgres";
import type {
  ArchiveCandidate,
  ArchiveExportSummary,
  AuthenticatedActor,
  CreateArchiveExportCommand,
  CreateImportPlanCommand,
  ExecuteImportCommand,
  ImportOperationSummary,
  ImportPlanSummary,
  UploadArchiveCommand,
} from "@trust-core/protocol";
import type { ObjectStorage } from "@trust-core/storage";
import type { PortabilityProvider } from "./portability.js";
import type { ArchiveExportTransfer } from "./portability.js";

const archiveLimits = {
  maxContainerBytes: 8_000_000,
  maxEntryBytes: 4_000_000,
  maxTotalBytes: 16_000_000,
  maxEntries: 10_000,
  maxCompressionRatio: 100,
};

export type ImportCheckpointEffect = (
  checkpoint: ArchiveImportCheckpoint,
  operation: ArchiveImportOperation,
) => void | Promise<void>;

export class PostgresPortabilityProvider implements PortabilityProvider {
  private readonly store: PostgresPortabilityStore;
  private readonly objects: PortabilityArchiveObjectStore;
  private readonly reader: PostgresPortabilityExportReader;

  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ObjectStorage,
    private readonly storageProvider: string,
    allowLocalUnsignedProfile: boolean,
    private readonly afterImportCheckpoint?: ImportCheckpointEffect,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = new PostgresPortabilityStore(pool, {
      allowLocalUnsignedProfile,
    });
    this.objects = new PortabilityArchiveObjectStore(storage, storageProvider);
    this.reader = new PostgresPortabilityExportReader(
      pool,
      storage,
      storageProvider,
    );
  }

  async createExport(
    actor: AuthenticatedActor,
    command: CreateArchiveExportCommand,
  ): Promise<ArchiveExportSummary> {
    const datasetIds = [...new Set(command.datasetIds)].sort();
    const identity = requestIdentity(actor, command.idempotencyKey, {
      datasetIds,
    });
    const exportId = `export-${sha256(`${command.workspaceId}:${identity.principalType}:${actor.id}:${command.idempotencyKey}`).slice(0, 40)}`;
    const createdAt = this.now().toISOString();
    try {
      const durable = await this.store.saveExport({
        id: exportId,
        workspaceId: command.workspaceId,
        datasetIds,
        status: "pending",
        signatureProfile: "unsigned",
        createdAt,
        ...identity,
      });
      if (durable.status === "ready") return exportSummary(durable);
      const source = await this.reader.read({
        exportId,
        workspaceId: command.workspaceId,
        datasetIds,
        createdAt: durable.createdAt,
        createdBy: actor.id,
      });
      const assembled = assembleArchiveEntries(source);
      const bytes = await writeTrustArchive(assembled);
      const persisted = await this.objects.persist({
        workspaceId: command.workspaceId,
        requestId: exportId,
        bytes,
      });
      const completed = await this.store.completeExport({
        workspaceId: command.workspaceId,
        exportId,
        archiveSha256: persisted.sha256,
        byteLength: persisted.byteLength,
        storage: persisted.storage,
        manifest: assembled.manifest,
        completedAt: this.now().toISOString(),
      });
      await this.audit(actor, command.workspaceId, {
        action: "archive.exported",
        subjectKind: "export",
        subjectId: exportId,
        requestId: command.idempotencyKey,
        outcome: "succeeded",
      });
      return exportSummary(completed);
    } catch (error) {
      await this.store
        .failExport(command.workspaceId, exportId, this.now().toISOString())
        .catch(() => undefined);
      await this.auditFailure(
        actor,
        command.workspaceId,
        "archive.export.failed",
        "export",
        exportId,
        command.idempotencyKey,
        error,
      );
      throw error;
    }
  }

  async downloadExport(
    workspaceId: string,
    exportId: string,
  ): Promise<ArchiveExportTransfer | undefined> {
    const durable = await this.store.getExport(workspaceId, exportId);
    if (!durable || durable.status !== "ready" || !durable.storage) return;
    const bytes = await this.objects.read(durable.storage);
    assertStoredBytes(durable.archiveSha256, durable.byteLength, bytes);
    return {
      summary: exportSummary(durable),
      mediaType: "application/vnd.trust-core.archive+zip",
      filename: `${durable.id}.trustarchive`,
      bytes,
    };
  }

  async uploadArchive(
    actor: AuthenticatedActor,
    command: UploadArchiveCommand,
  ): Promise<ArchiveCandidate> {
    const bytes = decodeBase64(command.archiveBase64);
    const fingerprint = sha256(bytes);
    const identity = requestIdentity(actor, command.idempotencyKey, {
      archiveSha256: fingerprint,
    });
    try {
      const parsed = await readTrustArchive(bytes, archiveLimits);
      if (parsed.manifest.signatureProfile !== "unsigned")
        throw codedError(
          "INVALID_COMMAND",
          "Only the local unsigned archive profile is supported.",
        );
      if (
        [...parsed.entries.keys()].some((path) =>
          path.startsWith("signatures/"),
        )
      )
        throw codedError(
          "INVALID_COMMAND",
          "Unsigned archives must not contain signature artifacts.",
        );
      const persisted = await this.objects.persist({
        workspaceId: command.workspaceId,
        requestId: `upload-${fingerprint}`,
        bytes,
      });
      const durable = await this.store.saveArchive({
        id: fingerprint,
        workspaceId: command.workspaceId,
        sourceExportId: parsed.manifest.exportId,
        sourceWorkspaceId: parsed.manifest.workspaceId,
        status: parsed.verification.valid ? "verified" : "rejected",
        signatureProfile: "unsigned",
        checkedEntries: parsed.verification.checkedEntries,
        issueCount: parsed.verification.issues.length,
        archiveSha256: fingerprint,
        byteLength: bytes.byteLength,
        storage: persisted.storage,
        manifest: parsed.manifest,
        verification: parsed.verification,
        createdAt: this.now().toISOString(),
        ...identity,
      });
      await this.audit(actor, command.workspaceId, {
        action: parsed.verification.valid
          ? "archive.upload.verified"
          : "archive.upload.rejected",
        subjectKind: "archive",
        subjectId: durable.id,
        requestId: command.idempotencyKey,
        outcome: parsed.verification.valid ? "succeeded" : "failed",
        ...(parsed.verification.valid
          ? {}
          : { errorCode: "ARCHIVE_VERIFICATION_FAILED" }),
      });
      return archiveCandidate(durable);
    } catch (error) {
      await this.auditFailure(
        actor,
        command.workspaceId,
        "archive.upload.failed",
        "archive",
        fingerprint,
        command.idempotencyKey,
        error,
      );
      throw error;
    }
  }

  async getArchive(
    workspaceId: string,
    archiveId: string,
  ): Promise<ArchiveCandidate | undefined> {
    const durable = await this.store.getArchive(workspaceId, archiveId);
    return durable ? archiveCandidate(durable) : undefined;
  }

  async createPlan(
    actor: AuthenticatedActor,
    command: CreateImportPlanCommand,
  ): Promise<ImportPlanSummary> {
    const identity = requestIdentity(actor, command.idempotencyKey, {
      archiveId: command.archiveId,
      mode: command.mode,
      conflictMode: command.conflictMode,
    });
    try {
      const archive = await this.store.getArchive(
        command.workspaceId,
        command.archiveId,
      );
      if (!archive)
        throw codedError(
          "ARCHIVE_NOT_FOUND",
          "Archive candidate was not found.",
        );
      if (archive.status !== "verified")
        throw codedError(
          "INVALID_COMMAND",
          "Rejected archives cannot be planned.",
        );
      if (
        command.mode === "preserve_ids" &&
        archive.sourceWorkspaceId !== command.workspaceId
      )
        throw codedError(
          "INVALID_COMMAND",
          "Preserve-ID import requires matching source and target workspaces.",
        );
      const parsed = await this.readArchive(archive);
      const inventory = await loadArchiveImportInventory(
        this.pool,
        command.workspaceId,
      );
      const plan = planArchiveImport({
        archive: parsed,
        mode: command.mode,
        conflictMode: command.conflictMode,
        target: inventory,
      });
      const durable = await this.store.savePlan({
        workspaceId: command.workspaceId,
        archiveId: command.archiveId,
        plan,
        createdAt: this.now().toISOString(),
        ...identity,
      });
      await this.audit(actor, command.workspaceId, {
        action: "archive.import.planned",
        subjectKind: "import-plan",
        subjectId: plan.planId,
        requestId: command.idempotencyKey,
        outcome: "succeeded",
      });
      return planSummary(durable);
    } catch (error) {
      await this.auditFailure(
        actor,
        command.workspaceId,
        "archive.import.plan_failed",
        "archive",
        command.archiveId,
        command.idempotencyKey,
        error,
      );
      throw error;
    }
  }

  async getPlan(
    workspaceId: string,
    planId: string,
  ): Promise<ImportPlanSummary | undefined> {
    const durable = await this.store.getPlan(workspaceId, planId);
    return durable ? planSummary(durable) : undefined;
  }

  async executePlan(
    planId: string,
    actor: AuthenticatedActor,
    command: ExecuteImportCommand,
  ): Promise<ImportOperationSummary> {
    const fingerprint = sha256(
      JSON.stringify({ planId, confirmation: command.confirmation }),
    );
    const principalType = actor.principalType ?? "user";
    try {
      const durablePlan = await this.store.getPlan(command.workspaceId, planId);
      if (!durablePlan)
        throw codedError("IMPORT_PLAN_NOT_FOUND", "Import plan was not found.");
      const durableArchive = await this.store.getArchive(
        command.workspaceId,
        durablePlan.archiveId,
      );
      if (!durableArchive)
        throw codedError(
          "ARCHIVE_NOT_FOUND",
          "Archive candidate was not found.",
        );
      const archive = await this.readArchive(durableArchive);
      const operations = new PostgresArchiveImportOperationStore(
        this.pool,
        command.workspaceId,
        {
          principalType,
          idempotencyKey: command.idempotencyKey,
          fingerprint,
        },
      );
      const target = new PostgresArchiveImportTarget(
        this.pool,
        this.storage,
        command.workspaceId,
        this.storageProvider,
      );
      const result = await new ArchiveImportExecutor(
        operations,
        target,
        () => this.now().toISOString(),
        this.afterImportCheckpoint,
      ).execute({
        archive,
        plan: durablePlan.plan,
        requestedBy: actor.id,
      });
      if (result.resumed)
        await this.audit(actor, command.workspaceId, {
          action: "archive.import.resumed",
          subjectKind: "import-operation",
          subjectId: result.operation.id,
          requestId: command.idempotencyKey,
          correlationId: result.operation.id,
          outcome: "succeeded",
        });
      await this.audit(actor, command.workspaceId, {
        action: "archive.import.executed",
        subjectKind: "import-operation",
        subjectId: result.operation.id,
        requestId: command.idempotencyKey,
        correlationId: result.operation.id,
        outcome: "succeeded",
      });
      return operationSummary(
        command.workspaceId,
        durablePlan.archiveId,
        result.operation,
        result.resumed,
      );
    } catch (error) {
      await this.auditFailure(
        actor,
        command.workspaceId,
        "archive.import.failed",
        "import-plan",
        planId,
        command.idempotencyKey,
        error,
      );
      throw error;
    }
  }

  async getImportOperation(
    workspaceId: string,
    operationId: string,
  ): Promise<ImportOperationSummary | undefined> {
    const operation = await new PostgresArchiveImportOperationStore(
      this.pool,
      workspaceId,
    ).get(operationId);
    if (!operation) return;
    const plan = await this.store.getPlan(workspaceId, operation.planId);
    return plan
      ? operationSummary(workspaceId, plan.archiveId, operation, true)
      : undefined;
  }

  private async readArchive(archive: DurablePortabilityArchive) {
    const bytes = await this.objects.read(archive.storage);
    assertStoredBytes(archive.archiveSha256, archive.byteLength, bytes);
    const parsed = await readTrustArchive(bytes, archiveLimits);
    if (!parsed.verification.valid)
      throw codedError(
        "INVALID_COMMAND",
        "Durable archive failed strict verification.",
      );
    if (
      parsed.manifest.exportId !== archive.sourceExportId ||
      parsed.manifest.workspaceId !== archive.sourceWorkspaceId
    )
      throw new Error("Durable archive manifest does not match its catalog.");
    return parsed;
  }

  private audit(
    actor: AuthenticatedActor,
    workspaceId: string,
    input: {
      action: string;
      subjectKind: "archive" | "export" | "import-plan" | "import-operation";
      subjectId: string;
      requestId: string;
      correlationId?: string;
      outcome: "succeeded" | "failed";
      errorCode?: string;
    },
  ): Promise<void> {
    return this.store.appendAudit({
      workspaceId,
      actorId: actor.id,
      principalType: actor.principalType ?? "user",
      ...input,
      correlationId:
        input.correlationId ??
        deterministicUuid(
          `portability-correlation:${workspaceId}:${input.requestId}`,
        ),
      at: this.now().toISOString(),
    });
  }

  private async auditFailure(
    actor: AuthenticatedActor,
    workspaceId: string,
    action: string,
    subjectKind: "archive" | "export" | "import-plan" | "import-operation",
    subjectId: string,
    requestId: string,
    error: unknown,
  ): Promise<void> {
    await this.audit(actor, workspaceId, {
      action,
      subjectKind,
      subjectId,
      requestId,
      outcome: "failed",
      errorCode:
        typeof (error as { code?: unknown })?.code === "string"
          ? String((error as { code: string }).code)
          : "PORTABILITY_OPERATION_FAILED",
    }).catch(() => undefined);
  }
}

function requestIdentity(
  actor: AuthenticatedActor,
  idempotencyKey: string,
  fingerprintValue: unknown,
): {
  requestedBy: string;
  principalType: PortabilityPrincipalType;
  idempotencyKey: string;
  requestFingerprint: string;
} {
  return {
    requestedBy: actor.id,
    principalType: actor.principalType ?? "user",
    idempotencyKey,
    requestFingerprint: sha256(JSON.stringify(fingerprintValue)),
  };
}

function exportSummary(value: DurablePortabilityExport): ArchiveExportSummary {
  if (
    value.status !== "ready" ||
    !value.archiveSha256 ||
    value.byteLength === undefined
  )
    throw new Error("Portability export is not ready.");
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    datasetIds: value.datasetIds,
    status: "ready",
    sha256: value.archiveSha256,
    byteLength: value.byteLength,
    createdAt: value.createdAt,
  };
}

function archiveCandidate(value: DurablePortabilityArchive): ArchiveCandidate {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    exportId: value.sourceExportId,
    status: value.status,
    checkedEntries: value.checkedEntries,
    issueCount: value.issueCount,
    recordCounts: value.manifest.recordCounts,
    blobCount: value.manifest.blobCount,
    totalBlobBytes: value.manifest.totalBlobBytes,
    createdAt: value.createdAt,
  };
}

function planSummary(value: DurablePortabilityPlan): ImportPlanSummary {
  const { plan } = value;
  return {
    id: plan.planId,
    archiveId: value.archiveId,
    workspaceId: value.workspaceId,
    sourceWorkspaceId: plan.sourceWorkspaceId,
    mode: plan.mode,
    conflictMode: plan.conflictMode,
    status: plan.status,
    issueCount: plan.issues.length,
    counts: {
      insert: plan.counts.insert,
      alreadyPresent: plan.counts.already_present,
      blocked: plan.counts.blocked,
    },
    createdAt: value.createdAt,
  };
}

function operationSummary(
  workspaceId: string,
  archiveId: string,
  operation: ArchiveImportOperation,
  resumed: boolean,
): ImportOperationSummary {
  return {
    id: operation.id,
    workspaceId,
    planId: operation.planId,
    archiveId,
    checkpoint: operation.checkpoint,
    status: operation.checkpoint === "completed" ? "completed" : "running",
    resumed,
    updatedAt: operation.updatedAt,
    completedAt: operation.completedAt ?? null,
  };
}

function decodeBase64(value: string): Uint8Array {
  if (value.length > 12_000_000)
    throw codedError("REQUEST_TOO_LARGE", "Archive request is too large.");
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw codedError(
      "INVALID_COMMAND",
      "Archive payload is not strict base64.",
    );
  return Buffer.from(value, "base64");
}

function assertStoredBytes(
  expectedSha256: string | undefined,
  expectedLength: number | undefined,
  bytes: Uint8Array,
): void {
  if (
    !expectedSha256 ||
    expectedLength === undefined ||
    bytes.byteLength !== expectedLength ||
    sha256(bytes) !== expectedSha256
  )
    throw new Error("Durable archive object does not match its catalog.");
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
