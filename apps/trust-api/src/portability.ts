import { createHash, randomUUID } from "node:crypto";
import {
  ArchiveImportExecutor,
  assembleArchiveEntries,
  planArchiveImport,
  readTrustArchive,
  writeTrustArchive,
  type ArchiveImportAction,
  type ArchiveImportExecutionTarget,
  type ArchiveImportOperation,
  type ArchiveImportOperationStore,
  type ArchiveImportPlan,
  type ArchiveIssue,
  type ArchiveRecord,
  type ArchiveSource,
  type ParsedTrustArchive,
} from "@trust-core/archive";
import { createIvansDiaryFixture } from "@trust-core/fixtures-ivans-diary";
import { createWeSketchFixture } from "@trust-core/fixtures-wesketch";
import type {
  ArchiveCandidate,
  ArchiveExportSummary,
  AuthenticatedActor,
  CreateImportPlanCommand,
  CreateArchiveExportCommand,
  ExecuteImportCommand,
  ImportOperationSummary,
  ImportPlanSummary,
  UploadArchiveCommand,
} from "@trust-core/protocol";

export interface PortabilityProvider {
  createExport(
    actor: AuthenticatedActor,
    command: CreateArchiveExportCommand,
  ): Promise<ArchiveExportSummary>;
  downloadExport(
    workspaceId: string,
    exportId: string,
  ): Promise<ArchiveExportTransfer | undefined>;
  uploadArchive(
    actor: AuthenticatedActor,
    command: UploadArchiveCommand,
  ): Promise<ArchiveCandidate>;
  getArchive(
    workspaceId: string,
    archiveId: string,
  ): Promise<ArchiveCandidate | undefined>;
  createPlan(
    actor: AuthenticatedActor,
    command: CreateImportPlanCommand,
  ): Promise<ImportPlanSummary>;
  getPlan(
    workspaceId: string,
    planId: string,
  ): Promise<ImportPlanSummary | undefined>;
  executePlan(
    planId: string,
    actor: AuthenticatedActor,
    command: ExecuteImportCommand,
  ): Promise<ImportOperationSummary>;
  getImportOperation(
    workspaceId: string,
    operationId: string,
  ): Promise<ImportOperationSummary | undefined>;
}
export interface ArchiveExportTransfer {
  summary: ArchiveExportSummary;
  mediaType: "application/vnd.trust-core.archive+zip";
  filename: string;
  bytes: Uint8Array;
}

type StoredArchive = {
  candidate: ArchiveCandidate;
  parsed: ParsedTrustArchive;
};
type StoredPlan = {
  summary: ImportPlanSummary;
  plan: ArchiveImportPlan;
};
type StoredExport = {
  summary: ArchiveExportSummary;
  bytes: Uint8Array;
};

export class FixturePortabilityProvider implements PortabilityProvider {
  private readonly exports = new Map<string, StoredExport>();
  private readonly archives = new Map<string, StoredArchive>();
  private readonly plans = new Map<string, StoredPlan>();
  private readonly uploadRequests = new Map<
    string,
    { fingerprint: string; archiveId: string }
  >();
  private readonly planRequests = new Map<
    string,
    { fingerprint: string; planId: string }
  >();
  private readonly executionRequests = new Map<
    string,
    { fingerprint: string; operationId: string }
  >();
  private readonly exportRequests = new Map<
    string,
    { fingerprint: string; exportId: string }
  >();
  private readonly operations = new MemoryImportOperations();
  private readonly target = new MemoryImportTarget();

  constructor(
    private readonly clock: () => Date = () => new Date(),
    private readonly exportSource: (
      workspaceId: string,
      datasetIds: readonly string[],
      actor: AuthenticatedActor,
    ) => ArchiveSource | undefined = fixtureExportSource,
  ) {}

  async createExport(
    actor: AuthenticatedActor,
    command: CreateArchiveExportCommand,
  ): Promise<ArchiveExportSummary> {
    const selected = [...new Set(command.datasetIds)].sort();
    const candidateSource = this.exportSource(
      command.workspaceId,
      selected,
      actor,
    );
    if (!candidateSource)
      throw codedError(
        "DATASET_NOT_FOUND",
        "The requested export dataset selection was not found.",
      );
    const fingerprint = sha256(JSON.stringify({ datasetIds: selected }));
    const requestKey = key(command.workspaceId, actor, command.idempotencyKey);
    const replay = this.exportRequests.get(requestKey);
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw idempotencyConflict();
      return this.exports.get(scoped(command.workspaceId, replay.exportId))!
        .summary;
    }
    const source: ArchiveSource = {
      ...candidateSource,
      exportId: `export-${sha256(requestKey).slice(0, 40)}`,
    };
    const bytes = await writeTrustArchive(assembleArchiveEntries(source));
    const digest = sha256(bytes);
    const summary: ArchiveExportSummary = {
      id: source.exportId,
      workspaceId: command.workspaceId,
      datasetIds: source.datasetIds,
      status: "ready",
      sha256: digest,
      byteLength: bytes.byteLength,
      createdAt: this.clock().toISOString(),
    };
    this.exports.set(scoped(command.workspaceId, summary.id), {
      summary,
      bytes,
    });
    this.exportRequests.set(requestKey, {
      fingerprint,
      exportId: summary.id,
    });
    return summary;
  }

  async downloadExport(workspaceId: string, exportId: string) {
    const stored = this.exports.get(scoped(workspaceId, exportId));
    return stored
      ? {
          summary: stored.summary,
          mediaType: "application/vnd.trust-core.archive+zip" as const,
          filename: `${stored.summary.id}.trustarchive`,
          bytes: stored.bytes,
        }
      : undefined;
  }

  async uploadArchive(
    actor: AuthenticatedActor,
    command: UploadArchiveCommand,
  ): Promise<ArchiveCandidate> {
    const bytes = decodeBase64(command.archiveBase64);
    const fingerprint = sha256(bytes);
    const requestKey = key(command.workspaceId, actor, command.idempotencyKey);
    const replay = this.uploadRequests.get(requestKey);
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw idempotencyConflict();
      return this.archives.get(scoped(command.workspaceId, replay.archiveId))!
        .candidate;
    }
    const parsed = await readTrustArchive(bytes, {
      maxContainerBytes: 8_000_000,
      maxEntryBytes: 4_000_000,
      maxTotalBytes: 16_000_000,
      maxEntries: 10_000,
    });
    const archiveId = fingerprint;
    const candidate: ArchiveCandidate = {
      id: archiveId,
      workspaceId: command.workspaceId,
      exportId: parsed.manifest.exportId,
      status: parsed.verification.valid ? "verified" : "rejected",
      checkedEntries: parsed.verification.checkedEntries,
      issueCount: parsed.verification.issues.length,
      recordCounts: parsed.manifest.recordCounts,
      blobCount: parsed.manifest.blobCount,
      totalBlobBytes: parsed.manifest.totalBlobBytes,
      createdAt: this.clock().toISOString(),
    };
    this.archives.set(scoped(command.workspaceId, archiveId), {
      candidate,
      parsed,
    });
    this.uploadRequests.set(requestKey, { fingerprint, archiveId });
    return candidate;
  }

  async getArchive(workspaceId: string, archiveId: string) {
    return this.archives.get(scoped(workspaceId, archiveId))?.candidate;
  }

  async createPlan(
    actor: AuthenticatedActor,
    command: CreateImportPlanCommand,
  ): Promise<ImportPlanSummary> {
    const archive = this.archives.get(
      scoped(command.workspaceId, command.archiveId),
    );
    if (!archive)
      throw codedError("ARCHIVE_NOT_FOUND", "Archive candidate was not found.");
    if (
      command.mode === "preserve_ids" &&
      archive.parsed.manifest.workspaceId !== command.workspaceId
    )
      throw codedError(
        "INVALID_COMMAND",
        "Preserve-ID import requires the target workspace to match the source workspace.",
      );
    const fingerprint = sha256(
      JSON.stringify({
        archiveId: command.archiveId,
        mode: command.mode,
        conflictMode: command.conflictMode,
      }),
    );
    const requestKey = key(command.workspaceId, actor, command.idempotencyKey);
    const replay = this.planRequests.get(requestKey);
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw idempotencyConflict();
      return this.plans.get(scoped(command.workspaceId, replay.planId))!
        .summary;
    }
    const plan = planArchiveImport({
      archive: archive.parsed,
      mode: command.mode,
      conflictMode: command.conflictMode,
      target: {
        ...(command.mode === "mapped_workspace"
          ? { workspaceId: command.workspaceId }
          : {}),
        records: this.target.inventory(),
        blobDigests: this.target.blobDigests(),
      },
    });
    const summary: ImportPlanSummary = {
      id: plan.planId,
      archiveId: command.archiveId,
      workspaceId: command.workspaceId,
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
      createdAt: this.clock().toISOString(),
    };
    this.plans.set(scoped(command.workspaceId, plan.planId), { summary, plan });
    this.planRequests.set(requestKey, { fingerprint, planId: plan.planId });
    return summary;
  }

  async getPlan(workspaceId: string, planId: string) {
    return this.plans.get(scoped(workspaceId, planId))?.summary;
  }

  async executePlan(
    planId: string,
    actor: AuthenticatedActor,
    command: ExecuteImportCommand,
  ): Promise<ImportOperationSummary> {
    const stored = this.plans.get(scoped(command.workspaceId, planId));
    if (!stored)
      throw codedError("IMPORT_PLAN_NOT_FOUND", "Import plan was not found.");
    const archive = this.archives.get(
      scoped(command.workspaceId, stored.summary.archiveId),
    )!;
    const fingerprint = sha256(
      JSON.stringify({ planId, confirmation: command.confirmation }),
    );
    const requestKey = key(command.workspaceId, actor, command.idempotencyKey);
    const replay = this.executionRequests.get(requestKey);
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw idempotencyConflict();
      return this.operationSummary(
        command.workspaceId,
        stored.summary.archiveId,
        this.operations.get(replay.operationId)!,
        true,
      );
    }
    const result = await new ArchiveImportExecutor(
      this.operations,
      this.target,
      () => this.clock().toISOString(),
    ).execute({
      archive: archive.parsed,
      plan: stored.plan,
      requestedBy: actor.id,
    });
    this.executionRequests.set(requestKey, {
      fingerprint,
      operationId: result.operation.id,
    });
    return this.operationSummary(
      command.workspaceId,
      stored.summary.archiveId,
      result.operation,
      result.resumed,
    );
  }

  async getImportOperation(workspaceId: string, operationId: string) {
    const operation = this.operations.get(operationId);
    if (!operation) return undefined;
    const plan = this.plans.get(scoped(workspaceId, operation.planId));
    return plan
      ? this.operationSummary(
          workspaceId,
          plan.summary.archiveId,
          operation,
          true,
        )
      : undefined;
  }

  private operationSummary(
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
}

class MemoryImportOperations implements ArchiveImportOperationStore {
  private readonly byPlan = new Map<string, ArchiveImportOperation>();
  private readonly byId = new Map<string, ArchiveImportOperation>();

  async begin(input: {
    planId: string;
    archiveExportId: string;
    requestedBy: string;
    at: string;
  }) {
    const found = this.byPlan.get(input.planId);
    if (found) return found;
    const operation: ArchiveImportOperation = {
      id: randomUUID(),
      planId: input.planId,
      archiveExportId: input.archiveExportId,
      requestedBy: input.requestedBy,
      checkpoint: "authorised",
      createdAt: input.at,
      updatedAt: input.at,
    };
    this.byPlan.set(input.planId, operation);
    this.byId.set(operation.id, operation);
    return operation;
  }

  async advance(input: {
    operationId: string;
    planId: string;
    expected: ArchiveImportOperation["checkpoint"];
    next: ArchiveImportOperation["checkpoint"];
    at: string;
  }) {
    const current = this.byId.get(input.operationId);
    if (!current || current.planId !== input.planId)
      throw new Error("Import operation was not found.");
    if (current.checkpoint !== input.expected) return current;
    const next: ArchiveImportOperation = {
      ...current,
      checkpoint: input.next,
      updatedAt: input.at,
      ...(input.next === "completed" ? { completedAt: input.at } : {}),
    };
    this.byPlan.set(next.planId, next);
    this.byId.set(next.id, next);
    return next;
  }

  get(id: string) {
    return this.byId.get(id);
  }
}

class MemoryImportTarget implements ArchiveImportExecutionTarget {
  private readonly staged = new Map<string, Map<string, Uint8Array>>();
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly records = new Map<
    string,
    Map<string, Readonly<Record<string, unknown>>>
  >();
  private readonly audited = new Set<string>();

  inventory() {
    return Object.fromEntries(
      [...this.records].map(([kind, values]) => [
        kind,
        Object.fromEntries(values),
      ]),
    );
  }
  blobDigests() {
    return [...this.blobs.keys()];
  }
  async revalidate(_plan: ArchiveImportPlan): Promise<readonly ArchiveIssue[]> {
    return [];
  }
  async stageBlob(input: {
    operationId: string;
    sha256: string;
    bytes: Uint8Array;
  }) {
    const values = this.staged.get(input.operationId) ?? new Map();
    values.set(input.sha256, input.bytes.slice());
    this.staged.set(input.operationId, values);
  }
  async verifyStagedBlob(input: {
    operationId: string;
    sha256: string;
    byteLength: number;
  }) {
    const bytes = this.staged.get(input.operationId)?.get(input.sha256);
    return (
      bytes?.byteLength === input.byteLength && sha256(bytes) === input.sha256
    );
  }
  async commitBlob(input: { operationId: string; sha256: string }) {
    const bytes = this.staged.get(input.operationId)?.get(input.sha256);
    if (!bytes) throw new Error("Staged blob was not found.");
    this.blobs.set(input.sha256, bytes);
  }
  async commitMetadata(input: {
    operationId: string;
    plan: ArchiveImportPlan;
    actions: readonly ArchiveImportAction[];
  }) {
    for (const action of input.actions) {
      if (!action.record) continue;
      const values = this.records.get(action.kind) ?? new Map();
      values.set(action.targetId, action.record);
      this.records.set(action.kind, values);
    }
  }
  async appendAudit(input: { operationId: string }) {
    this.audited.add(input.operationId);
  }
}

function fixtureExportSource(
  workspaceId: string,
  requestedDatasetIds: readonly string[],
  actor: AuthenticatedActor,
): ArchiveSource | undefined {
  const fixture =
    workspaceId === "workspace-demo-ivan"
      ? createIvansDiaryFixture()
      : workspaceId === "workspace-demo-wesketch"
        ? createWeSketchFixture()
        : undefined;
  if (!fixture) return undefined;
  const datasetIds = requestedDatasetIds.length
    ? requestedDatasetIds
    : [fixture.dataset.id];
  if (datasetIds.length !== 1 || datasetIds[0] !== fixture.dataset.id)
    return undefined;
  const expanded = fixture as ReturnType<typeof createWeSketchFixture>;
  return {
    exportId: `export-${workspaceId}-${fixture.dataset.id}`,
    workspaceId,
    datasetIds,
    createdAt: fixture.workspace.updatedAt,
    createdBy: actor.id,
    sourceVersion: "0.2H-candidate",
    records: {
      workspaces: archiveRecords([fixture.workspace]),
      datasets: archiveRecords([fixture.dataset]),
      resources: archiveRecords(fixture.resources),
      revisions: archiveRecords(fixture.revisions),
      relations: archiveRecords(fixture.relations),
      tombstones: archiveRecords(fixture.tombstones),
      ...(expanded.blobs ? { blobs: archiveRecords(expanded.blobs) } : {}),
      ...(expanded.revisionBlobs
        ? { "revision-blobs": archiveRecords(expanded.revisionBlobs) }
        : {}),
    },
    ...(expanded.blobContents
      ? {
          blobs: expanded.blobs.map((blob) => ({
            sha256: blob.sha256,
            byteLength: blob.byteLength,
            bytes: expanded.blobContents.find(
              (content) => content.blobObjectId === blob.id,
            )!.bytes,
          })),
        }
      : {}),
  };
}

function archiveRecords(values: readonly unknown[]): readonly ArchiveRecord[] {
  return values as readonly ArchiveRecord[];
}

function decodeBase64(value: string): Uint8Array {
  if (value.length > 12_000_000)
    throw codedError("REQUEST_TOO_LARGE", "Archive request is too large.");
  return Buffer.from(value, "base64");
}
function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}
function key(
  workspaceId: string,
  actor: AuthenticatedActor,
  idempotencyKey: string,
) {
  return `${workspaceId}:${actor.principalType ?? "user"}:${actor.id}:${idempotencyKey}`;
}
function scoped(workspaceId: string, id: string) {
  return `${workspaceId}:${id}`;
}
function idempotencyConflict() {
  return codedError(
    "IDEMPOTENCY_CONFLICT",
    "Idempotency key was already used for a different portability request.",
  );
}
function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
