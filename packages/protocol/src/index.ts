export type DatasetKind = "foundation" | "personal" | "creative" | "shared";
export type DatasetHealth = "verified" | "review";

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
  canonicalIntegrityPercent: number;
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

export type TrustAction = "control:read" | "history:read" | "revision:create" | "resource:delete" | "resource:restore" | "verification:run";
export interface AuthenticatedActor { id: string; displayName: string; roles: readonly ("owner" | "admin" | "editor" | "recovery_operator" | "auditor")[]; workspaceIds: readonly string[]; }
export interface RevisionCommand { workspaceId: string; expectedRevisionId: string | null; schemaPackageId: string; schemaVersion: string; canonicalPayload: Readonly<Record<string, unknown>>; changeNote?: string; }
export interface DeleteResourceCommand { workspaceId: string; expectedRevisionId: string | null; recoverUntil: string | null; reason?: string; }
export interface RestoreResourceCommand { workspaceId: string; changeNote?: string; }
export interface RevisionCommandResult { resourceId: string; revisionId: string; revisionNumber: number; source: "user" | "application" | "import" | "restore" | "merge"; createdAt: string; }
export interface DeleteResourceResult { resourceId: string; tombstoneId: string; deletedAt: string; recoverUntil: string | null; }
export interface RecoverableItem { tombstoneId: string; workspaceId: string; datasetId: string; resourceId: string; resourceTitle: string | null; resourceType: string; deletedAt: string; recoverUntil: string | null; deletedBy: string; priorRevisionId: string | null; }
export interface TrustEventSummary { id: string; action: string; subjectId: string; actorId: string; occurredAt: string; metadata: Readonly<Record<string, unknown>>; }
export interface HistorySnapshot { recoverable: readonly RecoverableItem[]; events: readonly TrustEventSummary[]; }
export interface AdminSession { actor: AuthenticatedActor; csrfToken: string; expiresAt: string; }
export interface RunVerificationCommand { workspaceId:string;level:"metadata"|"full_blob"; }
export interface VerificationIssueSummary { code:string;severity:"warning"|"error"|"critical";subjectKind:"blob"|"resource"|"storage";subjectId:string;message:string;expected?:string|number;actual?:string|number|null; }
export interface VerificationRunResult { id:string;workspaceId:string;level:"metadata"|"full_blob";status:"running"|"passed"|"failed"|"degraded";startedAt:string;completedAt:string;objectsChecked:number;bytesRead:number;issues:readonly VerificationIssueSummary[]; }
