// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { fixtureGateway } from "../src/fixture-gateway";

afterEach(cleanup);

describe("Trust Core Control Centre", () => {
  it("opens on the project and component home", async () => {
    render(<App gateway={fixtureGateway} />);
    expect(await screen.findByRole("heading", { name: "Good morning, Ben" })).toBeVisible();
    expect(screen.getByText("Common components")).toBeVisible();
  });

  it("switches between registry and system flow sections", async () => {
    render(<App gateway={fixtureGateway} />);
    await screen.findByRole("heading", { name: "Good morning, Ben" });
    fireEvent.click(screen.getByRole("button", { name: "Datasets" }));
    expect(screen.getByRole("heading", { name: "Dataset registry" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Flow" }));
    expect(screen.getByRole("heading", { name: "System flow" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Trust API/ })).toBeVisible();
  });

  it("opens a project directly in its dataset detail", async () => {
    render(<App gateway={fixtureGateway} />);
    const openButtons = await screen.findAllByRole("button", { name: "Open" });
    fireEvent.click(openButtons[0]!);
    expect(screen.getByRole("heading", { name: "Dataset registry" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "2417 — Moorabbin Apartments" })).toBeVisible();
  });

  it("restores a deleted item as a new revision from History", async () => {
    render(<App gateway={fixtureGateway} />);
    await screen.findByRole("heading", { name: "Good morning, Ben" });
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "Recovery bin" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]!);
    expect(await screen.findByRole("status")).toHaveTextContent("Restored safely as revision 18");
  });

  it("runs a full-byte verification from System health",async()=>{
    render(<App gateway={fixtureGateway}/>);await screen.findByRole("heading",{name:"Good morning, Ben"});fireEvent.click(screen.getByRole("button",{name:"Health"}));fireEvent.click(screen.getByRole("button",{name:"Run full verification"}));expect(await screen.findByRole("status")).toHaveTextContent("PASSED");expect(screen.getByRole("status")).toHaveTextContent("3,284 objects");
  });
});
