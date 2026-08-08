// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppsTenantsView, StorageAttentionStrip } from "../src/AppsTenantsView";
import { foundationStorageRollup } from "../src/foundation-storage-fixture";
import { platformStatus, wiringEntries } from "../src/wiring-status";

afterEach(cleanup);

describe("AppsTenantsView", () => {
  it("shows sample customers and management actions in fixture mode", () => {
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
    expect(screen.getAllByText("Tenant 2").length).toBeGreaterThan(0);
    expect(screen.getByText(/Sample customers/i)).toBeVisible();
    expect(screen.getByText(/Some customer storage needs attention/i)).toBeVisible();
    expect(screen.getByText(/App default storage/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Add customer/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Edit app storage/i }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tenant 2" }));
    expect(
      screen.getByText(/region on this setup does not match/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Set up storage/i }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /^Test connection$/i }).length,
    ).toBeGreaterThan(0);
  });

  it("adds a customer and sets up customer-provided storage in the sample flow", () => {
    render(
      <AppsTenantsView
        applications={[]}
        mode="fixture"
        onOpenConnections={vi.fn()}
        onOpenStorage={vi.fn()}
        onOpenPortability={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add customer/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. acme"), {
      target: { value: "acme" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Acme School"), {
      target: { value: "Acme School" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Add customer$/i }));
    expect(screen.getByRole("heading", { name: "Acme School" })).toBeVisible();
    expect(
      screen.getByText(/Added Acme School/i),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Set up storage/i }));
    fireEvent.click(
      screen.getByLabelText(/Use a customer-provided bucket/i),
    );
    fireEvent.change(screen.getByLabelText("Bucket name"), {
      target: { value: "acme-trust-files" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save storage setup/i }));
    expect(
      screen.getByText(/Customer storage saved for Acme School/i),
    ).toBeVisible();
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
      screen.getByText(/Loading customers from Trust Core/i),
    ).toBeVisible();
    expect(
      screen.queryByText(/Some customer storage needs attention/i),
    ).toBeNull();
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
    expect(
      screen.getByText(/Some customer storage needs attention/i),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Open Apps/i }));
    expect(onOpenApps).toHaveBeenCalled();
  });
});

describe("ADR-016 platform status catalog", () => {
  it("keeps Apps Partial and lists ADR-016 implemented/outstanding", () => {
    expect(wiringEntries["section.apps"].level).toBe("partial");
    expect(wiringEntries["section.apps"].detail).toMatch(/sample data/i);
    const implemented = platformStatus.implemented.map((item) => item.id);
    expect(implemented).toContain("adr-016-api");
    expect(implemented).toContain("adr-016-schema");
    expect(implemented).toContain("adr-016-postgres-repo");
    expect(implemented).toContain("cc-apps-gateway");
    expect(implemented).toContain("cc-apps-live-strip");
    expect(implemented).toContain("adr-016-tenant-crud");
    expect(implemented).toContain("binding-routing-managed");
    expect(implemented).toContain("cc-apps-management-ui");
    const outstanding = platformStatus.outstanding.map((item) => item.id);
    expect(outstanding).not.toContain("cc-apps-gateway");
    expect(outstanding).not.toContain("cc-apps-live-strip");
    expect(outstanding).toContain("sts-assumerole-hardening");
    expect(outstanding).toContain("byob-data-plane");
  });
});
