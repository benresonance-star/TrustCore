export const policyActions = [
  "workspace:read",
  "workspace:manage",
  "control:read",
  "dataset:read",
  "dataset:write",
  "dataset:manage",
  "resource:read",
  "revision:create",
  "resource:delete",
  "resource:restore",
  "blob:read",
  "object:ingest",
  "relation:read",
  "relation:write",
  "history:read",
  "audit:read",
  "verification:run",
  "retention:manage",
  "purge:execute",
  "access:manage",
  "break_glass:grant",
  "break_glass:revoke",
  "break_glass:use",
  "health:read",
  "operation:process",
  "portability:read",
  "portability:plan",
  "portability:execute",
] as const;

export type PolicyAction = (typeof policyActions)[number];
export type PolicyRole =
  | "owner"
  | "admin"
  | "editor"
  | "recovery_operator"
  | "auditor"
  | "worker"
  | "infrastructure_operator";
export type PrincipalType = "user" | "service" | "application";
export type ScopeKind = "workspace" | "dataset" | "application";
export type ActionBoundary = "content" | "infrastructure" | "security";

export interface PolicyPrincipal {
  id: string;
  type: PrincipalType;
  roles?: readonly string[];
  workspaceIds?: readonly string[];
}

export interface PolicyScope {
  workspaceId: string;
  datasetId?: string;
  applicationId?: string;
}

export interface ScopedPolicyAssignment {
  id: string;
  workspaceId: string;
  principalType: PrincipalType;
  principalId: string;
  role: string;
  scopeKind: ScopeKind;
  scopeId: string;
  revokedAt?: string;
}

export interface RegisteredApplication {
  id: string;
  workspaceId: string;
  namespace: string;
  capabilities: readonly string[];
  status: "active" | "suspended" | "revoked";
}

export interface ActiveBreakGlassGrant {
  id: string;
  workspaceId: string;
  principalId: string;
  reason: string;
  actions: readonly string[];
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface PolicyEvaluationInput {
  principal: PolicyPrincipal;
  action: PolicyAction;
  scope: PolicyScope;
  assignments?: readonly ScopedPolicyAssignment[];
  applications?: readonly RegisteredApplication[];
  breakGlassGrants?: readonly ActiveBreakGlassGrant[];
  at?: string;
}

export type PolicyDecision =
  | { allowed: true; source: "role"; assignmentId: string }
  | { allowed: true; source: "break_glass"; grantId: string; reason: string }
  | {
      allowed: false;
      reason:
        | "unknown_action"
        | "unregistered_application"
        | "application_capability_denied"
        | "no_matching_assignment";
    };

const breakGlassEligibleActions = new Set<PolicyAction>([
  "dataset:read",
  "resource:read",
  "resource:restore",
  "blob:read",
  "history:read",
]);

const roleCapabilities: Readonly<
  Record<PolicyRole, ReadonlySet<PolicyAction>>
> = {
  owner: new Set(
    policyActions.filter((action) => action !== "operation:process"),
  ),
  admin: new Set([
    "workspace:read",
    "workspace:manage",
    "control:read",
    "dataset:read",
    "dataset:write",
    "dataset:manage",
    "resource:read",
    "revision:create",
    "resource:delete",
    "resource:restore",
    "blob:read",
    "object:ingest",
    "relation:read",
    "relation:write",
    "history:read",
    "audit:read",
    "verification:run",
    "retention:manage",
    "purge:execute",
    "access:manage",
    "break_glass:grant",
    "break_glass:revoke",
    "health:read",
    "portability:read",
    "portability:plan",
    "portability:execute",
  ]),
  editor: new Set([
    "dataset:read",
    "dataset:write",
    "resource:read",
    "revision:create",
    "blob:read",
    "object:ingest",
    "relation:read",
    "relation:write",
  ]),
  recovery_operator: new Set([
    "dataset:read",
    "resource:read",
    "resource:restore",
    "history:read",
    "portability:read",
    "portability:plan",
    "portability:execute",
  ]),
  auditor: new Set([
    "workspace:read",
    "control:read",
    "dataset:read",
    "resource:read",
    "blob:read",
    "relation:read",
    "history:read",
    "audit:read",
    "verification:run",
    "health:read",
    "portability:read",
  ]),
  worker: new Set(["health:read", "operation:process"]),
  infrastructure_operator: new Set([
    "workspace:read",
    "control:read",
    "audit:read",
    "verification:run",
    "health:read",
    "portability:read",
  ]),
};

export function isPolicyAction(value: string): value is PolicyAction {
  return (policyActions as readonly string[]).includes(value);
}

export function isBreakGlassEligibleAction(
  value: string,
): value is PolicyAction {
  return isPolicyAction(value) && breakGlassEligibleActions.has(value);
}

export function actionBoundary(action: PolicyAction): ActionBoundary {
  switch (action) {
    case "dataset:read":
    case "dataset:write":
    case "dataset:manage":
    case "resource:read":
    case "revision:create":
    case "resource:delete":
    case "resource:restore":
    case "blob:read":
    case "object:ingest":
    case "relation:read":
    case "relation:write":
    case "history:read":
    case "retention:manage":
    case "purge:execute":
      return "content";
    case "workspace:read":
    case "control:read":
    case "audit:read":
    case "verification:run":
    case "health:read":
    case "operation:process":
    case "portability:read":
      return "infrastructure";
    case "workspace:manage":
    case "access:manage":
    case "break_glass:grant":
    case "break_glass:revoke":
    case "break_glass:use":
    case "portability:plan":
    case "portability:execute":
      return "security";
    default:
      return assertNever(action);
  }
}

export function capabilitiesForRole(role: string): ReadonlySet<PolicyAction> {
  return isPolicyRole(role) ? roleCapabilities[role] : new Set();
}

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecision {
  const application = registeredApplication(input);
  if (input.principal.type === "application") {
    if (!application)
      return { allowed: false, reason: "unregistered_application" };
    if (!application.capabilities.some((action) => action === input.action)) {
      return { allowed: false, reason: "application_capability_denied" };
    }
  }

  const assignments = [
    ...(input.assignments ?? []),
    ...claimedRoleAssignments(input),
  ];
  for (const assignment of assignments) {
    if (!assignmentMatches(assignment, input)) continue;
    if (capabilitiesForRole(assignment.role).has(input.action)) {
      return { allowed: true, source: "role", assignmentId: assignment.id };
    }
  }

  const breakGlass = activeBreakGlassGrant(input);
  if (breakGlass)
    return {
      allowed: true,
      source: "break_glass",
      grantId: breakGlass.id,
      reason: breakGlass.reason,
    };
  return { allowed: false, reason: "no_matching_assignment" };
}

function assignmentMatches(
  assignment: ScopedPolicyAssignment,
  input: PolicyEvaluationInput,
): boolean {
  if (
    assignment.revokedAt ||
    assignment.workspaceId !== input.scope.workspaceId ||
    assignment.principalType !== input.principal.type ||
    assignment.principalId !== input.principal.id
  )
    return false;
  switch (assignment.scopeKind) {
    case "workspace":
      return assignment.scopeId === input.scope.workspaceId;
    case "dataset":
      return (
        input.scope.datasetId !== undefined &&
        assignment.scopeId === input.scope.datasetId
      );
    case "application":
      return (
        input.scope.applicationId !== undefined &&
        assignment.scopeId === input.scope.applicationId
      );
    default:
      return assertNever(assignment.scopeKind);
  }
}

function claimedRoleAssignments(
  input: PolicyEvaluationInput,
): ScopedPolicyAssignment[] {
  if (!input.principal.workspaceIds?.includes(input.scope.workspaceId))
    return [];
  return (input.principal.roles ?? []).map((role, index) => ({
    id: `identity-claim:${index}:${role}`,
    workspaceId: input.scope.workspaceId,
    principalType: input.principal.type,
    principalId: input.principal.id,
    role,
    scopeKind: "workspace",
    scopeId: input.scope.workspaceId,
  }));
}

function registeredApplication(
  input: PolicyEvaluationInput,
): RegisteredApplication | undefined {
  return input.applications?.find(
    (application) =>
      application.workspaceId === input.scope.workspaceId &&
      application.status === "active" &&
      (application.id === input.principal.id ||
        application.namespace === input.principal.id),
  );
}

function activeBreakGlassGrant(
  input: PolicyEvaluationInput,
): ActiveBreakGlassGrant | undefined {
  if (!isBreakGlassEligibleAction(input.action)) return undefined;
  const at = Date.parse(input.at ?? new Date().toISOString());
  return input.breakGlassGrants?.find(
    (grant) =>
      grant.workspaceId === input.scope.workspaceId &&
      grant.principalId === input.principal.id &&
      !grant.revokedAt &&
      grant.reason.trim().length > 0 &&
      grant.actions.some((action) => action === input.action) &&
      Date.parse(grant.grantedAt) <= at &&
      Date.parse(grant.expiresAt) > at,
  );
}

function isPolicyRole(value: string): value is PolicyRole {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "editor" ||
    value === "recovery_operator" ||
    value === "auditor" ||
    value === "worker" ||
    value === "infrastructure_operator"
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled policy value: ${String(value)}`);
}
