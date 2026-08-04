import type { AuthenticatedActor } from "@trust-core/protocol";
import type { IdentitySessionRecord,IdentityStore,LoginTransaction } from "@trust-core/identity";
import type { DatabasePool } from "./db.js";
export class PostgresIdentityStore implements IdentityStore {
  constructor(private readonly pool:DatabasePool){}
  async saveLogin(v:LoginTransaction):Promise<void>{await this.pool.query("INSERT INTO identity_login_transactions (state_hash,browser_binding_hash,nonce,code_verifier,redirect_uri,return_to,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",[v.stateHash,v.browserBindingHash,v.nonce,v.codeVerifier,v.redirectUri,v.returnTo,v.expiresAt]);}
  async consumeLogin(stateHash:string):Promise<LoginTransaction|undefined>{const r=await this.pool.query<LoginRow>("DELETE FROM identity_login_transactions WHERE state_hash=$1 RETURNING state_hash,browser_binding_hash,nonce,code_verifier,redirect_uri,return_to,expires_at",[stateHash]);return r.rows[0]?mapLogin(r.rows[0]):undefined;}
  async createSession(v:IdentitySessionRecord):Promise<void>{await this.pool.query("INSERT INTO identity_sessions (session_hash,csrf_hash,actor_json,created_at,expires_at,last_seen_at) VALUES ($1,$2,$3::jsonb,$4,$5,$6)",[v.sessionHash,v.csrfHash,JSON.stringify(v.actor),v.createdAt,v.expiresAt,v.lastSeenAt]);}
  async getSession(sessionHash:string):Promise<IdentitySessionRecord|undefined>{const r=await this.pool.query<SessionRow>("UPDATE identity_sessions SET last_seen_at=now() WHERE session_hash=$1 AND revoked_at IS NULL AND expires_at>now() RETURNING session_hash,csrf_hash,actor_json,created_at,expires_at,last_seen_at",[sessionHash]);return r.rows[0]?mapSession(r.rows[0]):undefined;}
  async revokeSession(sessionHash:string):Promise<void>{await this.pool.query("UPDATE identity_sessions SET revoked_at=now() WHERE session_hash=$1 AND revoked_at IS NULL",[sessionHash]);}
}
interface LoginRow{state_hash:string;browser_binding_hash:string;nonce:string;code_verifier:string;redirect_uri:string;return_to:string;expires_at:string|Date;}
interface SessionRow{session_hash:string;csrf_hash:string;actor_json:AuthenticatedActor;created_at:string|Date;expires_at:string|Date;last_seen_at:string|Date;}
const iso=(v:string|Date)=>new Date(v).toISOString();
function mapLogin(r:LoginRow):LoginTransaction{return{stateHash:r.state_hash,browserBindingHash:r.browser_binding_hash,nonce:r.nonce,codeVerifier:r.code_verifier,redirectUri:r.redirect_uri,returnTo:r.return_to,expiresAt:iso(r.expires_at)};}
function mapSession(r:SessionRow):IdentitySessionRecord{return{sessionHash:r.session_hash,csrfHash:r.csrf_hash,actor:r.actor_json,createdAt:iso(r.created_at),expiresAt:iso(r.expires_at),lastSeenAt:iso(r.last_seen_at)};}
