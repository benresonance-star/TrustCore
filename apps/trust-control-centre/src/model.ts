export type Section =
  | "home"
  | "datasets"
  | "flow"
  | "health"
  | "history"
  | "portability"
  | "access";

export type {
  ControlCentreSnapshot,
  DatasetSummary,
  SystemStatus,
} from "@trust-core/protocol";
import type {
  AdminSession,
  ArchiveCandidate,
  ControlCentreSnapshot,
  HistorySnapshot,
  ImportOperationSummary,
  ImportPlanSummary,
  RevisionCommandResult,
  ServiceHealth,
  VerificationRunResult,
} from "@trust-core/protocol";

export interface OperationalSnapshot {
  storage: ServiceHealth;
  backup: ServiceHealth;
  latestVerification: VerificationRunResult | null;
}

export interface ControlCentreGateway {
  readonly mode: "fixture" | "live";
  readonly workspaceId: string;
  getSnapshot(): Promise<ControlCentreSnapshot>;
  getOperationalSnapshot(): Promise<OperationalSnapshot>;
  getHistory(workspaceId: string): Promise<HistorySnapshot>;
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
