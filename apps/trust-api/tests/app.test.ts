import { describe, expect, it } from "vitest";
import { createApi, roleAllows } from "../src/app.js";
import type { AuthenticatedActor } from "@trust-core/protocol";

const snapshot = {
  status: { protectedDatasets: 1, activeProjects: 1, latestVerifiedBackup: "Now", recoveryAttention: 0, canonicalIntegrityPercent: 100, syncQueue: 0 },
  datasets: [],
} as const;

describe("Trust API routing", () => {
  const schema = { id: "schema:test", key: "app/test/1.0.0", digest: "a".repeat(64), status: "active", publishedAt: "2026-08-03T12:00:00.000Z", manifest: { namespace: "app", name: "test", version: "1.0.0", title: "Test", description: "Test", classification: "application", resourceTypes: [], relationships: [], compatibleArchiveFormat: "trust-core-archive/1.0.0" } } as const;
  const schemas = { listSchemas: async () => [schema], getSchema: async (key: string) => key === schema.key ? schema : undefined };
  const route = createApi({ getSnapshot: async () => snapshot }, schemas, () => new Date("2026-08-03T12:00:00Z"));

  it("reports explicit fixture health", async () => {
    expect(await route("GET", "/health")).toEqual({ status: 200, body: { service: "trust-api", status: "ok", mode: "fixture", checkedAt: "2026-08-03T12:00:00.000Z" } });
  });

  it("returns the shared control-centre snapshot contract", async () => {
    expect(await route("GET", "/v1/control-centre/snapshot")).toEqual({ status: 200, body: snapshot });
  });

  it("lists and retrieves immutable schema packages", async () => {
    expect(await route("GET", "/v1/schemas")).toEqual({ status: 200, body: [schema] });
    expect(await route("GET", "/v1/schemas/app%2Ftest%2F1.0.0")).toEqual({ status: 200, body: schema });
    expect((await route("GET", "/v1/schemas/app%2Fmissing%2F1.0.0")).status).toBe(404);
  });

  it("rejects unknown and mutating routes", async () => {
    expect((await route("GET", "/missing")).status).toBe(404);
    expect((await route("POST", "/health")).status).toBe(405);
  });

  it("requires authentication, workspace membership and command permission", async () => {
    const actor: AuthenticatedActor = { id: "admin", displayName: "Admin", roles: ["recovery_operator"], workspaceIds: ["workspace"] };
    const commands = { getHistory: async () => ({ recoverable: [], events: [] }), createRevision: async () => { throw new Error("not called"); }, deleteResource: async () => { throw new Error("not called"); }, restoreResource: async (resourceId: string) => ({ resourceId, revisionId: "restored", revisionNumber: 2, source: "restore" as const, createdAt: "2026-08-03T12:00:00.000Z" }),runVerification:async()=>{throw new Error("not called");} };
    const access = { authenticate: async (token: string) => token === "valid" ? actor : undefined, allows: roleAllows };
    const secured = createApi({ getSnapshot: async () => snapshot }, schemas, () => new Date("2026-08-03T12:00:00Z"), "fixture", commands, access);
    expect((await secured("GET", "/v1/history", { headers: { "x-trust-workspace-id": "workspace" } })).status).toBe(401);
    expect((await secured("POST", "/v1/resources/page/restore", { headers: { authorization: "Bearer valid" }, body: { workspaceId: "other" } })).status).toBe(403);
    expect((await secured("POST", "/v1/resources/page/delete", { headers: { authorization: "Bearer valid" }, body: { workspaceId: "workspace", expectedRevisionId: "one", recoverUntil: null } })).status).toBe(403);
    expect((await secured("POST", "/v1/resources/page/restore", { headers: { authorization: "Bearer valid" }, body: { workspaceId: "workspace" } })).body).toMatchObject({ revisionId: "restored", source: "restore" });
  });

  it("rejects malformed commands before invoking a provider", async () => {
    const actor: AuthenticatedActor = { id: "admin", displayName: "Admin", roles: ["admin"], workspaceIds: ["workspace"] };
    const commands = { getHistory: async () => ({ recoverable: [], events: [] }), createRevision: async () => { throw new Error("not called"); }, deleteResource: async () => { throw new Error("not called"); }, restoreResource: async () => { throw new Error("not called"); },runVerification:async()=>{throw new Error("not called");} };
    const secured = createApi({ getSnapshot: async () => snapshot }, schemas, undefined, "fixture", commands, { authenticate: async () => actor, allows: roleAllows });
    const result = await secured("POST", "/v1/resources/page/revisions", { headers: { authorization: "Bearer valid" }, body: { workspaceId: "workspace" } });
    expect(result).toEqual({ status: 400, body: { error: "invalid_command" } });
  });

  it("exposes authenticated idempotent object ingestion",async()=>{
    const actor:AuthenticatedActor={id:"editor",displayName:"Editor",roles:["editor"],workspaceIds:["workspace"]};
    const commands={getHistory:async()=>({recoverable:[],events:[]}),createRevision:async()=>{throw new Error("not called");},deleteResource:async()=>{throw new Error("not called");},restoreResource:async()=>{throw new Error("not called");},runVerification:async()=>{throw new Error("not called");},ingestObject:async(_actor:AuthenticatedActor,command:{workspaceId:string})=>({operationId:"operation",blob:{id:"blob",workspaceId:command.workspaceId,sha256:"a".repeat(64),byteLength:4,mediaType:"text/plain",storageProvider:"test",storageKey:"object",verificationState:"verified" as const,createdAt:"2026-08-04T00:00:00.000Z"},deduplicated:false,resumed:false})};
    const secured=createApi({getSnapshot:async()=>snapshot},schemas,undefined,"live",commands,{authenticate:async()=>actor,allows:roleAllows});
    const result=await secured("POST","/v1/objects/ingest",{headers:{authorization:"Bearer valid"},body:{workspaceId:"workspace",idempotencyKey:"upload-1",mediaType:"text/plain",bytesBase64:"dGVzdA=="}});
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({operationId:"operation",blob:{verificationState:"verified"}});
  });

  it("accepts a protected session cookie and requires CSRF for mutations", async () => {
    const actor: AuthenticatedActor = { id: "admin", displayName: "Admin", roles: ["admin"], workspaceIds: ["workspace"] };
    const commands = { getHistory: async () => ({ recoverable: [], events: [] }), createRevision: async () => { throw new Error("not called"); }, deleteResource: async () => { throw new Error("not called"); }, restoreResource: async (resourceId: string) => ({ resourceId, revisionId: "restored", revisionNumber: 3, source: "restore" as const, createdAt: "2026-08-03T12:00:00.000Z" }),runVerification:async(_actor:AuthenticatedActor,command:{workspaceId:string;level:"metadata"|"full_blob"})=>({id:"run",workspaceId:command.workspaceId,level:command.level,status:"passed" as const,startedAt:"2026-08-03T12:00:00.000Z",completedAt:"2026-08-03T12:01:00.000Z",objectsChecked:1,bytesRead:10,issues:[]}) };
    const access = { authenticate: async () => undefined, authenticateSession: async (id: string, csrf: string | undefined, mutation: boolean) => id === "session" && (!mutation || csrf === "csrf") ? actor : undefined, allows: roleAllows };
    const secured = createApi({ getSnapshot: async () => snapshot }, schemas, undefined, "fixture", commands, access);
    expect((await secured("GET", "/v1/history", { headers: { cookie: "trust_session=session", "x-trust-workspace-id": "workspace" } })).status).toBe(200);
    expect((await secured("POST", "/v1/resources/page/restore", { headers: { cookie: "trust_session=session" }, body: { workspaceId: "workspace" } })).status).toBe(401);
    expect((await secured("POST", "/v1/resources/page/restore", { headers: { cookie: "trust_session=session", "x-trust-csrf": "csrf" }, body: { workspaceId: "workspace" } })).status).toBe(200);
    expect((await secured("POST","/v1/verification/runs",{headers:{cookie:"trust_session=session","x-trust-csrf":"csrf"},body:{workspaceId:"workspace",level:"full_blob"}})).body).toMatchObject({status:"passed",bytesRead:10});
    const live = createApi({ getSnapshot: async () => snapshot }, schemas, undefined, "live", commands, access);
    expect((await live("GET", "/v1/control-centre/snapshot", { headers: { "x-trust-workspace-id": "workspace" } })).status).toBe(401);
    expect((await live("GET", "/v1/control-centre/snapshot", { headers: { cookie: "trust_session=session", "x-trust-workspace-id": "workspace" } })).status).toBe(200);
  });
});
