import type { AdminSession, ControlCentreSnapshot, HistorySnapshot, RevisionCommandResult, VerificationRunResult } from "@trust-core/protocol";
import type { ControlCentreGateway } from "./model";

let csrfToken=typeof document==="undefined"?"":readCookie("trust_csrf")??"";
const base=(import.meta.env.VITE_TRUST_API_BASE as string|undefined)?.replace(/\/$/,"")??"/api";
const configuredWorkspace=(import.meta.env.VITE_TRUST_WORKSPACE_ID as string|undefined)??"workspace-demo";
export class GatewayError extends Error { constructor(readonly status:number,message:string){super(message);this.name="GatewayError";} }
async function request<T>(path:string,init:RequestInit={}):Promise<T>{const response=await fetch(`${base}${path}`,{...init,credentials:"include",headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(csrfToken?{"x-trust-csrf":csrfToken}:{}),...init.headers}});if(!response.ok){const body=await response.json().catch(()=>({})) as {error?:string;detail?:string};throw new GatewayError(response.status,body.detail??body.error??`Request failed (${response.status})`);}return response.status===204?undefined as T:await response.json() as T;}
export const httpGateway:ControlCentreGateway={
  getSnapshot:()=>request<ControlCentreSnapshot>("/v1/control-centre/snapshot",{headers:{"x-trust-workspace-id":configuredWorkspace}}),
  getHistory:(_workspaceId)=>request<HistorySnapshot>("/v1/history",{headers:{"x-trust-workspace-id":configuredWorkspace}}),
  restoreResource:(_workspaceId,resourceId)=>request<RevisionCommandResult>(`/v1/resources/${encodeURIComponent(resourceId)}/restore`,{method:"POST",body:JSON.stringify({workspaceId:configuredWorkspace,changeNote:"Restored from Trust Core Control Centre"})}),
  async startAdminSession(token){const session=await request<AdminSession>("/v1/auth/session",{method:"POST",headers:{authorization:`Bearer ${token}`}});csrfToken=session.csrfToken;return session;},
  async endAdminSession(){await request<void>("/v1/auth/session",{method:"DELETE"});csrfToken="";},
  beginFederatedLogin(returnTo="/"){window.location.assign(`${base}/v1/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`);},
  runVerification:(_workspaceId,level)=>request<VerificationRunResult>("/v1/verification/runs",{method:"POST",body:JSON.stringify({workspaceId:configuredWorkspace,level})}),
};
function readCookie(name:string):string|undefined{return document.cookie.split(";").map(item=>item.trim().split("=")).find(([key])=>key===name)?.[1];}
