import { verificationLevels } from "@trust-core/protocol";
import type {
  ApiErrorResponse,
  ApplicationRegistration,
  AuthenticatedActor,
  CompleteUploadCommand,
  ControlCentreSnapshot,
  CreatePolicyAssignmentCommand,
  CreateArchiveExportCommand,
  CreateDownloadGrantCommand,
  CreateUploadCommand,
  CreateImportPlanCommand,
  CreateRetentionPolicyCommand,
  DeleteResourceCommand,
  DeleteResourceResult,
  DownloadGrant,
  HealthResponse,
  HistorySnapshot,
  PublicErrorCode,
  PolicyAssignment,
  ProbeStorageCommand,
  RegisterApplicationCommand,
  RestoreResourceCommand,
  RevokePolicyAssignmentCommand,
  RetentionPolicyRecord,
  RevisionCommand,
  RevisionCommandResult,
  RunVerificationCommand,
  ExecuteImportCommand,
  TrustAction,
  UploadSession,
  UploadScanStatus,
  UploadArchiveCommand,
  UpdateRetentionPolicyCommand,
  VerificationRunResult,
} from "@trust-core/protocol";
import type { ObjectIngestResult } from "@trust-core/operations";
import { evaluatePolicy } from "@trust-core/policy";
import type { PolicyScope } from "@trust-core/policy";
import type { PublishedSchemaPackage } from "@trust-core/schema-registry";
import type { PortabilityProvider } from "./portability.js";

export type ApiAction = TrustAction;
export interface ObjectIngestCommand {
  workspaceId: string;
  idempotencyKey: string;
  mediaType: string;
  bytesBase64: string;
}
export interface SnapshotProvider {
  getSnapshot(): Promise<ControlCentreSnapshot>;
}
export interface SchemaProvider {
  listSchemas(): Promise<readonly PublishedSchemaPackage[]>;
  getSchema(key: string): Promise<PublishedSchemaPackage | undefined>;
}
export interface ApiResult {
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
}
export interface ApiRequest {
  headers?: Readonly<Record<string, string | undefined>>;
  body?: unknown;
}

export interface CommandProvider {
  listWorkspaces(workspaceId: string): Promise<unknown>;
  listApplications(workspaceId: string): Promise<unknown>;
  registerApplication(
    actor: AuthenticatedActor,
    command: RegisterApplicationCommand,
  ): Promise<ApplicationRegistration>;
  listPolicyAssignments(workspaceId: string): Promise<unknown>;
  createPolicyAssignment(
    actor: AuthenticatedActor,
    command: CreatePolicyAssignmentCommand,
  ): Promise<PolicyAssignment>;
  revokePolicyAssignment(
    assignmentId: string,
    actor: AuthenticatedActor,
    command: RevokePolicyAssignmentCommand,
  ): Promise<PolicyAssignment>;
  listDatasets(workspaceId: string): Promise<unknown>;
  getDataset(
    workspaceId: string,
    datasetId: string,
  ): Promise<unknown | undefined>;
  listRetentionPolicies(workspaceId: string): Promise<unknown>;
  getRetentionPolicy(
    workspaceId: string,
    policyId: string,
  ): Promise<RetentionPolicyRecord | undefined>;
  createRetentionPolicy(
    actor: AuthenticatedActor,
    command: CreateRetentionPolicyCommand,
  ): Promise<RetentionPolicyRecord>;
  updateRetentionPolicy(
    policyId: string,
    actor: AuthenticatedActor,
    command: UpdateRetentionPolicyCommand,
  ): Promise<RetentionPolicyRecord>;
  listResources(workspaceId: string, datasetId?: string): Promise<unknown>;
  getResource(
    workspaceId: string,
    resourceId: string,
  ): Promise<unknown | undefined>;
  getRevisionGraph(
    workspaceId: string,
    resourceId: string,
  ): Promise<unknown | undefined>;
  listRelations(workspaceId: string, datasetId?: string): Promise<unknown>;
  listDeletedResources(
    workspaceId: string,
    datasetId?: string,
  ): Promise<unknown>;
  getHistory(workspaceId: string, datasetId?: string): Promise<HistorySnapshot>;
  listAuditEvents(workspaceId: string, datasetId?: string): Promise<unknown>;
  createRevision(
    resourceId: string,
    actor: AuthenticatedActor,
    command: RevisionCommand,
  ): Promise<RevisionCommandResult>;
  deleteResource(
    resourceId: string,
    actor: AuthenticatedActor,
    command: DeleteResourceCommand,
  ): Promise<DeleteResourceResult>;
  restoreResource(
    resourceId: string,
    actor: AuthenticatedActor,
    command: RestoreResourceCommand,
  ): Promise<RevisionCommandResult>;
  runVerification(
    actor: AuthenticatedActor,
    command: RunVerificationCommand,
  ): Promise<VerificationRunResult>;
  listVerificationReports(workspaceId: string): Promise<unknown>;
  getVerificationReport(
    workspaceId: string,
    reportId: string,
  ): Promise<unknown | undefined>;
  getOperation(
    workspaceId: string,
    operationId: string,
  ): Promise<unknown | undefined>;
  getStorageHealth(workspaceId: string): Promise<unknown>;
  probeStorageHealth?(
    actor: AuthenticatedActor,
    command: ProbeStorageCommand,
  ): Promise<unknown>;
  getBackupHealth(workspaceId: string): Promise<unknown>;
  createUpload(
    actor: AuthenticatedActor,
    command: CreateUploadCommand,
  ): Promise<UploadSession>;
  getUpload(
    workspaceId: string,
    uploadId: string,
    actor: AuthenticatedActor,
  ): Promise<UploadSession | undefined>;
  getUploadScanStatus(
    workspaceId: string,
    uploadId: string,
    actor: AuthenticatedActor,
  ): Promise<UploadScanStatus | undefined>;
  completeUpload(
    uploadId: string,
    actor: AuthenticatedActor,
    command: CompleteUploadCommand,
  ): Promise<UploadSession>;
  createDownloadGrant?(
    actor: AuthenticatedActor,
    command: CreateDownloadGrantCommand,
  ): Promise<DownloadGrant>;
  ingestObject?(
    actor: AuthenticatedActor,
    command: ObjectIngestCommand,
  ): Promise<ObjectIngestResult>;
}

export interface AuthorizationScope extends PolicyScope {
  requestId?: string;
  applicationScopeAllowed?: boolean;
}
export interface AccessGateway {
  authenticate(bearerToken: string): Promise<AuthenticatedActor | undefined>;
  authenticateSession?(
    sessionId: string,
    csrfToken: string | undefined,
    mutation: boolean,
  ): Promise<AuthenticatedActor | undefined>;
  allows(
    actor: AuthenticatedActor,
    action: ApiAction,
    scope: AuthorizationScope,
  ): boolean | Promise<boolean>;
  confirmsPrivilegedAction?(
    actor: AuthenticatedActor,
    proof: string | undefined,
  ): boolean | Promise<boolean>;
}

export function roleAllows(
  actor: AuthenticatedActor,
  action: ApiAction,
  scope: string | AuthorizationScope,
): boolean {
  const workspaceId = typeof scope === "string" ? scope : scope.workspaceId;
  return evaluatePolicy({
    principal: {
      id: actor.id,
      type: "user",
      roles: actor.roles,
      workspaceIds: actor.workspaceIds,
    },
    action,
    scope: { workspaceId },
  }).allowed;
}

export function createApi(
  provider: SnapshotProvider,
  schemas: SchemaProvider,
  clock: () => Date = () => new Date(),
  mode: "fixture" | "live" = "fixture",
  commands?: CommandProvider,
  access?: AccessGateway,
  portability?: PortabilityProvider,
) {
  return async function route(
    method: string,
    pathname: string,
    request: ApiRequest = {},
  ): Promise<ApiResult> {
    if (pathname === "/health" && method === "GET")
      return {
        status: 200,
        body: {
          service: "trust-api",
          status: "ok",
          mode,
          checkedAt: clock().toISOString(),
        } satisfies HealthResponse,
      };

    const datasetMatch = match(pathname, /^\/v1\/datasets\/([^/]+)$/);
    const resourceMatch = match(pathname, /^\/v1\/resources\/([^/]+)$/);
    const retentionPolicyMatch = match(
      pathname,
      /^\/v1\/retention-policies\/([^/]+)$/,
    );
    const policyAssignmentMatch = match(
      pathname,
      /^\/v1\/policy-assignments\/([^/]+)$/,
    );
    const revisionGraphMatch = match(
      pathname,
      /^\/v1\/resources\/([^/]+)\/revision-graph$/,
    );
    const revisionMatch = match(
      pathname,
      /^\/v1\/resources\/([^/]+)\/revisions$/,
    );
    const deleteMatch = match(pathname, /^\/v1\/resources\/([^/]+)\/delete$/);
    const restoreMatch = match(pathname, /^\/v1\/resources\/([^/]+)\/restore$/);
    const schemaMatch = match(pathname, /^\/v1\/schemas\/(.+)$/);
    const reportMatch = match(
      pathname,
      /^\/v1\/verification\/reports\/([^/]+)$/,
    );
    const operationMatch = match(pathname, /^\/v1\/operations\/([^/]+)$/);
    const uploadMatch = match(pathname, /^\/v1\/uploads\/([^/]+)$/);
    const uploadScanStatusMatch = match(
      pathname,
      /^\/v1\/uploads\/([^/]+)\/scan-status$/,
    );
    const uploadCompleteMatch = match(
      pathname,
      /^\/v1\/uploads\/([^/]+)\/complete$/,
    );
    const archiveMatch = match(
      pathname,
      /^\/v1\/portability\/archives\/([^/]+)$/,
    );
    const exportDownloadMatch = match(
      pathname,
      /^\/v1\/portability\/exports\/([^/]+)\/download$/,
    );
    const importPlanMatch = match(
      pathname,
      /^\/v1\/portability\/plans\/([^/]+)$/,
    );
    const importExecuteMatch = match(
      pathname,
      /^\/v1\/portability\/plans\/([^/]+)\/execute$/,
    );
    const importOperationMatch = match(
      pathname,
      /^\/v1\/portability\/operations\/([^/]+)$/,
    );

    if (pathname === "/v1/workspaces" && method === "GET")
      return secured(
        "workspace:read",
        method,
        request,
        commands,
        access,
        (workspaceId) => commands!.listWorkspaces(workspaceId),
      );
    if (pathname === "/v1/applications" && method === "GET")
      return secured(
        "workspace:read",
        method,
        request,
        commands,
        access,
        (workspaceId) => commands!.listApplications(workspaceId),
      );
    if (pathname === "/v1/applications" && method === "POST")
      return secured(
        "workspace:manage",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.registerApplication(
            actor,
            request.body as RegisterApplicationCommand,
          ),
        validApplication,
      );
    if (pathname === "/v1/policy-assignments" && method === "GET")
      return secured(
        "access:manage",
        method,
        request,
        commands,
        access,
        (workspaceId) => commands!.listPolicyAssignments(workspaceId),
      );
    if (pathname === "/v1/policy-assignments" && method === "POST")
      return secured(
        "access:manage",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.createPolicyAssignment(
            actor,
            request.body as CreatePolicyAssignmentCommand,
          ),
        validPolicyAssignment,
      );
    if (policyAssignmentMatch && method === "DELETE")
      return secured(
        "access:manage",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.revokePolicyAssignment(
            policyAssignmentMatch,
            actor,
            request.body as RevokePolicyAssignmentCommand,
          ),
        validPolicyRevocation,
      );
    if (pathname === "/v1/schemas" && method === "GET")
      return secured(
        "workspace:read",
        method,
        request,
        commands,
        access,
        async () => schemas.listSchemas(),
      );
    if (schemaMatch && method === "GET")
      return secured(
        "workspace:read",
        method,
        request,
        commands,
        access,
        async () =>
          found(
            await schemas.getSchema(schemaMatch),
            "SCHEMA_NOT_FOUND",
            "The requested schema package was not found.",
          ),
      );
    if (pathname === "/v1/datasets" && method === "GET")
      return secured(
        "dataset:read",
        method,
        request,
        commands,
        access,
        (workspaceId) => commands!.listDatasets(workspaceId),
      );
    if (datasetMatch && method === "GET")
      return secured(
        "dataset:read",
        method,
        request,
        commands,
        access,
        async (workspaceId) =>
          found(
            await commands!.getDataset(workspaceId, datasetMatch),
            "DATASET_NOT_FOUND",
            "The requested dataset was not found.",
          ),
        undefined,
        { datasetId: datasetMatch },
      );
    if (pathname === "/v1/retention-policies" && method === "GET")
      return secured(
        "dataset:read",
        method,
        request,
        commands,
        access,
        (workspaceId) => commands!.listRetentionPolicies(workspaceId),
      );
    if (pathname === "/v1/retention-policies" && method === "POST")
      return secured(
        "retention:manage",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.createRetentionPolicy(
            actor,
            request.body as CreateRetentionPolicyCommand,
          ),
        validRetentionPolicy,
      );
    if (retentionPolicyMatch && method === "GET")
      return secured(
        "dataset:read",
        method,
        request,
        commands,
        access,
        async (workspaceId) =>
          found(
            await commands!.getRetentionPolicy(
              workspaceId,
              retentionPolicyMatch,
            ),
            "RETENTION_POLICY_NOT_FOUND",
            "The requested retention policy was not found.",
          ),
      );
    if (retentionPolicyMatch && method === "PUT")
      return secured(
        "retention:manage",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.updateRetentionPolicy(
            retentionPolicyMatch,
            actor,
            request.body as UpdateRetentionPolicyCommand,
          ),
        validRetentionPolicyUpdate,
      );
    if (pathname === "/v1/resources" && method === "GET")
      return secured(
        "resource:read",
        method,
        request,
        commands,
        access,
        (workspaceId) =>
          commands!.listResources(
            workspaceId,
            request.headers?.["x-trust-dataset-id"],
          ),
        undefined,
        { applicationScopeAllowed: true },
      );
    if (resourceMatch && method === "GET")
      return secured(
        "resource:read",
        method,
        request,
        commands,
        access,
        async (workspaceId) =>
          found(
            await commands!.getResource(workspaceId, resourceMatch),
            "RESOURCE_NOT_FOUND",
            "The requested resource was not found.",
          ),
        undefined,
        resourceScope(commands, resourceMatch),
      );
    if (revisionGraphMatch && method === "GET")
      return secured(
        "resource:read",
        method,
        request,
        commands,
        access,
        async (workspaceId) =>
          found(
            await commands!.getRevisionGraph(workspaceId, revisionGraphMatch),
            "RESOURCE_NOT_FOUND",
            "The requested resource was not found.",
          ),
        undefined,
        resourceScope(commands, revisionGraphMatch),
      );
    if (revisionMatch && method === "POST")
      return secured(
        "revision:create",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.createRevision(
            revisionMatch,
            actor,
            request.body as RevisionCommand,
          ),
        validRevision,
        resourceScope(commands, revisionMatch),
      );
    if (deleteMatch && method === "POST")
      return secured(
        "resource:delete",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.deleteResource(
            deleteMatch,
            actor,
            request.body as DeleteResourceCommand,
          ),
        validDelete,
        resourceScope(commands, deleteMatch),
      );
    if (restoreMatch && method === "POST")
      return secured(
        "resource:restore",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.restoreResource(
            restoreMatch,
            actor,
            request.body as RestoreResourceCommand,
          ),
        validRestore,
        resourceScope(commands, restoreMatch),
      );
    if (pathname === "/v1/deleted-resources" && method === "GET")
      return secured(
        "history:read",
        method,
        request,
        commands,
        access,
        (workspaceId) =>
          commands!.listDeletedResources(
            workspaceId,
            request.headers?.["x-trust-dataset-id"],
          ),
        undefined,
        { applicationScopeAllowed: true },
      );
    if (pathname === "/v1/relations" && method === "GET")
      return secured(
        "relation:read",
        method,
        request,
        commands,
        access,
        (workspaceId) =>
          commands!.listRelations(
            workspaceId,
            request.headers?.["x-trust-dataset-id"],
          ),
        undefined,
        { applicationScopeAllowed: true },
      );
    if (pathname === "/v1/history" && method === "GET")
      return secured(
        "history:read",
        method,
        request,
        commands,
        access,
        (workspaceId) =>
          commands!.getHistory(
            workspaceId,
            request.headers?.["x-trust-dataset-id"],
          ),
      );
    if (pathname === "/v1/audit/events" && method === "GET")
      return secured(
        "audit:read",
        method,
        request,
        commands,
        access,
        (workspaceId) =>
          commands!.listAuditEvents(
            workspaceId,
            request.headers?.["x-trust-dataset-id"],
          ),
      );
    if (pathname === "/v1/verification/runs" && method === "POST")
      return secured(
        "verification:run",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.runVerification(
            actor,
            request.body as RunVerificationCommand,
          ),
        validVerification,
        verificationAuthorizationScope(commands, request.body),
      );
    if (pathname === "/v1/verification/reports" && method === "GET")
      return secured(
        "verification:run",
        method,
        request,
        commands,
        access,
        (workspaceId) => commands!.listVerificationReports(workspaceId),
      );
    if (reportMatch && method === "GET")
      return secured(
        "verification:run",
        method,
        request,
        commands,
        access,
        async (workspaceId) =>
          found(
            await commands!.getVerificationReport(workspaceId, reportMatch),
            "VERIFICATION_REPORT_NOT_FOUND",
            "The requested verification report was not found.",
          ),
        undefined,
        verificationReportScope(commands, reportMatch),
      );
    if (operationMatch && method === "GET")
      return secured(
        "health:read",
        method,
        request,
        commands,
        access,
        async (workspaceId) =>
          found(
            await commands!.getOperation(workspaceId, operationMatch),
            "OPERATION_NOT_FOUND",
            "The requested operation was not found.",
          ),
      );
    if (pathname === "/v1/health/storage" && method === "GET")
      return secured(
        "health:read",
        method,
        request,
        commands,
        access,
        (workspaceId) => commands!.getStorageHealth(workspaceId),
      );
    if (pathname === "/v1/health/storage/probe" && method === "POST") {
      const tier =
        record(request.body) && request.body.tier === "ingest"
          ? "ingest"
          : "connectivity";
      return secured(
        tier === "ingest" ? "storage:probe_ingest" : "health:read",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) => {
          if (!commands!.probeStorageHealth) {
            return Promise.reject(
              Object.assign(
                new Error("Storage probe is not available in this mode."),
                { code: "COMMAND_BOUNDARY_UNAVAILABLE" },
              ),
            );
          }
          return commands!.probeStorageHealth(
            actor,
            request.body as ProbeStorageCommand,
          );
        },
        validProbeStorage,
      );
    }
    if (pathname === "/v1/health/backup" && method === "GET")
      return secured(
        "health:read",
        method,
        request,
        commands,
        access,
        (workspaceId) => commands!.getBackupHealth(workspaceId),
      );
    if (pathname === "/v1/uploads" && method === "POST")
      return secured(
        "object:ingest",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.createUpload(actor, request.body as CreateUploadCommand),
        validCreateUpload,
        { applicationScopeAllowed: true },
      );
    if (uploadMatch && method === "GET")
      return secured(
        "object:ingest",
        method,
        request,
        commands,
        access,
        async (workspaceId, actor) =>
          found(
            await commands!.getUpload(workspaceId, uploadMatch, actor),
            "OPERATION_NOT_FOUND",
            "The requested upload session was not found.",
          ),
        undefined,
        { applicationScopeAllowed: true },
      );
    if (uploadScanStatusMatch && method === "GET")
      return secured(
        "object:ingest",
        method,
        request,
        commands,
        access,
        async (workspaceId, actor) =>
          found(
            await commands!.getUploadScanStatus(
              workspaceId,
              uploadScanStatusMatch,
              actor,
            ),
            "OPERATION_NOT_FOUND",
            "The requested upload session was not found.",
          ),
        undefined,
        { applicationScopeAllowed: true },
      );
    if (uploadCompleteMatch && method === "POST")
      return secured(
        "object:ingest",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.completeUpload(
            uploadCompleteMatch,
            actor,
            request.body as CompleteUploadCommand,
          ),
        validCompleteUpload,
        { applicationScopeAllowed: true },
      );
    if (pathname === "/v1/blobs/download-grants" && method === "POST")
      return commands?.createDownloadGrant
        ? secured(
            "blob:read",
            method,
            request,
            commands,
            access,
            (_workspaceId, actor) =>
              commands!.createDownloadGrant!(
                actor,
                request.body as CreateDownloadGrantCommand,
              ),
            validCreateDownloadGrant,
            { applicationScopeAllowed: true },
          )
        : unavailable(request);
    if (pathname === "/v1/objects/ingest" && method === "POST")
      return secured(
        "object:ingest",
        method,
        request,
        commands,
        access,
        (_workspaceId, actor) =>
          commands!.ingestObject!(actor, request.body as ObjectIngestCommand),
        validObjectIngest,
        { applicationScopeAllowed: true },
        true,
      );
    if (pathname === "/v1/portability/exports" && method === "POST")
      return portability
        ? secured(
            "portability:export",
            method,
            request,
            commands,
            access,
            (_workspaceId, actor) =>
              portability.createExport(
                actor,
                request.body as CreateArchiveExportCommand,
              ),
            validArchiveExport,
            {},
            false,
            true,
          )
        : unavailable(request);
    if (exportDownloadMatch && method === "GET")
      return portability
        ? secured(
            "portability:export",
            method,
            request,
            commands,
            access,
            async (workspaceId) =>
              archiveDownloadResult(
                found(
                  await portability.downloadExport(
                    workspaceId,
                    exportDownloadMatch,
                  ),
                  "ARCHIVE_NOT_FOUND",
                  "The requested archive export was not found.",
                ),
                request.headers?.accept,
              ),
            undefined,
            {},
            false,
            true,
          )
        : unavailable(request);
    if (pathname === "/v1/portability/archives" && method === "POST")
      return portability
        ? secured(
            "portability:plan",
            method,
            request,
            commands,
            access,
            (_workspaceId, actor) =>
              portability.uploadArchive(
                actor,
                request.body as UploadArchiveCommand,
              ),
            validArchiveUpload,
          )
        : unavailable(request);
    if (archiveMatch && method === "GET")
      return portability
        ? secured(
            "portability:read",
            method,
            request,
            commands,
            access,
            async (workspaceId) =>
              found(
                await portability.getArchive(workspaceId, archiveMatch),
                "ARCHIVE_NOT_FOUND",
                "The requested archive candidate was not found.",
              ),
          )
        : unavailable(request);
    if (pathname === "/v1/portability/plans" && method === "POST")
      return portability
        ? secured(
            "portability:plan",
            method,
            request,
            commands,
            access,
            (_workspaceId, actor) =>
              portability.createPlan(
                actor,
                request.body as CreateImportPlanCommand,
              ),
            validImportPlan,
          )
        : unavailable(request);
    if (importPlanMatch && method === "GET")
      return portability
        ? secured(
            "portability:read",
            method,
            request,
            commands,
            access,
            async (workspaceId) =>
              found(
                await portability.getPlan(workspaceId, importPlanMatch),
                "IMPORT_PLAN_NOT_FOUND",
                "The requested import plan was not found.",
              ),
          )
        : unavailable(request);
    if (importExecuteMatch && method === "POST")
      return portability
        ? secured(
            "portability:execute",
            method,
            request,
            commands,
            access,
            (_workspaceId, actor) =>
              portability.executePlan(
                importExecuteMatch,
                actor,
                request.body as ExecuteImportCommand,
              ),
            validExecuteImport,
            {},
            false,
            true,
          )
        : unavailable(request);
    if (importOperationMatch && method === "GET")
      return portability
        ? secured(
            "portability:read",
            method,
            request,
            commands,
            access,
            async (workspaceId) =>
              found(
                await portability.getImportOperation(
                  workspaceId,
                  importOperationMatch,
                ),
                "OPERATION_NOT_FOUND",
                "The requested import operation was not found.",
              ),
          )
        : unavailable(request);
    if (pathname === "/v1/control-centre/snapshot" && method === "GET")
      return secured("control:read", method, request, commands, access, () =>
        provider.getSnapshot(),
      );

    if (method !== "GET")
      return failure(
        405,
        "METHOD_NOT_ALLOWED",
        "The HTTP method is not supported for this route.",
        request,
      );
    return failure(
      404,
      "NOT_FOUND",
      "The requested route was not found.",
      request,
    );
  };
}

async function secured(
  action: ApiAction,
  method: string,
  request: ApiRequest,
  commands: CommandProvider | undefined,
  access: AccessGateway | undefined,
  execute: (workspaceId: string, actor: AuthenticatedActor) => Promise<unknown>,
  validate?: (body: unknown) => boolean,
  extraScope:
    | Partial<AuthorizationScope>
    | ((workspaceId: string) => Promise<Partial<AuthorizationScope>>) = {},
  needsIngest = false,
  requiresReauthentication = false,
): Promise<ApiResult> {
  if (!commands || !access || (needsIngest && !commands.ingestObject))
    return failure(
      501,
      "COMMAND_BOUNDARY_UNAVAILABLE",
      "The command boundary is not configured.",
      request,
    );
  const authorization = request.headers?.authorization;
  const sessionId = cookieValue(request.headers?.cookie, "trust_session");
  if (!authorization && !sessionId)
    return failure(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authentication is required.",
      request,
    );
  const mutation = method !== "GET";
  const actor = authorization?.startsWith("Bearer ")
    ? await access.authenticate(authorization.slice(7))
    : sessionId && access.authenticateSession
      ? await access.authenticateSession(
          sessionId,
          request.headers?.["x-trust-csrf"],
          mutation,
        )
      : undefined;
  if (!actor)
    return failure(
      401,
      "INVALID_CREDENTIALS",
      "The supplied credentials are invalid or expired.",
      request,
    );
  const workspaceId =
    bodyWorkspace(request.body) ?? request.headers?.["x-trust-workspace-id"];
  if (!workspaceId)
    return failure(
      400,
      "WORKSPACE_REQUIRED",
      "A workspace context is required.",
      request,
    );
  const resolvedScope =
    typeof extraScope === "function"
      ? await extraScope(workspaceId)
      : extraScope;
  const scope = { ...requestScope(workspaceId, request), ...resolvedScope };
  if (!(await access.allows(actor, action, scope)))
    return failure(
      403,
      "PERMISSION_DENIED",
      "The actor is not permitted to perform this action.",
      request,
    );
  if (
    requiresReauthentication &&
    !(await access.confirmsPrivilegedAction?.(
      actor,
      request.headers?.["x-trust-reauth"],
    ))
  )
    return failure(
      401,
      "REAUTHENTICATION_REQUIRED",
      "Fresh administrator authentication is required for this action.",
      request,
    );
  if (validate && !validate(request.body))
    return failure(
      400,
      "INVALID_COMMAND",
      "The request body is not valid for this command.",
      request,
    );
  try {
    const body = await execute(workspaceId, actor);
    return isApiResult(body) ? body : { status: 200, body };
  } catch (error) {
    if (error instanceof ApiRouteError)
      return failure(error.status, error.code, error.message, request);
    const code = (error as { code?: string }).code;
    if (code === "BASE_REVISION_CONFLICT")
      return failure(
        409,
        "REVISION_CONFLICT",
        "The resource head changed before this command could be applied.",
        request,
      );
    if (code === "IDEMPOTENCY_CONFLICT")
      return failure(
        409,
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different request.",
        request,
      );
    if (code === "RETENTION_POLICY_NOT_FOUND")
      return failure(
        404,
        "RETENTION_POLICY_NOT_FOUND",
        "The requested retention policy was not found.",
        request,
      );
    if (code === "POLICY_ASSIGNMENT_NOT_FOUND")
      return failure(
        404,
        "POLICY_ASSIGNMENT_NOT_FOUND",
        "The requested policy assignment was not found.",
        request,
      );
    if (code === "RETENTION_POLICY_CONFLICT")
      return failure(
        409,
        "RETENTION_POLICY_CONFLICT",
        "The retention policy changed before this update.",
        request,
      );
    if (code === "INVALID_COMMAND")
      return failure(
        400,
        "INVALID_COMMAND",
        "The request body is not valid for this command.",
        request,
      );
    if (code === "REQUEST_TOO_LARGE")
      return failure(
        413,
        "REQUEST_TOO_LARGE",
        "The request body exceeds the allowed size.",
        request,
      );
    if (code === "OPERATION_NOT_FOUND")
      return failure(
        404,
        "OPERATION_NOT_FOUND",
        "The requested operation was not found.",
        request,
      );
    if (code === "ARCHIVE_NOT_FOUND")
      return failure(
        404,
        "ARCHIVE_NOT_FOUND",
        "Archive candidate was not found.",
        request,
      );
    if (code === "IMPORT_PLAN_NOT_FOUND")
      return failure(
        404,
        "IMPORT_PLAN_NOT_FOUND",
        "Import plan was not found.",
        request,
      );
    return failure(
      422,
      "COMMAND_REJECTED",
      "The command was rejected.",
      request,
    );
  }
}
function isApiResult(value: unknown): value is ApiResult {
  return (
    record(value) &&
    typeof value.status === "number" &&
    Object.prototype.hasOwnProperty.call(value, "body")
  );
}

class ApiRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: PublicErrorCode,
    message: string,
  ) {
    super(message);
  }
}
function found<T>(
  value: T | undefined,
  code: PublicErrorCode,
  message: string,
): T {
  if (value === undefined) throw new ApiRouteError(404, code, message);
  return value;
}
function match(pathname: string, pattern: RegExp): string | undefined {
  const value = pathname.match(pattern)?.[1];
  return value ? decodeURIComponent(value) : undefined;
}
function bodyWorkspace(body: unknown): string | undefined {
  if (!record(body)) return undefined;
  return nonEmpty(body.workspaceId) ? body.workspaceId : undefined;
}
function requestScope(
  workspaceId: string,
  request: ApiRequest,
): AuthorizationScope {
  const requestId = request.headers?.["x-request-id"];
  return {
    workspaceId,
    ...(requestId ? { requestId } : {}),
  };
}
function resourceScope(
  commands: CommandProvider | undefined,
  resourceId: string,
): (workspaceId: string) => Promise<Partial<AuthorizationScope>> {
  return async (workspaceId) => {
    const resource = (await commands?.getResource(workspaceId, resourceId)) as
      { datasetId?: unknown } | undefined;
    return resource && nonEmpty(resource.datasetId)
      ? { datasetId: resource.datasetId }
      : {};
  };
}
function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  return header
    ?.split(";")
    .map((item) => item.trim().split("="))
    .find(([key]) => key === name)?.[1];
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function validWorkspaceBody(body: unknown): body is Record<string, unknown> {
  return record(body) && nonEmpty(body.workspaceId);
}
function validApplication(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    nonEmpty(body.namespace) &&
    nonEmpty(body.name) &&
    nonEmpty(body.applicationVersion) &&
    nonEmpty(body.idempotencyKey) &&
    Array.isArray(body.schemaPackageIds) &&
    body.schemaPackageIds.every(nonEmpty) &&
    Array.isArray(body.capabilities) &&
    body.capabilities.every(nonEmpty)
  );
}
function validRevision(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    (body.expectedRevisionId === null || nonEmpty(body.expectedRevisionId)) &&
    nonEmpty(body.schemaPackageId) &&
    nonEmpty(body.schemaVersion) &&
    record(body.canonicalPayload) &&
    (body.changeNote === undefined || typeof body.changeNote === "string")
  );
}
function validPolicyAssignment(body: unknown): boolean {
  if (
    !validWorkspaceBody(body) ||
    !nonEmpty(body.principalId) ||
    !nonEmpty(body.scopeId) ||
    !nonEmpty(body.idempotencyKey) ||
    !["user", "service", "application"].includes(String(body.principalType)) ||
    !["owner", "admin", "editor", "recovery_operator", "auditor"].includes(
      String(body.role),
    ) ||
    !["workspace", "dataset", "application"].includes(String(body.scopeKind))
  )
    return false;
  return body.scopeKind !== "workspace" || body.scopeId === body.workspaceId;
}
function validPolicyRevocation(body: unknown): boolean {
  return validWorkspaceBody(body) && nonEmpty(body.idempotencyKey);
}
function validDelete(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    (body.expectedRevisionId === null || nonEmpty(body.expectedRevisionId)) &&
    (body.recoverUntil === null ||
      (nonEmpty(body.recoverUntil) &&
        Number.isFinite(Date.parse(body.recoverUntil)))) &&
    (body.reason === undefined || typeof body.reason === "string")
  );
}
function validRetentionPolicy(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    nonEmpty(body.name) &&
    nonEmpty(body.idempotencyKey) &&
    validRetentionDays(body.recoveryWindowDays) &&
    validRetentionDays(body.minimumHistoryDays) &&
    validRetentionDays(body.backupRetentionDays) &&
    body.purgeEnabled === false &&
    (body.extensions === undefined || record(body.extensions))
  );
}
function validRetentionPolicyUpdate(body: unknown): boolean {
  return (
    record(body) &&
    validRetentionPolicy(body) &&
    nonEmpty(body.expectedUpdatedAt) &&
    Number.isFinite(Date.parse(body.expectedUpdatedAt))
  );
}
function validRetentionDays(value: unknown): boolean {
  return (
    Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 36500
  );
}
function validRestore(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    (body.changeNote === undefined || typeof body.changeNote === "string")
  );
}
function validVerification(body: unknown): boolean {
  if (
    !validWorkspaceBody(body) ||
    !nonEmpty(body.level) ||
    !verificationLevels.includes(
      body.level as (typeof verificationLevels)[number],
    )
  )
    return false;
  const scope = body.scope;
  switch (body.level) {
    case "metadata":
    case "full_blob":
    case "workspace":
      return (
        scope === undefined ||
        (record(scope) &&
          scope.kind === "workspace" &&
          scope.id === body.workspaceId)
      );
    case "resource":
    case "dataset":
      return record(scope) && scope.kind === body.level && nonEmpty(scope.id);
    default:
      return false;
  }
}
function validProbeStorage(body: unknown): boolean {
  if (!validWorkspaceBody(body)) return false;
  if (body.tier === undefined) return true;
  return body.tier === "connectivity" || body.tier === "ingest";
}
function validObjectIngest(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    nonEmpty(body.idempotencyKey) &&
    nonEmpty(body.mediaType) &&
    validBase64(body.bytesBase64)
  );
}
function validCreateUpload(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    nonEmpty(body.idempotencyKey) &&
    nonEmpty(body.mediaType) &&
    Number.isSafeInteger(body.expectedByteLength) &&
    Number(body.expectedByteLength) >= 0 &&
    Number(body.expectedByteLength) <= 750_000 &&
    typeof body.expectedSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(body.expectedSha256) &&
    (body.expiresInSeconds === undefined ||
      (Number.isSafeInteger(body.expiresInSeconds) &&
        Number(body.expiresInSeconds) >= 60 &&
        Number(body.expiresInSeconds) <= 86400))
  );
}
function validCompleteUpload(body: unknown): boolean {
  return validWorkspaceBody(body) && validBase64(body.bytesBase64);
}
function validCreateDownloadGrant(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    nonEmpty(body.objectId) &&
    nonEmpty(body.idempotencyKey) &&
    Number.isSafeInteger(body.requestedTtlSeconds) &&
    Number(body.requestedTtlSeconds) >= 1 &&
    Number(body.requestedTtlSeconds) <= 86400 &&
    (body.fileName === undefined ||
      (typeof body.fileName === "string" &&
        body.fileName.length > 0 &&
        body.fileName.length <= 180))
  );
}
function validArchiveUpload(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    nonEmpty(body.idempotencyKey) &&
    validBase64(body.archiveBase64, 12_000_000)
  );
}
function validArchiveExport(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    nonEmpty(body.idempotencyKey) &&
    Array.isArray(body.datasetIds) &&
    body.datasetIds.length > 0 &&
    body.datasetIds.length <= 100 &&
    body.datasetIds.every(nonEmpty)
  );
}
function validImportPlan(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    nonEmpty(body.archiveId) &&
    nonEmpty(body.idempotencyKey) &&
    (body.mode === "preserve_ids" || body.mode === "mapped_workspace") &&
    (body.conflictMode === "reject_on_error" ||
      body.conflictMode === "report_only")
  );
}
function validExecuteImport(body: unknown): boolean {
  return (
    validWorkspaceBody(body) &&
    nonEmpty(body.idempotencyKey) &&
    body.confirmation === "IMPORT"
  );
}
function validBase64(value: unknown, maxLength = 1_400_000): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  );
}
function archiveDownloadResult(
  transfer: Awaited<ReturnType<PortabilityProvider["downloadExport"]>> & object,
  accept: string | undefined,
): ApiResult {
  if (accept?.includes("application/vnd.trust-core.archive+zip"))
    return {
      status: 200,
      body: transfer.bytes,
      headers: {
        "content-type": transfer.mediaType,
        "content-disposition": `attachment; filename="${transfer.filename}"`,
        "content-length": String(transfer.bytes.byteLength),
        "x-trust-archive-sha256": transfer.summary.sha256,
      },
    };
  return {
    status: 200,
    body: {
      ...transfer.summary,
      mediaType: transfer.mediaType,
      filename: transfer.filename,
      archiveBase64: Buffer.from(transfer.bytes).toString("base64"),
    },
  };
}
function failure(
  status: number,
  code: PublicErrorCode,
  message: string,
  request: ApiRequest,
): ApiResult {
  const requestId = request.headers?.["x-request-id"];
  const body: ApiErrorResponse = {
    code,
    message,
    ...(requestId ? { requestId } : {}),
  };
  return { status, body };
}
function unavailable(request: ApiRequest): ApiResult {
  return failure(
    501,
    "COMMAND_BOUNDARY_UNAVAILABLE",
    "The portability command boundary is not configured.",
    request,
  );
}
function verificationAuthorizationScope(
  commands: CommandProvider | undefined,
  body: unknown,
): (workspaceId: string) => Promise<Partial<AuthorizationScope>> {
  return async (workspaceId) => {
    if (!record(body) || !record(body.scope) || !nonEmpty(body.scope.id))
      return {};
    if (body.scope.kind === "dataset") return { datasetId: body.scope.id };
    if (body.scope.kind !== "resource") return {};
    const resource = (await commands?.getResource(
      workspaceId,
      body.scope.id,
    )) as { datasetId?: unknown } | undefined;
    return resource && nonEmpty(resource.datasetId)
      ? { datasetId: resource.datasetId }
      : {};
  };
}

function verificationReportScope(
  commands: CommandProvider | undefined,
  reportId: string,
): (workspaceId: string) => Promise<Partial<AuthorizationScope>> {
  return async (workspaceId) => {
    const report = (await commands?.getVerificationReport(
      workspaceId,
      reportId,
    )) as { scope?: unknown } | undefined;
    if (!report || !record(report.scope)) return {};
    if (report.scope.kind === "dataset" && nonEmpty(report.scope.id))
      return { datasetId: report.scope.id };
    if (report.scope.kind !== "resource" || !nonEmpty(report.scope.id))
      return {};
    return resourceScope(commands, report.scope.id)(workspaceId);
  };
}
