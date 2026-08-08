import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("live Control Centre gateway", () => {
  it("uses the configured workspace for SDK reads and commands", async () => {
    vi.stubEnv("VITE_TRUST_API_BASE", "https://trust.example");
    vi.stubEnv("VITE_TRUST_WORKSPACE_ID", "workspace-live");
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/control-centre/snapshot") {
        return json({ status: {}, datasets: [] });
      }
      if (path === "/v1/health/storage" || path === "/v1/health/backup") {
        return json({
          status: "healthy",
          checkedAt: "2026-08-04T00:00:00.000Z",
          summary: "Healthy",
          details: {},
        });
      }
      if (path === "/v1/verification/reports") return json({ items: [] });
      if (path === "/v1/history") return json({ recoverable: [], events: [] });
      if (path === "/v1/verification/runs") {
        return json({
          id: "verification",
          workspaceId: "workspace-live",
          level: "metadata",
          scope: { kind: "workspace", id: "workspace-live" },
          status: "passed",
          startedAt: "2026-08-04T00:00:00.000Z",
          completedAt: "2026-08-04T00:00:00.000Z",
          objectsChecked: 0,
          bytesRead: 0,
          issues: [],
        });
      }
      if (path === "/v1/resources/resource-1/restore") {
        return json({
          resourceId: "resource-1",
          revisionId: "revision-2",
          revisionNumber: 2,
          source: "restore",
          createdAt: "2026-08-04T00:00:00.000Z",
        });
      }
      if (
        path === "/v1/applications" &&
        (!init || !init.method || init.method === "GET")
      ) {
        return json({
          items: [
            {
              id: "app-1",
              workspaceId: "workspace-live",
              namespace: "app/live",
              name: "Live App",
              applicationVersion: "1.0.0",
              schemaPackageIds: [],
              capabilities: ["dataset:read"],
              status: "active",
              createdAt: "2026-08-04T00:00:00.000Z",
              updatedAt: "2026-08-04T00:00:00.000Z",
            },
          ],
        });
      }
      if (path === "/v1/applications" && init?.method === "POST") {
        return json({
          id: "app-2",
          workspaceId: "workspace-live",
          namespace: "app/new",
          name: "New App",
          applicationVersion: "0.1.0",
          schemaPackageIds: [],
          capabilities: ["dataset:read"],
          status: "active",
          createdAt: "2026-08-04T00:00:00.000Z",
          updatedAt: "2026-08-04T00:00:00.000Z",
        });
      }
      return new Response(undefined, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    const { httpGateway } = await import("../src/http-gateway");
    await Promise.all([
      httpGateway.getSnapshot(),
      httpGateway.getOperationalSnapshot(),
      httpGateway.getHistory(httpGateway.workspaceId),
      httpGateway.runVerification(httpGateway.workspaceId, "metadata"),
      httpGateway.restoreResource(httpGateway.workspaceId, "resource-1"),
    ]);
    const listed = await httpGateway.listApplications(httpGateway.workspaceId);
    const registered = await httpGateway.registerApplication(
      httpGateway.workspaceId,
      {
        namespace: "app/new",
        name: "New App",
        applicationVersion: "0.1.0",
        schemaPackageIds: [],
        capabilities: ["dataset:read"],
      },
    );

    expect(httpGateway.workspaceId).toBe("workspace-live");
    expect(listed).toHaveLength(1);
    expect(registered.id).toBe("app-2");
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get("x-trust-workspace-id")).toBe(
        "workspace-live",
      );
    }
    const commandBodies = fetch.mock.calls
      .map(([, init]) => init?.body)
      .filter((body): body is string => typeof body === "string")
      .map((body) => JSON.parse(body) as { workspaceId?: string });
    expect(commandBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workspaceId: "workspace-live" }),
        expect.objectContaining({
          workspaceId: "workspace-live",
          namespace: "app/new",
        }),
      ]),
    );
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
