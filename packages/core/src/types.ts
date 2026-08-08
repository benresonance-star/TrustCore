export type TrustId = string;
export type IsoTimestamp = string;

export type ResourceStatus =
  "active" | "archived" | "deleted_logically" | "legal_hold";

export interface Workspace {
  id: TrustId;
  name: string;
  slug: string;
  status: "active" | "suspended" | "closed";
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface Dataset {
  id: TrustId;
  workspaceId: TrustId;
  schemaPackageId: TrustId;
  datasetType: string;
  name: string;
  status: "active" | "archived" | "deleted_logically" | "legal_hold";
  retentionPolicyId: TrustId | null;
  createdBy: TrustId;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface Resource {
  id: TrustId;
  workspaceId: TrustId;
  datasetId: TrustId;
  resourceType: string;
  title: string | null;
  status: ResourceStatus;
  currentRevisionId: TrustId | null;
  createdBy: TrustId;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface Revision {
  id: TrustId;
  workspaceId: TrustId;
  datasetId: TrustId;
  resourceId: TrustId;
  revisionNumber: number;
  parentRevisionId: TrustId | null;
  mergeParentRevisionIds: readonly TrustId[];
  schemaPackageId: TrustId;
  schemaVersion: string;
  canonicalPayload: Readonly<Record<string, unknown>>;
  canonicalPayloadHash: string;
  createdBy: TrustId;
  createdOnDeviceId: TrustId | null;
  source: "user" | "application" | "import" | "restore" | "merge";
  changeNote: string | null;
  restoredFromRevisionId: TrustId | null;
  createdAt: IsoTimestamp;
}

export interface BlobObject {
  id: TrustId;
  workspaceId: TrustId;
  sha256: string;
  byteLength: number;
  mediaType: string;
  storageProvider: string;
  storageKey: string;
  encryptionState: "provider_managed" | "customer_managed";
  encryptionKeyRef: string | null;
  verificationState: "pending" | "verified" | "failed";
  createdAt: IsoTimestamp;
  /** Sticky binding recorded at commit (ADR-016). */
  storageBindingId?: TrustId | null;
  storageBindingGeneration?: number | null;
}

export interface Relation {
  id: TrustId;
  workspaceId: TrustId;
  datasetId: TrustId;
  sourceKind: "resource" | "revision" | "blob" | "external";
  sourceId: TrustId;
  targetKind: "resource" | "revision" | "blob" | "external";
  targetId: TrustId;
  relationType: string;
  metadata: Readonly<Record<string, unknown>>;
  createdBy: TrustId;
  createdAt: IsoTimestamp;
  endedAt: IsoTimestamp | null;
}

export interface Tombstone {
  id: TrustId;
  workspaceId: TrustId;
  datasetId: TrustId;
  subjectKind: "dataset" | "resource" | "relation";
  subjectId: TrustId;
  deletedBy: TrustId;
  deletedAt: IsoTimestamp;
  reason?: string | null;
  recoverUntil: IsoTimestamp | null;
  priorRevisionId: TrustId | null;
  restoredAt?: IsoTimestamp | null;
  restoredBy?: TrustId | null;
  purgeState: "not_eligible" | "eligible" | "planned" | "purged";
}

export interface RetentionPolicy {
  id: TrustId;
  workspaceId: TrustId;
  name: string;
  recoveryWindowDays: number;
  minimumHistoryDays: number;
  backupRetentionDays: number;
  purgeEnabled: false;
  createdBy: TrustId;
  updatedBy: TrustId;
  extensions: Readonly<Record<string, unknown>>;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
