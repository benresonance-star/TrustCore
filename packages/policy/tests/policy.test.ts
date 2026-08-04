import { describe, expect, it } from "vitest";
import {
  actionBoundary,
  evaluatePolicy,
  type PolicyEvaluationInput,
  type PolicyRole,
} from "../src/index.js";

const at = "2026-08-04T12:00:00.000Z";

function evaluation(
  role: PolicyRole,
  action: PolicyEvaluationInput["action"],
  scope: PolicyEvaluationInput["scope"] = { workspaceId: "workspace" },
): PolicyEvaluationInput {
  return {
    principal: { id: "person", type: "user" },
    action,
    scope,
    at,
    assignments: [
      {
        id: `assignment-${role}`,
        workspaceId: "workspace",
        principalType: "user",
        principalId: "person",
        role,
        scopeKind: "workspace",
        scopeId: "workspace",
      },
    ],
  };
}

describe("Release 0.1 policy evaluation", () => {
  it("enforces focused role capabilities and denies by default", () => {
    expect(
      evaluatePolicy(evaluation("editor", "revision:create")).allowed,
    ).toBe(true);
    expect(
      evaluatePolicy(evaluation("editor", "resource:delete")).allowed,
    ).toBe(false);
    expect(evaluatePolicy(evaluation("auditor", "audit:read")).allowed).toBe(
      true,
    );
    expect(
      evaluatePolicy(evaluation("auditor", "revision:create")).allowed,
    ).toBe(false);
    expect(
      evaluatePolicy(evaluation("recovery_operator", "resource:restore"))
        .allowed,
    ).toBe(true);
    expect(
      evaluatePolicy(evaluation("recovery_operator", "resource:delete"))
        .allowed,
    ).toBe(false);
    expect(
      evaluatePolicy(evaluation("worker", "operation:process")).allowed,
    ).toBe(true);
    expect(evaluatePolicy(evaluation("worker", "resource:read")).allowed).toBe(
      false,
    );
    expect(
      evaluatePolicy({
        principal: { id: "unknown", type: "user" },
        action: "history:read",
        scope: { workspaceId: "workspace" },
      }).allowed,
    ).toBe(false);
  });

  it("keeps infrastructure capability separate from content access", () => {
    expect(actionBoundary("health:read")).toBe("infrastructure");
    expect(actionBoundary("resource:read")).toBe("content");
    expect(
      evaluatePolicy(evaluation("infrastructure_operator", "health:read"))
        .allowed,
    ).toBe(true);
    expect(
      evaluatePolicy(evaluation("infrastructure_operator", "resource:read"))
        .allowed,
    ).toBe(false);
  });

  it("requires exact dataset scope while workspace scope covers descendants", () => {
    const input = evaluation("editor", "revision:create", {
      workspaceId: "workspace",
      datasetId: "dataset-a",
    });
    input.assignments = [
      { ...input.assignments![0]!, scopeKind: "dataset", scopeId: "dataset-a" },
    ];
    expect(evaluatePolicy(input).allowed).toBe(true);
    expect(
      evaluatePolicy({
        ...input,
        scope: { workspaceId: "workspace", datasetId: "dataset-b" },
      }).allowed,
    ).toBe(false);
  });

  it("requires an active application registration, capability ceiling, and matching application scope", () => {
    const input: PolicyEvaluationInput = {
      principal: { id: "diary.app", type: "application" },
      action: "revision:create",
      scope: { workspaceId: "workspace", applicationId: "application-a" },
      assignments: [
        {
          id: "assignment",
          workspaceId: "workspace",
          principalType: "application",
          principalId: "diary.app",
          role: "editor",
          scopeKind: "application",
          scopeId: "application-a",
        },
      ],
      applications: [
        {
          id: "application-a",
          workspaceId: "workspace",
          namespace: "diary.app",
          capabilities: ["revision:create"],
          status: "active",
        },
      ],
    };
    expect(evaluatePolicy(input).allowed).toBe(true);
    expect(
      evaluatePolicy({
        ...input,
        scope: { workspaceId: "workspace", applicationId: "application-b" },
      }).allowed,
    ).toBe(false);
    expect(evaluatePolicy({ ...input, action: "object:ingest" }).allowed).toBe(
      false,
    );
    expect(
      evaluatePolicy({
        ...input,
        applications: [{ ...input.applications![0]!, status: "suspended" }],
      }).allowed,
    ).toBe(false);
  });

  it("allows only explicit active break-glass actions and rejects expired or revoked grants", () => {
    const grant = {
      id: "grant",
      workspaceId: "workspace",
      principalId: "person",
      reason: "Recover critical records",
      actions: ["resource:restore"],
      grantedAt: "2026-08-04T11:00:00.000Z",
      expiresAt: "2026-08-04T13:00:00.000Z",
    } as const;
    const input: PolicyEvaluationInput = {
      principal: { id: "person", type: "user" },
      action: "resource:restore",
      scope: { workspaceId: "workspace" },
      at,
      breakGlassGrants: [grant],
    };
    expect(evaluatePolicy(input)).toMatchObject({
      allowed: true,
      source: "break_glass",
      grantId: "grant",
    });
    expect(evaluatePolicy({ ...input, at: grant.expiresAt }).allowed).toBe(
      false,
    );
    expect(
      evaluatePolicy({
        ...input,
        breakGlassGrants: [{ ...grant, revokedAt: "2026-08-04T11:30:00.000Z" }],
      }).allowed,
    ).toBe(false);
    expect(
      evaluatePolicy({
        ...input,
        action: "access:manage",
        breakGlassGrants: [{ ...grant, actions: ["access:manage"] }],
      }).allowed,
    ).toBe(false);
  });
});
