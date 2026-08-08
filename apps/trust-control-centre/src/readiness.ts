import type { ControlCentreSnapshot, OperationalSnapshot } from "./model";
import type { RemediationKey } from "./remediation";
import type { GatewayMode } from "./wiring-status";

export type ReadinessStatus = "ok" | "blocked" | "warning";

export type ReadinessStepId =
  | "signed_in"
  | "workspace"
  | "storage"
  | "backup"
  | "applications"
  | "access_grant"
  | "probe";

export interface ReadinessStep {
  readonly id: ReadinessStepId;
  readonly label: string;
  readonly status: ReadinessStatus;
  readonly detail: string;
  readonly remediationKey?: RemediationKey;
}

export interface ReadinessInput {
  readonly mode: GatewayMode;
  readonly workspaceId: string;
  readonly signedIn: boolean;
  readonly snapshot: ControlCentreSnapshot | null;
  readonly operational: OperationalSnapshot | null;
  readonly applicationCount: number;
  readonly applicationGrantCount: number;
  readonly probeOk: boolean | null;
}

function step(value: ReadinessStep): ReadinessStep {
  return value;
}

export function evaluateReadiness(
  input: ReadinessInput,
): readonly ReadinessStep[] {
  const workspaceConfigured = input.workspaceId.trim().length > 0;
  const storageStatus = input.operational?.storage.status;
  const backupStatus = input.operational?.backup.status;
  const signedInOk = input.signedIn || input.mode === "fixture";

  return [
    step({
      id: "signed_in",
      label: "Administrator session",
      status: signedInOk ? "ok" : "blocked",
      detail:
        input.mode === "fixture"
          ? "Fixture mode does not require a live session."
          : input.signedIn
            ? "Administrator session is available."
            : "Sign in with organisation identity or a bootstrap token.",
      ...(signedInOk ? {} : { remediationKey: "sign_in" as const }),
    }),
    step({
      id: "workspace",
      label: "Workspace configured",
      status: workspaceConfigured ? "ok" : "blocked",
      detail: workspaceConfigured
        ? `Workspace ${input.workspaceId}`
        : "No workspace id is configured for this Control Centre.",
      ...(workspaceConfigured
        ? {}
        : { remediationKey: "workspace_env" as const }),
    }),
    step({
      id: "storage",
      label: "Object storage healthy",
      status: !input.operational
        ? "warning"
        : storageStatus === "healthy"
          ? "ok"
          : storageStatus === "not_configured"
            ? "blocked"
            : "warning",
      detail: input.operational
        ? input.operational.storage.summary
        : "Storage health has not been loaded yet.",
      ...(storageStatus === "not_configured"
        ? { remediationKey: "storage_env" as const }
        : storageStatus === "degraded"
          ? { remediationKey: "storage_degraded" as const }
          : {}),
    }),
    step({
      id: "backup",
      label: "Backup telemetry",
      status: !input.operational
        ? "warning"
        : backupStatus === "healthy"
          ? "ok"
          : "warning",
      detail: input.operational
        ? input.operational.backup.summary
        : "Backup health has not been loaded yet.",
      ...(backupStatus === "not_configured"
        ? { remediationKey: "backup_not_configured" as const }
        : {}),
    }),
    step({
      id: "applications",
      label: "Application registered",
      status: input.applicationCount > 0 ? "ok" : "blocked",
      detail:
        input.applicationCount > 0
          ? `${input.applicationCount} registered application(s).`
          : "Register at least one application for this workspace.",
      ...(input.applicationCount > 0
        ? {}
        : { remediationKey: "register_app" as const }),
    }),
    step({
      id: "access_grant",
      label: "Application access granted",
      status: input.applicationGrantCount > 0 ? "ok" : "blocked",
      detail:
        input.applicationGrantCount > 0
          ? `${input.applicationGrantCount} application policy assignment(s).`
          : "Grant a workspace or dataset role to the application principal.",
      ...(input.applicationGrantCount > 0
        ? {}
        : { remediationKey: "grant_access" as const }),
    }),
    step({
      id: "probe",
      label: "Connection probe",
      status:
        input.probeOk === null ? "warning" : input.probeOk ? "ok" : "blocked",
      detail:
        input.probeOk === null
          ? "Probe has not been run yet."
          : input.probeOk
            ? "Latest probe passed (session can read workspace snapshot)."
            : "Latest probe failed.",
      ...(input.probeOk === false
        ? { remediationKey: "probe_failed" as const }
        : {}),
    }),
  ];
}
