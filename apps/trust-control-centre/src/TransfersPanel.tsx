import type { DownloadGrant } from "@trust-core/protocol";
import { useEffect, useState, type FormEvent } from "react";
import { CopyIdChip } from "./CopyIdChip";
import type { ControlCentreGateway, QuarantineScanSummary } from "./model";
import { formatGatewayError, remediationFor } from "./remediation";
import { WiringBadge } from "./WiringBadge";

export function TransfersPanel({
  gateway,
  storageHealthy,
  onViewHistory,
}: {
  gateway: ControlCentreGateway;
  storageHealthy: boolean;
  onViewHistory: () => void;
}) {
  const [objectId, setObjectId] = useState("fixture-object-verified");
  const [ttlSeconds, setTtlSeconds] = useState("300");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remediation, setRemediation] = useState("");
  const [grant, setGrant] = useState<DownloadGrant | null>(null);
  const [scan, setScan] = useState<QuarantineScanSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void gateway
      .getQuarantineScanSummary(gateway.workspaceId)
      .then((summary) => {
        if (!cancelled) setScan(summary);
      });
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  async function onCreateGrant(event: FormEvent) {
    event.preventDefault();
    if (!storageHealthy) {
      setError("Storage is not healthy.");
      setRemediation(remediationFor("storage_degraded"));
      return;
    }
    setBusy(true);
    setError("");
    setRemediation("");
    try {
      const created = await gateway.createDownloadGrant(gateway.workspaceId, {
        objectId: objectId.trim(),
        requestedTtlSeconds: Number(ttlSeconds) || 300,
      });
      setGrant(created);
    } catch (cause) {
      const formatted = formatGatewayError(cause);
      setError(formatted.message);
      setRemediation(formatted.remediation);
      setGrant(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card panel">
      <div className="panel-heading">
        <div>
          <h2>Transfers</h2>
          <small>
            Create policy-gated download grants. Secrets stay on the API; this
            UI only requests short-lived transfer URLs.
          </small>
        </div>
        <WiringBadge entryId="control.health.transfers" mode={gateway.mode} />
      </div>

      <form
        className="assignment-form"
        onSubmit={(event) => void onCreateGrant(event)}
      >
        <label>
          Object id
          <input
            value={objectId}
            onChange={(event) => setObjectId(event.target.value)}
            required
            disabled={!storageHealthy}
          />
        </label>
        <label>
          TTL seconds
          <input
            value={ttlSeconds}
            onChange={(event) => setTtlSeconds(event.target.value)}
            inputMode="numeric"
            disabled={!storageHealthy}
          />
        </label>
        <button
          className="button primary"
          type="submit"
          disabled={busy || !storageHealthy}
        >
          {busy ? "Creating grant…" : "Create download grant"}
        </button>
      </form>

      {!storageHealthy && (
        <div className="status-notice error" role="status">
          {remediationFor("storage_env")}
        </div>
      )}
      {error && (
        <div className="status-notice error" role="alert">
          <strong>{error}</strong>
          {remediation && <small>{remediation}</small>}
        </div>
      )}
      {grant && (
        <div className="status-notice" role="status">
          Grant ready until {new Date(grant.expiresAt).toLocaleString()}.
          <div className="heading-action-cluster" style={{ marginTop: 8 }}>
            <CopyIdChip id={grant.grantId} label="Grant" />
            <CopyIdChip id={grant.objectId} label="Object" />
            <button
              type="button"
              className="text-button"
              onClick={onViewHistory}
            >
              View related events
            </button>
          </div>
        </div>
      )}

      <div className="panel-heading" style={{ marginTop: 16 }}>
        <div>
          <h2>Quarantine / scan</h2>
          <small>Read-only status when a scan summary API is available.</small>
        </div>
        <WiringBadge entryId="control.health.quarantine" mode={gateway.mode} />
      </div>
      {scan ? (
        scan.available ? (
          <ul className="assignment-list">
            <li>
              <strong>{scan.summary}</strong>
            </li>
            {scan.items.map((item) => (
              <li key={item.objectId}>
                <span>
                  {item.objectId} · {item.state}
                </span>
                <small>{new Date(item.updatedAt).toLocaleString()}</small>
                <CopyIdChip id={item.objectId} label="Object" />
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <strong>Scan status unavailable</strong>
            <small>{scan.summary}</small>
          </div>
        )
      ) : (
        <div className="empty-state">
          <strong>Loading scan status…</strong>
        </div>
      )}
    </article>
  );
}
