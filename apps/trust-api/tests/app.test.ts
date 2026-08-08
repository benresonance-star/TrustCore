import { createHash } from "node:crypto";
import {
  assembleArchiveEntries,
  readTrustArchive,
  writeTrustArchive,
} from "@trust-core/archive";
import { release01Routes, release01Schemas } from "@trust-core/protocol";
import type { AuthenticatedActor } from "@trust-core/protocol";
import { describe, expect, it } from "vitest";
import { StaticTokenAccessGateway } from "../src/access.js";
import { createApi, roleAllows } from "../src/app.js";
import { createFixtureCommands } from "../src/fixture-commands.js";
import { FixturePortabilityProvider } from "../src/portability.js";

const now = new Date("2026-08-04T12:00:00.000Z");
const snapshot = {
  status: {
    protectedDatasets: 1,
    activeProjects: 1,
    latestVerifiedBackup: "Now",
    recoveryAttention: 0,
    canonicalIntegrityPercent: 100,
    canonicalIntegrityStatus: "verified",
    syncQueue: 0,
  },
  datasets: [],
} as const;
const schema = {
  id: "schema:test",
  key: "app/test/1.0.0",
  digest: "a".repeat(64),
  status: "active",
  publishedAt: now.toISOString(),
  manifest: {
    namespace: "app",
    name: "test",
    version: "1.0.0",
    title: "Test",
    description: "Test",
    classification: "application",
    resourceTypes: [],
    relationships: [],
    compatibleArchiveFormat: "trust-core-archive/1.0.0",
  },
} as const;
const schemas = {
  listSchemas: async () => [schema],
  getSchema: async (key: string) => (key === schema.key ? schema : undefined),
};
const admin: AuthenticatedActor = {
  id: "admin",
  displayName: "Admin",
  roles: ["admin"],
  workspaceIds: ["workspace-demo"],
};
const headers = {
  authorization: "Bearer valid",
  "x-trust-workspace-id": "workspace-demo",
  "x-request-id": "request-1",
};

function configured(actor: AuthenticatedActor = admin) {
  const commands = createFixtureCommands(() => now);
  const access = {
    authenticate: async (token: string) =>
      token === "valid" ? actor : undefined,
    confirmsPrivilegedAction: async (
      authenticatedActor: AuthenticatedActor,
      proof: string,
    ) =>
      proof === "valid" &&
      authenticatedActor.id === actor.id &&
      (authenticatedActor.principalType ?? "user") ===
        (actor.principalType ?? "user"),
    allows: roleAllows,
  };
  return {
    commands,
    route: createApi(
      { getSnapshot: async () => snapshot },
      schemas,
      () => now,
      "fixture",
      commands,
      access,
      new FixturePortabilityProvider(() => now),
    ),
  };
}

describe("Release 0.1 API routing", () => {
  it("keeps health public and protects every workspace route", async () => {
    const { route } = configured();
    expect(await route("GET", "/health")).toEqual({
      status: 200,
      body: {
        service: "trust-api",
        status: "ok",
        mode: "fixture",
        checkedAt: now.toISOString(),
      },
    });
    expect((await route("GET", "/v1/workspaces")).body).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(
      (
        await route("GET", "/v1/schemas", {
          headers: { authorization: "Bearer valid" },
        })
      ).body,
    ).toMatchObject({ code: "WORKSPACE_REQUIRED" });
    expect((await route("GET", "/v1/workspaces", { headers })).status).toBe(
      200,
    );
  });

  it("serves the in-scope query surface from shared contracts", async () => {
    const { route } = configured();
    const paths = [
      "/v1/workspaces",
      "/v1/applications",
      "/v1/schemas",
      "/v1/schemas/app%2Ftest%2F1.0.0",
      "/v1/datasets",
      "/v1/datasets/ivan",
      "/v1/resources",
      "/v1/resources/diary-main",
      "/v1/resources/diary-main/revision-graph",
      "/v1/relations",
      "/v1/deleted-resources",
      "/v1/history",
      "/v1/audit/events",
      "/v1/verification/reports",
      "/v1/health/storage",
      "/v1/health/backup",
      "/v1/control-centre/snapshot",
    ];
    for (const path of paths)
      expect((await route("GET", path, { headers })).status, path).toBe(200);
    expect(
      (await route("GET", "/v1/resources/missing", { headers })).body,
    ).toMatchObject({ code: "RESOURCE_NOT_FOUND", requestId: "request-1" });
  });

  it("restricts policy assignment management and keeps fixture changes non-persistent", async () => {
    const { route } = configured();
    const initial = await route("GET", "/v1/policy-assignments", { headers });
    expect(initial.body).toMatchObject({
      items: [{ id: "fixture-policy-admin", role: "admin" }],
    });
    const created = await route("POST", "/v1/policy-assignments", {
      headers,
      body: {
        workspaceId: "workspace-demo",
        principalType: "user",
        principalId: "reviewer",
        role: "auditor",
        scopeKind: "workspace",
        scopeId: "workspace-demo",
        idempotencyKey: "assign-reviewer",
      },
    });
    expect(created.body).toMatchObject({
      principalId: "reviewer",
      role: "auditor",
    });
    expect(
      (await route("GET", "/v1/policy-assignments", { headers })).body,
    ).toEqual(initial.body);
    const revoked = await route(
      "DELETE",
      "/v1/policy-assignments/fixture-policy-admin",
      {
        headers,
        body: {
          workspaceId: "workspace-demo",
          idempotencyKey: "revoke-admin",
        },
      },
    );
    expect(revoked.body).toMatchObject({
      id: "fixture-policy-admin",
      revokedAt: now.toISOString(),
    });

    const denied = configured({
      id: "auditor",
      displayName: "Auditor",
      roles: ["auditor"],
      workspaceIds: ["workspace-demo"],
    }).route;
    expect(
      (await denied("GET", "/v1/policy-assignments", { headers })).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("keeps every shared Release 0.1 contract wired to the router", async () => {
    const { route } = configured();
    for (const contract of release01Routes) {
      if (contract.operationId.startsWith("auth.")) continue;
      const path = contract.path
        .replace("{schemaKey}", "app%2Ftest%2F1.0.0")
        .replace("{datasetId}", "ivan")
        .replace("{policyId}", "missing")
        .replace("{assignmentId}", "fixture-policy-admin")
        .replace("{resourceId}", "diary-main")
        .replace("{reportId}", "missing")
        .replace("{operationId}", "missing")
        .replace("{uploadId}", "missing")
        .replace("{archiveId}", "missing")
        .replace("{planId}", "missing")
        .replace(
          "{applicationId}",
          "22222222-2222-2222-2222-222222222222",
        )
        .replace("{tenantId}", "missing")
        .replace("{bindingId}", "missing");
      const body = bodyFor(contract.operationId);
      const result = await route(contract.method, path, {
        headers,
        ...(body ? { body } : {}),
      });
      expect(
        (result.body as { code?: string }).code,
        contract.operationId,
      ).not.toBe("NOT_FOUND");
      expect(
        (result.body as { code?: string }).code,
        contract.operationId,
      ).not.toBe("METHOD_NOT_ALLOWED");
    }
  });

  it("enforces policy independently for reads and writes", async () => {
    const auditor: AuthenticatedActor = {
      id: "auditor",
      displayName: "Auditor",
      roles: ["auditor"],
      workspaceIds: ["workspace-demo"],
    };
    const { route } = configured(auditor);
    expect((await route("GET", "/v1/audit/events", { headers })).status).toBe(
      200,
    );
    expect(
      (
        await route("POST", "/v1/applications", {
          headers,
          body: {
            workspaceId: "workspace-demo",
            namespace: "test.app",
            name: "Test",
            applicationVersion: "1.0.0",
            schemaPackageIds: [],
            capabilities: [],
            idempotencyKey: "one",
          },
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("creates, reads, and updates retention policies without enabling purge", async () => {
    const { route } = configured();
    const created = await route("POST", "/v1/retention-policies", {
      headers,
      body: {
        workspaceId: "workspace-demo",
        name: "Default",
        recoveryWindowDays: 30,
        minimumHistoryDays: 365,
        backupRetentionDays: 90,
        purgeEnabled: false,
        idempotencyKey: "retention-create",
        futureField: "preserved",
      },
    });
    expect(created.status).toBe(200);
    const policy = created.body as {
      id: string;
      updatedAt: string;
      extensions: Record<string, unknown>;
    };
    expect(policy.extensions.futureField).toBe("preserved");
    expect(
      (
        await route("GET", `/v1/retention-policies/${policy.id}`, {
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await route("PUT", `/v1/retention-policies/${policy.id}`, {
          headers,
          body: {
            workspaceId: "workspace-demo",
            name: "Default",
            recoveryWindowDays: 60,
            minimumHistoryDays: 365,
            backupRetentionDays: 90,
            purgeEnabled: false,
            idempotencyKey: "retention-update",
            expectedUpdatedAt: policy.updatedAt,
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await route("POST", "/v1/retention-policies", {
          headers,
          body: {
            workspaceId: "workspace-demo",
            name: "Unsafe",
            recoveryWindowDays: 0,
            minimumHistoryDays: 0,
            backupRetentionDays: 0,
            purgeEnabled: true,
            idempotencyKey: "retention-purge",
          },
        })
      ).body,
    ).toMatchObject({ code: "INVALID_COMMAND" });
  });

  it("derives and filters dataset-scoped policy boundaries", async () => {
    const actor: AuthenticatedActor = {
      id: "scoped-editor",
      displayName: "Scoped editor",
      roles: [],
      workspaceIds: [],
    };
    const access = new StaticTokenAccessGateway(
      "valid",
      actor,
      {
        async listApplications() {
          return [];
        },
        async listPolicyAssignments() {
          return [
            {
              id: "assignment",
              workspaceId: "workspace-demo",
              principalType: "user",
              principalId: actor.id,
              role: "auditor",
              scopeKind: "dataset",
              scopeId: "ivan",
              createdBy: "admin",
              createdAt: now.toISOString(),
            },
          ];
        },
        async listActiveBreakGlassGrants() {
          return [];
        },
      },
      () => now,
    );
    const commands = createFixtureCommands(() => now);
    const route = createApi(
      { getSnapshot: async () => snapshot },
      schemas,
      () => now,
      "fixture",
      commands,
      access,
    );
    expect(
      (await route("GET", "/v1/resources/diary-main", { headers })).status,
    ).toBe(200);
    expect(
      (await route("GET", "/v1/resources", { headers })).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
    const scopedHeaders = { ...headers, "x-trust-dataset-id": "ivan" };
    expect(
      (await route("GET", "/v1/resources", { headers: scopedHeaders })).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(
      (await route("GET", "/v1/datasets", { headers: scopedHeaders })).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(
      (
        await route("GET", "/v1/verification/reports", {
          headers: scopedHeaders,
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(
      (
        await route("GET", "/v1/resources", {
          headers: { ...headers, "x-trust-dataset-id": "other" },
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("allows registered application reads but rejects arbitrary scoped IDs", async () => {
    const actor = {
      id: "diary.app",
      displayName: "Diary application",
      roles: [],
      workspaceIds: [],
      principalType: "application" as const,
    };
    const policies = {
      async listApplications() {
        return [
          {
            id: "application-a",
            workspaceId: "workspace-demo",
            namespace: actor.id,
            name: "Diary",
            applicationVersion: "1.0.0",
            schemaPackageIds: [],
            capabilities: [
              "dataset:read",
              "resource:read",
              "relation:read",
              "history:read",
              "verification:run",
              "object:ingest",
            ],
            status: "active" as const,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        ];
      },
      async listPolicyAssignments() {
        return [
          {
            id: "application-assignment",
            workspaceId: "workspace-demo",
            principalType: "application" as const,
            principalId: actor.id,
            role: "admin",
            scopeKind: "application" as const,
            scopeId: "application-a",
            createdBy: "admin",
            createdAt: now.toISOString(),
          },
        ];
      },
      async listActiveBreakGlassGrants() {
        return [];
      },
    };
    const commands = createFixtureCommands(() => now);
    const report = await commands.runVerification(admin, {
      workspaceId: "workspace-demo",
      level: "resource",
      scope: { kind: "resource", id: "diary-main" },
    });
    const route = createApi(
      { getSnapshot: async () => snapshot },
      schemas,
      () => now,
      "fixture",
      commands,
      new StaticTokenAccessGateway("valid", actor, policies, () => now),
    );

    for (const path of [
      "/v1/datasets/ivan",
      "/v1/resources/diary-main",
      `/v1/verification/reports/${report.id}`,
    ])
      expect(
        (
          await route("GET", path, {
            headers: {
              ...headers,
              "x-trust-application-id": "attacker-controlled",
            },
          })
        ).body,
        path,
      ).toMatchObject({ code: "PERMISSION_DENIED" });
    for (const scope of [
      { kind: "dataset", id: "ivan" },
      { kind: "resource", id: "diary-main" },
    ] as const)
      expect(
        (
          await route("POST", "/v1/verification/runs", {
            headers,
            body: {
              workspaceId: "workspace-demo",
              level: scope.kind,
              scope,
            },
          })
        ).body,
        scope.kind,
      ).toMatchObject({ code: "PERMISSION_DENIED" });
    for (const path of [
      "/v1/resources",
      "/v1/relations",
      "/v1/deleted-resources",
    ])
      expect(
        (
          await route("GET", path, {
            headers: {
              ...headers,
              "x-trust-application-id": "application-a",
            },
          })
        ).status,
        path,
      ).toBe(200);
    expect(
      (
        await route("GET", "/v1/resources", {
          headers: {
            ...headers,
            "x-trust-workspace-id": "workspace-demo-wesketch",
            "x-trust-application-id": "application-a",
          },
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(
      (
        await route("POST", "/v1/uploads", {
          headers,
          body: {
            workspaceId: "workspace-demo",
            idempotencyKey: "application-upload",
            mediaType: "text/plain",
            expectedByteLength: 1,
            expectedSha256: "a".repeat(64),
          },
        })
      ).status,
    ).toBe(200);

    const impostor = { ...actor, id: "unregistered.app" };
    const impostorRoute = createApi(
      { getSnapshot: async () => snapshot },
      schemas,
      () => now,
      "fixture",
      commands,
      new StaticTokenAccessGateway("valid", impostor, policies, () => now),
    );
    expect(
      (
        await impostorRoute("GET", "/v1/resources/diary-main", {
          headers: { ...headers, "x-trust-application-id": "application-a" },
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("validates and executes applicable Release 0.1 writes", async () => {
    const { route } = configured();
    const application = await route("POST", "/v1/applications", {
      headers,
      body: {
        workspaceId: "workspace-demo",
        namespace: "test.app",
        name: "Test",
        applicationVersion: "1.0.0",
        schemaPackageIds: [],
        capabilities: ["resource:read"],
        idempotencyKey: "one",
      },
    });
    expect(application.status).toBe(200);
    expect(application.body).toMatchObject({
      namespace: "test.app",
      capabilities: ["resource:read"],
    });
    const replay = await route("POST", "/v1/applications", {
      headers,
      body: {
        workspaceId: "workspace-demo",
        namespace: "test.app",
        name: "Test",
        applicationVersion: "1.0.0",
        schemaPackageIds: [],
        capabilities: ["resource:read"],
        idempotencyKey: "one",
      },
    });
    expect(replay.body).toEqual(application.body);
    const conflict = await route("POST", "/v1/applications", {
      headers,
      body: {
        workspaceId: "workspace-demo",
        namespace: "test.app",
        name: "Changed",
        applicationVersion: "2.0.0",
        schemaPackageIds: [],
        capabilities: ["resource:read"],
        idempotencyKey: "one",
      },
    });
    expect(conflict.body).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const invalid = await route("POST", "/v1/resources/diary-main/revisions", {
      headers,
      body: { workspaceId: "workspace-demo" },
    });
    expect(invalid.body).toMatchObject({ code: "INVALID_COMMAND" });
    const verification = await route("POST", "/v1/verification/runs", {
      headers,
      body: { workspaceId: "workspace-demo", level: "metadata" },
    });
    expect(verification.body).toMatchObject({
      status: "passed",
      level: "metadata",
    });
  });

  it("executes and persists strictly scoped structural verification runs", async () => {
    const { route } = configured();
    const commands = [
      { level: "resource", scope: { kind: "resource", id: "diary-main" } },
      { level: "dataset", scope: { kind: "dataset", id: "ivan" } },
      {
        level: "workspace",
        scope: { kind: "workspace", id: "workspace-demo" },
      },
    ] as const;
    for (const command of commands) {
      const result = await route("POST", "/v1/verification/runs", {
        headers,
        body: { workspaceId: "workspace-demo", ...command },
      });
      expect(result.status, command.level).toBe(200);
      expect(result.body).toMatchObject({
        level: command.level,
        scope: command.scope,
        status: "passed",
      });
      const reportId = (result.body as { id: string }).id;
      expect(
        (
          await route("GET", `/v1/verification/reports/${reportId}`, {
            headers,
          })
        ).body,
      ).toEqual(result.body);
    }
    for (const body of [
      { workspaceId: "workspace-demo", level: "resource" },
      {
        workspaceId: "workspace-demo",
        level: "resource",
        scope: { kind: "dataset", id: "ivan" },
      },
      {
        workspaceId: "workspace-demo",
        level: "dataset",
        scope: { kind: "dataset", id: "" },
      },
      {
        workspaceId: "workspace-demo",
        level: "workspace",
        scope: { kind: "workspace", id: "other" },
      },
      {
        workspaceId: "workspace-demo",
        level: "metadata",
        scope: { kind: "blob", id: "blob" },
      },
    ])
      expect(
        (await route("POST", "/v1/verification/runs", { headers, body })).body,
      ).toMatchObject({ code: "INVALID_COMMAND" });
  });

  it("provides bounded, expected-hash upload sessions with idempotent completion", async () => {
    const { route } = configured();
    const bytes = Buffer.from("bounded upload");
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    const created = await route("POST", "/v1/uploads", {
      headers,
      body: {
        workspaceId: "workspace-demo",
        idempotencyKey: "upload-1",
        mediaType: "text/plain",
        expectedByteLength: bytes.byteLength,
        expectedSha256,
        expiresInSeconds: 300,
      },
    });
    expect(created.body).toMatchObject({
      state: "requested",
      status: "pending",
      expectedSha256,
    });
    const uploadId = (created.body as { id: string }).id;
    const mismatch = await route("POST", `/v1/uploads/${uploadId}/complete`, {
      headers,
      body: {
        workspaceId: "workspace-demo",
        bytesBase64: Buffer.from("wrong").toString("base64"),
      },
    });
    expect(mismatch.body).toMatchObject({ code: "COMMAND_REJECTED" });
    const completed = await route("POST", `/v1/uploads/${uploadId}/complete`, {
      headers,
      body: {
        workspaceId: "workspace-demo",
        bytesBase64: bytes.toString("base64"),
      },
    });
    expect(completed.body).toMatchObject({
      state: "completed",
      status: "succeeded",
      completedAt: now.toISOString(),
    });
    expect(
      await route("POST", `/v1/uploads/${uploadId}/complete`, {
        headers,
        body: {
          workspaceId: "workspace-demo",
          bytesBase64: bytes.toString("base64"),
        },
      }),
    ).toEqual(completed);
    expect(
      (
        await route("POST", `/v1/uploads/${uploadId}/complete`, {
          headers,
          body: {
            workspaceId: "workspace-demo",
            bytesBase64: Buffer.from("wrong").toString("base64"),
          },
        })
      ).body,
    ).toMatchObject({ code: "COMMAND_REJECTED" });
    expect(
      (await route("GET", `/v1/uploads/${uploadId}`, { headers })).body,
    ).toEqual(completed.body);
  });

  it("isolates application upload ownership and idempotency without leaking existence", async () => {
    const commands = createFixtureCommands(() => now);
    const bytes = Buffer.from("application-owned");
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    const actors = ["application.a", "application.b"].map((id) => ({
      id,
      displayName: id,
      roles: [],
      workspaceIds: [],
      principalType: "application" as const,
    }));
    const policies = {
      async listApplications() {
        return actors.map((actor) => ({
          id: `registration-${actor.id}`,
          workspaceId: "workspace-demo",
          namespace: actor.id,
          name: actor.displayName,
          applicationVersion: "1.0.0",
          schemaPackageIds: [],
          capabilities: ["object:ingest"],
          status: "active" as const,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }));
      },
      async listPolicyAssignments() {
        return actors.map((actor) => ({
          id: `assignment-${actor.id}`,
          workspaceId: "workspace-demo",
          principalType: "application" as const,
          principalId: actor.id,
          role: "admin",
          scopeKind: "application" as const,
          scopeId: `registration-${actor.id}`,
          createdBy: "admin",
          createdAt: now.toISOString(),
        }));
      },
      async listActiveBreakGlassGrants() {
        return [];
      },
    };
    const applicationRoute = (actor: (typeof actors)[number]) =>
      createApi(
        { getSnapshot: async () => snapshot },
        schemas,
        () => now,
        "fixture",
        commands,
        new StaticTokenAccessGateway("valid", actor, policies, () => now),
      );
    const routeA = applicationRoute(actors[0]!);
    const routeB = applicationRoute(actors[1]!);
    const command = {
      workspaceId: "workspace-demo",
      idempotencyKey: "shared-upload-key",
      mediaType: "text/plain",
      expectedByteLength: bytes.byteLength,
      expectedSha256,
    };
    const createdA = await routeA("POST", "/v1/uploads", {
      headers,
      body: command,
    });
    const createdB = await routeB("POST", "/v1/uploads", {
      headers,
      body: command,
    });
    expect(createdA.status).toBe(200);
    expect(createdB.status).toBe(200);
    expect((createdB.body as { id: string }).id).not.toBe(
      (createdA.body as { id: string }).id,
    );
    expect(
      (
        await routeA("POST", "/v1/uploads", {
          headers,
          body: { ...command, mediaType: "application/octet-stream" },
        })
      ).body,
    ).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const uploadA = (createdA.body as { id: string }).id;
    for (const result of [
      await routeB("GET", `/v1/uploads/${uploadA}`, { headers }),
      await routeB("POST", `/v1/uploads/${uploadA}/complete`, {
        headers,
        body: {
          workspaceId: "workspace-demo",
          bytesBase64: bytes.toString("base64"),
        },
      }),
    ]) {
      expect(result.status).toBe(404);
      expect(result.body).toMatchObject({ code: "OPERATION_NOT_FOUND" });
    }

    const adminRoute = createApi(
      { getSnapshot: async () => snapshot },
      schemas,
      () => now,
      "fixture",
      commands,
      {
        authenticate: async () => admin,
        allows: roleAllows,
      },
    );
    expect(
      (await adminRoute("GET", `/v1/uploads/${uploadA}`, { headers })).status,
    ).toBe(200);
  });

  it("authorizes upload scan-status without leaking existence", async () => {
    const commands = createFixtureCommands(() => now);
    const permittedActor = {
      id: "application.permitted",
      displayName: "Permitted",
      roles: [],
      workspaceIds: [],
      principalType: "application" as const,
    };
    const otherActor = {
      id: "application.other",
      displayName: "Other",
      roles: [],
      workspaceIds: [],
      principalType: "application" as const,
    };
    const registrations = [
      {
        id: "registration-permitted",
        workspaceId: "workspace-demo",
        namespace: permittedActor.id,
        name: "Permitted",
        applicationVersion: "1.0.0",
        schemaPackageIds: [] as string[],
        capabilities: ["object:ingest"],
        status: "active" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: "registration-other",
        workspaceId: "workspace-demo",
        namespace: otherActor.id,
        name: "Other",
        applicationVersion: "1.0.0",
        schemaPackageIds: [] as string[],
        capabilities: ["object:ingest"],
        status: "active" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: "registration-unassigned",
        workspaceId: "workspace-demo",
        namespace: "application.unassigned",
        name: "Unassigned",
        applicationVersion: "1.0.0",
        schemaPackageIds: [] as string[],
        capabilities: ["object:ingest"],
        status: "active" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: "registration-nocap",
        workspaceId: "workspace-demo",
        namespace: "application.nocap",
        name: "NoCap",
        applicationVersion: "1.0.0",
        schemaPackageIds: [] as string[],
        capabilities: ["dataset:read"],
        status: "active" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: "registration-suspended",
        workspaceId: "workspace-demo",
        namespace: "application.suspended",
        name: "Suspended",
        applicationVersion: "1.0.0",
        schemaPackageIds: [] as string[],
        capabilities: ["object:ingest"],
        status: "suspended" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: "registration-revoked-assignment",
        workspaceId: "workspace-demo",
        namespace: "application.revoked-assignment",
        name: "RevokedAssignment",
        applicationVersion: "1.0.0",
        schemaPackageIds: [] as string[],
        capabilities: ["object:ingest"],
        status: "active" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];
    const assignments = [
      {
        id: "assignment-permitted",
        workspaceId: "workspace-demo",
        principalType: "application" as const,
        principalId: permittedActor.id,
        role: "admin",
        scopeKind: "application" as const,
        scopeId: "registration-permitted",
        createdBy: "admin",
        createdAt: now.toISOString(),
      },
      {
        id: "assignment-other",
        workspaceId: "workspace-demo",
        principalType: "application" as const,
        principalId: otherActor.id,
        role: "admin",
        scopeKind: "application" as const,
        scopeId: "registration-other",
        createdBy: "admin",
        createdAt: now.toISOString(),
      },
      {
        id: "assignment-nocap",
        workspaceId: "workspace-demo",
        principalType: "application" as const,
        principalId: "application.nocap",
        role: "admin",
        scopeKind: "application" as const,
        scopeId: "registration-nocap",
        createdBy: "admin",
        createdAt: now.toISOString(),
      },
      {
        id: "assignment-revoked-only",
        workspaceId: "workspace-demo",
        principalType: "application" as const,
        principalId: "application.revoked-assignment",
        role: "admin",
        scopeKind: "application" as const,
        scopeId: "registration-permitted",
        createdBy: "admin",
        createdAt: now.toISOString(),
        revokedAt: now.toISOString(),
      },
    ];
    const policiesFor = (actorId: string) => ({
      async listApplications() {
        return registrations;
      },
      async listPolicyAssignments() {
        return assignments.filter(
          (assignment) => assignment.principalId === actorId,
        );
      },
      async listActiveBreakGlassGrants() {
        return [];
      },
    });
    const routeFor = (actor: AuthenticatedActor) =>
      createApi(
        { getSnapshot: async () => snapshot },
        schemas,
        () => now,
        "fixture",
        commands,
        new StaticTokenAccessGateway(
          "valid",
          actor,
          policiesFor(actor.id),
          () => now,
        ),
      );
    const permitted = routeFor(permittedActor);
    const other = routeFor(otherActor);
    const created = await permitted("POST", "/v1/uploads", {
      headers,
      body: {
        workspaceId: "workspace-demo",
        idempotencyKey: "scan-status-upload",
        mediaType: "text/plain",
        expectedByteLength: 1,
        expectedSha256: "b".repeat(64),
      },
    });
    expect(created.status).toBe(200);
    const uploadId = (created.body as { id: string }).id;
    await commands.seedUploadScan({
      scanJobId: "scan-fixture-1",
      workspaceId: "workspace-demo",
      uploadId,
      storageKey: "workspaces/workspace-demo/temporary/secret-key",
      state: "scanning",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const allowed = await permitted(
      "GET",
      `/v1/uploads/${uploadId}/scan-status`,
      { headers },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({
      uploadId,
      workspaceId: "workspace-demo",
      state: "scanning",
      updatedAt: now.toISOString(),
    });
    expect(allowed.body).not.toHaveProperty("scanJobId");
    expect(allowed.body).not.toHaveProperty("storageKey");
    expect(JSON.stringify(allowed.body)).not.toContain("secret-key");

    const unassigned = routeFor({
      id: "application.unassigned",
      displayName: "Unassigned",
      roles: [],
      workspaceIds: [],
      principalType: "application",
    });
    expect(
      (
        await unassigned("GET", `/v1/uploads/${uploadId}/scan-status`, {
          headers,
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });

    const noCapability = routeFor({
      id: "application.nocap",
      displayName: "NoCap",
      roles: [],
      workspaceIds: [],
      principalType: "application",
    });
    expect(
      (
        await noCapability("GET", `/v1/uploads/${uploadId}/scan-status`, {
          headers,
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });

    const suspended = routeFor({
      id: "application.suspended",
      displayName: "Suspended",
      roles: [],
      workspaceIds: [],
      principalType: "application",
    });
    expect(
      (
        await suspended("GET", `/v1/uploads/${uploadId}/scan-status`, {
          headers,
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });

    const revokedAssignment = routeFor({
      id: "application.revoked-assignment",
      displayName: "RevokedAssignment",
      roles: [],
      workspaceIds: [],
      principalType: "application",
    });
    expect(
      (
        await revokedAssignment(
          "GET",
          `/v1/uploads/${uploadId}/scan-status`,
          { headers },
        )
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });

    for (const result of [
      await other("GET", `/v1/uploads/${uploadId}/scan-status`, { headers }),
      await permitted("GET", "/v1/uploads/missing-upload/scan-status", {
        headers,
      }),
    ]) {
      expect(result.status).toBe(404);
      expect(result.body).toMatchObject({ code: "OPERATION_NOT_FOUND" });
    }

    expect(
      (
        await permitted("GET", `/v1/uploads/${uploadId}/scan-status`, {
          headers: { ...headers, "x-trust-workspace-id": "workspace-other" },
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("supports direct immutable ingest and protected sessions", async () => {
    const base = createFixtureCommands(() => now);
    const commands = {
      ...base,
      ingestObject: async (
        _actor: AuthenticatedActor,
        command: { workspaceId: string },
      ) => ({
        operationId: "operation",
        blob: {
          id: "blob",
          workspaceId: command.workspaceId,
          sha256: "a".repeat(64),
          byteLength: 4,
          mediaType: "text/plain",
          storageProvider: "test",
          storageKey: "object",
          encryptionState: "provider_managed" as const,
          encryptionKeyRef: null,
          verificationState: "verified" as const,
          createdAt: now.toISOString(),
        },
        deduplicated: false,
        resumed: false,
      }),
    };
    const access = {
      authenticate: async () => admin,
      authenticateSession: async (
        id: string,
        csrf: string | undefined,
        mutation: boolean,
      ) =>
        id === "session" && (!mutation || csrf === "csrf") ? admin : undefined,
      allows: roleAllows,
    };
    const route = createApi(
      { getSnapshot: async () => snapshot },
      schemas,
      () => now,
      "live",
      commands,
      access,
    );
    expect(
      (
        await route("POST", "/v1/objects/ingest", {
          headers,
          body: {
            workspaceId: "workspace-demo",
            idempotencyKey: "ingest",
            mediaType: "text/plain",
            bytesBase64: "dGVzdA==",
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await route("GET", "/v1/history", {
          headers: {
            cookie: "trust_session=session",
            "x-trust-workspace-id": "workspace-demo",
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await route("POST", "/v1/verification/runs", {
          headers: {
            cookie: "trust_session=session",
            "x-trust-workspace-id": "workspace-demo",
          },
          body: { workspaceId: "workspace-demo", level: "metadata" },
        })
      ).status,
    ).toBe(401);
  });

  it("audits active break-glass use and returns stable route errors", async () => {
    const actor: AuthenticatedActor = {
      id: "recovery",
      displayName: "Recovery",
      roles: [],
      workspaceIds: ["workspace-demo"],
    };
    const audits: unknown[] = [];
    const access = new StaticTokenAccessGateway(
      "valid",
      actor,
      {
        async listApplications() {
          return [];
        },
        async listPolicyAssignments() {
          return [];
        },
        async listActiveBreakGlassGrants() {
          return [
            {
              id: "grant",
              workspaceId: "workspace-demo",
              principalId: "recovery",
              reason: "Urgent recovery",
              actions: ["resource:restore"],
              grantedBy: "owner",
              grantedAt: "2026-08-04T11:00:00.000Z",
              expiresAt: "2026-08-04T13:00:00.000Z",
            },
          ];
        },
        async recordBreakGlassUse(input) {
          audits.push(input);
        },
      },
      () => now,
    );
    expect(
      await access.allows(actor, "resource:restore", {
        workspaceId: "workspace-demo",
        requestId: "request-1",
      }),
    ).toBe(true);
    expect(audits).toEqual([
      expect.objectContaining({
        grantId: "grant",
        action: "resource:restore",
        requestId: "request-1",
      }),
    ]);
    const { route } = configured();
    expect(await route("GET", "/missing", { headers })).toEqual({
      status: 404,
      body: {
        code: "NOT_FOUND",
        message: "The requested route was not found.",
        requestId: "request-1",
      },
    });
    expect((await route("POST", "/health", { headers })).body).toMatchObject({
      code: "METHOD_NOT_ALLOWED",
    });
  });

  it("verifies, plans and executes an idempotent fixture archive import", async () => {
    const { route } = configured();
    const archiveBase64 = await fixtureArchiveBase64();
    const uploadBody = {
      workspaceId: "workspace-demo",
      idempotencyKey: "archive-one",
      archiveBase64,
    };
    const uploaded = await route("POST", "/v1/portability/archives", {
      headers,
      body: uploadBody,
    });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({ status: "verified", issueCount: 0 });
    const archiveId = (uploaded.body as { id: string }).id;
    expect(
      await route("POST", "/v1/portability/archives", {
        headers,
        body: uploadBody,
      }),
    ).toEqual(uploaded);
    const conflict = await route("POST", "/v1/portability/archives", {
      headers,
      body: { ...uploadBody, archiveBase64: "YQ==" },
    });
    expect(conflict.body).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const planned = await route("POST", "/v1/portability/plans", {
      headers,
      body: {
        workspaceId: "workspace-demo",
        archiveId,
        idempotencyKey: "plan-one",
        mode: "mapped_workspace",
        conflictMode: "reject_on_error",
      },
    });
    expect(planned.body).toMatchObject({ status: "ready", issueCount: 0 });
    const planId = (planned.body as { id: string }).id;
    expect(
      (
        await route("POST", `/v1/portability/plans/${planId}/execute`, {
          headers,
          body: {
            workspaceId: "workspace-demo",
            idempotencyKey: "execute-without-reauth",
            confirmation: "IMPORT",
          },
        })
      ).body,
    ).toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    const executed = await route(
      "POST",
      `/v1/portability/plans/${planId}/execute`,
      {
        headers: { ...headers, "x-trust-reauth": "valid" },
        body: {
          workspaceId: "workspace-demo",
          idempotencyKey: "execute-one",
          confirmation: "IMPORT",
        },
      },
    );
    expect(executed.body).toMatchObject({
      planId,
      checkpoint: "completed",
      status: "completed",
    });
    const operationId = (executed.body as { id: string }).id;
    expect(
      (
        await route("GET", `/v1/portability/operations/${operationId}`, {
          headers,
        })
      ).body,
    ).toMatchObject({ id: operationId, checkpoint: "completed" });
  });

  it("exports and downloads a verified fixture archive behind reauthentication", async () => {
    const actor: AuthenticatedActor = {
      ...admin,
      workspaceIds: ["workspace-demo-ivan"],
    };
    const { route } = configured(actor);
    const exportHeaders = {
      ...headers,
      "x-trust-workspace-id": "workspace-demo-ivan",
    };
    const command = {
      workspaceId: "workspace-demo-ivan",
      datasetIds: ["dataset-demo-ivan-001"],
      idempotencyKey: "export-one",
    };
    expect(
      (
        await route("POST", "/v1/portability/exports", {
          headers: exportHeaders,
          body: command,
        })
      ).body,
    ).toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    const created = await route("POST", "/v1/portability/exports", {
      headers: { ...exportHeaders, "x-trust-reauth": "valid" },
      body: command,
    });
    expect(created.body).toMatchObject({
      workspaceId: "workspace-demo-ivan",
      datasetIds: ["dataset-demo-ivan-001"],
      status: "ready",
    });
    const exportId = (created.body as { id: string }).id;
    const downloaded = await route(
      "GET",
      `/v1/portability/exports/${exportId}/download`,
      { headers: { ...exportHeaders, "x-trust-reauth": "valid" } },
    );
    expect(downloaded.body).toMatchObject({
      id: exportId,
      mediaType: "application/vnd.trust-core.archive+zip",
      filename: `${exportId}.trustarchive`,
    });
    const bytes = Buffer.from(
      (downloaded.body as { archiveBase64: string }).archiveBase64,
      "base64",
    );
    const parsed = await readTrustArchive(bytes);
    expect(parsed.verification.valid).toBe(true);
    expect(parsed.manifest.datasetIds).toEqual(["dataset-demo-ivan-001"]);
    const binary = await route(
      "GET",
      `/v1/portability/exports/${exportId}/download`,
      {
        headers: {
          ...exportHeaders,
          accept: "application/vnd.trust-core.archive+zip",
          "x-trust-reauth": "valid",
        },
      },
    );
    expect(binary.headers).toMatchObject({
      "content-type": "application/vnd.trust-core.archive+zip",
      "content-disposition": `attachment; filename="${exportId}.trustarchive"`,
    });
    expect(binary.body).toBeInstanceOf(Uint8Array);
    expect(
      (await readTrustArchive(binary.body as Uint8Array)).verification.valid,
    ).toBe(true);

    const weSketchActor: AuthenticatedActor = {
      ...admin,
      workspaceIds: ["workspace-demo-wesketch"],
    };
    const weSketchRoute = configured(weSketchActor).route;
    const weSketchHeaders = {
      ...headers,
      "x-trust-workspace-id": "workspace-demo-wesketch",
      "x-trust-reauth": "valid",
    };
    const weSketchExport = await weSketchRoute(
      "POST",
      "/v1/portability/exports",
      {
        headers: weSketchHeaders,
        body: {
          workspaceId: "workspace-demo-wesketch",
          datasetIds: ["dataset-demo-wesketch-001"],
          idempotencyKey: "export-wesketch",
        },
      },
    );
    const weSketchExportId = (weSketchExport.body as { id: string }).id;
    const weSketchDownload = await weSketchRoute(
      "GET",
      `/v1/portability/exports/${weSketchExportId}/download`,
      { headers: weSketchHeaders },
    );
    const weSketchParsed = await readTrustArchive(
      Buffer.from(
        (weSketchDownload.body as { archiveBase64: string }).archiveBase64,
        "base64",
      ),
    );
    expect(weSketchParsed.verification.valid).toBe(true);
    expect(weSketchParsed.manifest.blobCount).toBeGreaterThan(0);
  });

  it("denies portability mutation to read-only roles", async () => {
    const { route } = configured({
      id: "auditor",
      displayName: "Auditor",
      roles: ["auditor"],
      workspaceIds: ["workspace-demo"],
    });
    const result = await route("POST", "/v1/portability/archives", {
      headers,
      body: {
        workspaceId: "workspace-demo",
        idempotencyKey: "denied",
        archiveBase64: await fixtureArchiveBase64(),
      },
    });
    expect(result.body).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("keeps representative live route responses conformant with OpenAPI schemas", async () => {
    const { route } = configured();
    const health = await route("GET", "/health");
    const resources = await route("GET", "/v1/resources", { headers });
    const error = await route("GET", "/v1/resources/missing", { headers });
    expect(conforms(health.body, release01Schemas.HealthResponse)).toBe(true);
    expect(conforms(resources.body, release01Schemas.ResourceList)).toBe(true);
    expect(conforms(error.body, release01Schemas.ApiError)).toBe(true);
  });

  it("lists Foundation tenants and refuses auditor storage:manage", async () => {
    const { route } = configured();
    const listed = await route(
      "GET",
      "/v1/applications/22222222-2222-2222-2222-222222222222/tenants",
      { headers },
    );
    expect(listed.status).toBe(200);
    expect(
      (listed.body as { items: unknown[] }).items.length,
    ).toBeGreaterThanOrEqual(3);
    const rollup = await route("GET", "/v1/storage/bindings/rollup", {
      headers,
    });
    expect(rollup.status).toBe(200);
    expect(
      (rollup.body as { attentionTotal: number }).attentionTotal,
    ).toBeGreaterThan(0);
    const auditor: AuthenticatedActor = {
      id: "auditor",
      displayName: "Auditor",
      roles: ["auditor"],
      workspaceIds: ["workspace-demo"],
    };
    const denied = configured(auditor).route;
    expect(
      (
        await denied("POST", "/v1/storage/bindings", {
          headers,
          body: {
            workspaceId: "workspace-demo",
            applicationId: "22222222-2222-2222-2222-222222222222",
            provider: "s3",
            region: "ap-southeast-2",
            bucket: "x",
            tier: "managed",
            credentialMode: "platform_iam",
            idempotencyKey: "denied",
          },
        })
      ).body,
    ).toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

async function fixtureArchiveBase64(): Promise<string> {
  const logical = assembleArchiveEntries({
    exportId: "export-api-candidate",
    workspaceId: "source-workspace",
    datasetIds: [],
    createdAt: now.toISOString(),
    createdBy: "fixture-exporter",
    sourceVersion: "0.2F-test",
    records: {
      workspaces: [
        {
          id: "source-workspace",
          name: "Source",
          slug: "source",
          status: "active",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
    },
  });
  return Buffer.from(await writeTrustArchive(logical)).toString("base64");
}

function bodyFor(
  operationId: (typeof release01Routes)[number]["operationId"],
): Record<string, unknown> | undefined {
  switch (operationId) {
    case "applications.register":
      return {
        workspaceId: "workspace-demo",
        namespace: "contract.app",
        name: "Contract",
        applicationVersion: "1.0.0",
        schemaPackageIds: [],
        capabilities: [],
        idempotencyKey: "contract",
      };
    case "policyAssignments.create":
      return {
        workspaceId: "workspace-demo",
        principalType: "user",
        principalId: "reviewer",
        role: "auditor",
        scopeKind: "workspace",
        scopeId: "workspace-demo",
        idempotencyKey: "contract-policy",
      };
    case "policyAssignments.revoke":
      return {
        workspaceId: "workspace-demo",
        idempotencyKey: "contract-policy-revoke",
      };
    case "revisions.create":
      return {
        workspaceId: "workspace-demo",
        expectedRevisionId: null,
        schemaPackageId: "schema-demo",
        schemaVersion: "1.0.0",
        canonicalPayload: {},
      };
    case "resources.delete":
      return {
        workspaceId: "workspace-demo",
        expectedRevisionId: null,
        recoverUntil: null,
      };
    case "resources.restore":
      return { workspaceId: "workspace-demo" };
    case "retentionPolicies.create":
      return {
        workspaceId: "workspace-demo",
        name: "Contract retention",
        recoveryWindowDays: 30,
        minimumHistoryDays: 365,
        backupRetentionDays: 90,
        purgeEnabled: false,
        idempotencyKey: "contract-retention",
      };
    case "retentionPolicies.update":
      return {
        workspaceId: "workspace-demo",
        name: "Contract retention",
        recoveryWindowDays: 60,
        minimumHistoryDays: 365,
        backupRetentionDays: 90,
        purgeEnabled: false,
        idempotencyKey: "contract-retention-update",
        expectedUpdatedAt: now.toISOString(),
      };
    case "uploads.create":
      return {
        workspaceId: "workspace-demo",
        idempotencyKey: "contract-upload",
        mediaType: "text/plain",
        expectedByteLength: 1,
        expectedSha256: "a".repeat(64),
      };
    case "uploads.complete":
      return { workspaceId: "workspace-demo", bytesBase64: "YQ==" };
    case "blobs.createDownloadGrant":
      return {
        workspaceId: "workspace-demo",
        objectId: "fixture-blob",
        requestedTtlSeconds: 60,
        idempotencyKey: "contract-download-grant",
      };
    case "objects.ingest":
      return {
        workspaceId: "workspace-demo",
        idempotencyKey: "contract-ingest",
        mediaType: "text/plain",
        bytesBase64: "YQ==",
      };
    case "verification.run":
      return { workspaceId: "workspace-demo", level: "metadata" };
    case "portability.archives.create":
      return {
        workspaceId: "workspace-demo",
        idempotencyKey: "contract-archive",
        archiveBase64: "YQ==",
      };
    case "portability.exports.create":
      return {
        workspaceId: "workspace-demo",
        datasetIds: ["ivan"],
        idempotencyKey: "contract-export",
      };
    case "portability.plans.create":
      return {
        workspaceId: "workspace-demo",
        archiveId: "missing",
        idempotencyKey: "contract-plan",
        mode: "mapped_workspace",
        conflictMode: "reject_on_error",
      };
    case "portability.plans.execute":
      return {
        workspaceId: "workspace-demo",
        idempotencyKey: "contract-execute",
        confirmation: "IMPORT",
      };
    case "health.get":
    case "auth.oidcStart":
    case "auth.oidcCallback":
    case "auth.sessionCreate":
    case "auth.sessionDelete":
    case "workspaces.list":
    case "applications.list":
    case "policyAssignments.list":
    case "schemas.list":
    case "schemas.get":
    case "datasets.list":
    case "datasets.get":
    case "retentionPolicies.list":
    case "retentionPolicies.get":
    case "resources.list":
    case "resources.get":
    case "revisions.graph":
    case "deletedResources.list":
    case "relations.list":
    case "uploads.get":
    case "uploads.scanStatus":
    case "history.list":
    case "audit.list":
    case "verification.list":
    case "verification.get":
    case "operations.get":
    case "storage.health":
    case "backup.health":
    case "control.snapshot":
    case "portability.archives.get":
    case "portability.plans.get":
    case "portability.operations.get":
    case "portability.exports.download":
      return undefined;
    case "storage.probe":
      return {
        workspaceId: "workspace-demo",
        tier: "connectivity",
      };
    case "applicationTenants.create":
      return {
        workspaceId: "workspace-demo",
        externalTenantKey: "contract-tenant",
        displayName: "Contract Tenant",
        idempotencyKey: "contract-tenant",
      };
    case "applicationTenants.update":
      return {
        workspaceId: "workspace-demo",
        displayName: "Contract Tenant renamed",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "contract-tenant-update",
      };
    case "applicationTenants.suspend":
    case "applicationTenants.close":
      return {
        workspaceId: "workspace-demo",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "contract-tenant-status",
      };
    case "storageBindings.upsert":
      return {
        workspaceId: "workspace-demo",
        applicationId: "22222222-2222-2222-2222-222222222222",
        provider: "s3",
        region: "ap-southeast-2",
        bucket: "contract-binding",
        tier: "managed",
        credentialMode: "platform_iam",
        idempotencyKey: "contract-binding",
      };
    case "storageBindings.probe":
    case "storageBindings.planRefresh":
      return { workspaceId: "workspace-demo" };
    case "storageBindings.planAccept":
      return {
        workspaceId: "workspace-demo",
        declaredCapacityBytes: 1024,
      };
    case "storageBindings.migrateCutover":
      return {
        workspaceId: "workspace-demo",
        sourceBindingId: "11111111-1111-1111-1111-111111111111",
        targetBindingId: "22222222-2222-2222-2222-222222222222",
        objectDigests: [],
        idempotencyKey: "contract-cutover",
      };
    case "storageBindings.disable":
    case "storageBindings.rollback":
      return { workspaceId: "workspace-demo" };
    case "applicationTenants.list":
    case "applicationTenants.get":
    case "applicationStorage.effective":
    case "applicationTenantStorage.effective":
    case "storageBindings.rollup":
    case "storageBindings.list":
    case "storageBindings.get":
    case "storageBindings.delete":
      return undefined;
    default:
      return assertNever(operationId);
  }
}
function assertNever(value: never): never {
  throw new Error(`Unhandled route operation: ${String(value)}`);
}
function conforms(
  value: unknown,
  schema: Readonly<Record<string, unknown>>,
): boolean {
  if ("$ref" in schema) {
    const name = String(schema.$ref)
        .split("/")
        .at(-1) as keyof typeof release01Schemas,
      target = release01Schemas[name];
    return target !== undefined && conforms(value, target);
  }
  if ("anyOf" in schema)
    return (schema.anyOf as readonly Readonly<Record<string, unknown>>[]).some(
      (option) => conforms(value, option),
    );
  if ("const" in schema && value !== schema.const) return false;
  if ("enum" in schema && !(schema.enum as readonly unknown[]).includes(value))
    return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "integer") return Number.isInteger(value);
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.every((item) =>
        conforms(item, schema.items as Readonly<Record<string, unknown>>),
      )
    );
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return false;
    const record = value as Record<string, unknown>,
      required = (schema.required ?? []) as readonly string[],
      properties = (schema.properties ?? {}) as Readonly<
        Record<string, Readonly<Record<string, unknown>>>
      >;
    return (
      required.every((key) => key in record) &&
      Object.entries(properties).every(
        ([key, property]) =>
          !(key in record) || conforms(record[key], property),
      )
    );
  }
  return true;
}
