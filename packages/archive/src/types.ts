export const archiveRecordKinds = [
  "workspaces",
  "schema-packages",
  "datasets",
  "resources",
  "revisions",
  "revision-blobs",
  "blobs",
  "relations",
  "tombstones",
  "audit-events",
  "retention",
] as const;

export type ArchiveRecordKind = (typeof archiveRecordKinds)[number];
export type ArchiveRecord = Readonly<Record<string, unknown>>;

export interface ArchiveBlobInput {
  readonly sha256: string;
  readonly byteLength: number;
  readonly bytes: Uint8Array;
}

export interface ArchiveSource {
  readonly exportId: string;
  readonly workspaceId: string;
  readonly datasetIds: readonly string[];
  readonly createdAt: string;
  readonly createdBy: string;
  readonly sourceVersion: string;
  readonly records: Partial<
    Readonly<Record<ArchiveRecordKind, readonly ArchiveRecord[]>>
  >;
  readonly blobs?: readonly ArchiveBlobInput[];
}

export type ArchiveSignatureAlgorithm = "Ed25519";
export type ArchiveSignatureProfile =
  | "unsigned"
  | {
      readonly name: "trust-core-manifest-signature-v1";
      readonly algorithm: ArchiveSignatureAlgorithm;
      readonly keyId: string;
    };

export interface TrustArchiveManifest {
  readonly format: "trustarchive";
  readonly formatVersion: "0.2" | "0.3";
  readonly exportId: string;
  readonly workspaceId: string;
  readonly datasetIds: readonly string[];
  readonly createdAt: string;
  readonly createdBy: string;
  readonly sourceVersion: string;
  readonly checksumAlgorithm: "sha256";
  readonly canonicalJsonProfile: "trust-core-canonical-json-v1";
  readonly signatureProfile: ArchiveSignatureProfile;
  readonly auditLineage: {
    readonly mode: "source_chain";
    readonly sourceWorkspaceId: string;
    readonly eventCount: number;
    readonly firstEventHash: string | null;
    readonly lastEventHash: string | null;
  };
  readonly recordCounts: Readonly<Record<ArchiveRecordKind, number>>;
  readonly blobCount: number;
  readonly totalBlobBytes: number;
}

export interface ArchiveManifestSignature {
  readonly profile: "trust-core-manifest-signature-v1";
  readonly algorithm: ArchiveSignatureAlgorithm;
  readonly keyId: string;
  readonly signedEntries: readonly [
    "manifest.json",
    "checksums/sha256sums.txt",
  ];
  readonly signatureEncoding: "base64";
  readonly signature: string;
}

export interface ArchiveManifestSigner {
  readonly algorithm: ArchiveSignatureAlgorithm;
  readonly keyId: string;
  signManifest(manifestBytes: Uint8Array): Promise<Uint8Array>;
}

export type ArchiveSignatureVerificationResult =
  | "valid"
  | "invalid"
  | "unknown_key";

export interface ArchiveManifestVerifier {
  verifyManifest(input: {
    readonly algorithm: ArchiveSignatureAlgorithm;
    readonly keyId: string;
    readonly manifestBytes: Uint8Array;
    readonly signature: Uint8Array;
  }): Promise<ArchiveSignatureVerificationResult>;
}

export interface ArchiveEntrySet {
  readonly entries: ReadonlyMap<string, Uint8Array>;
  readonly manifest: TrustArchiveManifest;
}

export interface ArchiveIssue {
  readonly code: string;
  readonly path?: string;
  readonly message: string;
}

export interface ArchiveVerificationReport {
  readonly valid: boolean;
  readonly checkedEntries: number;
  readonly issues: readonly ArchiveIssue[];
  readonly manifest?: TrustArchiveManifest;
  readonly records: Partial<
    Readonly<Record<ArchiveRecordKind, readonly ArchiveRecord[]>>
  >;
}

export interface ArchiveContainerLimits {
  readonly maxContainerBytes: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  readonly maxCompressionRatio: number;
}

export interface ParsedTrustArchive extends ArchiveEntrySet {
  readonly verification: ArchiveVerificationReport;
}

export type ArchiveImportMode = "preserve_ids" | "mapped_workspace";
export type ArchiveConflictMode = "reject_on_error" | "report_only";

export interface ArchiveImportInventory {
  readonly workspaceId?: string;
  readonly records?: Partial<
    Readonly<Record<ArchiveRecordKind, Readonly<Record<string, ArchiveRecord>>>>
  >;
  readonly blobDigests?: readonly string[];
}

export interface ArchiveImportRequest {
  readonly archive: ParsedTrustArchive;
  readonly mode: ArchiveImportMode;
  readonly conflictMode: ArchiveConflictMode;
  readonly target: ArchiveImportInventory;
}

export interface ArchiveImportAction {
  readonly index: number;
  readonly phase: number;
  readonly kind: ArchiveRecordKind | "blob-bytes";
  readonly sourceId: string;
  readonly targetId: string;
  readonly disposition: "insert" | "already_present" | "blocked";
  readonly record?: ArchiveRecord;
  readonly dependsOn: readonly string[];
}

export interface ArchiveImportPlan {
  readonly planId: string;
  readonly archiveExportId: string;
  readonly sourceWorkspaceId: string;
  readonly targetWorkspaceId: string;
  readonly mode: ArchiveImportMode;
  readonly conflictMode: ArchiveConflictMode;
  readonly status: "ready" | "rejected" | "report_only";
  readonly issues: readonly ArchiveIssue[];
  readonly actions: readonly ArchiveImportAction[];
  readonly counts: Readonly<
    Record<"insert" | "already_present" | "blocked", number>
  >;
}

export const archiveImportCheckpoints = [
  "authorised",
  "target_revalidated",
  "temporary_blobs_staged",
  "staged_blobs_verified",
  "immutable_blobs_committed",
  "metadata_committed",
  "audit_committed",
  "completed",
] as const;

export type ArchiveImportCheckpoint = (typeof archiveImportCheckpoints)[number];

export interface ArchiveImportOperation {
  readonly id: string;
  readonly planId: string;
  readonly archiveExportId: string;
  readonly requestedBy: string;
  readonly checkpoint: ArchiveImportCheckpoint;
  readonly resumed?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface ArchiveImportOperationStore {
  begin(input: {
    planId: string;
    archiveExportId: string;
    requestedBy: string;
    at: string;
  }): Promise<ArchiveImportOperation>;
  advance(input: {
    operationId: string;
    planId: string;
    expected: ArchiveImportCheckpoint;
    next: ArchiveImportCheckpoint;
    at: string;
  }): Promise<ArchiveImportOperation>;
}

export interface ArchiveImportExecutionTarget {
  revalidate(plan: ArchiveImportPlan): Promise<readonly ArchiveIssue[]>;
  stageBlob(input: {
    operationId: string;
    sha256: string;
    bytes: Uint8Array;
  }): Promise<void>;
  verifyStagedBlob(input: {
    operationId: string;
    sha256: string;
    byteLength: number;
  }): Promise<boolean>;
  commitBlob(input: { operationId: string; sha256: string }): Promise<void>;
  commitMetadata(input: {
    operationId: string;
    plan: ArchiveImportPlan;
    actions: readonly ArchiveImportAction[];
  }): Promise<void>;
  appendAudit(input: {
    operationId: string;
    plan: ArchiveImportPlan;
    requestedBy: string;
    at: string;
    sourceAuditLineage: TrustArchiveManifest["auditLineage"];
  }): Promise<void>;
}

export interface ArchiveImportExecutionResult {
  readonly operation: ArchiveImportOperation;
  readonly resumed: boolean;
  readonly insertedRecords: number;
  readonly insertedBlobs: number;
}
