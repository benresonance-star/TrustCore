export type Release01Method = "GET" | "POST" | "PUT" | "DELETE";
export interface RouteContract {
  method: Release01Method;
  path: string;
  operationId: string;
}
export const publicErrorCodes = [
  "AUTHENTICATION_REQUIRED",
  "INVALID_CREDENTIALS",
  "INVALID_SESSION",
  "REAUTHENTICATION_REQUIRED",
  "PERMISSION_DENIED",
  "WORKSPACE_REQUIRED",
  "INVALID_COMMAND",
  "SCHEMA_NOT_FOUND",
  "RESOURCE_NOT_FOUND",
  "DATASET_NOT_FOUND",
  "RETENTION_POLICY_NOT_FOUND",
  "RETENTION_POLICY_CONFLICT",
  "APPLICATION_NOT_FOUND",
  "POLICY_ASSIGNMENT_NOT_FOUND",
  "VERIFICATION_REPORT_NOT_FOUND",
  "OPERATION_NOT_FOUND",
  "ARCHIVE_NOT_FOUND",
  "IMPORT_PLAN_NOT_FOUND",
  "REVISION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "COMMAND_REJECTED",
  "COMMAND_BOUNDARY_UNAVAILABLE",
  "OIDC_UNAVAILABLE",
  "OIDC_CALLBACK_INVALID",
  "REQUEST_TOO_LARGE",
  "METHOD_NOT_ALLOWED",
  "NOT_FOUND",
  "TRUST_STORE_UNAVAILABLE",
] as const;
export type PublicErrorCode = (typeof publicErrorCodes)[number];

export const release01Routes = [
  { method: "GET", path: "/health", operationId: "health.get" },
  { method: "GET", path: "/v1/auth/oidc/start", operationId: "auth.oidcStart" },
  {
    method: "GET",
    path: "/v1/auth/oidc/callback",
    operationId: "auth.oidcCallback",
  },
  {
    method: "POST",
    path: "/v1/auth/session",
    operationId: "auth.sessionCreate",
  },
  {
    method: "DELETE",
    path: "/v1/auth/session",
    operationId: "auth.sessionDelete",
  },
  { method: "GET", path: "/v1/workspaces", operationId: "workspaces.list" },
  { method: "GET", path: "/v1/applications", operationId: "applications.list" },
  {
    method: "POST",
    path: "/v1/applications",
    operationId: "applications.register",
  },
  {
    method: "GET",
    path: "/v1/policy-assignments",
    operationId: "policyAssignments.list",
  },
  {
    method: "POST",
    path: "/v1/policy-assignments",
    operationId: "policyAssignments.create",
  },
  {
    method: "DELETE",
    path: "/v1/policy-assignments/{assignmentId}",
    operationId: "policyAssignments.revoke",
  },
  { method: "GET", path: "/v1/schemas", operationId: "schemas.list" },
  {
    method: "GET",
    path: "/v1/schemas/{schemaKey}",
    operationId: "schemas.get",
  },
  { method: "GET", path: "/v1/datasets", operationId: "datasets.list" },
  {
    method: "GET",
    path: "/v1/datasets/{datasetId}",
    operationId: "datasets.get",
  },
  {
    method: "GET",
    path: "/v1/retention-policies",
    operationId: "retentionPolicies.list",
  },
  {
    method: "POST",
    path: "/v1/retention-policies",
    operationId: "retentionPolicies.create",
  },
  {
    method: "GET",
    path: "/v1/retention-policies/{policyId}",
    operationId: "retentionPolicies.get",
  },
  {
    method: "PUT",
    path: "/v1/retention-policies/{policyId}",
    operationId: "retentionPolicies.update",
  },
  { method: "GET", path: "/v1/resources", operationId: "resources.list" },
  {
    method: "GET",
    path: "/v1/resources/{resourceId}",
    operationId: "resources.get",
  },
  {
    method: "GET",
    path: "/v1/resources/{resourceId}/revision-graph",
    operationId: "revisions.graph",
  },
  {
    method: "POST",
    path: "/v1/resources/{resourceId}/revisions",
    operationId: "revisions.create",
  },
  {
    method: "POST",
    path: "/v1/resources/{resourceId}/delete",
    operationId: "resources.delete",
  },
  {
    method: "POST",
    path: "/v1/resources/{resourceId}/restore",
    operationId: "resources.restore",
  },
  {
    method: "GET",
    path: "/v1/deleted-resources",
    operationId: "deletedResources.list",
  },
  { method: "GET", path: "/v1/relations", operationId: "relations.list" },
  { method: "POST", path: "/v1/uploads", operationId: "uploads.create" },
  { method: "GET", path: "/v1/uploads/{uploadId}", operationId: "uploads.get" },
  {
    method: "GET",
    path: "/v1/uploads/{uploadId}/scan-status",
    operationId: "uploads.scanStatus",
  },
  {
    method: "POST",
    path: "/v1/uploads/{uploadId}/complete",
    operationId: "uploads.complete",
  },
  {
    method: "POST",
    path: "/v1/blobs/download-grants",
    operationId: "blobs.createDownloadGrant",
  },
  { method: "POST", path: "/v1/objects/ingest", operationId: "objects.ingest" },
  { method: "GET", path: "/v1/history", operationId: "history.list" },
  { method: "GET", path: "/v1/audit/events", operationId: "audit.list" },
  {
    method: "POST",
    path: "/v1/verification/runs",
    operationId: "verification.run",
  },
  {
    method: "GET",
    path: "/v1/verification/reports",
    operationId: "verification.list",
  },
  {
    method: "GET",
    path: "/v1/verification/reports/{reportId}",
    operationId: "verification.get",
  },
  {
    method: "GET",
    path: "/v1/operations/{operationId}",
    operationId: "operations.get",
  },
  { method: "GET", path: "/v1/health/storage", operationId: "storage.health" },
  {
    method: "POST",
    path: "/v1/health/storage/probe",
    operationId: "storage.probe",
  },
  {
    method: "GET",
    path: "/v1/applications/{applicationId}/tenants",
    operationId: "applicationTenants.list",
  },
  {
    method: "POST",
    path: "/v1/applications/{applicationId}/tenants",
    operationId: "applicationTenants.create",
  },
  {
    method: "GET",
    path: "/v1/applications/{applicationId}/storage",
    operationId: "applicationStorage.effective",
  },
  {
    method: "GET",
    path: "/v1/applications/{applicationId}/tenants/{tenantId}/storage",
    operationId: "applicationTenantStorage.effective",
  },
  {
    method: "GET",
    path: "/v1/storage/bindings/rollup",
    operationId: "storageBindings.rollup",
  },
  {
    method: "POST",
    path: "/v1/storage/bindings",
    operationId: "storageBindings.upsert",
  },
  {
    method: "POST",
    path: "/v1/storage/bindings/{bindingId}/probe",
    operationId: "storageBindings.probe",
  },
  {
    method: "POST",
    path: "/v1/storage/bindings/{bindingId}/plan/refresh",
    operationId: "storageBindings.planRefresh",
  },
  {
    method: "POST",
    path: "/v1/storage/bindings/{bindingId}/plan/accept",
    operationId: "storageBindings.planAccept",
  },
  {
    method: "POST",
    path: "/v1/storage/bindings/{bindingId}/disable",
    operationId: "storageBindings.disable",
  },
  {
    method: "POST",
    path: "/v1/storage/bindings/{bindingId}/rollback",
    operationId: "storageBindings.rollback",
  },
  {
    method: "POST",
    path: "/v1/storage/bindings/migrate/cutover",
    operationId: "storageBindings.migrateCutover",
  },
  { method: "GET", path: "/v1/health/backup", operationId: "backup.health" },
  {
    method: "POST",
    path: "/v1/portability/archives",
    operationId: "portability.archives.create",
  },
  {
    method: "POST",
    path: "/v1/portability/exports",
    operationId: "portability.exports.create",
  },
  {
    method: "GET",
    path: "/v1/portability/exports/{exportId}/download",
    operationId: "portability.exports.download",
  },
  {
    method: "GET",
    path: "/v1/portability/archives/{archiveId}",
    operationId: "portability.archives.get",
  },
  {
    method: "POST",
    path: "/v1/portability/plans",
    operationId: "portability.plans.create",
  },
  {
    method: "GET",
    path: "/v1/portability/plans/{planId}",
    operationId: "portability.plans.get",
  },
  {
    method: "POST",
    path: "/v1/portability/plans/{planId}/execute",
    operationId: "portability.plans.execute",
  },
  {
    method: "GET",
    path: "/v1/portability/operations/{operationId}",
    operationId: "portability.operations.get",
  },
  {
    method: "GET",
    path: "/v1/control-centre/snapshot",
    operationId: "control.snapshot",
  },
] as const satisfies readonly RouteContract[];

type Schema = Readonly<Record<string, unknown>>;
const ref = (name: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
});
const object = (
  properties: Readonly<Record<string, Schema>>,
  required: readonly string[] = Object.keys(properties),
  additionalProperties = false,
): Schema => ({ type: "object", properties, required, additionalProperties });
const array = (items: Schema): Schema => ({ type: "array", items });
const nullable = (schema: Schema): Schema => ({
  anyOf: [schema, { type: "null" }],
});
const id: Schema = { type: "string", minLength: 1 };
const dateTime: Schema = { type: "string", format: "date-time" };
const stringMap: Schema = { type: "object", additionalProperties: true };
const list = (name: string): Schema =>
  object({ items: array(ref(name)), nextCursor: { type: "string" } }, [
    "items",
  ]);

export const release01Schemas = {
  ApiError: object(
    {
      code: { type: "string", enum: publicErrorCodes },
      message: { type: "string" },
      details: stringMap,
      requestId: { type: "string" },
    },
    ["code", "message"],
  ),
  HealthResponse: object({
    service: { const: "trust-api" },
    status: { type: "string", enum: ["ok", "degraded"] },
    mode: { type: "string", enum: ["fixture", "live"] },
    checkedAt: dateTime,
  }),
  Actor: object({
    id,
    displayName: { type: "string" },
    roles: array({
      type: "string",
      enum: ["owner", "admin", "editor", "recovery_operator", "auditor"],
    }),
    workspaceIds: array(id),
  }),
  AdminSession: object({
    actor: ref("Actor"),
    csrfToken: { type: "string", minLength: 1 },
    expiresAt: dateTime,
  }),
  Workspace: object({
    id,
    name: { type: "string" },
    slug: { type: "string" },
    status: { type: "string", enum: ["active", "suspended", "closed"] },
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Application: object({
    id,
    workspaceId: id,
    namespace: { type: "string" },
    name: { type: "string" },
    applicationVersion: { type: "string" },
    schemaPackageIds: array(id),
    capabilities: array({ type: "string" }),
    status: { type: "string", enum: ["active", "suspended", "revoked"] },
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  RegisterApplication: object({
    workspaceId: id,
    namespace: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    applicationVersion: { type: "string", minLength: 1 },
    schemaPackageIds: array(id),
    capabilities: array({ type: "string" }),
    idempotencyKey: { type: "string", minLength: 1 },
  }),
  PolicyAssignment: object({
    id,
    workspaceId: id,
    principalType: {
      type: "string",
      enum: ["user", "service", "application"],
    },
    principalId: id,
    role: {
      type: "string",
      enum: ["owner", "admin", "editor", "recovery_operator", "auditor"],
    },
    scopeKind: {
      type: "string",
      enum: ["workspace", "dataset", "application"],
    },
    scopeId: id,
    createdBy: id,
    createdAt: dateTime,
    revokedAt: nullable(dateTime),
  }),
  CreatePolicyAssignment: object({
    workspaceId: id,
    principalType: {
      type: "string",
      enum: ["user", "service", "application"],
    },
    principalId: id,
    role: {
      type: "string",
      enum: ["owner", "admin", "editor", "recovery_operator", "auditor"],
    },
    scopeKind: {
      type: "string",
      enum: ["workspace", "dataset", "application"],
    },
    scopeId: id,
    idempotencyKey: { type: "string", minLength: 1 },
  }),
  RevokePolicyAssignment: object({
    workspaceId: id,
    idempotencyKey: { type: "string", minLength: 1 },
  }),
  SchemaPackage: object({
    id,
    key: { type: "string" },
    digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    status: { type: "string" },
    publishedAt: dateTime,
    manifest: stringMap,
  }),
  Dataset: object({
    id,
    workspaceId: id,
    schemaPackageId: id,
    datasetType: { type: "string" },
    name: { type: "string" },
    status: {
      type: "string",
      enum: ["active", "archived", "deleted_logically", "legal_hold"],
    },
    retentionPolicyId: nullable(id),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  RetentionPolicy: object(
    {
      id,
      workspaceId: id,
      name: { type: "string", minLength: 1 },
      recoveryWindowDays: { type: "integer", minimum: 0, maximum: 36500 },
      minimumHistoryDays: { type: "integer", minimum: 0, maximum: 36500 },
      backupRetentionDays: { type: "integer", minimum: 0, maximum: 36500 },
      purgeEnabled: { const: false },
      extensions: stringMap,
      createdBy: id,
      updatedBy: id,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
    undefined,
    true,
  ),
  CreateRetentionPolicy: object(
    {
      workspaceId: id,
      name: { type: "string", minLength: 1 },
      recoveryWindowDays: { type: "integer", minimum: 0, maximum: 36500 },
      minimumHistoryDays: { type: "integer", minimum: 0, maximum: 36500 },
      backupRetentionDays: { type: "integer", minimum: 0, maximum: 36500 },
      purgeEnabled: { const: false },
      idempotencyKey: { type: "string", minLength: 1 },
      extensions: stringMap,
    },
    [
      "workspaceId",
      "name",
      "recoveryWindowDays",
      "minimumHistoryDays",
      "backupRetentionDays",
      "purgeEnabled",
      "idempotencyKey",
    ],
    true,
  ),
  UpdateRetentionPolicy: object(
    {
      workspaceId: id,
      name: { type: "string", minLength: 1 },
      recoveryWindowDays: { type: "integer", minimum: 0, maximum: 36500 },
      minimumHistoryDays: { type: "integer", minimum: 0, maximum: 36500 },
      backupRetentionDays: { type: "integer", minimum: 0, maximum: 36500 },
      purgeEnabled: { const: false },
      idempotencyKey: { type: "string", minLength: 1 },
      expectedUpdatedAt: dateTime,
      extensions: stringMap,
    },
    [
      "workspaceId",
      "name",
      "recoveryWindowDays",
      "minimumHistoryDays",
      "backupRetentionDays",
      "purgeEnabled",
      "idempotencyKey",
      "expectedUpdatedAt",
    ],
    true,
  ),
  BlobOperationalMetadata: object(
    {
      encryptionState: {
        type: "string",
        enum: ["provider_managed", "customer_managed"],
      },
      encryptionKeyRef: nullable({ type: "string" }),
      verificationState: {
        type: "string",
        enum: ["pending", "verified", "failed"],
      },
    },
    undefined,
    true,
  ),
  BlobObject: object(
    {
      id,
      workspaceId: id,
      sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      byteLength: { type: "integer", minimum: 0 },
      mediaType: { type: "string" },
      storageProvider: { type: "string" },
      storageKey: { type: "string" },
      encryptionState: {
        type: "string",
        enum: ["provider_managed", "customer_managed"],
      },
      encryptionKeyRef: nullable({ type: "string" }),
      verificationState: {
        type: "string",
        enum: ["pending", "verified", "failed"],
      },
      createdAt: dateTime,
    },
    undefined,
    true,
  ),
  Resource: object({
    id,
    workspaceId: id,
    datasetId: id,
    resourceType: { type: "string" },
    title: nullable({ type: "string" }),
    status: {
      type: "string",
      enum: ["active", "archived", "deleted_logically", "legal_hold"],
    },
    currentRevisionId: nullable(id),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Revision: object({
    id,
    workspaceId: id,
    datasetId: id,
    resourceId: id,
    revisionNumber: { type: "integer", minimum: 1 },
    parentRevisionId: nullable(id),
    mergeParentRevisionIds: array(id),
    schemaPackageId: id,
    schemaVersion: { type: "string" },
    canonicalPayload: stringMap,
    canonicalPayloadHash: { type: "string" },
    createdBy: id,
    source: {
      type: "string",
      enum: ["user", "application", "import", "restore", "merge"],
    },
    changeNote: nullable({ type: "string" }),
    restoredFromRevisionId: nullable(id),
    createdAt: dateTime,
  }),
  RevisionGraph: object({
    resourceId: id,
    headRevisionId: nullable(id),
    revisions: array(ref("Revision")),
  }),
  RevisionCommand: object(
    {
      workspaceId: id,
      expectedRevisionId: nullable(id),
      schemaPackageId: id,
      schemaVersion: { type: "string" },
      canonicalPayload: stringMap,
      changeNote: { type: "string" },
    },
    [
      "workspaceId",
      "expectedRevisionId",
      "schemaPackageId",
      "schemaVersion",
      "canonicalPayload",
    ],
  ),
  RevisionResult: object({
    resourceId: id,
    revisionId: id,
    revisionNumber: { type: "integer" },
    source: {
      type: "string",
      enum: ["user", "application", "import", "restore", "merge"],
    },
    createdAt: dateTime,
  }),
  DeleteResourceCommand: object(
    {
      workspaceId: id,
      expectedRevisionId: nullable(id),
      recoverUntil: nullable(dateTime),
      reason: { type: "string" },
    },
    ["workspaceId", "expectedRevisionId", "recoverUntil"],
  ),
  DeleteResourceResult: object({
    resourceId: id,
    tombstoneId: id,
    deletedAt: dateTime,
    recoverUntil: nullable(dateTime),
  }),
  RestoreResourceCommand: object(
    { workspaceId: id, changeNote: { type: "string" } },
    ["workspaceId"],
  ),
  RecoverableItem: object({
    tombstoneId: id,
    workspaceId: id,
    datasetId: id,
    resourceId: id,
    resourceTitle: nullable({ type: "string" }),
    resourceType: { type: "string" },
    deletedAt: dateTime,
    recoverUntil: nullable(dateTime),
    deletedBy: id,
    priorRevisionId: nullable(id),
  }),
  Relation: object({
    id,
    workspaceId: id,
    datasetId: id,
    sourceKind: { type: "string" },
    sourceId: id,
    targetKind: { type: "string" },
    targetId: id,
    relationType: { type: "string" },
    metadata: stringMap,
    createdBy: id,
    createdAt: dateTime,
    endedAt: nullable(dateTime),
  }),
  TrustEvent: object({
    id,
    action: { type: "string" },
    subjectId: id,
    actorId: id,
    occurredAt: dateTime,
    metadata: stringMap,
  }),
  History: object({
    recoverable: array(ref("RecoverableItem")),
    events: array(ref("TrustEvent")),
  }),
  AuditEvent: object({
    id,
    workspaceId: id,
    datasetId: nullable(id),
    actorType: {
      type: "string",
      enum: ["user", "service", "application", "system"],
    },
    actorId: id,
    action: { type: "string" },
    subjectKind: { type: "string" },
    subjectId: id,
    occurredAt: dateTime,
    requestId: id,
    correlationId: id,
    operationId: nullable(id),
    eventHash: { type: "string" },
    metadata: stringMap,
  }),
  CreateUpload: object(
    {
      workspaceId: id,
      idempotencyKey: { type: "string", minLength: 1 },
      mediaType: { type: "string", minLength: 1 },
      expectedByteLength: { type: "integer", minimum: 0, maximum: 750000 },
      expectedSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      expiresInSeconds: { type: "integer", minimum: 60, maximum: 86400 },
    },
    [
      "workspaceId",
      "idempotencyKey",
      "mediaType",
      "expectedByteLength",
      "expectedSha256",
    ],
  ),
  CompleteUpload: object({
    workspaceId: id,
    bytesBase64: {
      type: "string",
      contentEncoding: "base64",
      maxLength: 1400000,
    },
  }),
  CreateDownloadGrant: object(
    {
      workspaceId: id,
      objectId: id,
      requestedTtlSeconds: { type: "integer", minimum: 1, maximum: 86400 },
      fileName: { type: "string", minLength: 1, maxLength: 180 },
      idempotencyKey: { type: "string", minLength: 1 },
    },
    ["workspaceId", "objectId", "requestedTtlSeconds", "idempotencyKey"],
  ),
  DownloadGrant: object({
    grantId: id,
    objectId: id,
    workspaceId: id,
    expiresAt: dateTime,
    transfer: object({
      method: { type: "string", enum: ["GET"] },
      url: { type: "string" },
      headers: stringMap,
    }),
  }),
  Upload: object({
    id,
    workspaceId: id,
    operationId: id,
    state: { type: "string" },
    status: {
      type: "string",
      enum: ["pending", "running", "succeeded", "failed", "quarantined"],
    },
    mediaType: { type: "string" },
    expectedByteLength: { type: "integer" },
    expectedSha256: { type: "string" },
    expiresAt: dateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
    completedAt: nullable(dateTime),
    blobId: nullable(id),
  }),
  UploadScanStatus: object({
    uploadId: id,
    workspaceId: id,
    state: {
      type: "string",
      enum: [
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
      ],
    },
    outcome: {
      type: "string",
      enum: [
        "clean",
        "malicious",
        "suspicious",
        "unsupported",
        "error",
        "timeout",
      ],
    },
    updatedAt: dateTime,
  }, ["uploadId", "workspaceId", "state", "updatedAt"]),
  ObjectIngest: object({
    workspaceId: id,
    idempotencyKey: { type: "string", minLength: 1 },
    mediaType: { type: "string" },
    bytesBase64: {
      type: "string",
      contentEncoding: "base64",
      maxLength: 1400000,
    },
  }),
  ObjectIngestResult: object({
    operationId: id,
    blob: ref("BlobObject"),
    deduplicated: { type: "boolean" },
    resumed: { type: "boolean" },
  }),
  VerificationScope: object({
    kind: {
      type: "string",
      enum: ["blob", "resource", "dataset", "workspace"],
    },
    id,
  }),
  RunVerification: object(
    {
      workspaceId: id,
      level: {
        type: "string",
        enum: ["metadata", "full_blob", "resource", "dataset", "workspace"],
      },
      scope: ref("VerificationScope"),
    },
    ["workspaceId", "level"],
  ),
  VerificationIssue: object(
    {
      code: { type: "string" },
      severity: { type: "string", enum: ["warning", "error", "critical"] },
      subjectKind: { type: "string" },
      subjectId: id,
      message: { type: "string" },
      expected: {},
      actual: {},
    },
    ["code", "severity", "subjectKind", "subjectId", "message"],
  ),
  VerificationRun: object({
    id,
    workspaceId: id,
    level: { type: "string" },
    scope: ref("VerificationScope"),
    status: {
      type: "string",
      enum: ["running", "passed", "failed", "degraded"],
    },
    startedAt: dateTime,
    completedAt: nullable(dateTime),
    objectsChecked: { type: "integer" },
    bytesRead: { type: "integer" },
    issues: array(ref("VerificationIssue")),
  }),
  Operation: object({
    id,
    workspaceId: id,
    type: { type: "string" },
    state: { type: "string" },
    status: { type: "string" },
    requestedBy: id,
    retryCount: { type: "integer" },
    errorCode: nullable({ type: "string" }),
    createdAt: dateTime,
    updatedAt: dateTime,
    completedAt: nullable(dateTime),
  }),
  UploadArchive: object({
    workspaceId: id,
    idempotencyKey: { type: "string", minLength: 1 },
    archiveBase64: { type: "string", minLength: 1, maxLength: 12000000 },
  }),
  ArchiveCandidate: object({
    id,
    workspaceId: id,
    exportId: id,
    status: { type: "string", enum: ["verified", "rejected"] },
    checkedEntries: { type: "integer", minimum: 0 },
    issueCount: { type: "integer", minimum: 0 },
    recordCounts: stringMap,
    blobCount: { type: "integer", minimum: 0 },
    totalBlobBytes: { type: "integer", minimum: 0 },
    createdAt: dateTime,
  }),
  CreateArchiveExport: object({
    workspaceId: id,
    datasetIds: array(id),
    idempotencyKey: { type: "string", minLength: 1 },
  }),
  ArchiveExport: object({
    id,
    workspaceId: id,
    datasetIds: array(id),
    status: { const: "ready" },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    byteLength: { type: "integer", minimum: 1 },
    createdAt: dateTime,
  }),
  ArchiveDownload: object({
    id,
    workspaceId: id,
    datasetIds: array(id),
    status: { const: "ready" },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    byteLength: { type: "integer", minimum: 1 },
    createdAt: dateTime,
    mediaType: { const: "application/vnd.trust-core.archive+zip" },
    filename: { type: "string", minLength: 1 },
    archiveBase64: { type: "string", minLength: 1 },
  }),
  CreateImportPlan: object({
    workspaceId: id,
    archiveId: id,
    idempotencyKey: { type: "string", minLength: 1 },
    mode: { type: "string", enum: ["preserve_ids", "mapped_workspace"] },
    conflictMode: {
      type: "string",
      enum: ["reject_on_error", "report_only"],
    },
  }),
  ImportPlan: object({
    id,
    archiveId: id,
    workspaceId: id,
    sourceWorkspaceId: id,
    mode: { type: "string", enum: ["preserve_ids", "mapped_workspace"] },
    conflictMode: {
      type: "string",
      enum: ["reject_on_error", "report_only"],
    },
    status: { type: "string", enum: ["ready", "rejected", "report_only"] },
    issueCount: { type: "integer", minimum: 0 },
    counts: stringMap,
    createdAt: dateTime,
  }),
  ExecuteImport: object({
    workspaceId: id,
    idempotencyKey: { type: "string", minLength: 1 },
    confirmation: { const: "IMPORT" },
  }),
  ImportOperation: object({
    id,
    workspaceId: id,
    planId: id,
    archiveId: id,
    checkpoint: { type: "string" },
    status: { type: "string", enum: ["running", "completed"] },
    resumed: { type: "boolean" },
    updatedAt: dateTime,
    completedAt: nullable(dateTime),
  }),
  StorageConsoleLink: object({
    id: { type: "string" },
    label: { type: "string" },
    url: { type: "string", format: "uri" },
  }),
  StorageProbeResult: object(
    {
      probeId: id,
      tier: { type: "string", enum: ["connectivity", "ingest"] },
      ok: { type: "boolean" },
      latencyMs: { type: "integer", minimum: 0 },
      issueClass: nullable({
        type: "string",
        enum: [
          "not_configured",
          "auth",
          "permission",
          "not_found",
          "wrong_region",
          "network",
          "provider_outage",
          "internal",
        ],
      }),
      issueCode: nullable({ type: "string" }),
      checkedAt: dateTime,
      summary: { type: "string" },
      billingHint: { type: "string" },
      bucketRegion: nullable({ type: "string" }),
      regionMatch: nullable({ type: "boolean" }),
    },
    [
      "probeId",
      "tier",
      "ok",
      "latencyMs",
      "issueClass",
      "issueCode",
      "checkedAt",
      "summary",
    ],
  ),
  StorageHealthDetails: object(
    {
      provider: { type: "string", enum: ["minio", "s3"] },
      region: { type: "string" },
      bucket: { type: "string" },
      credentialMode: {
        type: "string",
        enum: ["iam_role", "static_keys_configured", "missing"],
      },
      endpointHost: nullable({ type: "string" }),
      transferSignerConfigured: { type: "boolean" },
      objectStorageConfigured: { type: "boolean" },
      cataloguedObjects: { type: "integer", minimum: 0 },
      failedVerificationObjects: { type: "integer", minimum: 0 },
      consoleLinks: array(ref("StorageConsoleLink")),
      probe: nullable(ref("StorageProbeResult")),
      minimalIamActions: array({ type: "string" }),
      scannerConfigured: { type: "boolean" },
    },
    [
      "provider",
      "region",
      "bucket",
      "credentialMode",
      "endpointHost",
      "transferSignerConfigured",
      "objectStorageConfigured",
      "cataloguedObjects",
      "failedVerificationObjects",
      "consoleLinks",
      "probe",
    ],
  ),
  ServiceHealth: object({
    status: { type: "string", enum: ["healthy", "degraded", "not_configured"] },
    checkedAt: dateTime,
    summary: { type: "string" },
    details: {
      description:
        "For storage.health / storage.probe, prefer StorageHealthDetails. Other health endpoints may use opaque maps.",
      anyOf: [ref("StorageHealthDetails"), stringMap],
    },
  }),
  ProbeStorage: object(
    {
      workspaceId: id,
      tier: {
        type: "string",
        enum: ["connectivity", "ingest"],
      },
    },
    ["workspaceId"],
  ),
  ApplicationTenant: object(
    {
      id,
      workspaceId: id,
      applicationId: id,
      externalTenantKey: { type: "string", minLength: 1 },
      displayName: { type: "string", minLength: 1 },
      status: { type: "string", enum: ["active", "suspended", "closed"] },
      createdAt: dateTime,
      updatedAt: dateTime,
    },
    [
      "id",
      "workspaceId",
      "applicationId",
      "externalTenantKey",
      "displayName",
      "status",
      "createdAt",
      "updatedAt",
    ],
  ),
  CreateApplicationTenant: object(
    {
      workspaceId: id,
      externalTenantKey: { type: "string", minLength: 1 },
      displayName: { type: "string", minLength: 1 },
      idempotencyKey: { type: "string", minLength: 1 },
    },
    ["workspaceId", "externalTenantKey", "displayName", "idempotencyKey"],
  ),
  EffectiveStorageSummary: stringMap,
  StorageBindingRollup: stringMap,
  StorageBindingSummary: stringMap,
  UpsertStorageBinding: object(
    {
      workspaceId: id,
      applicationId: id,
      applicationTenantId: nullable(id),
      provider: { type: "string", enum: ["minio", "s3"] },
      region: { type: "string", minLength: 1 },
      bucket: { type: "string", minLength: 1 },
      prefix: { type: "string" },
      tier: { type: "string", enum: ["managed", "byob", "premium"] },
      credentialMode: {
        type: "string",
        enum: [
          "platform_iam",
          "cross_account_role",
          "static_keys_ref",
          "missing",
        ],
      },
      expectedBucketOwner: nullable({ type: "string" }),
      endpointHost: nullable({ type: "string" }),
      roleArn: nullable({ type: "string" }),
      declaredPlanCode: nullable({ type: "string" }),
      declaredCapacityBytes: nullable({ type: "integer", minimum: 0 }),
      idempotencyKey: { type: "string", minLength: 1 },
    },
    [
      "workspaceId",
      "applicationId",
      "provider",
      "region",
      "bucket",
      "tier",
      "credentialMode",
      "idempotencyKey",
    ],
  ),
  ProbeStorageBinding: object(
    {
      workspaceId: id,
      tier: { type: "string", enum: ["connectivity", "ingest"] },
    },
    ["workspaceId"],
  ),
  RefreshStoragePlan: object(
    {
      workspaceId: id,
      observedQuotaBytes: { type: "integer", minimum: 0 },
      observedUsageBytes: { type: "integer", minimum: 0 },
    },
    ["workspaceId"],
  ),
  AcceptStoragePlan: object(
    {
      workspaceId: id,
      declaredCapacityBytes: { type: "integer", minimum: 0 },
      planCode: { type: "string" },
    },
    ["workspaceId", "declaredCapacityBytes"],
  ),
  CutoverStorageMigrate: object(
    {
      workspaceId: id,
      sourceBindingId: id,
      targetBindingId: id,
      objectDigests: array(
        object(
          {
            objectId: id,
            sha256: { type: "string", minLength: 64, maxLength: 64 },
          },
          ["objectId", "sha256"],
        ),
      ),
      idempotencyKey: { type: "string", minLength: 1 },
    },
    [
      "workspaceId",
      "sourceBindingId",
      "targetBindingId",
      "objectDigests",
      "idempotencyKey",
    ],
  ),
  ApplicationTenantList: list("ApplicationTenant"),
  ControlCentreSnapshot: object({
    status: stringMap,
    datasets: array(stringMap),
  }),
  WorkspaceList: list("Workspace"),
  ApplicationList: list("Application"),
  PolicyAssignmentList: list("PolicyAssignment"),
  SchemaPackageList: list("SchemaPackage"),
  DatasetList: list("Dataset"),
  RetentionPolicyList: list("RetentionPolicy"),
  ResourceList: list("Resource"),
  RecoverableList: list("RecoverableItem"),
  RelationList: list("Relation"),
  AuditEventList: list("AuditEvent"),
  VerificationRunList: list("VerificationRun"),
} as const;

const pathParameter = (name: string) => ({
  name,
  in: "path",
  required: true,
  schema: id,
});
const contextParameters = (workspaceRequired: boolean) => [
  {
    name: "x-trust-workspace-id",
    in: "header",
    required: workspaceRequired,
    schema: id,
    description: workspaceRequired
      ? "Required workspace context."
      : "Optional when workspaceId is supplied in the request body.",
  },
  { name: "x-trust-application-id", in: "header", required: false, schema: id },
  { name: "x-trust-dataset-id", in: "header", required: false, schema: id },
];
const readContextParameters = contextParameters(true);
const bodyContextParameters = contextParameters(false);
const readSecurity = [{ bearerAuth: [] }, { sessionCookie: [] }];
const mutationSecurity = [
  { bearerAuth: [] },
  { sessionCookie: [], csrfToken: [] },
];
const response = (schemaName: string) => ({
  "200": {
    description: "Successful response",
    content: { "application/json": { schema: ref(schemaName) } },
  },
  default: { $ref: "#/components/responses/Error" },
});
const noContent = {
  "204": { description: "Session ended" },
  default: { $ref: "#/components/responses/Error" },
};
const body = (schemaName: string) => ({
  required: true,
  content: { "application/json": { schema: ref(schemaName) } },
});
const operation = (
  operationId: string,
  schemaName: string,
  options: {
    body?: string;
    parameters?: readonly unknown[];
    security?: readonly unknown[];
    redirect?: boolean;
    mutation?: boolean;
  } = {},
) => ({
  operationId,
  ...(options.parameters ? { parameters: options.parameters } : {}),
  ...(options.body ? { requestBody: body(options.body) } : {}),
  security:
    options.security ??
    (options.body || options.mutation ? mutationSecurity : readSecurity),
  responses: options.redirect
    ? {
        "302": { description: "Browser redirect" },
        default: { $ref: "#/components/responses/Error" },
      }
    : response(schemaName),
});

export const release01OpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Trust Core API",
    version: "0.1.0",
    description: "Release 0.1 actual HTTP contract.",
  },
  servers: [{ url: "/api" }],
  paths: {
    "/health": {
      get: operation("health.get", "HealthResponse", { security: [] }),
    },
    "/v1/auth/oidc/start": {
      get: operation("auth.oidcStart", "ApiError", {
        security: [],
        redirect: true,
        parameters: [
          {
            name: "returnTo",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
      }),
    },
    "/v1/auth/oidc/callback": {
      get: operation("auth.oidcCallback", "ApiError", {
        security: [],
        redirect: true,
        parameters: [
          { name: "state", in: "query", required: true, schema: id },
          { name: "code", in: "query", required: true, schema: id },
        ],
      }),
    },
    "/v1/auth/session": {
      post: operation("auth.sessionCreate", "AdminSession", {
        security: [{ bearerAuth: [] }],
      }),
      delete: {
        ...operation("auth.sessionDelete", "ApiError", {
          security: [{ sessionCookie: [], csrfToken: [] }],
          mutation: true,
        }),
        responses: noContent,
      },
    },
    "/v1/workspaces": {
      get: operation("workspaces.list", "WorkspaceList", {
        parameters: readContextParameters,
      }),
    },
    "/v1/applications": {
      get: operation("applications.list", "ApplicationList", {
        parameters: readContextParameters,
      }),
      post: operation("applications.register", "Application", {
        body: "RegisterApplication",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/policy-assignments": {
      get: operation("policyAssignments.list", "PolicyAssignmentList", {
        parameters: readContextParameters,
      }),
      post: operation("policyAssignments.create", "PolicyAssignment", {
        body: "CreatePolicyAssignment",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/policy-assignments/{assignmentId}": {
      delete: operation("policyAssignments.revoke", "PolicyAssignment", {
        body: "RevokePolicyAssignment",
        parameters: [pathParameter("assignmentId"), ...bodyContextParameters],
      }),
    },
    "/v1/schemas": {
      get: operation("schemas.list", "SchemaPackageList", {
        parameters: readContextParameters,
      }),
    },
    "/v1/schemas/{schemaKey}": {
      get: operation("schemas.get", "SchemaPackage", {
        parameters: [pathParameter("schemaKey"), ...readContextParameters],
      }),
    },
    "/v1/datasets": {
      get: operation("datasets.list", "DatasetList", {
        parameters: readContextParameters,
      }),
    },
    "/v1/datasets/{datasetId}": {
      get: operation("datasets.get", "Dataset", {
        parameters: [pathParameter("datasetId"), ...readContextParameters],
      }),
    },
    "/v1/retention-policies": {
      get: operation("retentionPolicies.list", "RetentionPolicyList", {
        parameters: readContextParameters,
      }),
      post: operation("retentionPolicies.create", "RetentionPolicy", {
        body: "CreateRetentionPolicy",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/retention-policies/{policyId}": {
      get: operation("retentionPolicies.get", "RetentionPolicy", {
        parameters: [pathParameter("policyId"), ...readContextParameters],
      }),
      put: operation("retentionPolicies.update", "RetentionPolicy", {
        body: "UpdateRetentionPolicy",
        parameters: [pathParameter("policyId"), ...bodyContextParameters],
      }),
    },
    "/v1/resources": {
      get: operation("resources.list", "ResourceList", {
        parameters: readContextParameters,
      }),
    },
    "/v1/resources/{resourceId}": {
      get: operation("resources.get", "Resource", {
        parameters: [pathParameter("resourceId"), ...readContextParameters],
      }),
    },
    "/v1/resources/{resourceId}/revision-graph": {
      get: operation("revisions.graph", "RevisionGraph", {
        parameters: [pathParameter("resourceId"), ...readContextParameters],
      }),
    },
    "/v1/resources/{resourceId}/revisions": {
      post: operation("revisions.create", "RevisionResult", {
        body: "RevisionCommand",
        parameters: [pathParameter("resourceId"), ...bodyContextParameters],
      }),
    },
    "/v1/resources/{resourceId}/delete": {
      post: operation("resources.delete", "DeleteResourceResult", {
        body: "DeleteResourceCommand",
        parameters: [pathParameter("resourceId"), ...bodyContextParameters],
      }),
    },
    "/v1/resources/{resourceId}/restore": {
      post: operation("resources.restore", "RevisionResult", {
        body: "RestoreResourceCommand",
        parameters: [pathParameter("resourceId"), ...bodyContextParameters],
      }),
    },
    "/v1/deleted-resources": {
      get: operation("deletedResources.list", "RecoverableList", {
        parameters: readContextParameters,
      }),
    },
    "/v1/relations": {
      get: operation("relations.list", "RelationList", {
        parameters: readContextParameters,
      }),
    },
    "/v1/uploads": {
      post: operation("uploads.create", "Upload", {
        body: "CreateUpload",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/uploads/{uploadId}": {
      get: operation("uploads.get", "Upload", {
        parameters: [pathParameter("uploadId"), ...readContextParameters],
      }),
    },
    "/v1/uploads/{uploadId}/scan-status": {
      get: operation("uploads.scanStatus", "UploadScanStatus", {
        parameters: [pathParameter("uploadId"), ...readContextParameters],
      }),
    },
    "/v1/uploads/{uploadId}/complete": {
      post: operation("uploads.complete", "Upload", {
        body: "CompleteUpload",
        parameters: [pathParameter("uploadId"), ...bodyContextParameters],
      }),
    },
    "/v1/blobs/download-grants": {
      post: operation("blobs.createDownloadGrant", "DownloadGrant", {
        body: "CreateDownloadGrant",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/objects/ingest": {
      post: operation("objects.ingest", "ObjectIngestResult", {
        body: "ObjectIngest",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/history": {
      get: operation("history.list", "History", {
        parameters: readContextParameters,
      }),
    },
    "/v1/audit/events": {
      get: operation("audit.list", "AuditEventList", {
        parameters: readContextParameters,
      }),
    },
    "/v1/verification/runs": {
      post: operation("verification.run", "VerificationRun", {
        body: "RunVerification",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/verification/reports": {
      get: operation("verification.list", "VerificationRunList", {
        parameters: readContextParameters,
      }),
    },
    "/v1/verification/reports/{reportId}": {
      get: operation("verification.get", "VerificationRun", {
        parameters: [pathParameter("reportId"), ...readContextParameters],
      }),
    },
    "/v1/operations/{operationId}": {
      get: operation("operations.get", "Operation", {
        parameters: [pathParameter("operationId"), ...readContextParameters],
      }),
    },
    "/v1/health/storage": {
      get: operation("storage.health", "ServiceHealth", {
        parameters: readContextParameters,
      }),
    },
    "/v1/health/storage/probe": {
      post: operation("storage.probe", "ServiceHealth", {
        body: "ProbeStorage",
        parameters: bodyContextParameters,
        mutation: true,
      }),
    },
    "/v1/applications/{applicationId}/tenants": {
      get: operation("applicationTenants.list", "ApplicationTenantList", {
        parameters: [pathParameter("applicationId"), ...readContextParameters],
      }),
      post: operation("applicationTenants.create", "ApplicationTenant", {
        body: "CreateApplicationTenant",
        parameters: [
          pathParameter("applicationId"),
          ...bodyContextParameters,
        ],
        mutation: true,
      }),
    },
    "/v1/applications/{applicationId}/storage": {
      get: operation("applicationStorage.effective", "EffectiveStorageSummary", {
        parameters: [pathParameter("applicationId"), ...readContextParameters],
      }),
    },
    "/v1/applications/{applicationId}/tenants/{tenantId}/storage": {
      get: operation(
        "applicationTenantStorage.effective",
        "EffectiveStorageSummary",
        {
          parameters: [
            pathParameter("applicationId"),
            pathParameter("tenantId"),
            ...readContextParameters,
          ],
        },
      ),
    },
    "/v1/storage/bindings/rollup": {
      get: operation("storageBindings.rollup", "StorageBindingRollup", {
        parameters: readContextParameters,
      }),
    },
    "/v1/storage/bindings": {
      post: operation("storageBindings.upsert", "StorageBindingSummary", {
        body: "UpsertStorageBinding",
        parameters: bodyContextParameters,
        mutation: true,
      }),
    },
    "/v1/storage/bindings/{bindingId}/probe": {
      post: operation("storageBindings.probe", "StorageBindingSummary", {
        body: "ProbeStorageBinding",
        parameters: [pathParameter("bindingId"), ...bodyContextParameters],
        mutation: true,
      }),
    },
    "/v1/storage/bindings/{bindingId}/plan/refresh": {
      post: operation("storageBindings.planRefresh", "StorageBindingSummary", {
        body: "RefreshStoragePlan",
        parameters: [pathParameter("bindingId"), ...bodyContextParameters],
        mutation: true,
      }),
    },
    "/v1/storage/bindings/{bindingId}/plan/accept": {
      post: operation("storageBindings.planAccept", "StorageBindingSummary", {
        body: "AcceptStoragePlan",
        parameters: [pathParameter("bindingId"), ...bodyContextParameters],
        mutation: true,
      }),
    },
    "/v1/storage/bindings/{bindingId}/disable": {
      post: operation("storageBindings.disable", "StorageBindingSummary", {
        parameters: [pathParameter("bindingId"), ...readContextParameters],
        mutation: true,
      }),
    },
    "/v1/storage/bindings/{bindingId}/rollback": {
      post: operation("storageBindings.rollback", "StorageBindingSummary", {
        parameters: [pathParameter("bindingId"), ...readContextParameters],
        mutation: true,
      }),
    },
    "/v1/storage/bindings/migrate/cutover": {
      post: operation(
        "storageBindings.migrateCutover",
        "StorageBindingSummary",
        {
          body: "CutoverStorageMigrate",
          parameters: bodyContextParameters,
          mutation: true,
        },
      ),
    },
    "/v1/health/backup": {
      get: operation("backup.health", "ServiceHealth", {
        parameters: readContextParameters,
      }),
    },
    "/v1/portability/archives": {
      post: operation("portability.archives.create", "ArchiveCandidate", {
        body: "UploadArchive",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/portability/exports": {
      post: operation("portability.exports.create", "ArchiveExport", {
        body: "CreateArchiveExport",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/portability/exports/{exportId}/download": {
      get: operation("portability.exports.download", "ArchiveDownload", {
        parameters: [pathParameter("exportId"), ...readContextParameters],
      }),
    },
    "/v1/portability/archives/{archiveId}": {
      get: operation("portability.archives.get", "ArchiveCandidate", {
        parameters: [pathParameter("archiveId"), ...readContextParameters],
      }),
    },
    "/v1/portability/plans": {
      post: operation("portability.plans.create", "ImportPlan", {
        body: "CreateImportPlan",
        parameters: bodyContextParameters,
      }),
    },
    "/v1/portability/plans/{planId}": {
      get: operation("portability.plans.get", "ImportPlan", {
        parameters: [pathParameter("planId"), ...readContextParameters],
      }),
    },
    "/v1/portability/plans/{planId}/execute": {
      post: operation("portability.plans.execute", "ImportOperation", {
        body: "ExecuteImport",
        parameters: [pathParameter("planId"), ...bodyContextParameters],
      }),
    },
    "/v1/portability/operations/{operationId}": {
      get: operation("portability.operations.get", "ImportOperation", {
        parameters: [pathParameter("operationId"), ...readContextParameters],
      }),
    },
    "/v1/control-centre/snapshot": {
      get: operation("control.snapshot", "ControlCentreSnapshot", {
        parameters: readContextParameters,
      }),
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "trust_session",
        description: "Browser session. Mutations also require x-trust-csrf.",
      },
      csrfToken: {
        type: "apiKey",
        in: "header",
        name: "x-trust-csrf",
        description:
          "Required with trust_session for cookie-authenticated mutations.",
      },
    },
    responses: {
      Error: {
        description: "Stable API error envelope",
        content: { "application/json": { schema: ref("ApiError") } },
      },
    },
    schemas: release01Schemas,
  },
} as const;
