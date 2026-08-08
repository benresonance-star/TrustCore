import { HardDrive, ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { ServiceHealth, StorageProbeTier } from "@trust-core/protocol";
import { CopyIdChip } from "./CopyIdChip";
import { formatGatewayError, remediationFor } from "./remediation";
import {
  managedOnServerCopy,
  parseStorageHealthDetails,
  primaryConsoleLink,
  reconnectChecklist,
  remediationKeyForHealth,
  storageOperatorStatus,
} from "./storage-status";
import { WiringBadge } from "./WiringBadge";
import type { GatewayMode } from "./wiring-status";

export function StorageProviderView({
  health,
  mode,
  probing = false,
  onProbe,
  probeError,
}: {
  health: ServiceHealth | null;
  mode: GatewayMode;
  probing?: boolean;
  onProbe: (tier: StorageProbeTier) => void | Promise<void>;
  probeError?: string | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);
  const details = parseStorageHealthDetails(health);
  const status = storageOperatorStatus(health);
  const remediationKey = remediationKeyForHealth(health);
  const consoleLink = primaryConsoleLink(details);
  const probe = details?.probe ?? null;

  return (
    <section className="stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Canonical object store</p>
          <h1>Storage</h1>
          <p className="lede">
            Check whether Trust Core can reach the platform blob store, then
            open the provider console to fix host configuration.
          </p>
        </div>
        <WiringBadge entryId="section.storage" mode={mode} />
      </div>

      <div className="status-notice" role="status">
        <HardDrive size={18} aria-hidden />
        <div>
          <strong>{managedOnServerCopy}</strong>
          {mode === "fixture" ? (
            <small> Currently serving fixture gateway data.</small>
          ) : null}
        </div>
      </div>

      <div className="card panel">
        <div className="panel-heading">
          <h2>Connection</h2>
          <span
            className={
              status === "Connected"
                ? "verified"
                : status === "Configured"
                  ? "review"
                  : status === "Not set up"
                    ? "review"
                    : "review"
            }
          >
            {status}
          </span>
        </div>
        <p>{health?.summary ?? "Storage health has not loaded yet."}</p>
        {status !== "Connected" ? (
          <p className="readiness-remediation">
            {status === "Configured"
              ? "Storage is configured on the server but not live-verified yet. Run Test connection."
              : remediationFor(remediationKey)}
            {probe?.billingHint ? ` ${probe.billingHint}` : ""}
          </p>
        ) : null}

        <div className="button-row">
          <button
            type="button"
            className="button primary"
            disabled={probing}
            onClick={() => void onProbe("connectivity")}
          >
            {probing ? "Testing…" : "Test connection"}
          </button>
          {consoleLink ? (
            <a
              className="button"
              href={consoleLink.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {consoleLink.label}
            </a>
          ) : null}
          <button
            type="button"
            className="text-button"
            onClick={() => setShowReconnect((value) => !value)}
          >
            How to reconnect
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setShowDetails((value) => !value)}
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
        </div>

        {probeError ? (
          <div className="status-notice error" role="alert">
            <ShieldAlert size={18} aria-hidden />
            <div>
              <strong>{probeError}</strong>
            </div>
          </div>
        ) : null}

        {showReconnect ? (
          <div className="card soft">
            <h3>Reconnect checklist</h3>
            <p className="muted">{managedOnServerCopy}</p>
            <ol className="check-list">
              {reconnectChecklist.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="muted">
              Disconnect means changing host env/IAM or revoking access in the
              provider console — this UI does not flip a switch.
            </p>
          </div>
        ) : null}
      </div>

      {showDetails ? (
        <div className="two-columns">
          <div className="card panel">
            <div className="panel-heading">
              <h2>Configuration</h2>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Provider</dt>
                <dd>{details?.provider ?? "—"}</dd>
              </div>
              <div>
                <dt>Region</dt>
                <dd>{details?.region || "—"}</dd>
              </div>
              <div>
                <dt>Bucket</dt>
                <dd>{details?.bucket || "—"}</dd>
              </div>
              <div>
                <dt>Credential mode</dt>
                <dd>{details?.credentialMode ?? "—"}</dd>
              </div>
              <div>
                <dt>Endpoint</dt>
                <dd>{details?.endpointHost ?? "—"}</dd>
              </div>
              <div>
                <dt>Transfer signer</dt>
                <dd>
                  {details?.transferSignerConfigured ? "Configured" : "Missing"}
                </dd>
              </div>
              <div>
                <dt>Catalogued objects</dt>
                <dd>{details?.cataloguedObjects ?? "—"}</dd>
              </div>
              <div>
                <dt>Failed verification</dt>
                <dd>{details?.failedVerificationObjects ?? "—"}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="button"
              disabled={probing}
              onClick={() => void onProbe("ingest")}
            >
              Test upload path
            </button>
          </div>

          <div className="card panel">
            <div className="panel-heading">
              <h2>Last probe</h2>
            </div>
            {probe ? (
              <>
                <p>
                  {probe.ok ? "Succeeded" : "Failed"} · {probe.tier} ·{" "}
                  {probe.latencyMs} ms
                </p>
                <p>{probe.summary}</p>
                {probe.issueClass ? (
                  <p className="muted">Issue class: {probe.issueClass}</p>
                ) : null}
                <CopyIdChip id={probe.probeId} label="Probe" />
                {probe.bucketRegion ? (
                  <p className="muted">
                    Bucket region: {probe.bucketRegion}
                    {probe.regionMatch === false
                      ? " (does not match configured region)"
                      : ""}
                  </p>
                ) : null}
                <p className="muted">Checked {probe.checkedAt}</p>
              </>
            ) : (
              <p className="muted">
                No live probe yet. Run Test connection to refresh.
              </p>
            )}

            <h3>Connect checklist</h3>
            <ul className="check-list">
              {(details?.minimalIamActions ?? []).map((action) => (
                <li key={action}>
                  <code>{action}</code>
                </li>
              ))}
              <li>
                See <code>deploy/README.md</code> and{" "}
                <code>docs/cloud-recovery-gate-runbook.md</code>
              </li>
            </ul>
            <p className="muted">
              Quarantine/scan labels in Transfers are metadata on already-stored
              objects
              {details?.scannerConfigured
                ? " (fake scanner enabled via TRUST_SCANNER=fake)."
                : " (no scanner configured)."}
            </p>

            {(details?.consoleLinks?.length ?? 0) > 0 ? (
              <>
                <h3>Provider consoles</h3>
                <div className="button-row">
                  {details!.consoleLinks.map((link) => (
                    <a
                      key={link.id}
                      className="button"
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function describeProbeError(error: unknown): string {
  return formatGatewayError(error).message;
}
