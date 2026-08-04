import type { AuthenticatedActor, ControlCentreSnapshot, DeleteResourceCommand, DeleteResourceResult, HealthResponse, HistorySnapshot, RestoreResourceCommand, RevisionCommand, RevisionCommandResult, RunVerificationCommand, TrustAction, VerificationRunResult } from "@trust-core/protocol";
import type { PublishedSchemaPackage } from "@trust-core/schema-registry";
import type { ObjectIngestResult } from "@trust-core/operations";

export type ApiAction = TrustAction | "object:ingest";
export interface ObjectIngestCommand { workspaceId: string; idempotencyKey: string; mediaType: string; bytesBase64: string; }

export interface SnapshotProvider {
  getSnapshot(): Promise<ControlCentreSnapshot>;
}

export interface SchemaProvider {
  listSchemas(): Promise<readonly PublishedSchemaPackage[]>;
  getSchema(key: string): Promise<PublishedSchemaPackage | undefined>;
}

export interface ApiResult {
  status: number;
  body: HealthResponse | ControlCentreSnapshot | readonly PublishedSchemaPackage[] | PublishedSchemaPackage | HistorySnapshot | RevisionCommandResult | DeleteResourceResult | VerificationRunResult | ObjectIngestResult | { error: string; detail?: string };
}

export interface ApiRequest { headers?: Readonly<Record<string, string | undefined>>; body?: unknown; }
export interface CommandProvider {
  getHistory(workspaceId: string): Promise<HistorySnapshot>;
  createRevision(resourceId: string, actor: AuthenticatedActor, command: RevisionCommand): Promise<RevisionCommandResult>;
  deleteResource(resourceId: string, actor: AuthenticatedActor, command: DeleteResourceCommand): Promise<DeleteResourceResult>;
  restoreResource(resourceId: string, actor: AuthenticatedActor, command: RestoreResourceCommand): Promise<RevisionCommandResult>;
  runVerification(actor:AuthenticatedActor,command:RunVerificationCommand):Promise<VerificationRunResult>;
  ingestObject?(actor: AuthenticatedActor, command: ObjectIngestCommand): Promise<ObjectIngestResult>;
}
export interface AccessGateway { authenticate(bearerToken: string): Promise<AuthenticatedActor | undefined>; authenticateSession?(sessionId: string, csrfToken: string | undefined, mutation: boolean): Promise<AuthenticatedActor | undefined>; allows(actor: AuthenticatedActor, action: ApiAction, workspaceId: string): boolean; }

const permissions: Readonly<Record<ApiAction, readonly AuthenticatedActor["roles"][number][]>> = {
  "control:read": ["owner", "admin", "auditor"], "history:read": ["owner", "admin", "recovery_operator", "auditor"], "revision:create": ["owner", "admin", "editor"],
  "resource:delete": ["owner", "admin"], "resource:restore": ["owner", "admin", "recovery_operator"],
  "verification:run": ["owner","admin","auditor"],
  "object:ingest": ["owner", "admin", "editor"],
};
export function roleAllows(actor: AuthenticatedActor, action: ApiAction, workspaceId: string): boolean { return actor.workspaceIds.includes(workspaceId) && actor.roles.some((role) => permissions[action].includes(role)); }

export function createApi(provider: SnapshotProvider, schemas: SchemaProvider, clock: () => Date = () => new Date(), mode: "fixture" | "live" = "fixture", commands?: CommandProvider, access?: AccessGateway) {
  return async function route(method: string, pathname: string, request: ApiRequest = {}): Promise<ApiResult> {
    if (pathname === "/health" && method === "GET") {
      return { status: 200, body: { service: "trust-api", status: "ok", mode, checkedAt: clock().toISOString() } };
    }
    if (pathname === "/v1/control-centre/snapshot" && method === "GET") {
      return mode === "fixture" ? { status: 200, body: await provider.getSnapshot() } : secured("control:read", request, commands, access, () => provider.getSnapshot());
    }
    if (pathname === "/v1/schemas" && method === "GET") return { status: 200, body: await schemas.listSchemas() };
    if (pathname.startsWith("/v1/schemas/") && method === "GET") {
      const key = decodeURIComponent(pathname.slice("/v1/schemas/".length));
      const schema = await schemas.getSchema(key);
      return schema ? { status: 200, body: schema } : { status: 404, body: { error: "schema_not_found" } };
    }
    const revisionMatch = pathname.match(/^\/v1\/resources\/([^/]+)\/revisions$/);
    const deleteMatch = pathname.match(/^\/v1\/resources\/([^/]+)\/delete$/);
    const restoreMatch = pathname.match(/^\/v1\/resources\/([^/]+)\/restore$/);
    if (pathname === "/v1/history" && method === "GET") return secured("history:read", request, commands, access, (workspaceId) => commands!.getHistory(workspaceId));
    if (revisionMatch && method === "POST") return secured("revision:create", request, commands, access, (_workspaceId, actor) => commands!.createRevision(decodeURIComponent(revisionMatch[1]!), actor, request.body as RevisionCommand));
    if (deleteMatch && method === "POST") return secured("resource:delete", request, commands, access, (_workspaceId, actor) => commands!.deleteResource(decodeURIComponent(deleteMatch[1]!), actor, request.body as DeleteResourceCommand));
    if (restoreMatch && method === "POST") return secured("resource:restore", request, commands, access, (_workspaceId, actor) => commands!.restoreResource(decodeURIComponent(restoreMatch[1]!), actor, request.body as RestoreResourceCommand));
    if(pathname==="/v1/verification/runs"&&method==="POST")return secured("verification:run",request,commands,access,(_workspaceId,actor)=>commands!.runVerification(actor,request.body as RunVerificationCommand));
    if(pathname==="/v1/objects/ingest"&&method==="POST")return secured("object:ingest",request,commands,access,(_workspaceId,actor)=>commands!.ingestObject!(actor,request.body as ObjectIngestCommand));
    if (method !== "GET") return { status: 405, body: { error: "method_not_allowed" } };
    return { status: 404, body: { error: "not_found" } };
  };
}

async function secured(action: ApiAction, request: ApiRequest, commands: CommandProvider | undefined, access: AccessGateway | undefined, execute: (workspaceId: string, actor: AuthenticatedActor) => Promise<ControlCentreSnapshot | HistorySnapshot | RevisionCommandResult | DeleteResourceResult | VerificationRunResult | ObjectIngestResult>): Promise<ApiResult> {
  if (!commands || !access) return { status: 501, body: { error: "command_boundary_unavailable" } };
  if (action === "object:ingest" && !commands.ingestObject) return { status: 501, body: { error: "command_boundary_unavailable" } };
  const authorization = request.headers?.authorization;
  const sessionId = cookieValue(request.headers?.cookie, "trust_session");
  const mutation = action !== "history:read" && action !== "control:read";
  const actor = authorization?.startsWith("Bearer ") ? await access.authenticate(authorization.slice(7)) : sessionId && access.authenticateSession ? await access.authenticateSession(sessionId, request.headers?.["x-trust-csrf"], mutation) : undefined;
  if (!authorization && !sessionId) return { status: 401, body: { error: "authentication_required" } };
  if (!actor) return { status: 401, body: { error: "invalid_credentials" } };
  const workspaceId = bodyWorkspace(request.body) ?? request.headers?.["x-trust-workspace-id"];
  if (!workspaceId) return { status: 400, body: { error: "workspace_required" } };
  if (!access.allows(actor, action, workspaceId)) return { status: 403, body: { error: "permission_denied" } };
  if (!validCommand(action, request.body)) return { status: 400, body: { error: "invalid_command" } };
  try { return { status: 200, body: await execute(workspaceId, actor) }; }
  catch (error) { const conflict = (error as { code?: string }).code === "BASE_REVISION_CONFLICT"; return { status: conflict ? 409 : 422, body: { error: conflict ? "revision_conflict" : "command_rejected", detail: error instanceof Error ? error.message : undefined } }; }
}
function bodyWorkspace(body: unknown): string | undefined { if (!body || typeof body !== "object") return undefined; const value = (body as { workspaceId?: unknown }).workspaceId; return typeof value === "string" && value ? value : undefined; }
function cookieValue(header:string|undefined,name:string):string|undefined{return header?.split(";").map(item=>item.trim().split("=")).find(([key])=>key===name)?.[1];}
function validCommand(action: ApiAction, body: unknown): boolean {
  if (action === "history:read" || action === "control:read") return true;
  if (!body || typeof body !== "object" || !bodyWorkspace(body)) return false;
  const value = body as Record<string, unknown>;
  if (action === "resource:restore") return value.changeNote === undefined || typeof value.changeNote === "string";
  if(action==="verification:run")return value.level==="metadata"||value.level==="full_blob";
  if(action==="object:ingest")return typeof value.idempotencyKey==="string"&&value.idempotencyKey.length>0&&typeof value.mediaType==="string"&&value.mediaType.length>0&&typeof value.bytesBase64==="string"&&value.bytesBase64.length>0;
  if (!(value.expectedRevisionId === null || typeof value.expectedRevisionId === "string")) return false;
  if (action === "resource:delete") return value.recoverUntil === null || typeof value.recoverUntil === "string";
  return typeof value.schemaPackageId === "string" && typeof value.schemaVersion === "string" && !!value.canonicalPayload && typeof value.canonicalPayload === "object" && !Array.isArray(value.canonicalPayload);
}
