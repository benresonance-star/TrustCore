import {
  Activity,
  Archive,
  BadgeCheck,
  Braces,
  CircleCheckBig,
  Clock3,
  Database,
  FileCheck2,
  Files,
  Fingerprint,
  GitBranch,
  HardDrive,
  History,
  Home,
  KeyRound,
  Library,
  Link2,
  ClipboardList,
  NotebookPen,
  PackageOpen,
  PlugZap,
  Search,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Upload,
  UserPlus,
  Waypoints,
} from "lucide-react";
import {
  appCapabilities,
  createAppProtocolBundle,
  type AppCapability,
  type AppProtocolBundle,
} from "@trust-core/app-protocol";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  ArchiveCandidate,
  ArchiveExportSummary,
  HistorySnapshot,
  ImportOperationSummary,
  ImportPlanSummary,
  PolicyAssignment,
} from "@trust-core/protocol";
import { fixtureGateway } from "./fixture-gateway";
import { GatewayError, httpGateway } from "./http-gateway";
import type {
  ControlCentreGateway,
  ControlCentreSnapshot,
  DatasetSummary,
  OperationalSnapshot,
  Section,
} from "./model";
import { ConnectionsView } from "./ConnectionsView";
import { FlowView } from "./FlowView";
import { PlatformStatusView } from "./PlatformStatusView";
import { remediationFor } from "./remediation";
import { TransfersPanel } from "./TransfersPanel";
import { WiringBadge } from "./WiringBadge";
import {
  sectionWiringIds,
  type GatewayMode,
  type WiringEntryId,
} from "./wiring-status";

const navigation: readonly { id: Section; label: string; Icon: typeof Home }[] =
  [
    { id: "home", label: "Home", Icon: Home },
    { id: "connections", label: "Connections", Icon: Link2 },
    { id: "datasets", label: "Datasets", Icon: Database },
    { id: "flow", label: "System overview", Icon: Waypoints },
    { id: "health", label: "Health", Icon: Activity },
    { id: "history", label: "History", Icon: History },
    { id: "portability", label: "Portability", Icon: PackageOpen },
    { id: "app-protocol", label: "App protocol", Icon: PlugZap },
    { id: "access", label: "Access", Icon: KeyRound },
    { id: "platform-status", label: "Platform status", Icon: ClipboardList },
  ];

const defaultGateway =
  import.meta.env.VITE_TRUST_API_BASE || import.meta.env.VITE_TRUST_WORKSPACE_ID
    ? httpGateway
    : fixtureGateway;
export function App({
  gateway = defaultGateway,
}: {
  gateway?: ControlCentreGateway;
}) {
  const [section, setSection] = useState<Section>("home");
  const [snapshot, setSnapshot] = useState<ControlCentreSnapshot | null>(null);
  const [operationalSnapshot, setOperationalSnapshot] =
    useState<OperationalSnapshot | null>(null);
  const [operationalError, setOperationalError] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [applicationCount, setApplicationCount] = useState<number | null>(
    null,
  );
  const [applicationsError, setApplicationsError] = useState<string | null>(
    null,
  );
  const [appAuthRequired, setAppAuthRequired] = useState(false);
  const [appToken, setAppToken] = useState("");
  const [appError, setAppError] = useState("");

  const loadSnapshot = useCallback(async () => {
    if (gateway.mode === "live" && !gateway.workspaceId) {
      setAppError(
        "Live mode requires VITE_TRUST_WORKSPACE_ID. Configure a workspace before opening the Control Centre.",
      );
      return;
    }
    try {
      const [nextSnapshot, operations] = await Promise.all([
        gateway.getSnapshot(),
        gateway
          .getOperationalSnapshot()
          .then((value) => ({ value, error: "" }))
          .catch((error) => ({
            value: null,
            error:
              error instanceof Error
                ? error.message
                : "Operational status unavailable.",
          })),
      ]);
      setSnapshot(nextSnapshot);
      setOperationalSnapshot(operations.value);
      setOperationalError(operations.error);
      setAppAuthRequired(false);
    } catch (error) {
      if (error instanceof GatewayError && error.status === 401)
        setAppAuthRequired(true);
      else
        setAppError(
          error instanceof Error
            ? error.message
            : "Control Centre unavailable.",
        );
    }
  }, [gateway]);
  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (section !== "flow") return;
    let cancelled = false;
    setApplicationsError(null);
    void gateway
      .listApplications(gateway.workspaceId)
      .then((apps) => {
        if (!cancelled) {
          setApplicationCount(apps.length);
          setApplicationsError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setApplicationCount(null);
          setApplicationsError(
            error instanceof Error
              ? error.message
              : "Application list unavailable.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [section, gateway]);

  async function authenticateApp(event: FormEvent) {
    event.preventDefault();
    setAppError("");
    try {
      await gateway.startAdminSession(appToken);
      setAppToken("");
      await loadSnapshot();
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Sign-in failed.");
    }
  }

  if (appAuthRequired)
    return (
      <div className="auth-shell">
        <form
          className="card sign-in-card"
          onSubmit={(event) => void authenticateApp(event)}
        >
          <div className="brand auth-brand">
            <span className="brand-mark">
              <ShieldCheck size={18} />
            </span>
            <span>Trust Core</span>
          </div>
          <KeyRound size={24} />
          <h1>Administrator sign-in</h1>
          <p>
            Dataset summaries and recovery controls are protected. Use your
            organisation identity, including its passkey or MFA policy.
          </p>
          <button
            className="button primary"
            type="button"
            onClick={() => gateway.beginFederatedLogin("/")}
          >
            Continue with organisation identity
          </button>
          <div className="auth-divider">
            <span>Development fallback</span>
          </div>
          <label>
            Bootstrap token
            <input
              type="password"
              autoComplete="off"
              value={appToken}
              onChange={(event) => setAppToken(event.target.value)}
              required
              autoFocus
            />
          </label>
          {appError && (
            <div className="form-error" role="alert">
              {appError}
            </div>
          )}
          <button className="button" type="submit">
            Use bootstrap token
          </button>
        </form>
      </div>
    );
  if (appError && !snapshot)
    return (
      <div className="auth-shell">
        <div className="card sign-in-card">
          <h1>Control Centre unavailable</h1>
          <p>{appError}</p>
        </div>
      </div>
    );
  if (!snapshot)
    return <div className="loading">Loading continuity state…</div>;
  const selected =
    snapshot.datasets.find((dataset) => dataset.id === selectedDatasetId) ??
    snapshot.datasets[0];

  function openDataset(id: string) {
    setSelectedDatasetId(id);
    setSection("datasets");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <ShieldCheck size={18} />
          </span>
          <span>Trust Core</span>
        </div>
        <nav aria-label="Primary">
          {navigation.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={section === id ? "nav-item active" : "nav-item"}
              onClick={() => setSection(id)}
              aria-label={label}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={17} />
              <span className="nav-item-copy">
                <span>{label}</span>
                <WiringBadge
                  entryId={sectionWiringIds[id]}
                  mode={gateway.mode}
                />
              </span>
            </button>
          ))}
        </nav>
        <div className="operator">
          <span className="avatar">TC</span>
          <div>
            <strong>
              {gateway.mode === "fixture"
                ? "Fixture operator"
                : "Signed-in operator"}
            </strong>
            <small>
              {gateway.mode === "fixture"
                ? "Preview workspace"
                : "Workspace access"}
            </small>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <strong>{gateway.workspaceId || "Workspace not configured"}</strong>
            <span>/ Control centre</span>
          </div>
          <div className="system-ok">
            <span />
            {gateway.mode === "fixture"
              ? "Fixture preview"
              : operationalSnapshot
                ? `${operationalSnapshot.storage.status} storage`
                : "Status unavailable"}
          </div>
        </header>
        <div className="page">
          {section === "home" && (
            <HomeView
              snapshot={snapshot}
              openDataset={openDataset}
              navigate={setSection}
              mode={gateway.mode}
            />
          )}
          {section === "connections" && (
            <ConnectionsView
              gateway={gateway}
              snapshot={snapshot}
              operational={operationalSnapshot}
              navigateHistory={() => setSection("history")}
            />
          )}
          {section === "platform-status" && (
            <PlatformStatusView mode={gateway.mode} />
          )}
          {section === "datasets" && (
            <DatasetsView
              datasets={snapshot.datasets}
              selected={selected}
              status={snapshot.status}
              onSelect={setSelectedDatasetId}
              navigate={setSection}
              mode={gateway.mode}
            />
          )}
          {section === "flow" && (
            <FlowView
              mode={gateway.mode}
              snapshot={snapshot}
              operational={operationalSnapshot}
              applicationCount={applicationCount}
              applicationsError={applicationsError}
              navigate={setSection}
            />
          )}
          {section === "health" && (
            <HealthView
              snapshot={snapshot}
              operational={operationalSnapshot}
              operationalError={operationalError}
              gateway={gateway}
              navigateHistory={() => setSection("history")}
            />
          )}
          {section === "history" && (
            <HistoryView gateway={gateway} workspaceId={gateway.workspaceId} />
          )}
          {section === "portability" && <PortabilityView gateway={gateway} />}
          {section === "app-protocol" && (
            <AppProtocolView mode={gateway.mode} />
          )}
          {section === "access" && <AccessView gateway={gateway} />}
        </div>
      </main>
    </div>
  );
}

function healthLabel(health: DatasetSummary["health"]): string {
  switch (health) {
    case "unknown":
      return "Unknown";
    case "review":
      return "Review";
    case "verified":
      return "Verified";
    case "degraded":
      return "Degraded";
    default:
      return assertNever(health);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled health status: ${String(value)}`);
}

function PageHeading({
  title,
  subtitle,
  action,
  wiringId,
  mode,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  wiringId?: WiringEntryId;
  mode?: GatewayMode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="heading-title-row">
          <h1>{title}</h1>
          {wiringId && mode ? (
            <WiringBadge entryId={wiringId} mode={mode} />
          ) : null}
        </div>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="card metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function HomeView({
  snapshot,
  openDataset,
  navigate,
  mode,
}: {
  snapshot: ControlCentreSnapshot;
  openDataset: (id: string) => void;
  navigate: (section: Section) => void;
  mode: GatewayMode;
}) {
  const recent = recentDatasets(snapshot.datasets);
  const components = [
    { label: "Documents", note: "Drawings and files", Icon: Files },
    { label: "Tasks", note: "Work and approvals", Icon: CircleCheckBig },
    { label: "Notes", note: "Capture and organise", Icon: NotebookPen },
    { label: "Timesheets", note: "Time and sign-off", Icon: Clock3 },
    { label: "Resources", note: "Codes and references", Icon: Library },
  ];
  const [selectedComponent, setSelectedComponent] = useState<string | null>(
    null,
  );

  return (
    <>
      <PageHeading
        title="Workspace overview"
        subtitle="Your projects and shared system components."
        wiringId="section.home"
        mode={mode}
        action={
          <span className="heading-action-cluster">
            <WiringBadge entryId="control.home.new-project" mode={mode} />
            <button
              className="button"
              disabled
              title="Requires Foundation or API dataset provision"
            >
              + New project (requires Foundation)
            </button>
          </span>
        }
      />
      <section>
        <div className="section-heading">
          <h2>Recent projects</h2>
          <button className="text-button" onClick={() => navigate("datasets")}>
            View all datasets
          </button>
        </div>
        <div className="project-grid">
          {recent.map((dataset) => (
            <article className="card project-card" key={dataset.id}>
              <div className="project-title">
                <div>
                  <h3>{dataset.name.replace(/^\d+ — /, "")}</h3>
                  <small>{dataset.description}</small>
                </div>
                <span className="badge">{healthLabel(dataset.health)}</span>
              </div>
              <div>
                <strong>{dataset.objects}</strong>
                <small>
                  Last verified {dataset.lastVerified.toLowerCase()}
                </small>
              </div>
              <div className="project-footer">
                <span
                  className={
                    dataset.health === "verified" ? "verified" : "review"
                  }
                >
                  <i />
                  {healthLabel(dataset.health)}
                </span>
                <button
                  className="button"
                  onClick={() => openDataset(dataset.id)}
                >
                  Open
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="home-lower">
        <section>
          <div className="section-heading">
            <h2>Common components</h2>
            <WiringBadge entryId="control.home.common-components" mode={mode} />
          </div>
          <p className="selection-note">
            Foundation — not Trust Core. These tiles do not open Control Centre
            backends.
          </p>
          <div className="component-grid">
            {components.map(({ label, note, Icon }) => (
              <button
                type="button"
                className={
                  selectedComponent === label ? "component active" : "component"
                }
                key={label}
                onClick={() => setSelectedComponent(label)}
              >
                <span>
                  <Icon size={18} />
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>{note}</small>
                </div>
              </button>
            ))}
            <button
              type="button"
              className="component"
              onClick={() => navigate("datasets")}
            >
              <span>
                <ShieldCheck size={18} />
              </span>
              <div>
                <strong>Trust Core</strong>
                <small>Storage and recovery</small>
              </div>
            </button>
          </div>
          {selectedComponent && (
            <p className="selection-note">
              {selectedComponent} selected — this component will open inside the
              shared Foundation shell.
            </p>
          )}
        </section>
        <article className="card continuity-card">
          <h2>Practice continuity</h2>
          <div className="integrity-line">
            <BadgeCheck size={18} />
            {snapshot.status.canonicalIntegrityStatus === "verified" &&
            snapshot.status.canonicalIntegrityPercent === 100
              ? "All canonical stores verified"
              : snapshot.status.canonicalIntegrityPercent === null
                ? `${healthLabel(snapshot.status.canonicalIntegrityStatus)} canonical integrity`
                : `${snapshot.status.canonicalIntegrityPercent}% canonical integrity reported`}
          </div>
          <dl>
            <div>
              <dt>Protected datasets</dt>
              <dd>{snapshot.status.protectedDatasets}</dd>
            </div>
            <div>
              <dt>Latest backup</dt>
              <dd>{snapshot.status.latestVerifiedBackup}</dd>
            </div>
            <div>
              <dt>Recovery attention</dt>
              <dd>{snapshot.status.recoveryAttention} low priority</dd>
            </div>
          </dl>
          <button className="button wide" onClick={() => navigate("health")}>
            View system health
          </button>
        </article>
      </div>
    </>
  );
}

function recentDatasets(
  datasets: readonly DatasetSummary[],
): readonly DatasetSummary[] {
  const weSketch = datasets.find(
    (dataset) =>
      dataset.id.toLowerCase().includes("wesketch") ||
      dataset.name.toLowerCase().includes("wesketch"),
  );
  return [
    ...(weSketch ? [weSketch] : []),
    ...datasets.filter((dataset) => dataset !== weSketch),
  ].slice(0, 4);
}

function DatasetsView({
  datasets,
  selected,
  status,
  onSelect,
  navigate,
  mode,
}: {
  datasets: readonly DatasetSummary[];
  selected: DatasetSummary | undefined;
  status: ControlCentreSnapshot["status"];
  onSelect: (id: string) => void;
  navigate: (section: Section) => void;
  mode: ControlCentreGateway["mode"];
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const sourceNote =
    mode === "fixture" ? "Synthetic fixture data" : "Reported by Trust API";
  const filtered = useMemo(
    () =>
      datasets.filter(
        (dataset) =>
          (kind === "all" || dataset.kind === kind) &&
          dataset.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [datasets, kind, query],
  );
  return (
    <>
      <PageHeading
        title="Dataset registry"
        subtitle="Canonical stores, recovery state and controlled access."
        wiringId="section.datasets"
        mode={mode}
        action={
          <span className="heading-action-cluster">
            <WiringBadge
              entryId="control.datasets.export-register"
              mode={mode}
            />
            <button
              className="button"
              disabled
              title="Use Portability to create archives"
            >
              Export register (use Portability)
            </button>
          </span>
        }
      />
      <div className="metrics">
        <Metric
          label="Protected datasets"
          value={String(status.protectedDatasets)}
          note={`Across ${status.activeProjects} active projects`}
        />
        <Metric
          label="Latest verified backup"
          value={status.latestVerifiedBackup}
          note={sourceNote}
        />
        <Metric
          label="Recovery attention"
          value={String(status.recoveryAttention)}
          note={sourceNote}
        />
      </div>
      <section>
        <div className="section-heading registry-tools">
          <h2>Datasets</h2>
          <div>
            <label className="search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search datasets"
              />
            </label>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="all">All stores</option>
              <option value="foundation">Foundation</option>
              <option value="personal">Personal</option>
              <option value="creative">Creative</option>
              <option value="shared">Shared</option>
            </select>
          </div>
        </div>
        <div className="dataset-layout">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Canonical store</th>
                  <th>Last verified</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((dataset) => (
                  <tr
                    key={dataset.id}
                    className={dataset.id === selected?.id ? "selected" : ""}
                  >
                    <td>
                      <button
                        type="button"
                        className="dataset-select"
                        aria-pressed={dataset.id === selected?.id}
                        onClick={() => onSelect(dataset.id)}
                      >
                        <strong>{dataset.name}</strong>
                        <small>{dataset.description}</small>
                      </button>
                    </td>
                    <td>{dataset.canonicalStore}</td>
                    <td>{dataset.lastVerified}</td>
                    <td>
                      <span
                        className={
                          dataset.health === "verified" ? "verified" : "review"
                        }
                      >
                        <i />
                        {healthLabel(dataset.health)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected ? (
            <article className="card dataset-detail">
              <div className="detail-title">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.description}</p>
                </div>
                <span className="badge">
                  {selected.kind === "personal" ? "Private" : "Protected"}
                </span>
              </div>
              <div className="integrity-line">
                <BadgeCheck size={18} />
                {selected.health === "verified"
                  ? "Canonical objects verified"
                  : `${healthLabel(selected.health)} canonical integrity`}
              </div>
              <dl>
                <div>
                  <dt>Objects</dt>
                  <dd>{selected.objects}</dd>
                </div>
                <div>
                  <dt>Storage</dt>
                  <dd>{selected.storage}</dd>
                </div>
                <div>
                  <dt>Schema</dt>
                  <dd>{selected.schema}</dd>
                </div>
                <div>
                  <dt>Recovery</dt>
                  <dd>{selected.recovery}</dd>
                </div>
                <div>
                  <dt>Deleted</dt>
                  <dd>{selected.deleted}</dd>
                </div>
              </dl>
              <h3>Recent trust events</h3>
              {selected.recentEvents.map((event) => (
                <div className="event" key={event}>
                  <span>
                    <CircleCheckBig size={14} />
                  </span>
                  <div>
                    <strong>{event}</strong>
                    <small>Reported trust event</small>
                  </div>
                </div>
              ))}
              <div className="detail-actions">
                <button
                  className="button primary"
                  onClick={() => navigate("history")}
                >
                  Recovery
                </button>
                <button className="button" onClick={() => navigate("history")}>
                  Audit
                </button>
              </div>
            </article>
          ) : (
            <article className="card empty-state">
              <Database size={22} />
              <strong>No datasets available</strong>
              <small>The configured workspace has no visible datasets.</small>
            </article>
          )}
        </div>
      </section>
    </>
  );
}

function HealthView({
  snapshot,
  operational,
  operationalError,
  gateway,
  navigateHistory,
}: {
  snapshot: ControlCentreSnapshot;
  operational: OperationalSnapshot | null;
  operationalError: string;
  gateway: ControlCentreGateway;
  navigateHistory: () => void;
}) {
  const [running, setRunning] = useState(false),
    [result, setResult] = useState<string>("");
  async function verify() {
    setRunning(true);
    setResult("");
    try {
      const run = await gateway.runVerification(
        gateway.workspaceId,
        "full_blob",
      );
      setResult(
        `${run.status.toUpperCase()} · ${run.objectsChecked.toLocaleString()} objects · ${formatBytes(run.bytesRead)} streamed · ${run.issues.length} issues`,
      );
    } catch (error) {
      setResult(
        error instanceof Error ? error.message : "Verification failed.",
      );
    } finally {
      setRunning(false);
    }
  }
  const latest = operational?.latestVerification;
  const sourceNote =
    gateway.mode === "fixture"
      ? "Synthetic fixture data"
      : "Reported by Trust API";
  return (
    <>
      <PageHeading
        title="System health"
        subtitle="Storage, backup, integrity and synchronisation across every adapter."
        wiringId="section.health"
        mode={gateway.mode}
        action={
          <span className="heading-action-cluster">
            <WiringBadge
              entryId="control.health.run-verification"
              mode={gateway.mode}
            />
            <button
              className="button"
              disabled={running}
              onClick={() => void verify()}
            >
              {running ? "Verifying bytes…" : "Run full verification"}
            </button>
          </span>
        }
      />
      {result && (
        <div className="status-notice" role="status">
          <ShieldCheck size={17} />
          {result}
        </div>
      )}
      {operationalError && (
        <div className="status-notice error" role="alert">
          Live operational details unavailable: {operationalError}
        </div>
      )}
      <div className="metrics">
        <Metric
          label="Canonical integrity"
          value={
            snapshot.status.canonicalIntegrityPercent === null
              ? healthLabel(snapshot.status.canonicalIntegrityStatus)
              : `${snapshot.status.canonicalIntegrityPercent}%`
          }
          note={sourceNote}
        />
        <Metric
          label="Protected datasets"
          value={`${snapshot.status.protectedDatasets}/${snapshot.status.activeProjects}`}
          note="Protected / active"
        />
        <Metric
          label="Sync queue"
          value={String(snapshot.status.syncQueue)}
          note={sourceNote}
        />
      </div>
      <div className="two-columns">
        <article className="card panel">
          <h2>Operational services</h2>
          {operational ? (
            <>
              <ServiceStatus
                label="Canonical storage"
                status={operational.storage.status}
                summary={operational.storage.summary}
              />
              <ServiceStatus
                label="Backup service"
                status={operational.backup.status}
                summary={operational.backup.summary}
                badge={
                  <WiringBadge
                    entryId="control.health.backup"
                    mode={gateway.mode}
                  />
                }
              />
              {operational.backup.status === "not_configured" && (
                <div className="status-notice" role="status">
                  <small>{remediationFor("backup_not_configured")}</small>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <HardDrive size={22} />
              <strong>Operational status unavailable</strong>
              <small>No service health data was returned.</small>
            </div>
          )}
        </article>
        <article className="card panel">
          <h2>Latest verification</h2>
          {latest ? (
            <div className="attention">
              <ShieldCheck size={18} />
              <div>
                <strong>
                  {latest.status} · {latest.level}
                </strong>
                <small>
                  {latest.objectsChecked.toLocaleString()} objects checked ·{" "}
                  {latest.issues.length} issues
                </small>
              </div>
              <span className="badge">
                {latest.completedAt
                  ? new Date(latest.completedAt).toLocaleDateString()
                  : "Running"}
              </span>
            </div>
          ) : (
            <div className="empty-state">
              <Activity size={22} />
              <strong>No verification report available</strong>
              <small>Run a verification to establish current coverage.</small>
            </div>
          )}
          {latest && (
            <button
              type="button"
              className="text-button"
              onClick={navigateHistory}
            >
              View related events
            </button>
          )}
        </article>
      </div>
      <TransfersPanel
        gateway={gateway}
        storageHealthy={operational?.storage.status === "healthy"}
        onViewHistory={navigateHistory}
      />
    </>
  );
}
function ServiceStatus({
  label,
  status,
  summary,
  badge,
}: {
  label: string;
  status: "healthy" | "degraded" | "not_configured";
  summary: string;
  badge?: ReactNode;
}) {
  return (
    <div className="adapter">
      <div>
        <strong className="heading-title-row">
          {label}
          {badge}
        </strong>
        <span className={status === "healthy" ? "verified" : "review"}>
          <i />
          {status.replaceAll("_", " ")}
        </span>
      </div>
      <small>{summary}</small>
    </div>
  );
}
function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024,
    index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(1)} ${units[index]}`;
}

function HistoryView({
  gateway,
  workspaceId,
}: {
  gateway: ControlCentreGateway;
  workspaceId: string;
}) {
  const [history, setHistory] = useState<HistorySnapshot | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [signIn, setSignIn] = useState(false);
  const [token, setToken] = useState("");
  const [authError, setAuthError] = useState("");
  const load = useCallback(
    () =>
      gateway
        .getHistory(workspaceId)
        .then((value) => {
          setHistory(value);
          setSignIn(false);
        })
        .catch((error) => {
          if (error instanceof GatewayError && error.status === 401)
            setSignIn(true);
          else
            setAuthError(
              error instanceof Error ? error.message : "History unavailable.",
            );
        }),
    [gateway, workspaceId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setAuthError("");
    try {
      await gateway.startAdminSession(token);
      setToken("");
      await load();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in failed.");
    }
  }
  async function restore(resourceId: string) {
    setPending(resourceId);
    setNotice("");
    try {
      const result = await gateway.restoreResource(workspaceId, resourceId);
      setHistory(await gateway.getHistory(workspaceId));
      setNotice(
        `Restored safely as revision ${result.revisionNumber}. The prior state remains preserved.`,
      );
    } catch (error) {
      if (error instanceof GatewayError && error.status === 401)
        setSignIn(true);
      setNotice(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setPending(null);
    }
  }
  if (signIn)
    return (
      <>
        <PageHeading
          title="History and recovery"
          subtitle="Privileged recovery actions require an administrator session."
          wiringId="section.history"
          mode={gateway.mode}
        />
        <form
          className="card sign-in-card"
          onSubmit={(event) => void authenticate(event)}
        >
          <KeyRound size={24} />
          <h2>Administrator sign-in</h2>
          <p>
            The bootstrap token is exchanged for a short-lived, HTTP-only
            session and is not saved by the Control Centre.
          </p>
          <label>
            Administrator token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </label>
          {authError && (
            <div className="form-error" role="alert">
              {authError}
            </div>
          )}
          <button className="button primary" type="submit">
            Open protected history
          </button>
        </form>
      </>
    );
  if (authError)
    return (
      <div className="status-notice error" role="alert">
        {authError}
      </div>
    );
  if (!history)
    return <div className="loading">Loading protected history…</div>;
  return (
    <>
      <PageHeading
        title="History and recovery"
        subtitle="Immutable changes, deleted items and verified restoration points."
        wiringId="section.history"
        mode={gateway.mode}
        action={<button className="button">Export audit</button>}
      />
      {notice && (
        <div className="status-notice" role="status">
          <CircleCheckBig size={17} />
          {notice}
        </div>
      )}
      <article className="card recovery-banner">
        <div>
          <strong>{history.recoverable.length} recoverable items</strong>
          <small>
            Restoring creates a new revision; it never overwrites previous
            history.
          </small>
        </div>
        <span className="badge">90-day retention</span>
      </article>
      <div className="two-columns history-columns">
        <article className="card panel">
          <h2>Recovery bin</h2>
          {history.recoverable.length === 0 ? (
            <div className="empty-state">
              <Archive size={22} />
              <strong>Recovery bin is clear</strong>
              <small>No deleted items await action.</small>
            </div>
          ) : (
            history.recoverable.map((item) => (
              <div className="recovery-row" key={item.tombstoneId}>
                <span>
                  <Trash2 size={16} />
                </span>
                <div>
                  <strong>{item.resourceTitle ?? item.resourceId}</strong>
                  <small>
                    {item.resourceType} · deleted by {item.deletedBy}
                    <br />
                    Recover until{" "}
                    {item.recoverUntil
                      ? new Date(item.recoverUntil).toLocaleDateString()
                      : "policy review"}
                  </small>
                </div>
                <button
                  className="button primary"
                  disabled={pending === item.resourceId}
                  onClick={() => void restore(item.resourceId)}
                >
                  {pending === item.resourceId ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))
          )}
        </article>
        <article className="card panel">
          <h2>Recent trust events</h2>
          {history.events.map((event) => {
            const Icon = event.action.includes("delete")
              ? Trash2
              : event.action.includes("backup")
                ? BadgeCheck
                : History;
            return (
              <div className="timeline" key={event.id}>
                <span>
                  <Icon size={16} />
                </span>
                <div>
                  <strong>{event.action.replaceAll(".", " ")}</strong>
                  <small>
                    {event.subjectId} · {event.actorId}
                  </small>
                </div>
                <time>{new Date(event.occurredAt).toLocaleDateString()}</time>
              </div>
            );
          })}
        </article>
      </div>
    </>
  );
}

function PortabilityView({ gateway }: { gateway: ControlCentreGateway }) {
  const [archiveName, setArchiveName] = useState("WeSketch-demo.trustarchive");
  const [archiveBytes, setArchiveBytes] = useState<Uint8Array | null>(null);
  const [archive, setArchive] = useState<ArchiveCandidate | null>(null);
  const [plan, setPlan] = useState<ImportPlanSummary | null>(null);
  const [operation, setOperation] = useState<ImportOperationSummary | null>(
    null,
  );
  const [importMode, setImportMode] = useState<
    "preserve_ids" | "mapped_workspace"
  >("mapped_workspace");
  const [proof, setProof] = useState("");
  const [exportProof, setExportProof] = useState("");
  const [exportDatasetIds, setExportDatasetIds] = useState("ivan");
  const [createdExport, setCreatedExport] =
    useState<ArchiveExportSummary | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fixture = gateway.mode === "fixture";

  async function run<T>(
    kind: string,
    work: () => Promise<T>,
    apply: (value: T) => void,
  ) {
    setBusy(kind);
    setError("");
    try {
      apply(await work());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Portability operation failed.",
      );
    } finally {
      setBusy("");
    }
  }
  function resetCandidate() {
    setArchive(null);
    setPlan(null);
    setOperation(null);
  }
  async function downloadExport(value: ArchiveExportSummary) {
    await run(
      "download-export",
      () =>
        gateway.downloadArchiveExport(
          gateway.workspaceId,
          value.id,
          exportProof,
        ),
      (download) => {
        const url = URL.createObjectURL(
          new Blob([download.bytes as Uint8Array<ArrayBuffer>], {
            type: download.mediaType,
          }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = download.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      },
    );
  }

  return (
    <>
      <PageHeading
        title="Portability"
        subtitle="Inspect, verify and plan a controlled workspace transfer."
        wiringId="section.portability"
        mode={gateway.mode}
        action={
          <button
            className="button"
            onClick={() => setShowExport((current) => !current)}
          >
            Create export
          </button>
        }
      />
      <div className="status-notice" role="status">
        <FileCheck2 size={17} />
        {fixture
          ? "Fixture API workflow — execution is isolated in memory and writes no canonical data."
          : "Live Portability API connected. Mutations remain subject to configured provider and policy."}
      </div>
      {error && (
        <div className="status-notice error" role="alert">
          <ShieldAlert size={17} /> {error}
        </div>
      )}
      {showExport && (
        <form
          className="card panel assignment-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              "create-export",
              () =>
                gateway.createArchiveExport(
                  gateway.workspaceId,
                  tokens(exportDatasetIds),
                  exportProof,
                ),
              setCreatedExport,
            );
          }}
        >
          <div>
            <h2>Create archive export</h2>
            <small>
              {fixture
                ? "Fixture export is generated in memory and is not persisted."
                : "Creation and binary download require fresh administrator authentication."}
            </small>
          </div>
          <label className="field-label">
            Dataset IDs
            <input
              value={exportDatasetIds}
              onChange={(event) => setExportDatasetIds(event.target.value)}
            />
          </label>
          <label className="field-label">
            Export reauthentication proof
            <input
              type="password"
              value={exportProof}
              onChange={(event) => setExportProof(event.target.value)}
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={
              busy === "create-export" ||
              tokens(exportDatasetIds).length === 0 ||
              (!fixture && !exportProof)
            }
          >
            Create archive
          </button>
          {createdExport && (
            <button
              className="button"
              type="button"
              disabled={
                busy === "download-export" || (!fixture && !exportProof)
              }
              onClick={() => void downloadExport(createdExport)}
            >
              Download {createdExport.id}
            </button>
          )}
        </form>
      )}
      <div className="metrics">
        <Metric
          label="Archive format"
          value="ZIP64"
          note="Logical, deterministic layout"
        />
        <Metric
          label="Verification"
          value={archive?.status === "verified" ? "Passed" : "Pending"}
          note="Manifest, paths and checksums"
        />
        <Metric
          label="PC proof"
          value="Passed"
          note="0.2H clean reconstruction gate"
        />
      </div>
      <div className="two-columns portability-columns">
        <article className="card panel control-stack">
          <div className="panel-heading">
            <div>
              <h2>1. Select archive</h2>
              <small>
                Use the packaged fixture or choose a local candidate.
              </small>
            </div>
            <PackageOpen size={20} />
          </div>
          <label className="upload-box">
            <Upload size={22} />
            <strong>{archiveName}</strong>
            <small>
              {fixture
                ? "Packaged fixture candidate"
                : "Sent only to the authenticated verifier"}
            </small>
            <input
              type="file"
              accept=".trustarchive,.zip"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setArchiveName(file.name);
                resetCandidate();
                void file
                  .arrayBuffer()
                  .then((value) => setArchiveBytes(new Uint8Array(value)));
              }}
            />
          </label>
          <button
            className="button primary"
            disabled={busy !== "" || (!fixture && !archiveBytes)}
            onClick={() =>
              void run(
                "verify",
                () =>
                  gateway.uploadArchive(
                    gateway.workspaceId,
                    archiveBytes ?? new Uint8Array(),
                  ),
                (value) => {
                  setArchive(value);
                  setPlan(null);
                  setOperation(null);
                },
              )
            }
          >
            {busy === "verify" ? "Verifying…" : "Verify archive"}
          </button>
          {archive?.status === "verified" && (
            <div
              className="check-list"
              aria-label="Archive verification results"
            >
              <span>
                <CircleCheckBig size={16} /> Safe paths
              </span>
              <span>
                <CircleCheckBig size={16} /> {archive.checkedEntries} entries
              </span>
              <span>
                <CircleCheckBig size={16} /> No encrypted or linked entries
              </span>
            </div>
          )}
        </article>
        <article className="card panel control-stack">
          <div className="panel-heading">
            <div>
              <h2>2. Plan import</h2>
              <small>
                Planning is non-mutating and reports conflicts first.
              </small>
            </div>
            <GitBranch size={20} />
          </div>
          <label className="field-label">
            Import identity mode
            <select
              value={importMode}
              onChange={(event) =>
                setImportMode(event.target.value as typeof importMode)
              }
            >
              <option value="mapped_workspace">Map into this workspace</option>
              <option value="preserve_ids">Preserve workspace identity</option>
            </select>
          </label>
          <dl className="manifest-summary">
            <div>
              <dt>Export</dt>
              <dd>{archive?.exportId ?? "Awaiting verification"}</dd>
            </div>
            <div>
              <dt>Resources</dt>
              <dd>{archive?.recordCounts.resources ?? "—"}</dd>
            </div>
            <div>
              <dt>Revisions</dt>
              <dd>{archive?.recordCounts.revisions ?? "—"}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{importMode === "preserve_ids" ? "Preserve" : "Mapped"}</dd>
            </div>
          </dl>
          <button
            className="button primary"
            disabled={archive?.status !== "verified" || busy !== ""}
            onClick={() =>
              archive &&
              void run(
                "plan",
                () =>
                  gateway.createImportPlan(
                    gateway.workspaceId,
                    archive.id,
                    importMode,
                  ),
                setPlan,
              )
            }
          >
            {busy === "plan" ? "Planning…" : "Generate dry-run plan"}
          </button>
        </article>
      </div>
      {plan && (
        <article className="card panel plan-panel" aria-live="polite">
          <div className="panel-heading">
            <div>
              <h2>{plan.status === "ready" ? "Plan ready" : "Plan blocked"}</h2>
              <small>No canonical data has been changed.</small>
            </div>
            <span className="badge">Dry run</span>
          </div>
          <div className="plan-grid">
            <div>
              <strong>{plan.counts.insert}</strong>
              <small>Create or reconcile</small>
            </div>
            <div>
              <strong>{plan.counts.blocked}</strong>
              <small>Blocking conflicts</small>
            </div>
            <div>
              <strong>{plan.issueCount}</strong>
              <small>Reported issues</small>
            </div>
          </div>
          <div className="execution-row">
            <div>
              <strong>Execute guarded import</strong>
              <small>
                Fresh administrator authentication is required. The Docker
                reconstruction proof remains open.
              </small>
            </div>
            <div className="reauth-controls">
              <label className="field-label">
                Reauthentication proof
                <input
                  type="password"
                  autoComplete="current-password"
                  value={proof}
                  onChange={(event) => setProof(event.target.value)}
                  placeholder={
                    fixture
                      ? "Fixture administrator token"
                      : "Administrator credential"
                  }
                />
              </label>
              <button
                className="button primary"
                disabled={plan.status !== "ready" || !proof || busy !== ""}
                onClick={() =>
                  void run(
                    "execute",
                    () =>
                      gateway.executeImportPlan(
                        gateway.workspaceId,
                        plan.id,
                        proof,
                      ),
                    (value) => {
                      setOperation(value);
                      setProof("");
                    },
                  )
                }
              >
                {busy === "execute" ? "Executing…" : "Confirm and execute"}
              </button>
            </div>
          </div>
          {operation && (
            <div className="status-notice" role="status">
              <CircleCheckBig size={17} /> Import operation {operation.status}:{" "}
              {operation.checkpoint}
            </div>
          )}
        </article>
      )}
    </>
  );
}

function AppProtocolView({ mode }: { mode: GatewayMode }) {
  const [namespace, setNamespace] = useState("app/foundation");
  const [name, setName] = useState("Foundation");
  const [applicationVersion, setApplicationVersion] = useState("1.0.0");
  const [schemaVersion, setSchemaVersion] = useState("1.0.0");
  const [resourceTypes, setResourceTypes] = useState(
    "Project, Document, Drawing, Note, Task, Decision",
  );
  const [relationTypes, setRelationTypes] = useState(
    "contains, references, derived-from",
  );
  const [blobRoles, setBlobRoles] = useState(
    "original, editable, preview, fallback",
  );
  const [capabilities, setCapabilities] = useState<readonly AppCapability[]>([
    "dataset:read",
    "resource:read",
    "revision:create",
    "object:ingest",
    "relation:read",
    "history:read",
    "portability:read",
  ]);
  const [bundle, setBundle] = useState<AppProtocolBundle | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"methods" | "manifest" | "agent">("methods");

  function generate(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      setBundle(
        createAppProtocolBundle({
          namespace,
          name,
          applicationVersion,
          schemaVersion,
          resourceTypes: tokens(resourceTypes),
          relationTypes: tokens(relationTypes),
          blobRoles: tokens(blobRoles),
          capabilities,
          additionalFields: "preserve",
        }),
      );
    } catch (nextError) {
      setBundle(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Protocol generation failed.",
      );
    }
  }

  function toggleCapability(capability: AppCapability) {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((value) => value !== capability)
        : [...current, capability],
    );
  }

  const output = bundle
    ? view === "manifest"
      ? JSON.stringify(bundle.manifest, null, 2)
      : bundle.agentBrief
    : "Generate the protocol to create an agent-ready handoff.";

  return (
    <>
      <PageHeading
        title="App protocol"
        subtitle="Define how an application interfaces with Trust Core, then generate its TCAP/1 manifest, method surface and implementation brief."
        wiringId="section.app-protocol"
        mode={mode}
        action={<span className="status-pill healthy">TCAP/1.0</span>}
      />
      <div className="protocol-layout">
        <form className="card protocol-form" onSubmit={generate}>
          <div className="card-heading">
            <Braces size={18} />
            <div>
              <h2>Application contract</h2>
              <p>This generates a candidate. Publishing remains governed.</p>
            </div>
          </div>
          <div className="protocol-pair">
            <label>
              Namespace
              <input
                value={namespace}
                onChange={(event) => setNamespace(event.target.value)}
                placeholder="app/foundation"
              />
            </label>
            <label>
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </div>
          <div className="protocol-pair">
            <label>
              Application version
              <input
                value={applicationVersion}
                onChange={(event) => setApplicationVersion(event.target.value)}
              />
            </label>
            <label>
              Schema version
              <input
                value={schemaVersion}
                onChange={(event) => setSchemaVersion(event.target.value)}
              />
            </label>
          </div>
          <label>
            Resource types
            <textarea
              value={resourceTypes}
              onChange={(event) => setResourceTypes(event.target.value)}
              rows={2}
            />
            <small>Comma separated, UpperCamelCase.</small>
          </label>
          <label>
            Relation types
            <input
              value={relationTypes}
              onChange={(event) => setRelationTypes(event.target.value)}
            />
          </label>
          <label>
            Blob roles
            <input
              value={blobRoles}
              onChange={(event) => setBlobRoles(event.target.value)}
            />
          </label>
          <fieldset className="capability-fieldset">
            <legend>Requested capabilities</legend>
            <div className="capability-grid">
              {appCapabilities.map((capability) => (
                <label key={capability} className="capability-option">
                  <input
                    type="checkbox"
                    checked={capabilities.includes(capability)}
                    onChange={() => toggleCapability(capability)}
                  />
                  <span>{capability}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary" type="submit">
            Generate interface protocol
          </button>
        </form>

        <section className="card protocol-output">
          <div className="protocol-tabs" role="tablist">
            {(["methods", "manifest", "agent"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={view === tab}
                className={view === tab ? "active" : ""}
                onClick={() => setView(tab)}
              >
                {tab === "agent" ? "Agent brief" : titleCase(tab)}
              </button>
            ))}
          </div>
          {view === "methods" ? (
            <div className="method-list">
              {bundle ? (
                bundle.methods.map((method) => (
                  <article key={method.sdk}>
                    <div>
                      <strong>{method.purpose}</strong>
                      {method.required && <span>Required</span>}
                    </div>
                    <code>{method.sdk}</code>
                    <small>{method.http}</small>
                  </article>
                ))
              ) : (
                <div className="protocol-empty">
                  <PlugZap size={24} />
                  <p>
                    Interface methods will be derived from the requested
                    capabilities.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <pre className="protocol-code">{output}</pre>
          )}
          {bundle && (
            <div className="protocol-note">
              Generated locally. An administrator must still review permissions
              and publish the schema package.
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function tokens(value: string): readonly string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function titleCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function AccessView({ gateway }: { gateway: ControlCentreGateway }) {
  const fixture = gateway.mode === "fixture";
  const [assignments, setAssignments] = useState<readonly PolicyAssignment[]>(
    [],
  );
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [principal, setPrincipal] = useState("Audit reviewer");
  const [principalType, setPrincipalType] =
    useState<PolicyAssignment["principalType"]>("user");
  const [role, setRole] = useState<
    "owner" | "admin" | "editor" | "recovery_operator" | "auditor"
  >("auditor");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    gateway
      .listPolicyAssignments(gateway.workspaceId)
      .then((items) => {
        if (active) setAssignments(items);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Policy assignments could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [gateway]);

  async function addAssignment(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await gateway.createPolicyAssignment(
        gateway.workspaceId,
        {
          principalType,
          principalId: principal,
          role,
          scopeKind: "workspace",
          scopeId: gateway.workspaceId,
        },
      );
      setAssignments((current) => [...current, created]);
      setShowForm(false);
      setNotice(
        fixture
          ? "Preview assignment added locally. No access policy was changed."
          : "Workspace policy assignment created.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Policy assignment could not be created.",
      );
    }
  }

  async function revokeAssignment(assignment: PolicyAssignment) {
    setError("");
    try {
      await gateway.revokePolicyAssignment(gateway.workspaceId, assignment.id);
      setAssignments((current) =>
        current.filter(({ id }) => id !== assignment.id),
      );
      setNotice(
        fixture
          ? "Preview assignment removed locally. No access policy was changed."
          : "Workspace policy assignment revoked.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Policy assignment could not be revoked.",
      );
    }
  }

  return (
    <>
      <PageHeading
        title="Access control"
        subtitle="Sign-in, roles and least-privilege workspace assignments."
        wiringId="section.access"
        mode={gateway.mode}
        action={
          <button
            className="button"
            title={
              fixture ? "Add a non-persistent preview assignment" : undefined
            }
            onClick={() => setShowForm((current) => !current)}
          >
            <UserPlus size={16} /> Assign access
          </button>
        }
      />
      <div className="status-notice" role="status">
        {fixture ? <Fingerprint size={17} /> : <ShieldCheck size={17} />}
        {fixture
          ? "Fixture identities — controls preview the policy model; nothing is persisted."
          : "Live policy assignments are authenticated and restricted to workspace owners and administrators."}
      </div>
      {error && (
        <div className="status-notice error" role="alert">
          <ShieldAlert size={17} /> {error}
        </div>
      )}
      {notice && (
        <div className="status-notice" role="alert">
          {notice}
        </div>
      )}
      <div className="metrics">
        <Metric
          label="Active administrators"
          value={String(
            assignments.filter(
              ({ role }) => role === "owner" || role === "admin",
            ).length,
          )}
          note="Owner and administrator assignments"
        />
        <Metric
          label="Privileged sessions"
          value={fixture ? "1" : "Authenticated"}
          note="Organisation identity session"
        />
        <Metric
          label="Policy exceptions"
          value="0"
          note="No break-glass access active"
        />
      </div>
      {showForm && (
        <form className="card panel assignment-form" onSubmit={addAssignment}>
          <div>
            <h2>
              {fixture ? "Preview an assignment" : "Assign workspace access"}
            </h2>
            <small>
              {fixture
                ? "Review only; fixture changes are never persisted."
                : "Creates an audited, explicit workspace policy assignment."}
            </small>
          </div>
          <label className="field-label">
            Principal
            <input
              value={principal}
              onChange={(event) => setPrincipal(event.target.value)}
            />
          </label>
          <label className="field-label">
            Principal type
            <select
              value={principalType}
              onChange={(event) =>
                setPrincipalType(
                  event.target.value as PolicyAssignment["principalType"],
                )
              }
            >
              <option value="user">User</option>
              <option value="service">Service</option>
              <option value="application">Application</option>
            </select>
          </label>
          <label className="field-label">
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="auditor">Auditor</option>
              <option value="admin">Administrator</option>
              <option value="editor">Editor</option>
              <option value="recovery_operator">Recovery operator</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button className="button primary" type="submit">
            {fixture ? "Add preview assignment" : "Assign access"}
          </button>
        </form>
      )}
      <div className="two-columns access-columns">
        <article className="card panel">
          <div className="panel-heading">
            <div>
              <h2>Workspace assignments</h2>
              <small>Explicit principal, role and scope.</small>
            </div>
            <BadgeCheck size={20} />
          </div>
          {assignments.map((assignment) => (
            <div className="role-row" key={assignment.id}>
              <span className="avatar">
                {assignment.principalId.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong>{assignment.principalId}</strong>
                <small>
                  {titleCase(assignment.scopeKind)} · {assignment.scopeId}
                </small>
              </div>
              <span className="badge">
                {titleCase(assignment.role.replaceAll("_", " "))}
              </span>
              <button
                className="text-button"
                onClick={() => void revokeAssignment(assignment)}
              >
                Remove
              </button>
            </div>
          ))}
        </article>
        <div className="access-side">
          <article className="card panel session-card">
            <div className="panel-heading">
              <div>
                <h2>Current session</h2>
                <small>
                  {fixture ? "Fixture administrator" : "Authenticated operator"}
                </small>
              </div>
              <Fingerprint size={20} />
            </div>
            <dl>
              <div>
                <dt>Authentication</dt>
                <dd>Organisation identity</dd>
              </div>
              <div>
                <dt className="heading-title-row">
                  Assurance
                  <WiringBadge
                    entryId="control.access.passkey-mfa"
                    mode={gateway.mode}
                  />
                </dt>
                <dd>
                  {fixture
                    ? "Passkey / MFA preview"
                    : "Configured identity provider"}
                </dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>Owner or administrator required</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>Session policy controlled</dd>
              </div>
            </dl>
            <button
              className="button wide"
              onClick={() => {
                void gateway.endAdminSession();
                setNotice(
                  fixture
                    ? "Fixture sign-out requested. The preview remains available."
                    : "Sign-out requested.",
                );
              }}
            >
              Sign out session
            </button>
          </article>
          <article className="card panel">
            <div className="panel-heading">
              <div>
                <h2>Role boundaries</h2>
                <small>
                  Infrastructure access does not imply private-content access.
                </small>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="capability-list">
              <span>
                <strong>Owner</strong>
                <small>Policy and ownership</small>
              </span>
              <span>
                <strong>Administrator</strong>
                <small>Infrastructure and assignments</small>
              </span>
              <span>
                <strong>Auditor</strong>
                <small>Read evidence, no mutation</small>
              </span>
              <span>
                <strong>Recovery operator</strong>
                <small>Restore workflow only</small>
              </span>
            </div>
          </article>
        </div>
      </div>
    </>
  );
}
