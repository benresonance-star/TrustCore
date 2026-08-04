import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresBlobCatalog, PostgresIdentityStore, PostgresIngestOperationStore, PostgresTrustRepository, PostgresVerificationCatalog, deterministicUuid, type DatabasePool, type QueryResult, type TransactionClient } from "@trust-core/persistence-postgres";
import { ObjectIngestService, type IngestCheckpoint } from "@trust-core/operations";
import { OidcIdentityService, StandardsOidcProvider } from "@trust-core/identity";
import { MinioObjectStorage } from "@trust-core/storage-minio";
import { BlobVerificationService } from "@trust-core/verification";
import type { AuthenticatedActor } from "@trust-core/protocol";
import { createApi } from "./app.js";
import { AdminSessionGateway } from "./access.js";
import { createFixtureCommands } from "./fixture-commands.js";
import { PostgresCommandProvider } from "./postgres-commands.js";
import { fixtureProvider } from "./fixture-provider.js";

const databaseUrl = process.env.DATABASE_URL;
const pgPool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 10 }) : null;
const pool = pgPool ? adaptPool(pgPool) : null;
const repository = pool ? new PostgresTrustRepository(pool) : null;
const workspaceId = deterministicUuid(process.env.TRUST_WORKSPACE_KEY ?? "workspace-demo-ivan");
const snapshots = repository ? { getSnapshot: () => repository.getSnapshot(workspaceId) } : fixtureProvider;
const schemas = repository ?? fixtureProvider;
const storage = createStorage();
const verification = pool && storage ? new BlobVerificationService(storage,new PostgresVerificationCatalog(pool)) : undefined;
const ingest = pool && storage ? new ObjectIngestService(storage,new PostgresBlobCatalog(pool),new PostgresIngestOperationStore(pool),"s3-compatible",()=>new Date().toISOString(),()=>randomUUID(),afterIngestEffect) : undefined;
const commandProvider = pool ? new PostgresCommandProvider(pool,verification,ingest) : createFixtureCommands();
const adminToken = process.env.TRUST_ADMIN_TOKEN ?? (repository ? undefined : "trust-core-fixture-admin");
const actor:AuthenticatedActor={id:process.env.TRUST_ADMIN_ACTOR_ID??"fixture-admin",displayName:"Trust Core administrator",roles:["admin"],workspaceIds:[workspaceId,process.env.TRUST_FIXTURE_WORKSPACE_ID??"workspace-demo"]};
const oidc = createOidc();
const access = adminToken||oidc ? new AdminSessionGateway(adminToken,actor,30*60_000,oidc) : undefined;
const route = createApi(snapshots, schemas, () => new Date(), repository ? "live" : "fixture", commandProvider, access);
const port = Number(process.env.TRUST_API_PORT ?? process.env.PORT ?? 4310);

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://trust-api.local"),pathname=requestUrl.pathname;
    if(pathname==="/v1/auth/oidc/start"&&request.method==="GET"){if(!oidc){send(response,501,{error:"oidc_unavailable"});return;}const login=await oidc.beginLogin(requestUrl.searchParams.get("returnTo")??"/");response.writeHead(302,{location:login.authorizationUrl,"cache-control":"no-store","set-cookie":oidcBindingCookie(login.browserBinding)});response.end();return;}
    if(pathname==="/v1/auth/oidc/callback"&&request.method==="GET"){if(!oidc){send(response,501,{error:"oidc_unavailable"});return;}const state=requestUrl.searchParams.get("state"),code=requestUrl.searchParams.get("code"),browserBinding=cookieValue(header(request.headers.cookie),"trust_oidc_binding");if(!state||!code||!browserBinding){send(response,400,{error:"oidc_callback_invalid"});return;}const completed=await oidc.completeLogin({state,code,browserBinding});response.writeHead(302,{location:completed.returnTo,"cache-control":"no-store","set-cookie":[sessionCookie(completed.sessionId),csrfCookie(completed.csrfToken),clearOidcBindingCookie()]});response.end();return;}
    if(pathname==="/v1/auth/session"&&request.method==="POST"){const authorization=header(request.headers.authorization);const created=authorization?.startsWith("Bearer ")?await access?.createSession(authorization.slice(7)):undefined;if(!created){send(response,401,{error:"invalid_credentials"});return;}send(response,200,created.session,{"set-cookie":sessionCookie(created.sessionId)});return;}
    if(pathname==="/v1/auth/session"&&request.method==="DELETE"){const sessionId=cookieValue(header(request.headers.cookie),"trust_session");const valid=sessionId?await access?.authenticateSession(sessionId,header(request.headers["x-trust-csrf"]),true):undefined;if(!sessionId||!valid){send(response,401,{error:"invalid_session"});return;}await access?.revoke(sessionId);send(response,204,undefined,{"set-cookie":[clearSessionCookie(),clearCsrfCookie()]});return;}
    const body = await readJsonBody(request);
    const result = await route(request.method ?? "GET", pathname, { headers: { authorization: header(request.headers.authorization), cookie:header(request.headers.cookie), "x-trust-csrf":header(request.headers["x-trust-csrf"]), "x-trust-workspace-id": header(request.headers["x-trust-workspace-id"]) }, body });
    send(response,result.status,result.body);
  } catch (error) {
    response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "trust_store_unavailable" }));
  }
}).listen(port, "0.0.0.0", () => process.stdout.write(`Trust API listening on http://0.0.0.0:${port} (${repository ? "live" : "fixture"})\n`));

function adaptPool(source: Pool): DatabasePool {
  const query = async <Row>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
    const result = await source.query(text, values ? [...values] : undefined);
    return { rows: result.rows as Row[], rowCount: result.rowCount };
  };
  return { query, async connect() { const client = await source.connect(); return { query: async <Row>(text:string,values?:readonly unknown[])=>{const result=await client.query(text,values?[...values]:undefined);return {rows:result.rows as Row[],rowCount:result.rowCount};}, release:()=>client.release() } satisfies TransactionClient; }, end:()=>source.end() };
}
function header(value:string|string[]|undefined):string|undefined{return Array.isArray(value)?value[0]:value;}
async function readJsonBody(request:import("node:http").IncomingMessage):Promise<unknown>{if(request.method==="GET"||request.method==="HEAD")return undefined;const chunks:Buffer[]=[];let size=0;for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.byteLength;if(size>1024*1024)throw new Error("request_too_large");chunks.push(bytes);}if(size===0)return undefined;return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
function send(response:import("node:http").ServerResponse,status:number,body:unknown,headers:Record<string,string|string[]>={}):void{response.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers});response.end(body===undefined?undefined:JSON.stringify(body));}
function cookieValue(headerValue:string|undefined,name:string):string|undefined{return headerValue?.split(";").map(item=>item.trim().split("=")).find(([key])=>key===name)?.[1];}
function sessionCookie(id:string):string{return `trust_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${process.env.NODE_ENV==="production"?"; Secure":""}`;}
function clearSessionCookie():string{return `trust_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV==="production"?"; Secure":""}`;}
function csrfCookie(token:string):string{return `trust_csrf=${token}; SameSite=Strict; Path=/; Max-Age=1800${process.env.NODE_ENV==="production"?"; Secure":""}`;}
function clearCsrfCookie():string{return `trust_csrf=; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV==="production"?"; Secure":""}`;}
function oidcBindingCookie(token:string):string{return `trust_oidc_binding=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300${process.env.NODE_ENV==="production"?"; Secure":""}`;}
function clearOidcBindingCookie():string{return `trust_oidc_binding=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV==="production"?"; Secure":""}`;}
function createOidc():OidcIdentityService|undefined{const issuer=process.env.TRUST_OIDC_ISSUER,clientId=process.env.TRUST_OIDC_CLIENT_ID,redirectUri=process.env.TRUST_OIDC_REDIRECT_URI;if(!issuer||!clientId||!redirectUri||!pool)return undefined;const provider=new StandardsOidcProvider({issuer,clientId,...(process.env.TRUST_OIDC_CLIENT_SECRET?{clientSecret:process.env.TRUST_OIDC_CLIENT_SECRET}:{}),roleClaim:process.env.TRUST_OIDC_ROLE_CLAIM??"roles",workspaceClaim:process.env.TRUST_OIDC_WORKSPACE_CLAIM??"trust_workspaces"});return new OidcIdentityService(provider,new PostgresIdentityStore(pool),{clientId,redirectUri,allowedReturnPaths:["/"],roleMap:{"trust-owner":"owner","trust-admin":"admin","trust-editor":"editor","trust-recovery":"recovery_operator","trust-auditor":"auditor"}});}
function createStorage():MinioObjectStorage|undefined{const endpoint=process.env.TRUST_STORAGE_ENDPOINT,bucket=process.env.TRUST_STORAGE_BUCKET,accessKeyId=process.env.TRUST_STORAGE_ACCESS_KEY,secretAccessKey=process.env.TRUST_STORAGE_SECRET_KEY;if(!endpoint||!bucket||!accessKeyId||!secretAccessKey)return undefined;return new MinioObjectStorage({endpoint,bucket,accessKeyId,secretAccessKey,region:process.env.TRUST_STORAGE_REGION??"us-east-1",forcePathStyle:process.env.TRUST_STORAGE_FORCE_PATH_STYLE!=="false"});}
async function afterIngestEffect(checkpoint:IngestCheckpoint):Promise<void>{if(process.env.TRUST_FAIL_AFTER_CHECKPOINT===checkpoint){process.stderr.write(`Injected process termination after ${checkpoint}\n`);process.exit(86);}}
