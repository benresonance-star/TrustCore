/* Generated from packages/protocol/src/release01-contract.ts. Do not edit by hand. */
import type {
  AdminSession,
  ApiErrorResponse,
  ApplicationRegistration,
  AuditEventRecord,
  CompleteUploadCommand,
  ControlCentreSnapshot,
  CreateUploadCommand,
  DatasetRecord,
  DeleteResourceCommand,
  DeleteResourceResult,
  HealthResponse,
  HistorySnapshot,
  ListResponse,
  OperationSummary,
  PublicErrorCode,
  RecoverableItem,
  RegisterApplicationCommand,
  RelationRecord,
  ResourceRecord,
  RestoreResourceCommand,
  RevisionCommand,
  RevisionCommandResult,
  RevisionGraph,
  RunVerificationCommand,
  ServiceHealth,
  UploadSession,
  VerificationRunResult,
  WorkspaceSummary,
} from "@trust-core/protocol";

export type {
  AdminSession,
  ApiErrorResponse,
  ApplicationRegistration,
  AuditEventRecord,
  CompleteUploadCommand,
  ControlCentreSnapshot,
  CreateUploadCommand,
  DatasetRecord,
  DeleteResourceCommand,
  DeleteResourceResult,
  HealthResponse,
  HistorySnapshot,
  ListResponse,
  OperationSummary,
  PublicErrorCode,
  RecoverableItem,
  RegisterApplicationCommand,
  RelationRecord,
  ResourceRecord,
  RestoreResourceCommand,
  RevisionCommand,
  RevisionCommandResult,
  RevisionGraph,
  RunVerificationCommand,
  ServiceHealth,
  UploadSession,
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
