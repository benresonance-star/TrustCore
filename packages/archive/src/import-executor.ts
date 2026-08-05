import { sha256 } from "./canonical.js";
import { calculateArchiveImportPlanId } from "./import-plan.js";
import { blobArchivePath } from "./paths.js";
import {
  archiveImportCheckpoints,
  type ArchiveImportCheckpoint,
  type ArchiveImportExecutionResult,
  type ArchiveImportOperation,
  type ArchiveImportOperationStore,
  type ArchiveImportPlan,
  type ArchiveImportExecutionTarget,
  type ParsedTrustArchive,
} from "./types.js";

export type ImportEffectHook = (
  checkpoint: ArchiveImportCheckpoint,
  operation: ArchiveImportOperation,
) => void | Promise<void>;

export class ArchiveImportExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ArchiveImportExecutionError";
  }
}

export class ArchiveImportExecutor {
  constructor(
    private readonly operations: ArchiveImportOperationStore,
    private readonly target: ArchiveImportExecutionTarget,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly afterCheckpoint?: ImportEffectHook,
  ) {}

  async execute(input: {
    archive: ParsedTrustArchive;
    plan: ArchiveImportPlan;
    requestedBy: string;
  }): Promise<ArchiveImportExecutionResult> {
    validateInput(input.archive, input.plan);
    let operation = await this.operations.begin({
      planId: input.plan.planId,
      archiveExportId: input.archive.manifest.exportId,
      requestedBy: input.requestedBy,
      at: this.now(),
    });
    const resumed = operation.checkpoint !== "authorised";
    if (operation.checkpoint === "authorised")
      await this.afterCheckpoint?.("authorised", operation);
    while (operation.checkpoint !== "completed") {
      switch (operation.checkpoint) {
        case "authorised": {
          const issues = await this.target.revalidate(input.plan);
          if (issues.length > 0)
            throw new ArchiveImportExecutionError(
              "IMPORT_TARGET_STALE",
              "Import target changed after the plan was created.",
            );
          operation = await this.advance(operation, "target_revalidated");
          break;
        }
        case "target_revalidated":
          await this.stageBlobs(operation.id, input.archive, input.plan);
          operation = await this.advance(operation, "temporary_blobs_staged");
          break;
        case "temporary_blobs_staged":
          await this.verifyStaged(operation.id, input.archive, input.plan);
          operation = await this.advance(operation, "staged_blobs_verified");
          break;
        case "staged_blobs_verified":
          await this.commitBlobs(operation.id, input.plan);
          operation = await this.advance(
            operation,
            "immutable_blobs_committed",
          );
          break;
        case "immutable_blobs_committed":
          await this.target.commitMetadata({
            operationId: operation.id,
            plan: input.plan,
            actions: input.plan.actions.filter(
              (action) =>
                action.kind !== "blob-bytes" && action.disposition === "insert",
            ),
          });
          operation = await this.advance(operation, "metadata_committed");
          break;
        case "metadata_committed":
          await this.target.appendAudit({
            operationId: operation.id,
            plan: input.plan,
            requestedBy: input.requestedBy,
            at: this.now(),
            sourceAuditLineage: input.archive.manifest.auditLineage,
          });
          operation = await this.advance(operation, "audit_committed");
          break;
        case "audit_committed":
          operation = await this.advance(operation, "completed");
          break;
        default:
          throw new ArchiveImportExecutionError(
            "IMPORT_CHECKPOINT_INVALID",
            "Import operation checkpoint is invalid.",
          );
      }
    }
    return {
      operation,
      resumed,
      insertedRecords: input.plan.actions.filter(
        (action) =>
          action.kind !== "blob-bytes" && action.disposition === "insert",
      ).length,
      insertedBlobs: input.plan.actions.filter(
        (action) =>
          action.kind === "blob-bytes" && action.disposition === "insert",
      ).length,
    };
  }

  private async stageBlobs(
    operationId: string,
    archive: ParsedTrustArchive,
    plan: ArchiveImportPlan,
  ): Promise<void> {
    for (const action of blobActions(plan)) {
      const bytes = archive.entries.get(blobArchivePath(action.sourceId));
      if (!bytes)
        throw new ArchiveImportExecutionError(
          "IMPORT_BLOB_MISSING",
          "Verified archive blob bytes are missing.",
        );
      if (sha256(bytes) !== action.sourceId)
        throw new ArchiveImportExecutionError(
          "IMPORT_BLOB_HASH_MISMATCH",
          "Archive blob changed after planning.",
        );
      await this.target.stageBlob({
        operationId,
        sha256: action.sourceId,
        bytes,
      });
    }
  }

  private async verifyStaged(
    operationId: string,
    archive: ParsedTrustArchive,
    plan: ArchiveImportPlan,
  ): Promise<void> {
    for (const action of blobActions(plan)) {
      const byteLength = archive.entries.get(
        blobArchivePath(action.sourceId),
      )?.byteLength;
      if (
        byteLength === undefined ||
        !(await this.target.verifyStagedBlob({
          operationId,
          sha256: action.sourceId,
          byteLength,
        }))
      )
        throw new ArchiveImportExecutionError(
          "IMPORT_STAGED_BLOB_INVALID",
          "Staged blob verification failed.",
        );
    }
  }

  private async commitBlobs(
    operationId: string,
    plan: ArchiveImportPlan,
  ): Promise<void> {
    for (const action of blobActions(plan))
      await this.target.commitBlob({
        operationId,
        sha256: action.sourceId,
      });
  }

  private async advance(
    operation: ArchiveImportOperation,
    next: ArchiveImportCheckpoint,
  ): Promise<ArchiveImportOperation> {
    const advanced = await this.operations.advance({
      operationId: operation.id,
      planId: operation.planId,
      expected: operation.checkpoint,
      next,
      at: this.now(),
    });
    await this.afterCheckpoint?.(next, advanced);
    return advanced;
  }
}

function validateInput(
  archive: ParsedTrustArchive,
  plan: ArchiveImportPlan,
): void {
  if (!archive.verification.valid)
    throw new ArchiveImportExecutionError(
      "IMPORT_ARCHIVE_INVALID",
      "Archive verification must pass before execution.",
    );
  if (plan.status !== "ready" || plan.counts.blocked > 0)
    throw new ArchiveImportExecutionError(
      "IMPORT_PLAN_NOT_EXECUTABLE",
      "Only a ready reject-on-error plan can execute.",
    );
  if (
    plan.archiveExportId !== archive.manifest.exportId ||
    plan.sourceWorkspaceId !== archive.manifest.workspaceId
  )
    throw new ArchiveImportExecutionError(
      "IMPORT_PLAN_ARCHIVE_MISMATCH",
      "Import plan does not describe this archive.",
    );
  const expectedPlanId = calculateArchiveImportPlanId({
    manifest: archive.manifest,
    sourceWorkspaceId: plan.sourceWorkspaceId,
    targetWorkspaceId: plan.targetWorkspaceId,
    mode: plan.mode,
    conflictMode: plan.conflictMode,
    actions: plan.actions,
  });
  if (plan.planId !== expectedPlanId)
    throw new ArchiveImportExecutionError(
      "IMPORT_PLAN_ID_INVALID",
      "Import plan content does not match its identity.",
    );
}

function blobActions(plan: ArchiveImportPlan) {
  return plan.actions.filter(
    (action) => action.kind === "blob-bytes" && action.disposition === "insert",
  );
}

export function nextImportCheckpoint(
  value: ArchiveImportCheckpoint,
): ArchiveImportCheckpoint | undefined {
  const index = archiveImportCheckpoints.indexOf(value);
  return archiveImportCheckpoints[index + 1];
}
