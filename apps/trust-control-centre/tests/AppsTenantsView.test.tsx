// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppsTenantsView, StorageAttentionStrip } from "../src/AppsTenantsView";
import { foundationStorageRollup } from "../src/foundation-storage-fixture";
import { platformStatus, wiringEntries } from "../src/wiring-status";

afterEach(cleanup);

describe("AppsTenantsView", () => {
  it("shows Foundation tenants with distinct storage status in fixture mode", () => {
    render(
      <AppsTenantsView
        applications={[]}
        mode="fixture"
        onOpenConnections={vi.fn()}
        onOpenStorage={vi.fn()}
        onOpenPortability={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Apps & Tenants" })).toBeVisible();
    expect(screen.getByText("Foundation")).toBeVisible();
    expect(screen.getByText("Tenant 1")).toBeVisible();
    expect(screen.getByText("Tenant 2")).toBeVisible();
    expect(screen.getByText(/wrong_region/)).toBeVisible();
    expect(screen.getByText(/upgrade_recognised/i)).toBeVisible();
    expect(screen.getByText(/Fixture tenant and binding data/i)).toBeVisible();
    expect(screen.getByText(/Storage needs attention/i)).toBeVisible();
  });

  it("live mode shows honesty banner without fixture attention", () => {
    render(
      <AppsTenantsView
        applications={[]}
        mode="live"
        onOpenConnections={vi.fn()}
        onOpenStorage={vi.fn()}
        onOpenPortability={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Live gateway — binding UI not wired yet/i),
    ).toBeVisible();
    expect(screen.queryByText(/Storage needs attention/i)).toBeNull();
    expect(screen.queryByText(/wrong_region/)).toBeNull();
  });

  it("home attention strip links to apps", () => {
    const onOpenApps = vi.fn();
    render(
      <StorageAttentionStrip
        rollup={foundationStorageRollup()}
        onOpenApps={onOpenApps}
        onOpenStorage={vi.fn()}
      />,
    );
    expect(screen.getByText(/Storage needs attention/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Open Apps/i }));
    expect(onOpenApps).toHaveBeenCalled();
  });
});

describe("ADR-016 platform status catalog", () => {
  it("keeps Apps Partial and lists ADR-016 implemented/outstanding", () => {
    expect(wiringEntries["section.apps"].level).toBe("partial");
    const implemented = platformStatus.implemented.map((item) => item.id);
    expect(implemented).toContain("adr-016-api");
    expect(implemented).toContain("adr-016-schema");
    expect(implemented).toContain("adr-016-postgres-repo");
    const outstanding = platformStatus.outstanding.map((item) => item.id);
    expect(outstanding).toContain("cc-apps-gateway");
    expect(outstanding).toContain("cc-apps-live-strip");
    expect(outstanding).toContain("sts-assumerole-hardening");
    expect(outstanding).toContain("byob-data-plane");
  });
});
