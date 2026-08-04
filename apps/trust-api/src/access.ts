import { randomBytes, timingSafeEqual } from "node:crypto";
import { evaluatePolicy } from "@trust-core/policy";
import type { PolicyAction, PrincipalType } from "@trust-core/policy";
import type {
  AdminSession,
  ApplicationRegistration,
  AuthenticatedActor,
  BreakGlassGrant,
  PolicyAssignment,
} from "@trust-core/protocol";
import type { OidcIdentityService } from "@trust-core/identity";
import type { AccessGateway, ApiAction, AuthorizationScope } from "./app.js";

export interface PolicyDataSource {
  listApplications(
    workspaceId: string,
  ): Promise<readonly ApplicationRegistration[]>;
  listPolicyAssignments(
    workspaceId: string,
    principalId?: string,
  ): Promise<readonly PolicyAssignment[]>;
  listActiveBreakGlassGrants(
    workspaceId: string,
    at: string,
    principalId?: string,
  ): Promise<readonly BreakGlassGrant[]>;
  recordBreakGlassUse?(input: {
    workspaceId: string;
    principalId: string;
    grantId: string;
    action: PolicyAction;
    reason: string;
    requestId?: string;
    occurredAt: string;
  }): Promise<void>;
}

export class StaticTokenAccessGateway implements AccessGateway {
  constructor(
    private readonly token: string | undefined,
    private readonly actor: AuthenticatedActor,
    private readonly policies?: PolicyDataSource,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async authenticate(
    candidate: string,
  ): Promise<AuthenticatedActor | undefined> {
    if (!this.token) return undefined;
    const actual = Buffer.from(this.token),
      supplied = Buffer.from(candidate);
    return actual.byteLength === supplied.byteLength &&
      timingSafeEqual(actual, supplied)
      ? this.actor
      : undefined;
  }
  async allows(
    actor: AuthenticatedActor,
    action: ApiAction,
    scope: AuthorizationScope,
  ): Promise<boolean> {
    const at = this.clock().toISOString();
    const principalType = actorPrincipalType(actor);
    const [assignments, applications, breakGlassGrants] = this.policies
      ? await Promise.all([
          this.policies.listPolicyAssignments(scope.workspaceId, actor.id),
          this.policies.listApplications(scope.workspaceId),
          this.policies.listActiveBreakGlassGrants(
            scope.workspaceId,
            at,
            actor.id,
          ),
        ])
      : ([[], [], []] as const);
    const application =
      principalType === "application"
        ? applications.find(
            (candidate) =>
              candidate.workspaceId === scope.workspaceId &&
              candidate.status === "active" &&
              (candidate.id === actor.id || candidate.namespace === actor.id),
          )
        : undefined;
    if (principalType === "application" && !application) return false;
    if (
      principalType === "application" &&
      scope.applicationScopeAllowed !== true
    )
      return false;
    if (
      principalType === "application" &&
      scope.applicationId !== undefined &&
      scope.applicationId !== application?.id
    )
      return false;
    const effectiveScope: AuthorizationScope = {
      workspaceId: scope.workspaceId,
      ...(scope.datasetId ? { datasetId: scope.datasetId } : {}),
      ...(scope.requestId ? { requestId: scope.requestId } : {}),
      ...(principalType === "application" &&
      scope.applicationScopeAllowed &&
      application
        ? { applicationId: application.id, applicationScopeAllowed: true }
        : {}),
    };
    const decision = evaluatePolicy({
      principal: {
        id: actor.id,
        type: principalType,
        roles: actor.roles,
        workspaceIds: actor.workspaceIds,
      },
      action,
      scope: effectiveScope,
      assignments,
      applications,
      breakGlassGrants,
      at,
    });
    if (
      decision.allowed &&
      decision.source === "break_glass" &&
      this.policies?.recordBreakGlassUse
    ) {
      await this.policies.recordBreakGlassUse({
        workspaceId: scope.workspaceId,
        principalId: actor.id,
        grantId: decision.grantId,
        action,
        reason: decision.reason,
        ...(scope.requestId ? { requestId: scope.requestId } : {}),
        occurredAt: at,
      });
    }
    return decision.allowed;
  }
}

interface StoredSession {
  actor: AuthenticatedActor;
  csrfToken: string;
  expiresAt: number;
}
export class AdminSessionGateway extends StaticTokenAccessGateway {
  private readonly sessions = new Map<string, StoredSession>();
  constructor(
    token: string | undefined,
    actor: AuthenticatedActor,
    private readonly lifetimeMs = 30 * 60 * 1000,
    private readonly oidc?: OidcIdentityService,
    policies?: PolicyDataSource,
    clock: () => Date = () => new Date(),
  ) {
    super(token, actor, policies, clock);
    this.bootstrapActor = actor;
  }
  private readonly bootstrapActor: AuthenticatedActor;
  async createSession(
    candidate: string,
  ): Promise<{ sessionId: string; session: AdminSession } | undefined> {
    if (!(await super.authenticate(candidate))) return undefined;
    this.prune();
    const sessionId = randomBytes(32).toString("base64url"),
      csrfToken = randomBytes(24).toString("base64url"),
      expiresAt = Date.now() + this.lifetimeMs;
    this.sessions.set(sessionId, {
      actor: this.bootstrapActor,
      csrfToken,
      expiresAt,
    });
    return {
      sessionId,
      session: {
        actor: this.bootstrapActor,
        csrfToken,
        expiresAt: new Date(expiresAt).toISOString(),
      },
    };
  }
  async authenticateSession(
    sessionId: string,
    csrfToken: string | undefined,
    mutation: boolean,
  ): Promise<AuthenticatedActor | undefined> {
    this.prune();
    const session = this.sessions.get(sessionId);
    if (
      session &&
      (!mutation || csrfTokenMatches(session.csrfToken, csrfToken))
    )
      return session.actor;
    return this.oidc?.authenticateSession(sessionId, csrfToken, mutation);
  }
  async revoke(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    await this.oidc?.revokeSession(sessionId);
  }
  private prune(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions)
      if (session.expiresAt <= now) this.sessions.delete(id);
  }
}
function csrfTokenMatches(
  actual: string,
  supplied: string | undefined,
): boolean {
  if (!supplied) return false;
  const a = Buffer.from(actual),
    b = Buffer.from(supplied);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
function actorPrincipalType(actor: AuthenticatedActor): PrincipalType {
  const value = (
    actor as AuthenticatedActor & { principalType?: PrincipalType }
  ).principalType;
  return value ?? "user";
}
