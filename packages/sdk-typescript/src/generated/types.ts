/* Generated from packages/protocol/src/release01-contract.ts. Do not edit by hand. */
import type {
  AdminSession,
  ApiErrorResponse,
  ApplicationRegistration,
  ArchiveCandidate,
  ArchiveDownload,
  ArchiveExportSummary,
  AuditEventRecord,
  CompleteUploadCommand,
  ControlCentreSnapshot,
  CreatePolicyAssignmentCommand,
  CreateUploadCommand,
  CreateArchiveExportCommand,
  CreateImportPlanCommand,
  CreateRetentionPolicyCommand,
  DatasetRecord,
  DeleteResourceCommand,
  DeleteResourceResult,
  HealthResponse,
  HistorySnapshot,
  ImportOperationSummary,
  ImportPlanSummary,
  ListResponse,
  OperationSummary,
  PublicErrorCode,
  PolicyAssignment,
  RecoverableItem,
  RegisterApplicationCommand,
  RelationRecord,
  RetentionPolicyRecord,
  ResourceRecord,
  RestoreResourceCommand,
  RevokePolicyAssignmentCommand,
  RevisionCommand,
  RevisionCommandResult,
  RevisionGraph,
  RunVerificationCommand,
  ExecuteImportCommand,
  ServiceHealth,
  UploadSession,
  UploadScanStatus,
  UploadArchiveCommand,
  UpdateRetentionPolicyCommand,
  VerificationRunResult,
  WorkspaceSummary,
} from "@trust-core/protocol";

export type {
  AdminSession,
  ApiErrorResponse,
  ApplicationRegistration,
  ArchiveCandidate,
  ArchiveDownload,
  ArchiveExportSummary,
  AuditEventRecord,
  CompleteUploadCommand,
  ControlCentreSnapshot,
  CreatePolicyAssignmentCommand,
  CreateUploadCommand,
  CreateArchiveExportCommand,
  CreateImportPlanCommand,
  CreateRetentionPolicyCommand,
  DatasetRecord,
  DeleteResourceCommand,
  DeleteResourceResult,
  HealthResponse,
  HistorySnapshot,
  ImportOperationSummary,
  ImportPlanSummary,
  ListResponse,
  OperationSummary,
  PublicErrorCode,
  PolicyAssignment,
  RecoverableItem,
  RegisterApplicationCommand,
  RelationRecord,
  RetentionPolicyRecord,
  ResourceRecord,
  RestoreResourceCommand,
  RevokePolicyAssignmentCommand,
  RevisionCommand,
  RevisionCommandResult,
  RevisionGraph,
  RunVerificationCommand,
  ExecuteImportCommand,
  ServiceHealth,
  UploadSession,
  UploadScanStatus,
  UploadArchiveCommand,
  UpdateRetentionPolicyCommand,
  VerificationRunResult,
  WorkspaceSummary,
};

export interface SchemaPackage {
  id: string;
  key: string;
  digest: string;
  status: string;
  publishedAt: string;
  manifest: Readonly<Record<string, unknown>>;
  governance?: {
    protocolVersion: string;
    applicationNamespace: string;
    applicationVersion: string;
    approvedBy: string;
    approvalId: string;
    idempotencyKey: string;
  };
  compatibility?: {
    classification: "initial" | "backward-compatible" | "breaking";
    previousKey: string | null;
    changes: readonly Readonly<Record<string, unknown>>[];
  };
}

export interface ObjectIngestCommand {
  workspaceId: string;
  idempotencyKey: string;
  mediaType: string;
  bytesBase64: string;
}

export interface ObjectIngestResult {
  operationId: string;
  blob: Readonly<Record<string, unknown>>;
  deduplicated: boolean;
  resumed: boolean;
}

export type {
  ApplicationTenant,
  EffectiveStorageSummary,
  StorageBindingRollup,
  StorageBindingSummary,
  CreateApplicationTenantCommand,
  UpdateApplicationTenantCommand,
  SuspendApplicationTenantCommand,
  CloseApplicationTenantCommand,
  UpsertStorageBindingCommand,
  ProbeStorageBindingCommand,
  RefreshStoragePlanCommand,
  AcceptStoragePlanCommand,
  CutoverStorageMigrateCommand,
} from "@trust-core/protocol";
