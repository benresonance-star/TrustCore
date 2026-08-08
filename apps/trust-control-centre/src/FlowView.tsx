import { useId, useMemo, useState } from "react";
import { flowNodeLevel, flowNodes, type FlowNodeId } from "./flow-model";
import { deriveFlowSignals } from "./flow-signals";
import type {
  ControlCentreSnapshot,
  OperationalSnapshot,
  Section,
} from "./model";
import { WiringBadge } from "./WiringBadge";
import type { GatewayMode } from "./wiring-status";

export function FlowView({
  mode,
  snapshot,
  operational,
  applicationCount,
  applicationsError = null,
  navigate,
}: {
  mode: GatewayMode;
  snapshot: ControlCentreSnapshot | null;
  operational: OperationalSnapshot | null;
  applicationCount: number | null;
  applicationsError?: string | null;
  navigate: (section: Section) => void;
}) {
  const [selected, setSelected] = useState<FlowNodeId>("gateway");
  const descriptionIdPrefix = useId();
  const item = flowNodes.find((node) => node.id === selected)!;
  const SelectedIcon = item.Icon;
  const selectedLevel = flowNodeLevel(item);
  const selectedSignal = useMemo(
    () =>
      deriveFlowSignals({
        snapshot,
        operational,
        mode,
        applicationCount,
        applicationsError,
      }),
    [snapshot, operational, mode, applicationCount, applicationsError],
  );
  const signals = selectedSignal;
  const nodeSignal = signals.byNode[item.signalKey];

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="heading-title-row">
            <h1>System overview</h1>
            <WiringBadge entryId="section.flow" mode={mode} />
          </div>
          <p>
            Topology, process boundaries, and Control Centre wiring for trusted
            data.
          </p>
        </div>
      </div>

      <section className="flow-legend" aria-label="Wiring legend">
        <h2 className="flow-legend-title">Legend</h2>
        <ul className="flow-legend-list">
          <li>
            <span className="wiring-badge live">Live</span>
            <span>wired to Trust API</span>
          </li>
          <li>
            <span className="wiring-badge partial">Partial</span>
            <span>mixed UI / API coverage</span>
          </li>
          <li>
            <span className="wiring-badge dummy">Dummy</span>
            <span>docs / deferred</span>
          </li>
        </ul>
        <p className="flow-legend-note">
          Badge = Control Centre implementation for this node, not backend
          existence. Select a node for process details.
        </p>
      </section>

      <section
        className="flow-canvas"
        aria-label="System topology. Select a node for process analysis."
      >
        <p className="flow-canvas-eyebrow">Trust data path</p>
        <svg
          viewBox="0 0 1000 600"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0L8 4L0 8Z" />
            </marker>
          </defs>
          <path d="M210 246L248 246" />
          <path d="M440 246C466 246 463 63 488 63" />
          <path d="M440 246L488 206" />
          <path d="M440 246C466 246 463 350 488 350" />
          <path d="M690 63L758 63" />
          <path d="M690 206L758 206" />
          <path d="M690 350L758 350" />
          <path d="M865 245L865 458" />
          <path d="M758 245C650 245 650 495 445 495" />
          <path d="M345 458L345 285" />
        </svg>
        {flowNodes.map((node) => {
          const descriptionId = `${descriptionIdPrefix}-${node.id}`;
          const level = flowNodeLevel(node);
          return (
            <button
              type="button"
              key={node.id}
              className={`flow-node flow-${node.id} flow-level-${level} ${selected === node.id ? "active" : ""}`}
              onClick={() => setSelected(node.id)}
              aria-label={node.label}
              aria-describedby={descriptionId}
              aria-pressed={selected === node.id}
            >
              <node.Icon size={17} />
              <span>
                <strong>{node.label}</strong>
                <small>{node.note}</small>
              </span>
              <span aria-hidden="true">
                <WiringBadge entryId={node.wiringId} mode={mode} />
              </span>
              <span id={descriptionId} className="sr-only">
                {node.description}
              </span>
            </button>
          );
        })}
      </section>

      <section
        className="flow-inspector card"
        aria-labelledby="flow-inspector-heading"
      >
        <div className="flow-inspector-header">
          <SelectedIcon size={18} />
          <div>
            <h2 id="flow-inspector-heading">Process inspector</h2>
            <div className="heading-title-row">
              <h3>{item.label}</h3>
              <WiringBadge entryId={item.wiringId} mode={mode} />
            </div>
            <p className="flow-inspector-note">
              {item.note} · UI wiring: {selectedLevel}
            </p>
          </div>
        </div>

        <div className="flow-inspector-grid">
          <div>
            <h4>What this does</h4>
            <p>{item.description}</p>
          </div>
          <div>
            <h4>Features</h4>
            <ul>
              {item.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Signal</h4>
            <p data-signal-kind={nodeSignal.kind}>{nodeSignal.text}</p>
          </div>
          <div>
            <h4>Open in Control Centre</h4>
            <button
              type="button"
              className="button"
              onClick={() => navigate(item.deepLink)}
            >
              Open {item.deepLinkLabel}
            </button>
          </div>
        </div>
      </section>

      <section className="flow-signals" aria-labelledby="flow-signals-heading">
        <div className="flow-signals-heading-row">
          <h2 id="flow-signals-heading">Workspace signals</h2>
          {signals.workspace.fixtureCaption ? (
            <span className="flow-signals-caption">
              {signals.workspace.fixtureCaption}
            </span>
          ) : null}
        </div>
        <div className="flow-signals-grid">
          <button
            type="button"
            className="card flow-signal-tile"
            aria-label={`Datasets signal: ${signals.workspace.datasetsValue}`}
            onClick={() => navigate("datasets")}
          >
            <span>{signals.workspace.datasetsLabel}</span>
            <strong>{signals.workspace.datasetsValue}</strong>
          </button>
          <button
            type="button"
            className="card flow-signal-tile"
            aria-label={`Applications signal: ${signals.workspace.applicationsValue}`}
            onClick={() => navigate("apps")}
          >
            <span>{signals.workspace.applicationsLabel}</span>
            <strong>{signals.workspace.applicationsValue}</strong>
          </button>
          <button
            type="button"
            className="card flow-signal-tile"
            aria-label={`Verification signal: ${signals.workspace.verificationValue}`}
            onClick={() => navigate("health")}
          >
            <span>{signals.workspace.verificationLabel}</span>
            <strong>{signals.workspace.verificationValue}</strong>
          </button>
          <button
            type="button"
            className="card flow-signal-tile"
            aria-label={`Backup signal: ${signals.workspace.backupValue}`}
            onClick={() => navigate("health")}
          >
            <span>{signals.workspace.backupLabel}</span>
            <strong>{signals.workspace.backupValue}</strong>
          </button>
        </div>
      </section>
    </>
  );
}
