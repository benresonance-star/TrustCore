import { HardDrive, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
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

function statusClass(status: string): string {
  if (status === "connected") return "verified";
  return "review";
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
  onOpenConnections,
  onOpenStorage,
  onOpenPortability,
}: {
  applications: readonly ApplicationRegistration[];
  mode: GatewayMode;
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
    foundationTenants[1]?.id ?? null,
  );

  const rollup: StorageBindingRollup | null =
    mode === "fixture" ? foundationStorageRollup() : null;
  const isFoundation = mode === "fixture" && selectedAppId === FOUNDATION_APP_ID;
  const tenants: ApplicationTenant[] = isFoundation ? foundationTenants : [];
  const appEffective: EffectiveStorageSummary | null = isFoundation
    ? foundationEffectiveAppDefault()
    : null;
  const tenantEffective =
    isFoundation && selectedTenantId
      ? foundationEffectiveForTenant(selectedTenantId)
      : null;

  return (
    <section className="stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Connected applications</p>
          <h1>Apps &amp; Tenants</h1>
          <p className="lede">
            Review app-global and per-tenant canonical object stores. Secrets
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
            <strong>Fixture tenant and binding data.</strong>
            <small>
              {" "}
              Rollup, tenants, and effective storage are synthetic until the
              Control Centre gateway calls Trust API binding routes.
            </small>
          </div>
        </div>
      ) : (
        <div className="status-notice" role="status">
          <HardDrive size={18} aria-hidden />
          <div>
            <strong>Live gateway — binding UI not wired yet.</strong>
            <small>
              {" "}
              Application list may come from Connections; tenant, binding, and
              rollup data are not loaded from the API in this build.
            </small>
          </div>
        </div>
      )}

      {mode === "fixture" && rollup && rollup.attentionTotal > 0 ? (
        <div className="status-notice error" role="alert">
          <ShieldAlert size={18} aria-hidden />
          <div>
            <strong>Storage needs attention</strong>
            <small>
              Platform: {rollup.platformStatus}. Foundation:{" "}
              {rollup.applications[0]?.attention ?? 0} of{" "}
              {(rollup.applications[0]?.connected ?? 0) +
                (rollup.applications[0]?.attention ?? 0) +
                (rollup.applications[0]?.configured ?? 0)}{" "}
              tenants need attention
              {rollup.applications[0]?.topIssues[0]
                ? ` (Tenant ${rollup.applications[0].topIssues[0].externalTenantKey}: ${rollup.applications[0].topIssues[0].issueClass})`
                : ""}
              .
            </small>
          </div>
        </div>
      ) : null}

      <div className="two-columns">
        <div className="card panel">
          <div className="panel-heading">
            <h2>Applications</h2>
            <button type="button" className="text-button" onClick={onOpenConnections}>
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
                        app.id === FOUNDATION_APP_ID
                          ? foundationTenants[0]?.id ?? null
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
            <h2>App storage (global)</h2>
            <span className={statusClass(appEffective?.status ?? "not_configured")}>
              {appEffective?.status ?? "not_configured"}
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
              <button type="button" className="text-button" onClick={onOpenStorage}>
                Open platform Storage
              </button>
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() =>
                onOpenPortability({ applicationId: selectedAppId })
              }
            >
              Snapshot (Portability)
            </button>
            <button type="button" className="button" onClick={onOpenStorage}>
              Platform Storage
            </button>
          </div>
        </div>
      </div>

      <div className="card panel">
        <div className="panel-heading">
          <h2>Tenants</h2>
        </div>
        {tenants.length === 0 ? (
          <p className="muted">No application tenants registered for this app.</p>
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
                const eff = foundationEffectiveForTenant(tenant.id);
                return (
                  <tr
                    key={tenant.id}
                    className={
                      selectedTenantId === tenant.id ? "selected-row" : undefined
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
                    <td>{eff.provider ?? "—"}</td>
                    <td>{eff.tier ?? "—"}</td>
                    <td>
                      {eff.inheritedFrom === "none"
                        ? "Override"
                        : eff.inheritedFrom === "app"
                          ? "App default"
                          : "Platform"}
                    </td>
                    <td>
                      <span className={statusClass(eff.status)}>{eff.status}</span>
                    </td>
                    <td>{eff.planSyncState}</td>
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
              {tenantEffective.status}
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
              {formatBytes(tenantEffective.declaredCapacityBytes)} → observed quota{" "}
              {formatBytes(tenantEffective.observedQuotaBytes)}. Accept the new
              declared plan after confirming with the customer.
            </p>
          ) : null}
          {tenantEffective.status === "needs_attention" ? (
            <p className="readiness-remediation">
              {tenantEffective.binding?.lastProbeSummary}
            </p>
          ) : null}
          <div className="button-row">
            <button
              type="button"
              className="button primary"
              onClick={() =>
                onOpenPortability({
                  applicationId: selectedAppId,
                  applicationTenantId: selectedTenantId,
                })
              }
            >
              Snapshot tenant
            </button>
            <button type="button" className="button" disabled title="Phase 6 live migrate">
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
              Open platform Storage
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
