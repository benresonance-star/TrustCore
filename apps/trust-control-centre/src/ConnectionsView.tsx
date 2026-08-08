import {
  appCapabilities,
  createAppProtocolBundle,
  type AppCapability,
  type AppProtocolBundle,
} from "@trust-core/app-protocol";
import type {
  ApplicationRegistration,
  PolicyAssignment,
} from "@trust-core/protocol";
import { CircleCheckBig, Link2, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { labelForCapability } from "./capability-labels";
import {
  buildConnectionPack,
  connectionPackFilename,
} from "./connection-pack";
import { runConnectionProbe, type ConnectionProbeResult } from "./connection-probe";
import { CopyIdChip } from "./CopyIdChip";
import type {
  ControlCentreGateway,
  ControlCentreSnapshot,
  OperationalSnapshot,
} from "./model";
import { evaluateReadiness } from "./readiness";
import { formatGatewayError, remediationFor } from "./remediation";
import { WiringBadge } from "./WiringBadge";

const WIZARD_KEY = "trust-cc-connections-wizard";

const defaultCapabilities: readonly AppCapability[] = [
  "dataset:read",
  "resource:read",
  "history:read",
];

export function ConnectionsView({
  gateway,
  snapshot,
  operational,
  navigateHistory,
}: {
  gateway: ControlCentreGateway;
  snapshot: ControlCentreSnapshot;
  operational: OperationalSnapshot | null;
  navigateHistory: () => void;
}) {
  const [applications, setApplications] = useState<
    readonly ApplicationRegistration[]
  >([]);
  const [assignments, setAssignments] = useState<readonly PolicyAssignment[]>(
    [],
  );
  const [selectedAppId, setSelectedAppId] = useState("");
  const [namespace, setNamespace] = useState("app/foundation");
  const [name, setName] = useState("Foundation");
  const [applicationVersion, setApplicationVersion] = useState("1.0.0");
  const [capabilities, setCapabilities] =
    useState<readonly AppCapability[]>(defaultCapabilities);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [remediation, setRemediation] = useState("");
  const [probe, setProbe] = useState<ConnectionProbeResult | null>(null);
  const [bundle, setBundle] = useState<AppProtocolBundle | null>(null);
  const [lastAssignmentId, setLastAssignmentId] = useState("");
  const [wizardMode, setWizardMode] = useState(() => {
    try {
      return sessionStorage.getItem(WIZARD_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedApp =
    applications.find((app) => app.id === selectedAppId) ??
    applications[0] ??
    null;

  const appGrants = useMemo(
    () =>
      assignments.filter(
        (assignment) =>
          assignment.principalType === "application" && !assignment.revokedAt,
      ),
    [assignments],
  );

  const readiness = evaluateReadiness({
    mode: gateway.mode,
    workspaceId: gateway.workspaceId,
    signedIn: true,
    snapshot,
    operational,
    applicationCount: applications.length,
    applicationGrantCount: appGrants.length,
    probeOk: probe ? probe.ok : null,
  });

  const canGrant =
    !wizardMode || applications.length > 0 || !!selectedApp;
  const canProbe = !wizardMode || appGrants.length > 0;
  const canDownloadPack =
    !wizardMode || (probe?.ok === true && !!selectedApp);

  useEffect(() => {
    try {
      sessionStorage.setItem(WIZARD_KEY, wizardMode ? "1" : "0");
    } catch {
      // ignore
    }
  }, [wizardMode]);

  async function refresh() {
    const [apps, policies] = await Promise.all([
      gateway.listApplications(gateway.workspaceId),
      gateway.listPolicyAssignments(gateway.workspaceId),
    ]);
    setApplications(apps);
    setAssignments(policies);
    if (!selectedAppId && apps[0]) setSelectedAppId(apps[0].id);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [apps, policies] = await Promise.all([
          gateway.listApplications(gateway.workspaceId),
          gateway.listPolicyAssignments(gateway.workspaceId),
        ]);
        if (cancelled) return;
        setApplications(apps);
        setAssignments(policies);
        if (apps[0]) setSelectedAppId((current) => current || apps[0]!.id);
      } catch (cause) {
        if (cancelled) return;
        const formatted = formatGatewayError(cause);
        setError(formatted.message);
        setRemediation(formatted.remediation);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    setBusy("register");
    setError("");
    setRemediation("");
    setNotice("");
    try {
      const registered = await gateway.registerApplication(gateway.workspaceId, {
        namespace,
        name,
        applicationVersion,
        schemaPackageIds: [],
        capabilities,
      });
      const protocol = createAppProtocolBundle({
        namespace,
        name,
        applicationVersion,
        schemaVersion: "1.0.0",
        resourceTypes: ["Project", "Document"],
        relationTypes: ["contains"],
        blobRoles: ["original"],
        capabilities,
      });
      setBundle(protocol);
      setSelectedAppId(registered.id);
      setNotice(`Registered ${registered.name}.`);
      await refresh();
    } catch (cause) {
      const formatted = formatGatewayError(cause);
      setError(formatted.message);
      setRemediation(formatted.remediation);
    } finally {
      setBusy("");
    }
  }

  async function onGrant() {
    if (!selectedApp) return;
    setBusy("grant");
    setError("");
    setRemediation("");
    setNotice("");
    try {
      const assignment = await gateway.createPolicyAssignment(
        gateway.workspaceId,
        {
          principalType: "application",
          principalId: selectedApp.id,
          role: "editor",
          scopeKind: "workspace",
          scopeId: gateway.workspaceId,
        },
      );
      setLastAssignmentId(assignment.id);
      setNotice(`Granted editor access to ${selectedApp.name}.`);
      await refresh();
    } catch (cause) {
      const formatted = formatGatewayError(cause);
      setError(formatted.message);
      setRemediation(formatted.remediation);
    } finally {
      setBusy("");
    }
  }

  async function onProbe() {
    setBusy("probe");
    setError("");
    setRemediation("");
    setNotice("");
    const result = await runConnectionProbe(gateway);
    setProbe(result);
    if (!result.ok) {
      setError(result.message);
      setRemediation(result.remediation ?? remediationFor("probe_failed"));
    }
    setBusy("");
  }

  function onDownloadPack() {
    const apiBase =
      (import.meta.env.VITE_TRUST_API_BASE as string | undefined)?.replace(
        /\/$/,
        "",
      ) ?? (gateway.mode === "fixture" ? "(fixture)" : "/api");
    const pack = buildConnectionPack({
      workspaceId: gateway.workspaceId,
      apiBase,
      application: selectedApp,
      policyAssignmentIds: [
        ...new Set(
          [
            ...appGrants
              .filter(
                (assignment) =>
                  !selectedApp || assignment.principalId === selectedApp.id,
              )
              .map((assignment) => assignment.id),
            ...(lastAssignmentId ? [lastAssignmentId] : []),
          ].filter(Boolean),
        ),
      ],
      bundle,
      probeResult: probe,
    });
    const blob = new Blob([JSON.stringify(pack, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = connectionPackFilename(pack.applicationId);
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Connection pack downloaded.");
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="heading-title-row">
            <h1>Connections</h1>
            <WiringBadge entryId="section.connections" mode={gateway.mode} />
          </div>
          <p>
            Register an application, grant access, verify the admin session can
            read the workspace, then download a handoff pack for humans or AI
            agents.
          </p>
        </div>
        <div className="heading-action-cluster">
          <CopyIdChip id={gateway.workspaceId} label="Workspace" />
          <button
            type="button"
            className="text-button"
            onClick={() => setWizardMode((value) => !value)}
          >
            {wizardMode ? "Exit guided setup" : "Use guided setup"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="status-notice" role="status">
          <CircleCheckBig size={17} />
          {notice}
        </div>
      )}
      {error && (
        <div className="status-notice error" role="alert">
          <ShieldAlert size={17} />
          <div>
            <strong>{error}</strong>
            {remediation && <small>{remediation}</small>}
          </div>
        </div>
      )}

      <article className="card panel">
        <div className="panel-heading">
          <div>
            <h2>Workspace readiness</h2>
            <small>Complete these gates before handing off a connection pack.</small>
          </div>
          <Link2 size={20} />
        </div>
        <ul className="readiness-list">
          {readiness.map((step) => (
            <li key={step.id} data-status={step.status}>
              <strong>{step.label}</strong>
              <span className={`readiness-pill ${step.status}`}>
                {step.status}
              </span>
              <small>{step.detail}</small>
              {step.remediationKey && (
                <small className="readiness-remediation">
                  {remediationFor(step.remediationKey)}
                </small>
              )}
            </li>
          ))}
        </ul>
      </article>

      <div className="two-columns">
        <form className="card panel" onSubmit={(event) => void onRegister(event)}>
          <h2>1. Register application</h2>
          <label>
            Namespace
            <input
              value={namespace}
              onChange={(event) => setNamespace(event.target.value)}
              required
            />
          </label>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            Application version
            <input
              value={applicationVersion}
              onChange={(event) => setApplicationVersion(event.target.value)}
              required
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => setShowAdvanced((value) => !value)}
          >
            {showAdvanced ? "Hide contract details" : "Customize contract"}
          </button>
          {showAdvanced && (
            <fieldset className="capability-fieldset">
              <legend>Capabilities</legend>
              {appCapabilities.map((capability) => (
                <label key={capability} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={capabilities.includes(capability)}
                    onChange={(event) => {
                      setCapabilities((current) =>
                        event.target.checked
                          ? [...current, capability]
                          : current.filter((item) => item !== capability),
                      );
                    }}
                  />
                  <span title={capability}>
                    {labelForCapability(capability)}
                    <small> ({capability})</small>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {!showAdvanced && (
            <small>
              Default capabilities:{" "}
              {capabilities.map((capability) => labelForCapability(capability)).join("; ")}.
            </small>
          )}
          <button className="button primary" type="submit" disabled={!!busy}>
            {busy === "register" ? "Registering…" : "Register application"}
          </button>
        </form>

        <article className="card panel">
          <h2>Registered applications</h2>
          {applications.length === 0 ? (
            <div className="empty-state">
              <strong>No applications yet</strong>
              <small>{remediationFor("register_app")}</small>
            </div>
          ) : (
            <ul className="assignment-list">
              {applications.map((app) => (
                <li key={app.id}>
                  <button
                    type="button"
                    className={
                      selectedApp?.id === app.id
                        ? "text-button active"
                        : "text-button"
                    }
                    onClick={() => setSelectedAppId(app.id)}
                  >
                    {app.name}
                  </button>
                  <small>
                    {app.namespace} · {app.status}
                  </small>
                  <CopyIdChip id={app.id} label="Application" />
                </li>
              ))}
            </ul>
          )}
          <div className="heading-action-cluster" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="button"
              disabled={!selectedApp || !!busy || !canGrant}
              onClick={() => void onGrant()}
            >
              {busy === "grant" ? "Granting…" : "2. Grant editor access"}
            </button>
            {lastAssignmentId && (
              <CopyIdChip id={lastAssignmentId} label="Assignment" />
            )}
          </div>
          <small>
            Creates a workspace-scoped policy assignment for the selected
            application id.
          </small>
        </article>
      </div>

      <article className="card panel">
        <div className="panel-heading">
          <div>
            <h2>3. Verify connection</h2>
            <small>
              Probe confirms this admin session can read the workspace snapshot.
              It does not authenticate as the application principal.
            </small>
          </div>
        </div>
        <div className="heading-action-cluster">
          <button
            type="button"
            className="button"
            disabled={!!busy || !canProbe}
            onClick={() => void onProbe()}
          >
            {busy === "probe" ? "Probing…" : "Run connection probe"}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!canDownloadPack}
            onClick={onDownloadPack}
          >
            4. Download connection pack
          </button>
          <button type="button" className="text-button" onClick={navigateHistory}>
            View related events
          </button>
        </div>
        {probe && (
          <div
            className={
              probe.ok ? "status-notice" : "status-notice error"
            }
            role="status"
          >
            {probe.message}
            {probe.status !== undefined && (
              <CopyIdChip id={String(probe.status)} label="HTTP" />
            )}
          </div>
        )}
      </article>
    </>
  );
}
