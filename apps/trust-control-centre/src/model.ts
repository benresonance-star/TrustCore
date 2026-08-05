export type Section =
  | "home"
  | "datasets"
  | "flow"
  | "health"
  | "history"
  | "portability"
  | "app-protocol"
  | "access";

export type {
  ControlCentreSnapshot,
  CreatePolicyAssignmentCommand,
  DatasetSummary,
  SystemStatus,
} from "@trust-core/protocol";
import type {
  AdminSession,
  ArchiveCandidate,
  ArchiveExportSummary,
  ControlCentreSnapshot,
  CreatePolicyAssignmentCommand,
  HistorySnapshot,
  ImportOperationSummary,
  ImportPlanSummary,
  PolicyAssignment,
  RevisionCommandResult,
  ServiceHealth,
  VerificationRunResult,
} from "@trust-core/protocol";

export interface OperationalSnapshot {
  storage: ServiceHealth;
  backup: ServiceHealth;
  latestVerification: VerificationRunResult | null;
}
export interface ArchiveBinaryDownload {
  filename: string;
  mediaType: "application/vnd.trust-core.archive+zip";
  bytes: Uint8Array;
}

export interface ControlCentreGateway {
  readonly mode: "fixture" | "live";
  readonly workspaceId: string;
  getSnapshot(): Promise<ControlCentreSnapshot>;
  getOperationalSnapshot(): Promise<OperationalSnapshot>;
  getHistory(workspaceId: string): Promise<HistorySnapshot>;
  createArchiveExport(
    workspaceId: string,
    datasetIds: readonly string[],
    reauthenticationProof: string,
  ): Promise<ArchiveExportSummary>;
  downloadArchiveExport(
    workspaceId: string,
    exportId: string,
    reauthenticationProof: string,
  ): Promise<ArchiveBinaryDownload>;
  listPolicyAssignments(
    workspaceId: string,
  ): Promise<readonly PolicyAssignment[]>;
  createPolicyAssignment(
    workspaceId: string,
    input: Omit<
      CreatePolicyAssignmentCommand,
      "workspaceId" | "idempotencyKey"
    >,
  ): Promise<PolicyAssignment>;
  revokePolicyAssignment(
    workspaceId: string,
    assignmentId: string,
  ): Promise<PolicyAssignment>;
  restoreResource(
    workspaceId: string,
    resourceId: string,
  ): Promise<RevisionCommandResult>;
  startAdminSession(token: string): Promise<AdminSession>;
  endAdminSession(): Promise<void>;
  beginFederatedLogin(returnTo?: string): void;
  runVerification(
    workspaceId: string,
    level: "metadata" | "full_blob",
  ): Promise<VerificationRunResult>;
  uploadArchive(
    workspaceId: string,
    bytes: Uint8Array,
  ): Promise<ArchiveCandidate>;
  createImportPlan(
    workspaceId: string,
    archiveId: string,
    mode: "preserve_ids" | "mapped_workspace",
  ): Promise<ImportPlanSummary>;
  executeImportPlan(
    workspaceId: string,
    planId: string,
    reauthenticationProof: string,
  ): Promise<ImportOperationSummary>;
  getImportOperation(
    workspaceId: string,
    operationId: string,
  ): Promise<ImportOperationSummary>;
}
