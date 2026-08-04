import { createHash, randomUUID } from "node:crypto";
import { verifyAuditChain, type ChainedAuditEvent } from "@trust-core/audit";
import type {
  BlobObject,
  Dataset,
  Relation,
  Resource,
  Revision,
  Tombstone,
} from "@trust-core/core";
import type {
  VerificationIssueSummary,
  VerificationLevel as PublicVerificationLevel,
  VerificationRunResult,
  VerificationScope,
} from "@trust-core/protocol";
import {
  validateResourcePayload,
  type SchemaPackageManifest,
} from "@trust-core/schema-registry";
import type { ObjectStorage } from "@trust-core/storage";
import { verifyResourceGraph } from "./resource-graph.js";

export type BlobVerificationLevel = Extract<
  PublicVerificationLevel,
  "metadata" | "full_blob"
>;
export type StructuralVerificationLevel = Extract<
  PublicVerificationLevel,
  "resource" | "dataset" | "workspace"
>;
export type VerificationLevel = PublicVerificationLevel;
export type VerificationStatus = "running" | "passed" | "failed" | "degraded";
export type VerificationIssue = VerificationIssueSummary;

export interface BlobVerificationResult {
  blobId: string;
  level: BlobVerificationLevel;
  status: "passed" | "failed";
  checkedAt: string;
  bytesRead: number;
  issues: readonly VerificationIssue[];
}

export interface VerificationRun {
  id: string;
  workspaceId: string;
  level: VerificationLevel;
  scope: VerificationScope;
  status: VerificationStatus;
  startedAt: string;
  completedAt: string;
  objectsChecked: number;
  bytesRead: number;
  issues: readonly VerificationIssue[];
}

export interface RevisionBlobReference {
  id: string;
  workspaceId: string;
  revisionId: string;
  blobObjectId: string;
  role: string;
}

export interface VerificationSchemaPackage {
  id: string;
  version: string;
  manifest: SchemaPackageManifest;
  status: "active" | "deprecated" | "revoked";
}

export interface VerificationSnapshot {
  workspaceExists: boolean;
  datasets: readonly Dataset[];
  resources: readonly Resource[];
  revisions: readonly Revision[];
  blobs: readonly BlobObject[];
  revisionBlobs: readonly RevisionBlobReference[];
  relations: readonly Relation[];
  tombstones: readonly Tombstone[];
  auditEvents: readonly ChainedAuditEvent[];
  schemaPackages: readonly VerificationSchemaPackage[];
}

export interface VerificationCatalog {
  workspaceExists(workspaceId: string): Promise<boolean>;
  listBlobs(workspaceId: string): Promise<readonly BlobObject[]>;
  recordRun(run: VerificationRun): Promise<void>;
  setBlobVerification(
    workspaceId: string,
    blobId: string,
    state: BlobObject["verificationState"],
  ): Promise<void>;
  getReport(
    workspaceId: string,
    reportId: string,
  ): Promise<VerificationRunResult | undefined>;
  listReports(
    workspaceId: string,
    scopeFilter?: VerificationScope,
  ): Promise<readonly VerificationRunResult[]>;
}

export interface StructuralVerificationCatalog extends VerificationCatalog {
  loadSnapshot(workspaceId: string): Promise<VerificationSnapshot>;
}

export class BlobVerificationService {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly catalog: VerificationCatalog,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly nextId: () => string = () => randomUUID(),
  ) {}

  async run(input: {
    workspaceId: string;
    level: BlobVerificationLevel;
  }): Promise<VerificationRun> {
    const startedAt = this.now();
    if (!(await this.catalog.workspaceExists(input.workspaceId)))
      throw new Error("Verification workspace was not found.");
    const blobs = await this.catalog.listBlobs(input.workspaceId);
    const results: BlobVerificationResult[] = [];
    for (const blob of blobs) {
      const result = await this.verifyBlob(blob, input.level);
      results.push(result);
      await this.catalog.setBlobVerification(
        input.workspaceId,
        blob.id,
        result.status === "passed" ? "verified" : "failed",
      );
    }
    const run = makeRun({
      id: this.nextId(),
      workspaceId: input.workspaceId,
      level: input.level,
      scope: { kind: "workspace", id: input.workspaceId },
      startedAt,
      completedAt: this.now(),
      objectsChecked: results.length,
      bytesRead: results.reduce((sum, result) => sum + result.bytesRead, 0),
      issues: blobs.length
        ? results.flatMap((result) => result.issues)
        : [
            issue(
              "NO_OBJECTS_CHECKED",
              "warning",
              "workspace",
              input.workspaceId,
              "No catalogued blobs exist in this workspace; verification cannot pass without checking an object.",
            ),
          ],
    });
    await this.catalog.recordRun(run);
    return run;
  }

  async verifyBlob(
    blob: BlobObject,
    level: BlobVerificationLevel,
  ): Promise<BlobVerificationResult> {
    const checkedAt = this.now();
    const issues: VerificationIssue[] = [];
    let metadata;
    try {
      metadata = await this.storage.head({ key: blob.storageKey });
    } catch (error) {
      issues.push({
        code: "BLOB_MISSING_OR_INACCESSIBLE",
        severity: "critical",
        subjectKind: "blob",
        subjectId: blob.id,
        message:
          error instanceof Error
            ? error.message
            : "Canonical object is missing or inaccessible.",
        expected: blob.storageKey,
        actual: null,
      });
      return {
        blobId: blob.id,
        level,
        status: "failed",
        checkedAt,
        bytesRead: 0,
        issues,
      };
    }
    if (metadata.key !== blob.storageKey)
      issues.push(
        blobIssue(
          blob,
          "STORAGE_KEY_MISMATCH",
          "error",
          "Storage returned a different object key.",
          blob.storageKey,
          metadata.key,
        ),
      );
    if (metadata.byteLength !== blob.byteLength)
      issues.push(
        blobIssue(
          blob,
          "BLOB_LENGTH_MISMATCH",
          "critical",
          "Stored byte length differs from canonical metadata.",
          blob.byteLength,
          metadata.byteLength,
        ),
      );
    if (metadata.sha256 && metadata.sha256 !== blob.sha256)
      issues.push(
        blobIssue(
          blob,
          "STORED_HASH_METADATA_MISMATCH",
          "critical",
          "Storage hash metadata differs from the canonical hash.",
          blob.sha256,
          metadata.sha256,
        ),
      );
    if (level === "metadata")
      return {
        blobId: blob.id,
        level,
        status: issues.length ? "failed" : "passed",
        checkedAt,
        bytesRead: 0,
        issues,
      };

    let bytesRead = 0;
    const hash = createHash("sha256");
    try {
      const stream = await this.storage.openReadStream({
        key: blob.storageKey,
      });
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        bytesRead += bytes.byteLength;
        hash.update(bytes);
      }
    } catch (error) {
      issues.push({
        code: "BLOB_STREAM_FAILED",
        severity: "critical",
        subjectKind: "storage",
        subjectId: blob.id,
        message:
          error instanceof Error ? error.message : "Object stream failed.",
        expected: blob.byteLength,
        actual: bytesRead,
      });
      return {
        blobId: blob.id,
        level,
        status: "failed",
        checkedAt,
        bytesRead,
        issues,
      };
    }
    const digest = hash.digest("hex");
    if (bytesRead !== blob.byteLength)
      issues.push(
        blobIssue(
          blob,
          "FULL_LENGTH_MISMATCH",
          "critical",
          "Streamed byte count differs from canonical metadata.",
          blob.byteLength,
          bytesRead,
        ),
      );
    if (digest !== blob.sha256)
      issues.push(
        blobIssue(
          blob,
          "FULL_HASH_MISMATCH",
          "critical",
          "Streamed SHA-256 differs from the canonical hash.",
          blob.sha256,
          digest,
        ),
      );
    return {
      blobId: blob.id,
      level,
      status: issues.length ? "failed" : "passed",
      checkedAt,
      bytesRead,
      issues,
    };
  }
}

export class StructuralVerificationService {
  private readonly blobVerifier: BlobVerificationService;

  constructor(
    storage: ObjectStorage,
    private readonly catalog: StructuralVerificationCatalog,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly nextId: () => string = () => randomUUID(),
  ) {
    this.blobVerifier = new BlobVerificationService(
      storage,
      catalog,
      now,
      nextId,
    );
  }

  async run(input: {
    workspaceId: string;
    level: StructuralVerificationLevel;
    scope?: VerificationScope;
  }): Promise<VerificationRun> {
    const scope = resolveScope(input);
    const startedAt = this.now();
    const snapshot = await this.catalog.loadSnapshot(input.workspaceId);
    const selected = selectScope(snapshot, scope);
    const issues = [...selected.scopeIssues];
    let objectsChecked = selected.scopeIssues.length
      ? 0
      : selected.datasets.length;

    for (const dataset of selected.datasets) {
      const schemaPackage = snapshot.schemaPackages.find(
        ({ id }) => id === dataset.schemaPackageId,
      );
      if (!schemaPackage)
        issues.push(
          issue(
            "DATASET_SCHEMA_PACKAGE_MISSING",
            "critical",
            "dataset",
            dataset.id,
            "Dataset schema package does not resolve.",
          ),
        );
      else if (schemaPackage.status === "revoked")
        issues.push(
          issue(
            "DATASET_SCHEMA_PACKAGE_REVOKED",
            "error",
            "dataset",
            dataset.id,
            "Dataset uses a revoked schema package.",
          ),
        );
    }

    for (const resource of selected.resources) {
      objectsChecked += 1;
      issues.push(...verifyResourceGraph(resource, selected.revisions));
      const revisions = selected.revisions.filter(
        (revision) => revision.resourceId === resource.id,
      );
      const dataset = selected.datasets.find(
        ({ id }) => id === resource.datasetId,
      );
      for (const revision of revisions) {
        objectsChecked += 1;
        issues.push(
          ...verifySchema(resource, revision, dataset, snapshot.schemaPackages),
        );
      }
      if (!revisions.length && resource.status !== "deleted_logically") {
        issues.push(
          issue(
            "ORPHAN_RESOURCE_WITHOUT_REVISION",
            "critical",
            "resource",
            resource.id,
            "Resource has no revision history.",
          ),
        );
      }
    }

    const selectedRevisionIds = new Set(selected.revisions.map(({ id }) => id));
    const selectedBlobReferences = snapshot.revisionBlobs.filter(
      ({ revisionId }) => selectedRevisionIds.has(revisionId),
    );
    objectsChecked += selectedBlobReferences.length;
    const referencedBlobIds = new Set(
      selectedBlobReferences.map(({ blobObjectId }) => blobObjectId),
    );
    const selectedBlobs =
      input.level === "workspace"
        ? snapshot.blobs
        : snapshot.blobs.filter(({ id }) => referencedBlobIds.has(id));
    for (const reference of selectedBlobReferences) {
      if (!snapshot.blobs.some(({ id }) => id === reference.blobObjectId)) {
        issues.push(
          issue(
            "REVISION_BLOB_TARGET_MISSING",
            "critical",
            "revision",
            reference.revisionId,
            `Blob reference ${reference.id} does not resolve.`,
          ),
        );
      }
    }
    for (const blob of selectedBlobs) {
      objectsChecked += 1;
      const result = await this.blobVerifier.verifyBlob(blob, "metadata");
      issues.push(...result.issues);
      await this.catalog.setBlobVerification(
        input.workspaceId,
        blob.id,
        result.status === "passed" ? "verified" : "failed",
      );
    }

    for (const relation of selected.relations) {
      objectsChecked += 1;
      issues.push(...verifyRelation(relation, snapshot));
    }
    for (const tombstone of selected.tombstones) {
      objectsChecked += 1;
      issues.push(...verifyTombstone(tombstone, snapshot));
    }

    if (input.level === "workspace") {
      objectsChecked += snapshot.auditEvents.length;
      if (
        snapshot.auditEvents.length &&
        !verifyAuditChain(snapshot.auditEvents)
      ) {
        issues.push(
          issue(
            "AUDIT_CHAIN_INVALID",
            "critical",
            "workspace",
            input.workspaceId,
            "Workspace audit event hash chain is invalid.",
          ),
        );
      }
      const allReferencedBlobIds = new Set(
        snapshot.revisionBlobs.map(({ blobObjectId }) => blobObjectId),
      );
      for (const blob of snapshot.blobs) {
        if (!allReferencedBlobIds.has(blob.id)) {
          issues.push(
            issue(
              "ORPHAN_BLOB",
              "warning",
              "blob",
              blob.id,
              "Blob is not referenced by any revision.",
            ),
          );
        }
      }
    }

    const run = makeRun({
      id: this.nextId(),
      workspaceId: input.workspaceId,
      level: input.level,
      scope,
      startedAt,
      completedAt: this.now(),
      objectsChecked,
      bytesRead: 0,
      issues,
    });
    await this.catalog.recordRun(run);
    return run;
  }
}

interface SelectedScope {
  datasets: readonly Dataset[];
  resources: readonly Resource[];
  revisions: readonly Revision[];
  relations: readonly Relation[];
  tombstones: readonly Tombstone[];
  scopeIssues: readonly VerificationIssue[];
}

function resolveScope(input: {
  workspaceId: string;
  level: StructuralVerificationLevel;
  scope?: VerificationScope;
}): VerificationScope {
  const expectedKind = input.level;
  const scope =
    input.scope ??
    (input.level === "workspace"
      ? { kind: "workspace" as const, id: input.workspaceId }
      : undefined);
  if (!scope || scope.kind !== expectedKind)
    throw new Error(
      `${input.level} verification requires a ${expectedKind} scope.`,
    );
  if (scope.kind === "workspace" && scope.id !== input.workspaceId)
    throw new Error("Workspace verification scope must match workspaceId.");
  return scope;
}

function selectScope(
  snapshot: VerificationSnapshot,
  scope: VerificationScope,
): SelectedScope {
  if (!snapshot.workspaceExists)
    return emptySelection(
      issue(
        "SCOPE_NOT_FOUND",
        "critical",
        "workspace",
        scope.id,
        "Workspace scope does not exist.",
      ),
    );
  switch (scope.kind) {
    case "workspace":
      return {
        datasets: snapshot.datasets,
        resources: snapshot.resources,
        revisions: snapshot.revisions,
        relations: snapshot.relations,
        tombstones: snapshot.tombstones,
        scopeIssues: [],
      };
    case "dataset": {
      const dataset = snapshot.datasets.find(({ id }) => id === scope.id);
      if (!dataset)
        return emptySelection(
          issue(
            "SCOPE_NOT_FOUND",
            "critical",
            "dataset",
            scope.id,
            "Dataset scope does not exist in the workspace.",
          ),
        );
      return {
        datasets: [dataset],
        resources: snapshot.resources.filter(
          ({ datasetId }) => datasetId === scope.id,
        ),
        revisions: snapshot.revisions.filter(
          ({ datasetId }) => datasetId === scope.id,
        ),
        relations: snapshot.relations.filter(
          ({ datasetId }) => datasetId === scope.id,
        ),
        tombstones: snapshot.tombstones.filter(
          ({ datasetId }) => datasetId === scope.id,
        ),
        scopeIssues: [],
      };
    }
    case "resource": {
      const resource = snapshot.resources.find(({ id }) => id === scope.id);
      if (!resource)
        return emptySelection(
          issue(
            "SCOPE_NOT_FOUND",
            "critical",
            "resource",
            scope.id,
            "Resource scope does not exist in the workspace.",
          ),
        );
      return {
        datasets: snapshot.datasets.filter(
          ({ id }) => id === resource.datasetId,
        ),
        resources: [resource],
        revisions: snapshot.revisions.filter(
          ({ resourceId }) => resource.id === resourceId,
        ),
        relations: snapshot.relations.filter(
          ({ sourceId, targetId }) =>
            sourceId === resource.id || targetId === resource.id,
        ),
        tombstones: snapshot.tombstones.filter(
          ({ subjectKind, subjectId }) =>
            subjectKind === "resource" && subjectId === resource.id,
        ),
        scopeIssues: [],
      };
    }
    case "blob":
      return emptySelection(
        issue(
          "SCOPE_KIND_INVALID",
          "critical",
          "blob",
          scope.id,
          "Structural verification does not accept a blob scope.",
        ),
      );
    default: {
      const exhaustive: never = scope.kind;
      return exhaustive;
    }
  }
}

function emptySelection(scopeIssue: VerificationIssue): SelectedScope {
  return {
    datasets: [],
    resources: [],
    revisions: [],
    relations: [],
    tombstones: [],
    scopeIssues: [scopeIssue],
  };
}

function verifySchema(
  resource: Resource,
  revision: Revision,
  dataset: Dataset | undefined,
  packages: readonly VerificationSchemaPackage[],
): readonly VerificationIssue[] {
  const schemaPackage = packages.find(
    ({ id }) => id === revision.schemaPackageId,
  );
  if (!schemaPackage)
    return [
      issue(
        "SCHEMA_PACKAGE_MISSING",
        "critical",
        "revision",
        revision.id,
        "Revision schema package does not resolve.",
      ),
    ];
  const issues: VerificationIssue[] = [];
  if (dataset && revision.schemaPackageId !== dataset.schemaPackageId) {
    issues.push(
      issue(
        "REVISION_DATASET_SCHEMA_MISMATCH",
        "critical",
        "revision",
        revision.id,
        "Revision schema package differs from its dataset schema package.",
        dataset.schemaPackageId,
        revision.schemaPackageId,
      ),
    );
  }
  if (schemaPackage.version !== revision.schemaVersion) {
    issues.push(
      issue(
        "SCHEMA_VERSION_MISMATCH",
        "critical",
        "revision",
        revision.id,
        "Revision schema version differs from its package.",
        schemaPackage.version,
        revision.schemaVersion,
      ),
    );
  }
  if (schemaPackage.status === "revoked") {
    issues.push(
      issue(
        "SCHEMA_PACKAGE_REVOKED",
        "error",
        "revision",
        revision.id,
        "Revision uses a revoked schema package.",
      ),
    );
  }
  for (const validationIssue of validateResourcePayload(
    schemaPackage.manifest,
    resource.resourceType,
    revision.canonicalPayload,
  ).issues) {
    issues.push(
      issue(
        `SCHEMA_${validationIssue.code.toUpperCase()}`,
        "error",
        "revision",
        revision.id,
        `${validationIssue.path}: ${validationIssue.message}`,
      ),
    );
  }
  return issues;
}

function verifyRelation(
  relation: Relation,
  snapshot: VerificationSnapshot,
): readonly VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  for (const endpoint of [
    { side: "source", kind: relation.sourceKind, id: relation.sourceId },
    { side: "target", kind: relation.targetKind, id: relation.targetId },
  ] as const) {
    let exists: boolean;
    switch (endpoint.kind) {
      case "resource":
        exists = snapshot.resources.some(
          ({ id, datasetId }) =>
            id === endpoint.id && datasetId === relation.datasetId,
        );
        break;
      case "revision":
        exists = snapshot.revisions.some(
          ({ id, datasetId }) =>
            id === endpoint.id && datasetId === relation.datasetId,
        );
        break;
      case "blob":
        exists = snapshot.blobs.some(({ id }) => id === endpoint.id);
        break;
      case "external":
        exists = endpoint.id.length > 0;
        break;
      default: {
        const exhaustive: never = endpoint.kind;
        exists = exhaustive;
      }
    }
    if (!exists)
      issues.push(
        issue(
          "RELATION_ENDPOINT_MISSING",
          "critical",
          "relation",
          relation.id,
          `Relation ${endpoint.side} ${endpoint.kind} endpoint does not resolve.`,
        ),
      );
  }
  return issues;
}

function verifyTombstone(
  tombstone: Tombstone,
  snapshot: VerificationSnapshot,
): readonly VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const targetExists =
    tombstone.subjectKind === "dataset"
      ? snapshot.datasets.some(({ id }) => id === tombstone.subjectId)
      : tombstone.subjectKind === "resource"
        ? snapshot.resources.some(({ id }) => id === tombstone.subjectId)
        : snapshot.relations.some(({ id }) => id === tombstone.subjectId);
  if (!targetExists && tombstone.purgeState !== "purged") {
    issues.push(
      issue(
        "TOMBSTONE_SUBJECT_MISSING",
        "critical",
        tombstone.subjectKind,
        tombstone.subjectId,
        "Unpurged tombstone subject does not resolve.",
      ),
    );
  }
  if (tombstone.recoverUntil && tombstone.recoverUntil < tombstone.deletedAt) {
    issues.push(
      issue(
        "RETENTION_WINDOW_INVALID",
        "error",
        "resource",
        tombstone.subjectId,
        "Recovery deadline precedes deletion time.",
      ),
    );
  }
  if (
    tombstone.priorRevisionId &&
    !snapshot.revisions.some(
      ({ id, resourceId }) =>
        id === tombstone.priorRevisionId && resourceId === tombstone.subjectId,
    )
  ) {
    issues.push(
      issue(
        "TOMBSTONE_PRIOR_REVISION_INVALID",
        "critical",
        "resource",
        tombstone.subjectId,
        "Tombstone prior revision does not belong to its resource.",
      ),
    );
  }
  if (tombstone.subjectKind === "resource") {
    const resource = snapshot.resources.find(
      ({ id }) => id === tombstone.subjectId,
    );
    if (
      resource &&
      tombstone.purgeState !== "purged" &&
      resource.status !== "deleted_logically"
    ) {
      issues.push(
        issue(
          "TOMBSTONE_STATUS_MISMATCH",
          "error",
          "resource",
          resource.id,
          "Open tombstone resource is not logically deleted.",
        ),
      );
    }
  }
  return issues;
}

function makeRun(input: Omit<VerificationRun, "status">): VerificationRun {
  const status: VerificationStatus = input.issues.some(
    ({ severity }) => severity === "critical" || severity === "error",
  )
    ? "failed"
    : input.issues.length
      ? "degraded"
      : "passed";
  return { ...input, status };
}

function blobIssue(
  blob: BlobObject,
  code: string,
  severity: VerificationIssue["severity"],
  message: string,
  expected: string | number,
  actual: string | number,
): VerificationIssue {
  return {
    code,
    severity,
    subjectKind: "blob",
    subjectId: blob.id,
    message,
    expected,
    actual,
  };
}

function issue(
  code: string,
  severity: VerificationIssue["severity"],
  subjectKind: VerificationIssue["subjectKind"],
  subjectId: string,
  message: string,
  expected?: string | number,
  actual?: string | number | null,
): VerificationIssue {
  return expected === undefined
    ? { code, severity, subjectKind, subjectId, message }
    : {
        code,
        severity,
        subjectKind,
        subjectId,
        message,
        expected,
        actual: actual ?? null,
      };
}
