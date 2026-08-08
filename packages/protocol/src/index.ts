import type { PublicErrorCode } from "./release01-contract.js";

export type DatasetKind = "foundation" | "personal" | "creative" | "shared";
export type DatasetHealth = "unknown" | "review" | "verified" | "degraded";

export interface DatasetSummary {
  id: string;
  name: string;
  description: string;
  kind: DatasetKind;
  canonicalStore: string;
  schema: string;
  objects: string;
  storage: string;
  lastVerified: string;
  health: DatasetHealth;
  recovery: string;
  deleted: string;
  recentEvents: readonly string[];
}

export interface SystemStatus {
  protectedDatasets: number;
  activeProjects: number;
  latestVerifiedBackup: string;
  recoveryAttention: number;
  canonicalIntegrityPercent: number | null;
  canonicalIntegrityStatus: DatasetHealth;
  syncQueue: number;
}

export interface ControlCentreSnapshot {
  status: SystemStatus;
  datasets: readonly DatasetSummary[];
}

export interface HealthResponse {
  service: "trust-api";
  status: "ok" | "degraded";
  mode: "fixture" | "live";
  checkedAt: string;
}

export const verificationLevels = [
  "metadata",
  "full_blob",
  "resource",
  "dataset",
  "workspace",
] as const;
export type VerificationLevel = (typeof verificationLevels)[number];
export type VerificationScopeKind =
  "blob" | "resource" | "dataset" | "workspace";

export const operationStates = [
  "requested",
  "authorised",
  "temporary_upload_created",
  "bytes_received",
  "hash_verified",
  "immutable_object_committed",
  "metadata_committed",
  "audit_committed",
  "completed",
  "rejected",
  "failed_retryable",
  "failed_terminal",
  "quarantined",
] as const;
export type OperationState = (typeof operationStates)[number];
export type OperationStatus =
  "pending" | "running" | "succeeded" | "failed" | "quarantined";

export {
  publicErrorCodes,
  release01OpenApi,
  release01Routes,
  release01Schemas,
} from "./release01-contract.js";
export type {
  PublicErrorCode,
  Release01Method,
  RouteContract,
} from "./release01-contract.js";
export interface ApiErrorResponse {
  code: PublicErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
  requestId?: string;
}

export interface ListResponse<T> {
  items: readonly T[];
  nextCursor?: string;
}

export type TrustAction =
  | "workspace:read"
  | "workspace:manage"
  | "control:read"
  | "dataset:read"
  | "resource:read"
  | "revision:create"
  | "resource:delete"
  | "resource:restore"
  | "object:ingest"
  | "blob:read"
  | "relation:read"
  | "history:read"
  | "audit:read"
  | "verification:run"
  | "retention:manage"
  | "access:manage"
  | "health:read"
  | "storage:probe_ingest"
  | "storage:manage"
  | "portability:read"
  | "portability:export"
  | "portability:plan"
  | "portability:execute";
export interface AuthenticatedActor {
  id: string;
  displayName: string;
  principalType?: "user" | "service" | "application";
  roles: readonly (
    "owner" | "admin" | "editor" | "recovery_operator" | "auditor"
  )[];
  workspaceIds: readonly string[];
}
export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "closed";
  createdAt: string;
  updatedAt: string;
}
export interface ApplicationRegistration {
  id: string;
  workspaceId: string;
  namespace: string;
  name: string;
  applicationVersion: string;
  schemaPackageIds: readonly string[];
  capabilities: readonly string[];
  status: "active" | "suspended" | "revoked";
  createdAt: string;
  updatedAt: string;
}

/** App-domain tenant (e.g. Foundation Tenant ID) — not a Trust Workspace. */
export interface ApplicationTenant {
  id: string;
  workspaceId: string;
  applicationId: string;
  externalTenantKey: string;
  displayName: string;
  status: "active" | "suspended" | "closed";
  createdAt: string;
  updatedAt: string;
}

export type StorageBindingTier = "managed" | "byob" | "premium";
export type StorageBindingCredentialMode =
  | "platform_iam"
  | "cross_account_role"
  | "static_keys_ref"
  | "missing";
export type StorageBindingStatus =
  | "draft"
  | "awaiting_customer_role"
  | "configured"
  | "connected"
  | "needs_attention"
  | "disabled"
  | "migrating";
export type StoragePlanSyncState =
  | "synced"
  | "drift_detected"
  | "upgrade_recognised"
  | "unknown"
  | "over_capacity";
export type StorageCostPosture =
  | "customer_billed_byob"
  | "platform_managed"
  | "unknown";
export type StorageInheritedFrom = "platform" | "app" | "none";

export interface StorageProfileSummary {
  id: string;
  provider: StorageProviderName;
  region: string;
  bucket: string;
  prefix: string;
  tier: StorageBindingTier;
  credentialMode: StorageBindingCredentialMode;
  expectedBucketOwner: string | null;
  endpointHost: string | null;
  roleArn: string | null;
  declaredPlanCode: string | null;
  declaredCapacityBytes: number | null;
}

export interface StorageBindingSummary {
  id: string;
  workspaceId: string;
  applicationId: string;
  applicationTenantId: string | null;
  profile: StorageProfileSummary;
  status: StorageBindingStatus;
  generation: number;
  lastProbeOk: boolean | null;
  lastProbeAt: string | null;
  lastProbeSummary: string | null;
  lastIssueClass: StorageIssueClass | null;
  planSyncState: StoragePlanSyncState;
  observedUsageBytes: number | null;
  observedQuotaBytes: number | null;
  observedAt: string | null;
  disabled: boolean;
  costPosture: StorageCostPosture;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveStorageSummary {
  scope: "platform" | "app" | "tenant";
  status: StorageBindingStatus | "not_configured";
  inheritedFrom: StorageInheritedFrom;
  binding: StorageBindingSummary | null;
  provider: StorageProviderName | null;
  tier: StorageBindingTier | null;
  region: string | null;
  bucket: string | null;
  prefix: string | null;
  credentialMode: StorageBindingCredentialMode | null;
  usage: {
    cataloguedObjects: number;
    failedVerificationObjects: number;
  };
  costPosture: StorageCostPosture;
  planSyncState: StoragePlanSyncState;
  declaredCapacityBytes: number | null;
  observedUsageBytes: number | null;
  observedQuotaBytes: number | null;
}

export interface StorageBindingRollup {
  platformStatus: "healthy" | "degraded" | "not_configured";
  platformSummary: string;
  applications: readonly {
    applicationId: string;
    applicationName: string;
    connected: number;
    attention: number;
    configured: number;
    notSetUp: number;
    topIssues: readonly {
      applicationTenantId: string | null;
      externalTenantKey: string | null;
      issueClass: string | null;
      summary: string;
    }[];
  }[];
  attentionTotal: number;
}

export interface CreateApplicationTenantCommand {
  workspaceId: string;
  applicationId: string;
  externalTenantKey: string;
  displayName: string;
  idempotencyKey: string;
}

export interface UpsertStorageBindingCommand {
  workspaceId: string;
  applicationId: string;
  applicationTenantId?: string | null;
  provider: StorageProviderName;
  region: string;
  bucket: string;
  prefix?: string;
  tier: StorageBindingTier;
  credentialMode: StorageBindingCredentialMode;
  expectedBucketOwner?: string | null;
  endpointHost?: string | null;
  roleArn?: string | null;
  declaredPlanCode?: string | null;
  declaredCapacityBytes?: number | null;
  idempotencyKey: string;
}

export interface ProbeStorageBindingCommand {
  workspaceId: string;
  bindingId: string;
  tier?: StorageProbeTier;
}

export interface RefreshStoragePlanCommand {
  workspaceId: string;
  bindingId: string;
  /** Synthetic observation for tests/fixtures; ignored unless TRUST allows. */
  observedQuotaBytes?: number;
  observedUsageBytes?: number;
}

export interface AcceptStoragePlanCommand {
  workspaceId: string;
  bindingId: string;
  declaredCapacityBytes: number;
  planCode?: string;
}

export interface CutoverStorageMigrateCommand {
  workspaceId: string;
  sourceBindingId: string;
  targetBindingId: string;
  /** Digest proofs for each object being cut over (S9). */
  objectDigests: readonly { objectId: string; sha256: string }[];
  idempotencyKey: string;
}

export interface PolicyAssignment {
  id: string;
  workspaceId: string;
  principalType: "user" | "service" | "application";
  principalId: string;
  role: string;
  scopeKind: "workspace" | "dataset" | "application";
  scopeId: string;
  createdBy: string;
  createdAt: string;
  revokedAt?: string;
}
export interface CreatePolicyAssignmentCommand {
  workspaceId: string;
  principalType: PolicyAssignment["principalType"];
  principalId: string;
  role: "owner" | "admin" | "editor" | "recovery_operator" | "auditor";
  scopeKind: PolicyAssignment["scopeKind"];
  scopeId: string;
  idempotencyKey: string;
}
export interface RevokePolicyAssignmentCommand {
  workspaceId: string;
  idempotencyKey: string;
}
export interface BreakGlassGrant {
  id: string;
  workspaceId: string;
  principalId: string;
  reason: string;
  actions: readonly string[];
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string;
}
export interface DatasetRecord {
  id: string;
  workspaceId: string;
  schemaPackageId: string;
  datasetType: string;
  name: string;
  status: "active" | "archived" | "deleted_logically" | "legal_hold";
  retentionPolicyId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RetentionPolicyRecord {
  id: string;
  workspaceId: string;
  name: string;
  recoveryWindowDays: number;
  minimumHistoryDays: number;
  backupRetentionDays: number;
  purgeEnabled: false;
  extensions: Readonly<Record<string, unknown>>;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface CreateRetentionPolicyCommand {
  workspaceId: string;
  name: string;
  recoveryWindowDays: number;
  minimumHistoryDays: number;
  backupRetentionDays: number;
  purgeEnabled: false;
  idempotencyKey: string;
  extensions?: Readonly<Record<string, unknown>>;
}
export interface UpdateRetentionPolicyCommand extends CreateRetentionPolicyCommand {
  expectedUpdatedAt: string;
}
export interface ResourceRecord {
  id: string;
  workspaceId: string;
  datasetId: string;
  resourceType: string;
  title: string | null;
  status: "active" | "archived" | "deleted_logically" | "legal_hold";
  currentRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RevisionRecord {
  id: string;
  workspaceId: string;
  datasetId: string;
  resourceId: string;
  revisionNumber: number;
  parentRevisionId: string | null;
  mergeParentRevisionIds: readonly string[];
  schemaPackageId: string;
  schemaVersion: string;
  canonicalPayload: Readonly<Record<string, unknown>>;
  canonicalPayloadHash: string;
  createdBy: string;
  source: "user" | "application" | "import" | "restore" | "merge";
  changeNote: string | null;
  restoredFromRevisionId: string | null;
  createdAt: string;
}
export interface RevisionGraph {
  resourceId: string;
  headRevisionId: string | null;
  revisions: readonly RevisionRecord[];
}
export interface RelationRecord {
  id: string;
  workspaceId: string;
  datasetId: string;
  sourceKind: "resource" | "revision" | "blob" | "external";
  sourceId: string;
  targetKind: "resource" | "revision" | "blob" | "external";
  targetId: string;
  relationType: string;
  metadata: Readonly<Record<string, unknown>>;
  createdBy: string;
  createdAt: string;
  endedAt: string | null;
}
export interface UploadSession {
  id: string;
  workspaceId: string;
  operationId: string;
  state: OperationState;
  status: OperationStatus;
  mediaType: string;
  expectedByteLength: number;
  expectedSha256: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  blobId: string | null;
}

export const uploadScanStates = [
  "pending_upload",
  "uploaded",
  "scan_queued",
  "scanning",
  "accepted",
  "rejected",
  "manual_review",
  "promotion_pending",
  "promoted",
  "failed",
] as const;
export type UploadScanState = (typeof uploadScanStates)[number];

export const uploadScanOutcomes = [
  "clean",
  "malicious",
  "suspicious",
  "unsupported",
  "error",
  "timeout",
] as const;
export type UploadScanOutcome = (typeof uploadScanOutcomes)[number];

export interface UploadScanStatus {
  uploadId: string;
  workspaceId: string;
  state: UploadScanState;
  outcome?: UploadScanOutcome;
  updatedAt: string;
}
export interface OperationSummary {
  id: string;
  workspaceId: string;
  type: string;
  state: OperationState;
  status: OperationStatus;
  requestedBy: string;
  retryCount: number;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
export interface AuditEventRecord {
  id: string;
  workspaceId: string;
  datasetId: string | null;
  actorType: "user" | "service" | "application" | "system";
  actorId: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  occurredAt: string;
  requestId: string;
  correlationId: string;
  operationId: string | null;
  eventHash: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface ArchiveCandidate {
  id: string;
  workspaceId: string;
  exportId: string;
  status: "verified" | "rejected";
  checkedEntries: number;
  issueCount: number;
  recordCounts: Readonly<Record<string, number>>;
  blobCount: number;
  totalBlobBytes: number;
  createdAt: string;
}
export interface CreateArchiveExportCommand {
  workspaceId: string;
  datasetIds: readonly string[];
  idempotencyKey: string;
}
export interface ArchiveExportSummary {
  id: string;
  workspaceId: string;
  datasetIds: readonly string[];
  status: "ready";
  sha256: string;
  byteLength: number;
  createdAt: string;
}
export interface ArchiveDownload extends ArchiveExportSummary {
  mediaType: "application/vnd.trust-core.archive+zip";
  filename: string;
  archiveBase64: string;
}
export interface UploadArchiveCommand {
  workspaceId: string;
  idempotencyKey: string;
  archiveBase64: string;
}
export interface CreateImportPlanCommand {
  workspaceId: string;
  archiveId: string;
  idempotencyKey: string;
  mode: "preserve_ids" | "mapped_workspace";
  conflictMode: "reject_on_error" | "report_only";
}
export interface ImportPlanSummary {
  id: string;
  archiveId: string;
  workspaceId: string;
  sourceWorkspaceId: string;
  mode: "preserve_ids" | "mapped_workspace";
  conflictMode: "reject_on_error" | "report_only";
  status: "ready" | "rejected" | "report_only";
  issueCount: number;
  counts: Readonly<Record<"insert" | "alreadyPresent" | "blocked", number>>;
  createdAt: string;
}
export interface ExecuteImportCommand {
  workspaceId: string;
  idempotencyKey: string;
  confirmation: "IMPORT";
}
export interface ImportOperationSummary {
  id: string;
  workspaceId: string;
  planId: string;
  archiveId: string;
  checkpoint:
    | "authorised"
    | "target_revalidated"
    | "temporary_blobs_staged"
    | "staged_blobs_verified"
    | "immutable_blobs_committed"
    | "metadata_committed"
    | "audit_committed"
    | "completed";
  status: "running" | "completed";
  resumed: boolean;
  updatedAt: string;
  completedAt: string | null;
}
export interface ServiceHealth {
  status: "healthy" | "degraded" | "not_configured";
  checkedAt: string;
  summary: string;
  details: Readonly<Record<string, unknown>>;
}

/** Canonical object-store provider names for health/diagnostics. */
export type StorageProviderName = "minio" | "s3";

export type StorageCredentialMode =
  | "iam_role"
  | "static_keys_configured"
  | "missing";

export type StorageIssueClass =
  | "not_configured"
  | "auth"
  | "permission"
  | "not_found"
  | "wrong_region"
  | "network"
  | "provider_outage"
  | "internal";

/** Tier A = connectivity; Tier B = temp put+delete ingest path. */
export type StorageProbeTier = "connectivity" | "ingest";

export interface StorageConsoleLink {
  id: string;
  label: string;
  url: string;
}

export interface StorageProbeResult {
  probeId: string;
  tier: StorageProbeTier;
  ok: boolean;
  latencyMs: number;
  issueClass: StorageIssueClass | null;
  issueCode: string | null;
  checkedAt: string;
  summary: string;
  billingHint?: string;
  /** Region reported by HeadBucket (`x-amz-bucket-region`), when available. */
  bucketRegion?: string | null;
  /** False when configured region disagrees with HeadBucket. */
  regionMatch?: boolean | null;
}

/** Typed storage health details embedded in ServiceHealth.details. */
export interface StorageHealthDetails {
  provider: StorageProviderName;
  region: string;
  bucket: string;
  credentialMode: StorageCredentialMode;
  endpointHost: string | null;
  transferSignerConfigured: boolean;
  objectStorageConfigured: boolean;
  cataloguedObjects: number;
  failedVerificationObjects: number;
  consoleLinks: readonly StorageConsoleLink[];
  probe: StorageProbeResult | null;
  /** Minimal IAM actions for Connect checklist (documentation only). */
  minimalIamActions?: readonly string[];
  /** True only when TRUST_SCANNER=fake (or a future vendor) is active. */
  scannerConfigured?: boolean;
}

export interface ProbeStorageCommand {
  workspaceId: string;
  tier?: StorageProbeTier;
}
export interface RegisterApplicationCommand {
  workspaceId: string;
  namespace: string;
  name: string;
  applicationVersion: string;
  schemaPackageIds: readonly string[];
  capabilities: readonly string[];
  idempotencyKey: string;
}
export interface CreateUploadCommand {
  workspaceId: string;
  idempotencyKey: string;
  mediaType: string;
  expectedByteLength: number;
  expectedSha256: string;
  expiresInSeconds?: number;
}
export interface CompleteUploadCommand {
  workspaceId: string;
  bytesBase64: string;
}
export interface CreateDownloadGrantCommand {
  workspaceId: string;
  objectId: string;
  requestedTtlSeconds: number;
  fileName?: string;
  idempotencyKey: string;
}
export interface DownloadGrant {
  grantId: string;
  objectId: string;
  workspaceId: string;
  expiresAt: string;
  transfer: {
    method: "GET";
    url: string;
    headers: Readonly<Record<string, string>>;
  };
}
export interface RevisionCommand {
  workspaceId: string;
  expectedRevisionId: string | null;
  schemaPackageId: string;
  schemaVersion: string;
  canonicalPayload: Readonly<Record<string, unknown>>;
  changeNote?: string;
}
export interface DeleteResourceCommand {
  workspaceId: string;
  expectedRevisionId: string | null;
  recoverUntil: string | null;
  reason?: string;
}
export interface RestoreResourceCommand {
  workspaceId: string;
  changeNote?: string;
}
export interface RevisionCommandResult {
  resourceId: string;
  revisionId: string;
  revisionNumber: number;
  source: "user" | "application" | "import" | "restore" | "merge";
  createdAt: string;
}
export interface DeleteResourceResult {
  resourceId: string;
  tombstoneId: string;
  deletedAt: string;
  recoverUntil: string | null;
}
export interface RecoverableItem {
  tombstoneId: string;
  workspaceId: string;
  datasetId: string;
  resourceId: string;
  resourceTitle: string | null;
  resourceType: string;
  deletedAt: string;
  recoverUntil: string | null;
  deletedBy: string;
  priorRevisionId: string | null;
}
export interface TrustEventSummary {
  id: string;
  action: string;
  subjectId: string;
  actorId: string;
  occurredAt: string;
  metadata: Readonly<Record<string, unknown>>;
}
export interface HistorySnapshot {
  recoverable: readonly RecoverableItem[];
  events: readonly TrustEventSummary[];
}
export interface AdminSession {
  actor: AuthenticatedActor;
  csrfToken: string;
  expiresAt: string;
}
export interface VerificationScope {
  kind: VerificationScopeKind;
  id: string;
}
export interface RunVerificationCommand {
  workspaceId: string;
  level: VerificationLevel;
  scope?: VerificationScope;
}
export interface VerificationIssueSummary {
  code: string;
  severity: "warning" | "error" | "critical";
  subjectKind:
    | "blob"
    | "resource"
    | "revision"
    | "relation"
    | "dataset"
    | "workspace"
    | "policy"
    | "operation"
    | "storage";
  subjectId: string;
  message: string;
  expected?: string | number;
  actual?: string | number | null;
}
export interface VerificationRunResult {
  id: string;
  workspaceId: string;
  level: VerificationLevel;
  scope: VerificationScope;
  status: "running" | "passed" | "failed" | "degraded";
  startedAt: string;
  completedAt: string | null;
  objectsChecked: number;
  bytesRead: number;
  issues: readonly VerificationIssueSummary[];
}
