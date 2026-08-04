import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AdminSession, AuthenticatedActor } from "@trust-core/protocol";
import type { OidcIdentityService } from "@trust-core/identity";
import { roleAllows, type AccessGateway, type ApiAction } from "./app.js";

export class StaticTokenAccessGateway implements AccessGateway {
  constructor(private readonly token: string|undefined, private readonly actor: AuthenticatedActor) {}
  async authenticate(candidate: string): Promise<AuthenticatedActor | undefined> {
    if(!this.token)return undefined;
    const actual = Buffer.from(this.token), supplied = Buffer.from(candidate);
    return actual.byteLength === supplied.byteLength && timingSafeEqual(actual, supplied) ? this.actor : undefined;
  }
  allows(actor: AuthenticatedActor, action: ApiAction, workspaceId: string): boolean { return roleAllows(actor, action, workspaceId); }
}

interface StoredSession { actor: AuthenticatedActor; csrfToken: string; expiresAt: number; }
export class AdminSessionGateway extends StaticTokenAccessGateway {
  private readonly sessions=new Map<string,StoredSession>();
  constructor(token:string|undefined,actor:AuthenticatedActor,private readonly lifetimeMs=30*60*1000,private readonly oidc?:OidcIdentityService){super(token,actor);this.bootstrapActor=actor;}
  private readonly bootstrapActor:AuthenticatedActor;
  async createSession(candidate:string):Promise<{sessionId:string;session:AdminSession}|undefined>{if(!await super.authenticate(candidate))return undefined;this.prune();const sessionId=randomBytes(32).toString("base64url"),csrfToken=randomBytes(24).toString("base64url"),expiresAt=Date.now()+this.lifetimeMs;this.sessions.set(sessionId,{actor:this.bootstrapActor,csrfToken,expiresAt});return{sessionId,session:{actor:this.bootstrapActor,csrfToken,expiresAt:new Date(expiresAt).toISOString()}};}
  async authenticateSession(sessionId:string,csrfToken:string|undefined,mutation:boolean):Promise<AuthenticatedActor|undefined>{this.prune();const session=this.sessions.get(sessionId);if(session&&(!mutation||csrfTokenMatches(session.csrfToken,csrfToken)))return session.actor;return this.oidc?.authenticateSession(sessionId,csrfToken,mutation);}
  async revoke(sessionId:string):Promise<void>{this.sessions.delete(sessionId);await this.oidc?.revokeSession(sessionId);}
  private prune():void{const now=Date.now();for(const [id,session] of this.sessions)if(session.expiresAt<=now)this.sessions.delete(id);}
}
function csrfTokenMatches(actual:string,supplied:string|undefined):boolean{if(!supplied)return false;const a=Buffer.from(actual),b=Buffer.from(supplied);return a.byteLength===b.byteLength&&timingSafeEqual(a,b);}
