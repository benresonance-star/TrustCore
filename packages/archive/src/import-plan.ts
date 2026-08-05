import { canonicalJson, sha256 } from "./canonical.js";
import {
  archiveRecordKinds,
  type ArchiveImportAction,
  type ArchiveImportPlan,
  type ArchiveImportRequest,
  type ArchiveIssue,
  type ArchiveRecord,
  type ArchiveRecordKind,
  type TrustArchiveManifest,
} from "./types.js";

const phases: Readonly<Record<ArchiveRecordKind | "blob-bytes", number>> = {
  workspaces: 10,
  "schema-packages": 20,
  datasets: 30,
  blobs: 40,
  "blob-bytes": 45,
  resources: 50,
  revisions: 60,
  "revision-blobs": 70,
  relations: 80,
  tombstones: 90,
  "audit-events": 100,
  retention: 110,
};

export function planArchiveImport(
  request: ArchiveImportRequest,
): ArchiveImportPlan {
  const issues: ArchiveIssue[] = [];
  if (!request.archive.verification.valid)
    issues.push({
      code: "IMPORT_ARCHIVE_INVALID",
      message: "Archive verification must pass before import planning.",
    });
  const sourceWorkspaceId = request.archive.manifest.workspaceId;
  const targetWorkspaceId =
    request.mode === "mapped_workspace"
      ? request.target.workspaceId?.trim()
      : sourceWorkspaceId;
  if (!targetWorkspaceId)
    issues.push({
      code: "IMPORT_TARGET_WORKSPACE_REQUIRED",
      message: "Mapped-workspace import requires a target workspace ID.",
    });
  if (
    request.mode === "preserve_ids" &&
    request.target.workspaceId &&
    request.target.workspaceId !== sourceWorkspaceId
  )
    issues.push({
      code: "IMPORT_WORKSPACE_MODE_CONFLICT",
      message: "Preserve-ID import cannot substitute a workspace ID.",
    });

  const mappedWorkspaceId = targetWorkspaceId || sourceWorkspaceId;
  const transformed = transformRecords(
    request.archive.verification.records,
    sourceWorkspaceId,
    mappedWorkspaceId,
  );
  validateGraph(transformed, mappedWorkspaceId, issues);
  validateRetentionAssignments(transformed, issues);
  validateSchemaConflicts(transformed, request.target.records, issues);

  const actions: ArchiveImportAction[] = [];
  for (const kind of archiveRecordKinds) {
    const sourceRecords = request.archive.verification.records[kind] ?? [];
    const transformedRecords = transformed[kind] ?? [];
    for (const [recordIndex, record] of transformedRecords.entries()) {
      const sourceId = recordId(sourceRecords[recordIndex] ?? record, kind);
      const transformedId = recordId(record, kind);
      const existing = request.target.records?.[kind]?.[transformedId];
      let disposition: ArchiveImportAction["disposition"] = "insert";
      if (existing) {
        if (
          (kind === "workspaces" && request.mode === "mapped_workspace") ||
          canonicalJson(existing) === canonicalJson(record)
        )
          disposition = "already_present";
        else {
          disposition = "blocked";
          issues.push({
            code: "IMPORT_ID_CONFLICT",
            message: `${kind} ID already exists with different content: ${transformedId}`,
          });
        }
      }
      actions.push({
        index: 0,
        phase: phases[kind],
        kind,
        sourceId:
          kind === "workspaces" && request.mode === "mapped_workspace"
            ? sourceWorkspaceId
            : sourceId,
        targetId: transformedId,
        disposition,
        record,
        dependsOn: dependencies(kind, record),
      });
    }
  }
  for (const record of transformed.blobs ?? []) {
    if (typeof record.sha256 !== "string") continue;
    actions.push({
      index: 0,
      phase: phases["blob-bytes"],
      kind: "blob-bytes",
      sourceId: record.sha256,
      targetId: record.sha256,
      disposition: request.target.blobDigests?.includes(record.sha256)
        ? "already_present"
        : "insert",
      dependsOn: [`blobs:${recordId(record, "blobs")}`],
    });
  }
  actions.sort(compareActions);
  const blockedByGlobalError =
    request.conflictMode === "reject_on_error" && issues.length > 0;
  const indexed = actions.map((action, index) => ({
    ...action,
    index,
    disposition:
      blockedByGlobalError && action.disposition === "insert"
        ? ("blocked" as const)
        : action.disposition,
  }));
  const counts = {
    insert: indexed.filter((action) => action.disposition === "insert").length,
    already_present: indexed.filter(
      (action) => action.disposition === "already_present",
    ).length,
    blocked: indexed.filter((action) => action.disposition === "blocked")
      .length,
  };
  const status =
    request.conflictMode === "report_only"
      ? "report_only"
      : issues.length > 0
        ? "rejected"
        : "ready";
  const planId = calculateArchiveImportPlanId({
    manifest: request.archive.manifest,
    sourceWorkspaceId,
    targetWorkspaceId: mappedWorkspaceId,
    mode: request.mode,
    conflictMode: request.conflictMode,
    actions: indexed,
  });
  return {
    planId,
    archiveExportId: request.archive.manifest.exportId,
    sourceWorkspaceId,
    targetWorkspaceId: mappedWorkspaceId,
    mode: request.mode,
    conflictMode: request.conflictMode,
    status,
    issues,
    actions: indexed,
    counts,
  };
}

export function calculateArchiveImportPlanId(input: {
  manifest: TrustArchiveManifest;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  mode: ArchiveImportPlan["mode"];
  conflictMode: ArchiveImportPlan["conflictMode"];
  actions: readonly ArchiveImportAction[];
}): string {
  return sha256(
    canonicalJson({
      format: "trust-import-plan-v1",
      archiveExportId: input.manifest.exportId,
      archiveManifestHash: sha256(canonicalJson(input.manifest)),
      sourceWorkspaceId: input.sourceWorkspaceId,
      targetWorkspaceId: input.targetWorkspaceId,
      mode: input.mode,
      conflictMode: input.conflictMode,
      actions: input.actions.map(
        ({ index: _index, record, disposition: _disposition, ...action }) => ({
          ...action,
          ...(record ? { recordHash: sha256(canonicalJson(record)) } : {}),
        }),
      ),
    }),
  );
}

function transformRecords(
  source: Partial<Record<ArchiveRecordKind, readonly ArchiveRecord[]>>,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
): Partial<Record<ArchiveRecordKind, readonly ArchiveRecord[]>> {
  const mappings = buildIdMappings(
    source,
    sourceWorkspaceId,
    targetWorkspaceId,
  );
  return Object.fromEntries(
    archiveRecordKinds.map((kind) => [
      kind,
      (source[kind] ?? []).map((record) =>
        mapRecord(kind, record, sourceWorkspaceId, targetWorkspaceId, mappings),
      ),
    ]),
  );
}

function buildIdMappings(
  source: Partial<Record<ArchiveRecordKind, readonly ArchiveRecord[]>>,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
): Readonly<Record<string, ReadonlyMap<string, string>>> {
  const scopedKinds = [
    "datasets",
    "resources",
    "revisions",
    "revision-blobs",
    "blobs",
    "relations",
    "tombstones",
  ] as const;
  return Object.fromEntries([
    ["workspaces", new Map([[sourceWorkspaceId, targetWorkspaceId]])],
    ...scopedKinds.map((kind) => [
      kind,
      new Map(
        (source[kind] ?? []).flatMap((record) =>
          typeof record.id === "string"
            ? [
                [
                  record.id,
                  sourceWorkspaceId === targetWorkspaceId
                    ? record.id
                    : mappedEntityId(targetWorkspaceId, kind, record.id),
                ] as const,
              ]
            : [],
        ),
      ),
    ]),
  ]);
}

function mapRecord(
  kind: ArchiveRecordKind,
  record: ArchiveRecord,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  mappings: Readonly<Record<string, ReadonlyMap<string, string>>>,
): ArchiveRecord {
  const mapped = { ...record };
  if (kind !== "audit-events" && mapped.workspaceId === sourceWorkspaceId)
    mapped.workspaceId = targetWorkspaceId;
  mapped.id = mapReference(mappings[kind], mapped.id);
  switch (kind) {
    case "workspaces":
    case "schema-packages":
    case "audit-events":
    case "retention":
      break;
    case "datasets":
      break;
    case "resources":
      mapped.datasetId = mapReference(mappings.datasets, mapped.datasetId);
      mapped.currentRevisionId = mapReference(
        mappings.revisions,
        mapped.currentRevisionId,
      );
      break;
    case "revisions":
      mapped.datasetId = mapReference(mappings.datasets, mapped.datasetId);
      mapped.resourceId = mapReference(mappings.resources, mapped.resourceId);
      mapped.parentRevisionId = mapReference(
        mappings.revisions,
        mapped.parentRevisionId,
      );
      mapped.restoredFromRevisionId = mapReference(
        mappings.revisions,
        mapped.restoredFromRevisionId,
      );
      if (Array.isArray(mapped.mergeParentRevisionIds))
        mapped.mergeParentRevisionIds = mapped.mergeParentRevisionIds.map(
          (value) => mapReference(mappings.revisions, value),
        );
      break;
    case "revision-blobs":
      mapped.revisionId = mapReference(mappings.revisions, mapped.revisionId);
      mapped.blobObjectId = mapReference(mappings.blobs, mapped.blobObjectId);
      break;
    case "blobs":
      break;
    case "relations":
      mapped.datasetId = mapReference(mappings.datasets, mapped.datasetId);
      mapped.sourceId = mapRelationReference(
        mappings,
        mapped.sourceKind,
        mapped.sourceId,
      );
      mapped.targetId = mapRelationReference(
        mappings,
        mapped.targetKind,
        mapped.targetId,
      );
      break;
    case "tombstones":
      mapped.datasetId = mapReference(mappings.datasets, mapped.datasetId);
      mapped.subjectId = mapRelationReference(
        mappings,
        mapped.subjectKind,
        mapped.subjectId,
      );
      mapped.priorRevisionId = mapReference(
        mappings.revisions,
        mapped.priorRevisionId,
      );
      break;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported archive record kind: ${exhaustive}`);
    }
  }
  return mapped;
}

function mapReference(
  mapping: ReadonlyMap<string, string> | undefined,
  value: unknown,
): unknown {
  return typeof value === "string" ? (mapping?.get(value) ?? value) : value;
}

function mapRelationReference(
  mappings: Readonly<Record<string, ReadonlyMap<string, string>>>,
  kind: unknown,
  value: unknown,
): unknown {
  const recordKind =
    kind === "resource"
      ? "resources"
      : kind === "revision"
        ? "revisions"
        : kind === "blob"
          ? "blobs"
          : kind === "relation"
            ? "relations"
            : kind === "dataset"
              ? "datasets"
              : undefined;
  return recordKind ? mapReference(mappings[recordKind], value) : value;
}

function mappedEntityId(
  workspaceId: string,
  kind: ArchiveRecordKind,
  sourceId: string,
): string {
  const digest = sha256(
    canonicalJson({
      format: "trust-import-mapped-id-v1",
      workspaceId,
      kind,
      sourceId,
    }),
  );
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((Number.parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

function validateGraph(
  records: Partial<Record<ArchiveRecordKind, readonly ArchiveRecord[]>>,
  workspaceId: string,
  issues: ArchiveIssue[],
): void {
  const ids = Object.fromEntries(
    archiveRecordKinds.map((kind) => [
      kind,
      new Set(
        (records[kind] ?? [])
          .map((record) => record.id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ]),
  ) as Record<ArchiveRecordKind, Set<string>>;
  const revisions = new Map(
    (records.revisions ?? [])
      .filter((record) => typeof record.id === "string")
      .map((record) => [record.id as string, record]),
  );
  const resourceRevisions = new Map<string, Set<number>>();
  for (const [kind, values] of Object.entries(records)) {
    for (const record of values ?? []) {
      if (
        kind !== "audit-events" &&
        "workspaceId" in record &&
        record.workspaceId !== workspaceId
      )
        addIssue(
          issues,
          "IMPORT_WORKSPACE_MISMATCH",
          `${kind} crosses workspace boundary.`,
        );
    }
  }
  for (const dataset of records.datasets ?? [])
    requireId(
      ids["schema-packages"],
      dataset.schemaPackageId,
      "dataset schema package",
      issues,
      true,
    );
  for (const resource of records.resources ?? []) {
    requireId(ids.datasets, resource.datasetId, "resource dataset", issues);
    if (
      resource.currentRevisionId !== null &&
      resource.currentRevisionId !== undefined
    )
      requireId(
        ids.revisions,
        resource.currentRevisionId,
        "resource current revision",
        issues,
      );
  }
  for (const revision of records.revisions ?? []) {
    requireId(ids.resources, revision.resourceId, "revision resource", issues);
    requireId(ids.datasets, revision.datasetId, "revision dataset", issues);
    requireId(
      ids["schema-packages"],
      revision.schemaPackageId,
      "revision schema package",
      issues,
      true,
    );
    if (
      typeof revision.resourceId === "string" &&
      typeof revision.revisionNumber === "number"
    ) {
      const numbers =
        resourceRevisions.get(revision.resourceId) ?? new Set<number>();
      if (numbers.has(revision.revisionNumber))
        addIssue(
          issues,
          "IMPORT_REVISION_NUMBER_CONFLICT",
          "Revision number is duplicated for a resource.",
        );
      numbers.add(revision.revisionNumber);
      resourceRevisions.set(revision.resourceId, numbers);
    }
    if (typeof revision.parentRevisionId === "string") {
      const parent = revisions.get(revision.parentRevisionId);
      if (!parent)
        addIssue(
          issues,
          "IMPORT_REFERENCE_INVALID",
          "Revision parent does not exist.",
        );
      else if (
        parent.resourceId !== revision.resourceId ||
        Number(parent.revisionNumber) >= Number(revision.revisionNumber)
      )
        addIssue(
          issues,
          "IMPORT_REVISION_PARENT_INVALID",
          "Revision parent ordering or ownership is invalid.",
        );
    }
  }
  for (const attachment of records["revision-blobs"] ?? []) {
    requireId(
      ids.revisions,
      attachment.revisionId,
      "revision attachment revision",
      issues,
    );
    requireId(
      ids.blobs,
      attachment.blobObjectId,
      "revision attachment blob",
      issues,
    );
  }
  for (const relation of records.relations ?? []) {
    validateRelationEnd(
      relation.sourceKind,
      relation.sourceId,
      ids,
      "source",
      issues,
    );
    validateRelationEnd(
      relation.targetKind,
      relation.targetId,
      ids,
      "target",
      issues,
    );
  }
  for (const tombstone of records.tombstones ?? []) {
    const targetKind =
      tombstone.subjectKind === "resource"
        ? "resources"
        : tombstone.subjectKind === "dataset"
          ? "datasets"
          : tombstone.subjectKind === "relation"
            ? "relations"
            : undefined;
    if (!targetKind)
      addIssue(
        issues,
        "IMPORT_TOMBSTONE_INVALID",
        "Tombstone subject kind is invalid.",
      );
    else
      requireId(
        ids[targetKind],
        tombstone.subjectId,
        "tombstone subject",
        issues,
      );
    if (typeof tombstone.priorRevisionId === "string")
      requireId(
        ids.revisions,
        tombstone.priorRevisionId,
        "tombstone prior revision",
        issues,
      );
  }
}

function validateRetentionAssignments(
  records: Partial<Record<ArchiveRecordKind, readonly ArchiveRecord[]>>,
  issues: ArchiveIssue[],
): void {
  const retentionIds = new Set(
    (records.retention ?? []).flatMap((record) =>
      typeof record.id === "string" ? [record.id] : [],
    ),
  );
  for (const dataset of records.datasets ?? []) {
    if (
      typeof dataset.retentionPolicyId === "string" &&
      !retentionIds.has(dataset.retentionPolicyId)
    )
      addIssue(
        issues,
        "IMPORT_RETENTION_POLICY_UNAVAILABLE",
        `Dataset retention policy is not durably represented in the archive: ${dataset.retentionPolicyId}`,
      );
  }
}

function validateSchemaConflicts(
  records: Partial<Record<ArchiveRecordKind, readonly ArchiveRecord[]>>,
  target: ArchiveImportRequest["target"]["records"],
  issues: ArchiveIssue[],
): void {
  const existing = Object.values(target?.["schema-packages"] ?? {});
  for (const schema of records["schema-packages"] ?? []) {
    const match = existing.find(
      (candidate) =>
        candidate.namespace === schema.namespace &&
        candidate.name === schema.name &&
        candidate.semanticVersion === schema.semanticVersion,
    );
    if (match && match.schemaDigest !== schema.schemaDigest)
      addIssue(
        issues,
        "IMPORT_SCHEMA_CONFLICT",
        "Schema identity exists with a different digest.",
      );
  }
}

function validateRelationEnd(
  kind: unknown,
  id: unknown,
  ids: Record<ArchiveRecordKind, Set<string>>,
  side: string,
  issues: ArchiveIssue[],
) {
  const mapped =
    kind === "resource"
      ? "resources"
      : kind === "revision"
        ? "revisions"
        : kind === "blob"
          ? "blobs"
          : kind === "external"
            ? undefined
            : null;
  if (mapped === null)
    addIssue(
      issues,
      "IMPORT_RELATION_INVALID",
      `Relation ${side} kind is invalid.`,
    );
  else if (mapped) requireId(ids[mapped], id, `relation ${side}`, issues);
}

function requireId(
  ids: ReadonlySet<string>,
  value: unknown,
  label: string,
  issues: ArchiveIssue[],
  allowAbsentKind = false,
) {
  if (
    typeof value !== "string" ||
    (!ids.has(value) && !(allowAbsentKind && ids.size === 0))
  )
    addIssue(
      issues,
      "IMPORT_REFERENCE_INVALID",
      `${label} does not exist in the archive.`,
    );
}

function recordId(record: ArchiveRecord, kind: ArchiveRecordKind): string {
  if (typeof record.id === "string" && record.id.length > 0) return record.id;
  if (kind === "retention") return sha256(canonicalJson(record));
  throw new Error(`${kind} record is missing a stable ID.`);
}

function dependencies(
  kind: ArchiveRecordKind,
  record: ArchiveRecord,
): string[] {
  const values: string[] = [];
  const add = (dependencyKind: ArchiveRecordKind, value: unknown) => {
    if (typeof value === "string") values.push(`${dependencyKind}:${value}`);
  };
  if (kind === "datasets") add("schema-packages", record.schemaPackageId);
  if (kind === "resources") add("datasets", record.datasetId);
  if (kind === "revisions") {
    add("resources", record.resourceId);
    add("datasets", record.datasetId);
    add("schema-packages", record.schemaPackageId);
    add("revisions", record.parentRevisionId);
  }
  if (kind === "revision-blobs") {
    add("revisions", record.revisionId);
    add("blobs", record.blobObjectId);
  }
  if (kind === "relations") {
    add(relationKind(record.sourceKind), record.sourceId);
    add(relationKind(record.targetKind), record.targetId);
  }
  if (kind === "tombstones") add("revisions", record.priorRevisionId);
  return [...new Set(values)].sort();
}

function relationKind(value: unknown): ArchiveRecordKind {
  return value === "revision"
    ? "revisions"
    : value === "blob"
      ? "blobs"
      : "resources";
}

function compareActions(
  left: ArchiveImportAction,
  right: ArchiveImportAction,
): number {
  return (
    left.phase - right.phase ||
    left.kind.localeCompare(right.kind) ||
    left.targetId.localeCompare(right.targetId)
  );
}

function addIssue(issues: ArchiveIssue[], code: string, message: string) {
  issues.push({ code, message });
}
