import {
  getWiringEntry,
  wiringLevelLabels,
  wiringTooltip,
  type GatewayMode,
  type WiringEntryId,
} from "./wiring-status";

export function WiringBadge({
  entryId,
  mode,
}: {
  entryId: WiringEntryId;
  mode: GatewayMode;
}) {
  const entry = getWiringEntry(entryId);
  const label = wiringLevelLabels[entry.level];
  const tooltip = wiringTooltip(entryId, mode);

  return (
    <span
      className={`wiring-badge ${entry.level}`}
      title={tooltip}
      aria-label={tooltip}
    >
      {label}
    </span>
  );
}
