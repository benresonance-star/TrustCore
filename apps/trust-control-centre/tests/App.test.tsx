// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { fixtureGateway } from "../src/fixture-gateway";

afterEach(cleanup);

describe("Trust Core Control Centre", () => {
  it("opens on the project and component home", async () => {
    render(<App gateway={fixtureGateway} />);
    expect(
      await screen.findByRole("heading", { name: "Workspace overview" }),
    ).toBeVisible();
    expect(screen.getByText("Common components")).toBeVisible();
    expect(screen.getByText("WeSketch — Courtyard Study")).toBeVisible();
  });

  it("switches between registry and system flow sections", async () => {
    render(<App gateway={fixtureGateway} />);
    await screen.findByRole("heading", { name: "Workspace overview" });
    fireEvent.click(screen.getByRole("button", { name: "Datasets" }));
    expect(
      screen.getByRole("heading", { name: "Dataset registry" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Flow" }));
    expect(screen.getByRole("heading", { name: "System flow" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Trust API/ })).toBeVisible();
  });

  it("opens a project directly in its dataset detail", async () => {
    render(<App gateway={fixtureGateway} />);
    await screen.findByText("WeSketch — Courtyard Study");
    const moorabbinCard = screen
      .getByRole("heading", { name: "Moorabbin Apartments" })
      .closest("article");
    expect(moorabbinCard).not.toBeNull();
    fireEvent.click(
      within(moorabbinCard!).getByRole("button", { name: "Open" }),
    );
    expect(
      screen.getByRole("heading", { name: "Dataset registry" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "2417 — Moorabbin Apartments" }),
    ).toBeVisible();
  });

  it("restores a deleted item as a new revision from History", async () => {
    render(<App gateway={fixtureGateway} />);
    await screen.findByRole("heading", { name: "Workspace overview" });
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(
      await screen.findByRole("heading", { name: "Recovery bin" }),
    ).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]!);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Restored safely as revision 18",
    );
  });

  it("runs a full-byte verification from System health", async () => {
    render(<App gateway={fixtureGateway} />);
    await screen.findByRole("heading", { name: "Workspace overview" });
    fireEvent.click(screen.getByRole("button", { name: "Health" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Run full verification" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("PASSED");
    expect(screen.getByRole("status")).toHaveTextContent("3,284 objects");
  });

  it("uses the configured gateway workspace for live actions", async () => {
    const runVerification = vi.fn(fixtureGateway.runVerification);
    const getHistory = vi.fn(fixtureGateway.getHistory);
    const gateway = {
      ...fixtureGateway,
      mode: "live" as const,
      workspaceId: "workspace-wesketch",
      runVerification,
      getHistory,
    };
    render(<App gateway={gateway} />);
    await screen.findByRole("heading", { name: "Workspace overview" });
    expect(screen.getByText("workspace-wesketch")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Health" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Run full verification" }),
    );
    await screen.findByRole("status");
    expect(runVerification).toHaveBeenCalledWith(
      "workspace-wesketch",
      "full_blob",
    );
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByRole("heading", { name: "Recovery bin" });
    expect(getHistory).toHaveBeenCalledWith("workspace-wesketch");
  });

  it("previews scoped access assignments without claiming persistence", async () => {
    render(<App gateway={fixtureGateway} />);
    await screen.findByRole("heading", { name: "Workspace overview" });
    fireEvent.click(screen.getByRole("button", { name: "Access" }));
    expect(screen.getByText("Ben Resonance")).toBeVisible();
    expect(screen.getByText("Organisation identity")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Assign access" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add preview assignment" }),
    );
    expect(screen.getByText("Audit reviewer")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No access policy was changed",
    );
  });

  it("verifies a fixture archive and creates a non-mutating import plan", async () => {
    render(<App gateway={fixtureGateway} />);
    await screen.findByRole("heading", { name: "Workspace overview" });
    fireEvent.click(screen.getByRole("button", { name: "Portability" }));
    fireEvent.click(screen.getByRole("button", { name: "Verify archive" }));
    expect(await screen.findByText("18 entries")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate dry-run plan" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Plan ready" }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Reauthentication proof"), {
      target: { value: "trust-core-fixture-admin" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and execute" }),
    );
    expect(await screen.findByText(/Import operation completed/)).toBeVisible();
  });

  it("generates an app protocol method map and agent handoff", async () => {
    render(<App gateway={fixtureGateway} />);
    await screen.findByRole("heading", { name: "Workspace overview" });
    fireEvent.click(screen.getByRole("button", { name: "App protocol" }));
    expect(
      screen.getByRole("heading", { name: "Application contract" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate interface protocol" }),
    );
    expect(
      screen.getByText("Append a schema-versioned revision"),
    ).toBeVisible();
    expect(
      screen.getByText("client.revisions.create(resourceId, command)"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Agent brief" }));
    expect(
      screen.getByText(/Implement Foundation against TCAP\/1.0/),
    ).toBeVisible();
    expect(
      screen.getByText(/Do not access Trust Core PostgreSQL/),
    ).toBeVisible();
  });
});
