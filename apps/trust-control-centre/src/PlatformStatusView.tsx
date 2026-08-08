import { ClipboardList } from "lucide-react";
import { WiringBadge } from "./WiringBadge";
import {
  platformStatus,
  platformStatusCounts,
  type GatewayMode,
} from "./wiring-status";

export function PlatformStatusView({ mode }: { mode: GatewayMode }) {
  const counts = platformStatusCounts();

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="heading-title-row">
            <h1>Platform status</h1>
            <WiringBadge entryId="section.platform-status" mode={mode} />
          </div>
          <p>
            What Trust Core has implemented to date, what remains outstanding,
            and how Control Centre surfaces map to real wiring.
          </p>
        </div>
        <div className="platform-status-summary" aria-label="Platform counts">
          <ClipboardList size={18} />
          <span>
            Implemented {counts.implemented} · Partial {counts.partial} ·
            Outstanding {counts.outstanding}
          </span>
        </div>
      </div>

      <div className="two-columns platform-status-page">
        <article className="card panel">
          <h2>Implemented to date</h2>
          <ul className="platform-status-list">
            {platformStatus.implemented.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        </article>
        <article className="card panel">
          <h2>Outstanding</h2>
          <ul className="platform-status-list">
            {platformStatus.outstanding.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        </article>
      </div>
    </>
  );
}
