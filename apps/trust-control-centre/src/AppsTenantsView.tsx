import { HardDrive, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ApplicationRegistration,
  ApplicationTenant,
  EffectiveStorageSummary,
  StorageBindingRollup,
} from "@trust-core/protocol";
import { WiringBadge } from "./WiringBadge";
import type { GatewayMode } from "./wiring-status";
import {
  FOUNDATION_APP_ID,
  foundationEffectiveAppDefault,
  foundationEffectiveForTenant,
  foundationStorageRollup,
  foundationTenants,
} from "./foundation-storage-fixture";
import { remediationFor } from "./remediation";
import { remediationKeyForBindingIssueClass } from "./storage-status";

function statusClass(status: string): string {
  if (status === "connected") return "verified";
  return "review";
}

function humanStatus(status: string): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "configured":
      return "Configured";
    case "needs_attention":
      return "Needs attention";
    case "not_configured":
      return "Not set up";
    case "disabled":
      return "Disabled";
    case "migrating":
      return "Migrating";
    case "draft":
      return "Draft";
    case "awaiting_customer_role":
      return "Awaiting customer role";
    default:
      return status;
  }
}

function formatBytes(value: number | null | undefined): string {
  if (value == null) return "—";
  const tb = value / 1024 ** 4;
  if (tb >= 0.1) return `${tb.toFixed(1)} TB`;
  const gb = value / 1024 ** 3;
  return `${gb.toFixed(1)} GB`;
}

export function AppsTenantsView({
  applications,
  mode,
  gateway,
  rollup: rollupProp,
  onOpenConnections,
  onOpenStorage,
  onOpenPortability,
}: {
  applications: readonly ApplicationRegistration[];
  mode: GatewayMode;
  gateway?: {
    listApplicationTenants: (
      workspaceId: string,
      applicationId: string,
    ) => Promise<readonly ApplicationTenant[]>;
    getEffectiveStorage: (
      workspaceId: string,
      applicationId: string,
      applicationTenantId?: string,
    ) => Promise<EffectiveStorageSummary>;
    workspaceId: string;
  };
  rollup?: StorageBindingRollup | null;
  onOpenConnections: () => void;
  onOpenStorage: () => void;
  onOpenPortability: (scope?: {
    applicationId: string;
    applicationTenantId?: string;
  }) => void;
}) {
  const apps = useMemo(() => {
    const list = [...applications];
    if (!list.some((a) => a.id === FOUNDATION_APP_ID) && mode === "fixture") {
      list.unshift({
        id: FOUNDATION_APP_ID,
        workspaceId: "workspace-demo",
        namespace: "app/foundation",
        name: "Foundation",
        applicationVersion: "1.0.0",
        schemaPackageIds: [],
        capabilities: ["dataset:read", "resource:read", "object:ingest"],
        status: "active",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
      });
    }
    return list;
  }, [applications, mode]);

  const [selectedAppId, setSelectedAppId] = useState<string>(
    apps[0]?.id ?? FOUNDATION_APP_ID,
  );
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(
    mode === "fixture" ? (foundationTenants[1]?.id ?? null) : null,
  );
  const [liveTenants, setLiveTenants] = useState<ApplicationTenant[]>([]);
  const [tenantEffectiveById, setTenantEffectiveById] = useState<
    Record<string, EffectiveStorageSummary>
  >({});
  const [liveAppEffective, setLiveAppEffective] =
    useState<EffectiveStorageSummary | null>(null);
  const [liveLoadedAt, setLiveLoadedAt] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const rollup: StorageBindingRollup | null =
    rollupProp !== undefined
      ? rollupProp
      : mode === "fixture"
        ? foundationStorageRollup()
        : null;
  const isFoundationFixture =
    mode === "fixture" && selectedAppId === FOUNDATION_APP_ID;
  const tenants: ApplicationTenant[] = isFoundationFixture
    ? foundationTenants
    : liveTenants;
  const appEffective: EffectiveStorageSummary | null = isFoundationFixture
    ? foundationEffectiveAppDefault()
    : liveAppEffective;
  const tenantEffective = selectedTenantId
    ? isFoundationFixture
      ? foundationEffectiveForTenant(selectedTenantId)
      : (tenantEffectiveById[selectedTenantId] ?? null)
    : null;

  useEffect(() => {
    if (!apps.some((a) => a.id === selectedAppId) && apps[0]) {
      setSelectedAppId(apps[0].id);
    }
  }, [apps, selectedAppId]);

  useEffect(() => {
    if (mode === "fixture" || !gateway?.workspaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [tenantList, appEff] = await Promise.all([
          gateway.listApplicationTenants(gateway.workspaceId, selectedAppId),
          gateway.getEffectiveStorage(gateway.workspaceId, selectedAppId),
        ]);
        if (cancelled) return;
        setLiveTenants([...tenantList]);
        setLiveAppEffective(appEff);
        const effectiveEntries = await Promise.all(
          tenantList.map(async (tenant) => {
            const summary = await gateway.getEffectiveStorage(
              gateway.workspaceId,
              selectedAppId,
              tenant.id,
            );
            return [tenant.id, summary] as const;
          }),
        );
        if (cancelled) return;
        setTenantEffectiveById(Object.fromEntries(effectiveEntries));
        setLiveLoadedAt(new Date().toISOString());
        setLiveError(null);
        if (
          selectedTenantId &&
          !tenantList.some((tenant) => tenant.id === selectedTenantId)
        ) {
          setSelectedTenantId(tenantList[0]?.id ?? null);
        }
      } catch (error) {
        if (cancelled) return;
        setLiveError(
          error instanceof Error ? error.message : "Failed to load bindings",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway, mode, selectedAppId, selectedTenantId]);

  function effectiveForTenant(tenantId: string): EffectiveStorageSummary | null {
    if (isFoundationFixture) return foundationEffectiveForTenant(tenantId);
    return tenantEffectiveById[tenantId] ?? null;
  }

  return (
    <section className="stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Connected applications</p>
          <h1>Apps &amp; Tenants</h1>
          <p className="lede">
            Review app-default and per-tenant canonical object stores. Secrets
            stay on the API host; this screen diagnoses bindings and plan sync.
          </p>
        </div>
        <WiringBadge entryId="section.apps" mode={mode} />
      </div>

      <div className="status-notice" role="status">
        <HardDrive size={18} aria-hidden />
        <div>
          <strong>
            Source connectors (Drive/OneDrive/…) are deferred — see ADR-015.
            This page is for canonical object-store / BYOB bindings (ADR-016).
          </strong>
        </div>
      </div>

      {mode === "fixture" ? (
        <div className="status-notice" role="status">
          <HardDrive size={18} aria-hidden />
          <div>
            <strong>Synthetic binding data — preview only.</strong>
            <small>
              {" "}
              Rollup, tenants, and effective storage come from the fixture
              gateway.
            </small>
          </div>
        </div>
      ) : (
        <div className="status-notice" role="status">
          <HardDrive size={18} aria-hidden />
          <div>
            <strong>
              {liveLoadedAt
                ? `Loaded from Trust API at ${liveLoadedAt}.`
                : liveError
                  ? "Live binding load failed."
                  : "Loading binding data from Trust API…"}
            </strong>
            {liveError ? <small> {liveError}</small> : null}
          </div>
        </div>
      )}

      {rollup && rollup.attentionTotal > 0 ? (
        <div className="status-notice error" role="alert">
          <ShieldAlert size={18} aria-hidden />
          <div>
            <strong>Storage needs attention</strong>
            <small>
              Platform: {rollup.platformStatus}.{" "}
              {rollup.applications[0]
                ? `${rollup.applications[0].applicationName}: ${rollup.applications[0].attention} of ${(rollup.applications[0].connected ?? 0) + (rollup.applications[0].attention ?? 0) + (rollup.applications[0].configured ?? 0)} tenants need attention${
                    rollup.applications[0].topIssues[0]
                      ? ` (Tenant ${rollup.applications[0].topIssues[0].externalTenantKey}: ${rollup.applications[0].topIssues[0].issueClass})`
                      : ""
                  }.`
                : null}
            </small>
          </div>
        </div>
      ) : null}

      <div className="two-columns">
        <div className="card panel">
          <div className="panel-heading">
            <h2>Applications</h2>
            <button
              type="button"
              className="text-button"
              onClick={onOpenConnections}
            >
              Open Connections
            </button>
          </div>
          <ul className="assignment-list">
            {apps.map((app) => {
              const appRollup = rollup?.applications.find(
                (a) => a.applicationId === app.id,
              );
              return (
                <li key={app.id}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setSelectedAppId(app.id);
                      setSelectedTenantId(
                        mode === "fixture" && app.id === FOUNDATION_APP_ID
                          ? (foundationTenants[0]?.id ?? null)
                          : null,
                      );
                    }}
                  >
                    <strong>{app.name}</strong>
                  </button>
                  <small>
                    {app.namespace} ·{" "}
                    {appRollup
                      ? appRollup.attention > 0
                        ? `${appRollup.attention} need attention`
                        : "all connected"
                      : "using platform only"}
                  </small>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card panel">
          <div className="panel-heading">
            <h2>App-default object store</h2>
            <span
              className={statusClass(appEffective?.status ?? "not_configured")}
            >
              {humanStatus(appEffective?.status ?? "not_configured")}
            </span>
          </div>
          {appEffective ? (
            <StorageSummaryBlock
              summary={appEffective}
              inheritanceNote="Default for all tenants without an override."
            />
          ) : (
            <p className="muted">
              No app-default binding. Tenants inherit platform storage.{" "}
              <button
                type="button"
                className="text-button"
                onClick={onOpenStorage}
              >
                Open platform Storage (host)
              </button>
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              className="button"
              disabled
              title="Portability export is workspace-scoped today; app/tenant filters are not applied yet."
            >
              Snapshot app scope
            </button>
            <button type="button" className="button" onClick={onOpenStorage}>
              Open platform Storage (host)
            </button>
            <button
              type="button"
              className="button"
              onClick={() => onOpenPortability()}
            >
              Open Portability (workspace)
            </button>
          </div>
        </div>
      </div>

      <div className="card panel">
        <div className="panel-heading">
          <h2>Tenants</h2>
        </div>
        {tenants.length === 0 ? (
          <p className="muted">
            No application tenants registered for this app.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Name</th>
                <th>Provider</th>
                <th>Tier</th>
                <th>Inheritance</th>
                <th>Status</th>
                <th>Plan sync</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const eff = effectiveForTenant(tenant.id);
                return (
                  <tr
                    key={tenant.id}
                    className={
                      selectedTenantId === tenant.id
                        ? "selected-row"
                        : undefined
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedTenantId(tenant.id)}
                      >
                        {tenant.externalTenantKey}
                      </button>
                    </td>
                    <td>{tenant.displayName}</td>
                    <td>{eff?.provider ?? "—"}</td>
                    <td>{eff?.tier ?? "—"}</td>
                    <td>
                      {eff?.inheritedFrom === "none"
                        ? "Override"
                        : eff?.inheritedFrom === "app"
                          ? "App default"
                          : "Platform"}
                    </td>
                    <td>
                      <span className={statusClass(eff?.status ?? "not_configured")}>
                        {humanStatus(eff?.status ?? "not_configured")}
                      </span>
                    </td>
                    <td>{eff?.planSyncState ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {tenantEffective && selectedTenantId ? (
        <div className="card panel">
          <div className="panel-heading">
            <h2>Tenant detail</h2>
            <span className={statusClass(tenantEffective.status)}>
              {humanStatus(tenantEffective.status)}
            </span>
          </div>
          <p className="muted">
            {tenantEffective.inheritedFrom === "none"
              ? `Tenant override (${tenantEffective.provider} · ${tenantEffective.tier} · ${tenantEffective.region})`
              : `Using app default (${tenantEffective.provider} · ${tenantEffective.tier} · ${tenantEffective.region})`}
          </p>
          <StorageSummaryBlock summary={tenantEffective} />
          {tenantEffective.planSyncState === "upgrade_recognised" ? (
            <p className="readiness-remediation">
              Recognised capacity change: declared{" "}
              {formatBytes(tenantEffective.declaredCapacityBytes)} → observed
              quota {formatBytes(tenantEffective.observedQuotaBytes)}. Accept
              the new declared plan after confirming with the customer.
            </p>
          ) : null}
          {tenantEffective.status === "needs_attention" ? (
            <p className="readiness-remediation">
              {tenantEffective.binding?.lastIssueClass
                ? remediationFor(
                    remediationKeyForBindingIssueClass(
                      tenantEffective.binding.lastIssueClass,
                    ),
                  )
                : tenantEffective.binding?.lastProbeSummary}
            </p>
          ) : null}
          <div className="button-row">
            <button
              type="button"
              className="button"
              disabled
              title="Portability export is workspace-scoped today; app/tenant filters are not applied yet."
            >
              Snapshot this tenant
            </button>
            <button
              type="button"
              className="button"
              disabled
              title="Unavailable until migrate API ships"
            >
              Change plan / migrate
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StorageSummaryBlock({
  summary,
  inheritanceNote,
}: {
  summary: EffectiveStorageSummary;
  inheritanceNote?: string;
}) {
  return (
    <dl className="detail-list">
      {inheritanceNote ? (
        <div>
          <dt>Inheritance</dt>
          <dd>{inheritanceNote}</dd>
        </div>
      ) : null}
      <div>
        <dt>Provider</dt>
        <dd>
          {summary.provider ?? "—"} · {summary.credentialMode ?? "—"}
        </dd>
      </div>
      <div>
        <dt>Tier</dt>
        <dd>{summary.tier ?? "—"}</dd>
      </div>
      <div>
        <dt>Region / bucket</dt>
        <dd>
          {summary.region ?? "—"} / {summary.bucket ?? "—"}
        </dd>
      </div>
      <div>
        <dt>Cost posture</dt>
        <dd>{summary.costPosture}</dd>
      </div>
      <div>
        <dt>Usage</dt>
        <dd>
          {summary.usage.cataloguedObjects} objects · failed{" "}
          {summary.usage.failedVerificationObjects}
        </dd>
      </div>
      <div>
        <dt>Plan</dt>
        <dd>
          declared {formatBytes(summary.declaredCapacityBytes)} · observed{" "}
          {formatBytes(summary.observedUsageBytes)} used · quota{" "}
          {formatBytes(summary.observedQuotaBytes)} · {summary.planSyncState}
        </dd>
      </div>
      <div>
        <dt>Last probe</dt>
        <dd>
          {summary.binding?.lastProbeSummary ?? "—"}
          {summary.binding?.lastProbeAt
            ? ` · ${summary.binding.lastProbeAt}`
            : ""}
        </dd>
      </div>
    </dl>
  );
}

export function StorageAttentionStrip({
  rollup,
  onOpenApps,
  onOpenStorage,
}: {
  rollup: StorageBindingRollup | null;
  onOpenApps: () => void;
  onOpenStorage: () => void;
}) {
  if (!rollup || rollup.attentionTotal <= 0) return null;
  const issue = rollup.applications[0]?.topIssues[0];
  return (
    <div className="status-notice error" role="alert">
      <ShieldAlert size={18} aria-hidden />
      <div>
        <strong>Storage needs attention</strong>
        <small>
          Platform: {rollup.platformStatus}.{" "}
          {rollup.applications[0]
            ? `${rollup.applications[0].applicationName}: ${rollup.applications[0].attention} tenant(s) need attention${
                issue
                  ? ` (Tenant ${issue.externalTenantKey}: ${issue.issueClass})`
                  : ""
              }.`
            : null}
        </small>
        <div className="button-row" style={{ marginTop: 8 }}>
          <button type="button" className="button primary" onClick={onOpenApps}>
            Open Apps &amp; Tenants
          </button>
          {rollup.platformStatus !== "healthy" ? (
            <button type="button" className="button" onClick={onOpenStorage}>
              Open platform Storage (host)
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
