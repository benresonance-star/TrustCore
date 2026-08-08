import { useEffect, useState } from "react";
import {
  platformStatus,
  platformStatusCounts,
} from "./wiring-status";

const STORAGE_KEY = "trust-cc-platform-status-open";

export function PlatformStatusPanel() {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const counts = platformStatusCounts();

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      // ignore quota / private mode
    }
  }, [open]);

  return (
    <section className="platform-status" aria-label="Platform status">
      <button
        type="button"
        className="platform-status-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="platform-status-title">Platform status</span>
        <span className="platform-status-counts">
          Implemented {counts.implemented} · Partial {counts.partial} ·
          Outstanding {counts.outstanding}
        </span>
      </button>
      {open && (
        <div className="platform-status-body">
          <div>
            <h3>Implemented to date</h3>
            <ul>
              {platformStatus.implemented.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Outstanding</h3>
            <ul>
              {platformStatus.outstanding.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
