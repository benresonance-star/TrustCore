import type { ControlCentreGateway } from "./model";
import { formatGatewayError } from "./remediation";

export interface ConnectionProbeResult {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly scope: "session_snapshot";
  readonly message: string;
  readonly status?: number;
  readonly remediation?: string;
}

/** Probes that the current admin session can read the workspace snapshot. */
export async function runConnectionProbe(
  gateway: Pick<ControlCentreGateway, "getSnapshot" | "workspaceId">,
): Promise<ConnectionProbeResult> {
  const checkedAt = new Date().toISOString();
  try {
    const snapshot = await gateway.getSnapshot();
    return {
      ok: true,
      checkedAt,
      scope: "session_snapshot",
      message: `Probe passed for workspace ${gateway.workspaceId} (${snapshot.datasets.length} dataset(s) visible).`,
    };
  } catch (error) {
    const formatted = formatGatewayError(error);
    return {
      ok: false,
      checkedAt,
      scope: "session_snapshot",
      message: formatted.message,
      remediation: formatted.remediation,
      ...(formatted.status === undefined ? {} : { status: formatted.status }),
    };
  }
}
