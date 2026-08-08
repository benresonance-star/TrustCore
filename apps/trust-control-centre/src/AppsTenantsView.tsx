import { HardDrive, Plus, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  ApplicationRegistration,
  ApplicationTenant,
  EffectiveStorageSummary,
  StorageBindingRollup,
  StorageBindingSummary,
} from "@trust-core/protocol";
import { CopyIdChip } from "./CopyIdChip";
import { WiringBadge } from "./WiringBadge";
import type { GatewayMode } from "./wiring-status";
import {
  FOUNDATION_APP_ID,
  bindingAttentionMessage,
  createDemoTenantState,
  demoEffectiveAppDefault,
  demoEffectiveForTenant,
  demoStorageRollup,
  humanInheritance,
  humanPlanSync,
  humanProvider,
  humanStorageStatus,
  humanTier,
  humanWhoPays,
  type DemoTenantState,
} from "./apps-tenants-labels";
import { foundationTenants } from "./foundation-storage-fixture";

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

type StorageFormState = {
  kind: "trust" | "customer";
  region: string;
  bucket: string;
  prefix: string;
  capacityTb: string;
};

const emptyCustomerForm = (): StorageFormState => ({
  kind: "customer",
  region: "ap-southeast-2",
  bucket: "",
  prefix: "",
  capacityTb: "5",
});

const emptyTrustForm = (): StorageFormState => ({
  kind: "trust",
  region: "ap-southeast-2",
  bucket: "foundation-managed",
  prefix: "",
  capacityTb: "",
});

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
  const [demo, setDemo] = useState<DemoTenantState>(() => createDemoTenantState());
  const [liveTenants, setLiveTenants] = useState<ApplicationTenant[]>([]);
  const [tenantEffectiveById, setTenantEffectiveById] = useState<
    Record<string, EffectiveStorageSummary>
  >({});
  const [liveAppEffective, setLiveAppEffective] =
    useState<EffectiveStorageSummary | null>(null);
  const [liveLoadedAt, setLiveLoadedAt] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showAppStorageForm, setShowAppStorageForm] = useState(false);
  const [showTenantStorageForm, setShowTenantStorageForm] = useState(false);
  const [newCustomerKey, setNewCustomerKey] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [appForm, setAppForm] = useState<StorageFormState>(emptyTrustForm);
  const [tenantForm, setTenantForm] =
    useState<StorageFormState>(emptyCustomerForm);

  const isFoundationFixture =
    mode === "fixture" && selectedAppId === FOUNDATION_APP_ID;
  const managementEnabled = isFoundationFixture;

  const tenants: ApplicationTenant[] = isFoundationFixture
    ? demo.tenants
    : liveTenants;
  const appEffective: EffectiveStorageSummary | null = isFoundationFixture
    ? demoEffectiveAppDefault(demo)
    : liveAppEffective;
  const tenantEffective = selectedTenantId
    ? isFoundationFixture
      ? demoEffectiveForTenant(demo, selectedTenantId)
      : (tenantEffectiveById[selectedTenantId] ?? null)
    : null;
  const rollup: StorageBindingRollup | null = isFoundationFixture
    ? demoStorageRollup(demo)
    : rollupProp !== undefined
      ? rollupProp
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
          error instanceof Error ? error.message : "Failed to load customers",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway, mode, selectedAppId, selectedTenantId]);

  function effectiveForTenant(tenantId: string): EffectiveStorageSummary | null {
    if (isFoundationFixture) return demoEffectiveForTenant(demo, tenantId);
    return tenantEffectiveById[tenantId] ?? null;
  }

  function requireManagement(): boolean {
    if (managementEnabled) return true;
    setNotice(
      "This management preview works with sample data. Connect a live workspace to save real changes later.",
    );
    return false;
  }

  function addCustomer(event: FormEvent) {
    event.preventDefault();
    if (!requireManagement()) return;
    const key = newCustomerKey.trim();
    const name = newCustomerName.trim();
    if (!key || !name) {
      setNotice("Enter a customer key and display name.");
      return;
    }
    if (demo.tenants.some((tenant) => tenant.externalTenantKey === key)) {
      setNotice("That customer key is already in use.");
      return;
    }
    const now = new Date().toISOString();
    const tenant: ApplicationTenant = {
      id: `fixture-tenant-${key}`,
      workspaceId: "workspace-demo",
      applicationId: FOUNDATION_APP_ID,
      externalTenantKey: key,
      displayName: name,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    setDemo((current) => ({
      ...current,
      tenants: [...current.tenants, tenant],
    }));
    setSelectedTenantId(tenant.id);
    setNewCustomerKey("");
    setNewCustomerName("");
    setShowAddCustomer(false);
    setNotice(`Added ${name}. They currently use the app default storage.`);
  }

  function saveAppStorage(event: FormEvent) {
    event.preventDefault();
    if (!requireManagement()) return;
    setBusy("app-storage");
    const now = new Date().toISOString();
    setDemo((current) => {
      const next: StorageBindingSummary = {
        ...current.appDefault,
        status: "configured",
        lastProbeOk: null,
        lastProbeAt: null,
        lastProbeSummary: "Saved — test the connection to confirm.",
        lastIssueClass: null,
        updatedAt: now,
        profile: {
          ...current.appDefault.profile,
          region: appForm.region.trim() || current.appDefault.profile.region,
          bucket: appForm.bucket.trim() || current.appDefault.profile.bucket,
          prefix: appForm.prefix.trim(),
          tier: "managed",
          credentialMode: "platform_iam",
          declaredCapacityBytes: null,
          declaredPlanCode: "platform",
        },
        costPosture: "platform_managed",
      };
      return { ...current, appDefault: next };
    });
    setBusy("");
    setShowAppStorageForm(false);
    setNotice("App default storage saved. Test the connection next.");
  }

  function saveTenantStorage(event: FormEvent) {
    event.preventDefault();
    if (!requireManagement() || !selectedTenantId) return;
    const tenant = demo.tenants.find((item) => item.id === selectedTenantId);
    if (!tenant) return;
    if (tenantForm.kind === "trust") {
      setDemo((current) => ({
        ...current,
        tenantBindings: current.tenantBindings.filter(
          (binding) => binding.applicationTenantId !== selectedTenantId,
        ),
      }));
      setShowTenantStorageForm(false);
      setNotice(
        `${tenant.displayName} now uses the app default storage.`,
      );
      return;
    }
    if (!tenantForm.bucket.trim() || !tenantForm.region.trim()) {
      setNotice("Bucket name and region are required for customer storage.");
      return;
    }
    const now = new Date().toISOString();
    const capacityBytes = Number(tenantForm.capacityTb)
      ? Number(tenantForm.capacityTb) * 1024 ** 4
      : null;
    setDemo((current) => {
      const existing = current.tenantBindings.find(
        (binding) => binding.applicationTenantId === selectedTenantId,
      );
      const next: StorageBindingSummary = {
        id: existing?.id ?? `fixture-binding-${tenant.externalTenantKey}`,
        workspaceId: "workspace-demo",
        applicationId: FOUNDATION_APP_ID,
        applicationTenantId: selectedTenantId,
        profile: {
          id: existing?.profile.id ?? `fixture-profile-${tenant.externalTenantKey}`,
          provider: "s3",
          region: tenantForm.region.trim(),
          bucket: tenantForm.bucket.trim(),
          prefix: tenantForm.prefix.trim(),
          tier: "byob",
          credentialMode: "cross_account_role",
          expectedBucketOwner: null,
          endpointHost: null,
          roleArn: null,
          declaredPlanCode: capacityBytes ? `${tenantForm.capacityTb}tb` : null,
          declaredCapacityBytes: capacityBytes,
        },
        status: "configured",
        generation: (existing?.generation ?? 0) + 1,
        lastProbeOk: null,
        lastProbeAt: null,
        lastProbeSummary: "Saved — test the connection to confirm.",
        lastIssueClass: null,
        planSyncState: "unknown",
        observedUsageBytes: existing?.observedUsageBytes ?? null,
        observedQuotaBytes: existing?.observedQuotaBytes ?? null,
        observedAt: null,
        disabled: false,
        costPosture: "customer_billed_byob",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      return {
        ...current,
        tenantBindings: [
          ...current.tenantBindings.filter(
            (binding) => binding.applicationTenantId !== selectedTenantId,
          ),
          next,
        ],
      };
    });
    setShowTenantStorageForm(false);
    setNotice(
      `Customer storage saved for ${tenant.displayName}. Test the connection next.`,
    );
  }

  function testConnection(scope: "app" | "tenant") {
    if (!requireManagement()) return;
    setBusy(`probe-${scope}`);
    const now = new Date().toISOString();
    if (scope === "app") {
      setDemo((current) => ({
        ...current,
        appDefault: {
          ...current.appDefault,
          status: "connected",
          lastProbeOk: true,
          lastProbeAt: now,
          lastProbeSummary: "Connection test succeeded.",
          lastIssueClass: null,
          updatedAt: now,
        },
      }));
      setNotice("App default storage is connected.");
    } else if (selectedTenantId) {
      setDemo((current) => ({
        ...current,
        tenantBindings: current.tenantBindings.map((binding) => {
          if (binding.applicationTenantId !== selectedTenantId) return binding;
          // Demo: region eu-west-1 with a mismatched expectation stays broken until edited.
          if (
            binding.profile.region === "eu-west-1" &&
            binding.lastIssueClass === "wrong_region"
          ) {
            return {
              ...binding,
              status: "needs_attention",
              lastProbeOk: false,
              lastProbeAt: now,
              lastProbeSummary:
                "Bucket region does not match the region on this setup.",
              lastIssueClass: "wrong_region",
              updatedAt: now,
            };
          }
          return {
            ...binding,
            status: "connected",
            lastProbeOk: true,
            lastProbeAt: now,
            lastProbeSummary: "Connection test succeeded.",
            lastIssueClass: null,
            updatedAt: now,
          };
        }),
      }));
      setNotice("Customer storage connection tested.");
    }
    setBusy("");
  }

  function acceptCapacityChange() {
    if (!requireManagement() || !selectedTenantId || !tenantEffective) return;
    const quota = tenantEffective.observedQuotaBytes;
    if (quota == null) return;
    setDemo((current) => ({
      ...current,
      tenantBindings: current.tenantBindings.map((binding) =>
        binding.applicationTenantId === selectedTenantId
          ? {
              ...binding,
              planSyncState: "synced",
              profile: {
                ...binding.profile,
                declaredCapacityBytes: quota,
                declaredPlanCode: `${(quota / 1024 ** 4).toFixed(0)}tb`,
              },
              updatedAt: new Date().toISOString(),
            }
          : binding,
      ),
    }));
    setNotice("Capacity change accepted for this customer.");
  }

  function pauseCustomerStorage() {
    if (!requireManagement() || !selectedTenantId) return;
    setDemo((current) => ({
      ...current,
      tenantBindings: current.tenantBindings.map((binding) =>
        binding.applicationTenantId === selectedTenantId
          ? {
              ...binding,
              disabled: true,
              status: "disabled",
              updatedAt: new Date().toISOString(),
            }
          : binding,
      ),
    }));
    setNotice("Customer storage paused. New uploads will be blocked.");
  }

  function openTenantStorageEditor() {
    if (!selectedTenantId) return;
    const effective = effectiveForTenant(selectedTenantId);
    if (effective?.inheritedFrom === "none" && effective.binding) {
      setTenantForm({
        kind: "customer",
        region: effective.region ?? "ap-southeast-2",
        bucket: effective.bucket ?? "",
        prefix: effective.prefix ?? "",
        capacityTb: effective.declaredCapacityBytes
          ? String(effective.declaredCapacityBytes / 1024 ** 4)
          : "5",
      });
    } else {
      setTenantForm(emptyCustomerForm());
    }
    setShowTenantStorageForm(true);
  }

  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId);

  return (
    <section className="stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Connected applications</p>
          <h1>Apps &amp; Tenants</h1>
          <p className="lede">
            Choose how each app and customer stores files — Trust-managed
            storage or a customer-provided bucket.
          </p>
        </div>
        <WiringBadge entryId="section.apps" mode={mode} />
      </div>

      <div className="status-notice" role="status">
        <HardDrive size={18} aria-hidden />
        <div>
          <strong>
            {mode === "fixture"
              ? "Sample customers — try the full management flow here."
              : liveLoadedAt
                ? `Loaded from Trust Core at ${liveLoadedAt}.`
                : liveError
                  ? "Could not load live customers."
                  : "Loading customers from Trust Core…"}
          </strong>
          <small>
            {" "}
            {mode === "fixture"
              ? "Changes stay in this browser session and are not written to a server."
              : liveError
                ? liveError
                : "Saving storage changes from this screen is preview-only until live write actions are connected."}
          </small>
        </div>
      </div>

      {rollup && rollup.attentionTotal > 0 ? (
        <div className="status-notice error" role="alert">
          <ShieldAlert size={18} aria-hidden />
          <div>
            <strong>Some customer storage needs attention</strong>
            <small>
              {rollup.applications[0]
                ? `${rollup.applications[0].applicationName}: ${rollup.applications[0].attention} customer(s) need a fix before Trust Core can rely on their storage.`
                : null}
            </small>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="status-notice" role="status">
          <HardDrive size={18} aria-hidden />
          <div>
            <strong>{notice}</strong>
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
                          ? (demo.tenants[0]?.id ?? null)
                          : null,
                      );
                      setNotice("");
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
            <h2>App default storage</h2>
            <span
              className={statusClass(appEffective?.status ?? "not_configured")}
            >
              {humanStorageStatus(appEffective?.status ?? "not_configured")}
            </span>
          </div>
          <p className="muted">
            Used by every customer that does not have their own storage setup.
          </p>
          {appEffective ? (
            <StorageSummaryBlock summary={appEffective} />
          ) : (
            <p className="muted">
              No app default yet. Customers fall back to platform storage.{" "}
              <button
                type="button"
                className="text-button"
                onClick={onOpenStorage}
              >
                Open platform Storage
              </button>
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              className="button primary"
              disabled={Boolean(busy) || !appEffective}
              onClick={() => testConnection("app")}
            >
              {busy === "probe-app" ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                if (appEffective) {
                  setAppForm({
                    kind: "trust",
                    region: appEffective.region ?? "ap-southeast-2",
                    bucket: appEffective.bucket ?? "",
                    prefix: appEffective.prefix ?? "",
                    capacityTb: "",
                  });
                } else {
                  setAppForm(emptyTrustForm());
                }
                setShowAppStorageForm((value) => !value);
              }}
            >
              {showAppStorageForm ? "Hide setup" : "Edit app storage"}
            </button>
            <button type="button" className="button" onClick={onOpenStorage}>
              Platform Storage
            </button>
            <button
              type="button"
              className="button"
              onClick={() => onOpenPortability()}
            >
              Open Portability
            </button>
          </div>
          {appEffective?.binding?.id ? (
            <div className="button-row">
              <CopyIdChip label="Storage setup" id={appEffective.binding.id} />
            </div>
          ) : null}
          {showAppStorageForm ? (
            <form className="card soft stack" onSubmit={saveAppStorage}>
              <h3>Edit app default storage</h3>
              <p className="muted">
                Trust-managed storage for this app. Bucket details are stored on
                the server; this preview updates the sample data only.
              </p>
              <label className="field-label">
                Region
                <input
                  value={appForm.region}
                  onChange={(event) =>
                    setAppForm((current) => ({
                      ...current,
                      region: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-label">
                Bucket name
                <input
                  value={appForm.bucket}
                  onChange={(event) =>
                    setAppForm((current) => ({
                      ...current,
                      bucket: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-label">
                Folder prefix (optional)
                <input
                  value={appForm.prefix}
                  onChange={(event) =>
                    setAppForm((current) => ({
                      ...current,
                      prefix: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="button-row">
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy === "app-storage"}
                >
                  Save app storage
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>

      <div className="card panel">
        <div className="panel-heading">
          <h2>Customers</h2>
          <button
            type="button"
            className="button"
            onClick={() => {
              setShowAddCustomer((value) => !value);
              setNotice("");
            }}
          >
            <Plus size={16} aria-hidden />{" "}
            {showAddCustomer ? "Hide" : "Add customer"}
          </button>
        </div>
        {showAddCustomer ? (
          <form className="card soft stack" onSubmit={addCustomer}>
            <h3>Add customer</h3>
            <label className="field-label">
              Customer key
              <input
                value={newCustomerKey}
                onChange={(event) => setNewCustomerKey(event.target.value)}
                placeholder="e.g. acme"
              />
            </label>
            <label className="field-label">
              Display name
              <input
                value={newCustomerName}
                onChange={(event) => setNewCustomerName(event.target.value)}
                placeholder="e.g. Acme School"
              />
            </label>
            <div className="button-row">
              <button type="submit" className="button primary">
                Add customer
              </button>
            </div>
          </form>
        ) : null}
        {tenants.length === 0 ? (
          <p className="muted">
            No customers yet for this app. Add a customer to assign storage.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Storage</th>
                <th>Where files live</th>
                <th>Setup</th>
                <th>Status</th>
                <th>Capacity</th>
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
                        onClick={() => {
                          setSelectedTenantId(tenant.id);
                          setShowTenantStorageForm(false);
                          setNotice("");
                        }}
                      >
                        {tenant.displayName}
                      </button>
                      <div>
                        <small>{tenant.externalTenantKey}</small>
                      </div>
                    </td>
                    <td>{humanTier(eff?.tier)}</td>
                    <td>
                      {humanProvider(eff?.provider)}
                      {eff?.region ? ` · ${eff.region}` : ""}
                    </td>
                    <td>{humanInheritance(eff?.inheritedFrom)}</td>
                    <td>
                      <span
                        className={statusClass(eff?.status ?? "not_configured")}
                      >
                        {humanStorageStatus(eff?.status ?? "not_configured")}
                      </span>
                    </td>
                    <td>{humanPlanSync(eff?.planSyncState)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {tenantEffective && selectedTenant ? (
        <div className="card panel">
          <div className="panel-heading">
            <h2>{selectedTenant.displayName}</h2>
            <span className={statusClass(tenantEffective.status)}>
              {humanStorageStatus(tenantEffective.status)}
            </span>
          </div>
          <p className="muted">
            {tenantEffective.inheritedFrom === "none"
              ? "This customer uses their own storage."
              : "This customer uses the app default storage."}
          </p>
          <StorageSummaryBlock summary={tenantEffective} />
          {tenantEffective.planSyncState === "upgrade_recognised" ? (
            <p className="readiness-remediation">
              The customer appears to have more capacity than Trust Core has on
              file ({formatBytes(tenantEffective.declaredCapacityBytes)} →{" "}
              {formatBytes(tenantEffective.observedQuotaBytes)}). Confirm with
              the customer, then accept the new capacity.
            </p>
          ) : null}
          {tenantEffective.status === "needs_attention" ? (
            <p className="readiness-remediation">
              {bindingAttentionMessage(tenantEffective)}
            </p>
          ) : null}
          <div className="button-row">
            <button
              type="button"
              className="button primary"
              disabled={
                Boolean(busy) || tenantEffective.inheritedFrom !== "none"
              }
              title={
                tenantEffective.inheritedFrom !== "none"
                  ? "Set up customer storage before testing"
                  : undefined
              }
              onClick={() => testConnection("tenant")}
            >
              {busy === "probe-tenant" ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              className="button"
              onClick={openTenantStorageEditor}
            >
              {showTenantStorageForm ? "Hide storage setup" : "Set up storage"}
            </button>
            {tenantEffective.planSyncState === "upgrade_recognised" ? (
              <button
                type="button"
                className="button"
                onClick={acceptCapacityChange}
              >
                Accept capacity change
              </button>
            ) : null}
            {tenantEffective.inheritedFrom === "none" &&
            tenantEffective.status !== "disabled" ? (
              <button
                type="button"
                className="button"
                onClick={pauseCustomerStorage}
              >
                Pause storage
              </button>
            ) : null}
          </div>
          {tenantEffective.binding?.id ? (
            <div className="button-row">
              <CopyIdChip
                label="Customer"
                id={selectedTenant.externalTenantKey}
              />
              <CopyIdChip
                label="Storage setup"
                id={tenantEffective.binding.id}
              />
            </div>
          ) : null}
          {showTenantStorageForm ? (
            <form className="card soft stack" onSubmit={saveTenantStorage}>
              <h3>Set up storage for {selectedTenant.displayName}</h3>
              <fieldset className="capability-fieldset">
                <legend>Where should files live?</legend>
                <label className="capability-option">
                  <input
                    type="radio"
                    name="tenant-storage-kind"
                    checked={tenantForm.kind === "trust"}
                    onChange={() =>
                      setTenantForm((current) => ({
                        ...current,
                        kind: "trust",
                      }))
                    }
                  />
                  Use app default (Trust-managed)
                </label>
                <label className="capability-option">
                  <input
                    type="radio"
                    name="tenant-storage-kind"
                    checked={tenantForm.kind === "customer"}
                    onChange={() =>
                      setTenantForm((current) => ({
                        ...current,
                        kind: "customer",
                      }))
                    }
                  />
                  Use a customer-provided bucket
                </label>
              </fieldset>
              {tenantForm.kind === "customer" ? (
                <>
                  <label className="field-label">
                    Region
                    <input
                      value={tenantForm.region}
                      onChange={(event) =>
                        setTenantForm((current) => ({
                          ...current,
                          region: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field-label">
                    Bucket name
                    <input
                      value={tenantForm.bucket}
                      onChange={(event) =>
                        setTenantForm((current) => ({
                          ...current,
                          bucket: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field-label">
                    Folder prefix (optional)
                    <input
                      value={tenantForm.prefix}
                      onChange={(event) =>
                        setTenantForm((current) => ({
                          ...current,
                          prefix: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field-label">
                    Declared capacity (TB)
                    <input
                      value={tenantForm.capacityTb}
                      onChange={(event) =>
                        setTenantForm((current) => ({
                          ...current,
                          capacityTb: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              ) : (
                <p className="muted">
                  This customer will inherit the app default storage until you
                  attach their own bucket.
                </p>
              )}
              <div className="button-row">
                <button type="submit" className="button primary">
                  Save storage setup
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function StorageSummaryBlock({
  summary,
}: {
  summary: EffectiveStorageSummary;
}) {
  return (
    <dl className="detail-list">
      <div>
        <dt>Setup</dt>
        <dd>{humanInheritance(summary.inheritedFrom)}</dd>
      </div>
      <div>
        <dt>Storage type</dt>
        <dd>{humanTier(summary.tier)}</dd>
      </div>
      <div>
        <dt>Provider</dt>
        <dd>{humanProvider(summary.provider)}</dd>
      </div>
      <div>
        <dt>Location</dt>
        <dd>
          {summary.region ?? "—"}
          {summary.bucket ? ` / ${summary.bucket}` : ""}
        </dd>
      </div>
      <div>
        <dt>Who pays</dt>
        <dd>{humanWhoPays(summary.costPosture)}</dd>
      </div>
      <div>
        <dt>Files catalogued</dt>
        <dd>
          {summary.usage.cataloguedObjects} · failed checks{" "}
          {summary.usage.failedVerificationObjects}
        </dd>
      </div>
      <div>
        <dt>Capacity</dt>
        <dd>
          declared {formatBytes(summary.declaredCapacityBytes)} · used{" "}
          {formatBytes(summary.observedUsageBytes)} · quota{" "}
          {formatBytes(summary.observedQuotaBytes)} ·{" "}
          {humanPlanSync(summary.planSyncState)}
        </dd>
      </div>
      <div>
        <dt>Last connection test</dt>
        <dd>
          {summary.binding?.lastProbeSummary ?? "Not tested yet"}
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
        <strong>Some customer storage needs attention</strong>
        <small>
          {rollup.applications[0]
            ? `${rollup.applications[0].applicationName}: ${rollup.applications[0].attention} customer(s) need a fix${
                issue?.externalTenantKey
                  ? ` (customer ${issue.externalTenantKey})`
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
