import { describe, expect, it } from "vitest";
import { fixtureGateway } from "../src/fixture-gateway";

describe("fixture gateway applications", () => {
  it("lists seeded applications for the workspace", async () => {
    const apps = await fixtureGateway.listApplications("workspace-demo");
    expect(apps.some((app) => app.namespace === "app/wesketch")).toBe(true);
  });

  it("registers a new application and returns it on list", async () => {
    const registered = await fixtureGateway.registerApplication(
      "workspace-demo",
      {
        namespace: "app/fixture-connections",
        name: "Fixture Connections App",
        applicationVersion: "0.1.0",
        schemaPackageIds: [],
        capabilities: ["dataset:read", "history:read"],
      },
    );
    expect(registered.id).toMatch(/^fixture-app-/);
    expect(registered.workspaceId).toBe("workspace-demo");
    expect(registered.status).toBe("active");

    const apps = await fixtureGateway.listApplications("workspace-demo");
    expect(
      apps.find((app) => app.namespace === "app/fixture-connections"),
    ).toMatchObject({
      name: "Fixture Connections App",
      capabilities: ["dataset:read", "history:read"],
    });
  });

  it("returns the existing registration for a repeated namespace", async () => {
    const first = await fixtureGateway.registerApplication("workspace-demo", {
      namespace: "app/idempotent-demo",
      name: "Idempotent Demo",
      applicationVersion: "1.0.0",
      schemaPackageIds: [],
      capabilities: ["dataset:read"],
    });
    const second = await fixtureGateway.registerApplication("workspace-demo", {
      namespace: "app/idempotent-demo",
      name: "Idempotent Demo Renamed",
      applicationVersion: "2.0.0",
      schemaPackageIds: [],
      capabilities: ["dataset:read", "blob:read"],
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe(first.name);
  });
});
