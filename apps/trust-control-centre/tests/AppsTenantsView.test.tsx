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
    expect(
      screen.getByRole("heading", { name: "Apps & Tenants" }),
    ).toBeVisible();
    expect(screen.getByText("Foundation")).toBeVisible();
    expect(screen.getByText("Tenant 1")).toBeVisible();
    expect(screen.getByText("Tenant 2")).toBeVisible();
    expect(screen.getByText(/wrong_region/)).toBeVisible();
    expect(screen.getByText(/upgrade_recognised/i)).toBeVisible();
    expect(screen.getByText(/Synthetic binding data/i)).toBeVisible();
    expect(screen.getByText(/Storage needs attention/i)).toBeVisible();
    expect(screen.getByText(/App-default object store/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /Snapshot app scope/i })).toBeDisabled();
    fireEvent.click(screen.getByText("Tenant 2"));
    expect(
      screen.getByText(/correct the binding region/i),
    ).toBeVisible();
    expect(
      screen.getByText(/do not change the platform host TRUST_STORAGE_REGION/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Snapshot this tenant/i }),
    ).toBeDisabled();
  });

  it("live mode shows loading honesty without fixture attention", () => {
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
      screen.getByText(/Loading binding data from Trust API/i),
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
    expect(implemented).toContain("cc-apps-gateway");
    expect(implemented).toContain("cc-apps-live-strip");
    expect(implemented).toContain("adr-016-tenant-crud");
    expect(implemented).toContain("binding-routing-managed");
    const outstanding = platformStatus.outstanding.map((item) => item.id);
    expect(outstanding).not.toContain("cc-apps-gateway");
    expect(outstanding).not.toContain("cc-apps-live-strip");
    expect(outstanding).toContain("sts-assumerole-hardening");
    expect(outstanding).toContain("byob-data-plane");
    const byob = platformStatus.outstanding.find(
      (item) => item.id === "byob-data-plane",
    );
    expect(byob?.text).toMatch(/STS AssumeRole/i);
  });
});
