// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowView } from "../src/FlowView";
import { fixtureGateway } from "../src/fixture-gateway";

afterEach(cleanup);

describe("FlowView", () => {
  it("renders legend, inspector structure, hover popovers, and workspace signals", async () => {
    const snapshot = await fixtureGateway.getSnapshot();
    const operational = await fixtureGateway.getOperationalSnapshot();
    const navigate = vi.fn();

    render(
      <FlowView
        mode="fixture"
        snapshot={snapshot}
        operational={operational}
        applicationCount={1}
        navigate={navigate}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "System overview" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Legend" })).toBeVisible();
    expect(screen.getByText("wired to Trust API")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Process inspector" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "What this does" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Features" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Signal" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Open in Control Centre" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Workspace signals" }),
    ).toBeVisible();

    const tooltips = screen.getAllByRole("tooltip");
    expect(tooltips.length).toBe(10);
    expect(
      tooltips.some((node) =>
        node.textContent?.includes("HTTP gateway for snapshot"),
      ),
    ).toBe(true);

    expect(
      screen.getByRole("button", {
        name: `Datasets signal: ${snapshot.datasets.length}`,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Applications signal: 1" }),
    ).toBeVisible();
  });

  it("shows deferred Semantic signal and navigates deep links", async () => {
    const snapshot = await fixtureGateway.getSnapshot();
    const operational = await fixtureGateway.getOperationalSnapshot();
    const navigate = vi.fn();

    render(
      <FlowView
        mode="fixture"
        snapshot={snapshot}
        operational={operational}
        applicationCount={1}
        navigate={navigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Semantic layer" }));
    expect(
      screen.getByText(/No live signal — AI \/ semantic layer is deferred/),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Platform status" }),
    );
    expect(navigate).toHaveBeenCalledWith("platform-status");

    fireEvent.click(
      screen.getByRole("button", {
        name: `Datasets signal: ${snapshot.datasets.length}`,
      }),
    );
    expect(navigate).toHaveBeenCalledWith("datasets");
  });

  it("keeps Trust API selected by default with page Partial badge", async () => {
    const snapshot = await fixtureGateway.getSnapshot();
    render(
      <FlowView
        mode="fixture"
        snapshot={snapshot}
        operational={null}
        applicationCount={null}
        navigate={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Trust API" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Trust API", pressed: true }),
    ).toBeVisible();
    expect(
      screen.getByLabelText(/Partial:.*Topology, inspector/),
    ).toBeVisible();
  });
});
