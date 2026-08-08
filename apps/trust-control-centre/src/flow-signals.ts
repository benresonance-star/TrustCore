import type {
  ControlCentreSnapshot,
  OperationalSnapshot,
} from "./model";
import type { GatewayMode } from "./wiring-status";
import type { FlowSignalKey } from "./flow-model";

export type FlowSignalKind = "measured" | "note" | "deferred";

export interface FlowNodeSignal {
  readonly kind: FlowSignalKind;
  readonly text: string;
}

export interface FlowWorkspaceSignals {
  readonly datasetsLabel: string;
  readonly datasetsValue: string;
  readonly applicationsLabel: string;
  readonly applicationsValue: string;
  readonly verificationLabel: string;
  readonly verificationValue: string;
  readonly backupLabel: string;
  readonly backupValue: string;
  readonly fixtureCaption: string | null;
}

export interface FlowSignals {
  readonly workspace: FlowWorkspaceSignals;
  readonly byNode: Readonly<Record<FlowSignalKey, FlowNodeSignal>>;
}

export function deriveFlowSignals(input: {
  readonly snapshot: ControlCentreSnapshot | null;
  readonly operational: OperationalSnapshot | null;
  readonly mode: GatewayMode;
  readonly applicationCount: number | null;
  readonly applicationsError?: string | null;
}): FlowSignals {
  const datasetCount = input.snapshot?.datasets.length ?? null;
  const integrityPercent = input.snapshot?.status.canonicalIntegrityPercent;
  const integrityStatus = input.snapshot?.status.canonicalIntegrityStatus;
  const backupStatus = input.operational?.backup.status ?? null;
  const storageStatus = input.operational?.storage.status ?? null;
  const latestVerification = input.operational?.latestVerification;

  const datasetsValue =
    datasetCount === null ? "—" : String(datasetCount);
  const applicationsValue =
    input.applicationsError
      ? "—"
      : input.applicationCount === null
        ? "—"
        : String(input.applicationCount);
  const verificationValue =
    integrityPercent === undefined
      ? "—"
      : latestVerification
        ? `${integrityStatus ?? "unknown"} · ${integrityPercent}% · last run recorded`
        : `${integrityStatus ?? "unknown"} · ${integrityPercent}%`;
  const backupValue = backupStatus ?? "unavailable";

  const workspace: FlowWorkspaceSignals = {
    datasetsLabel: "Datasets",
    datasetsValue,
    applicationsLabel: "Applications",
    applicationsValue,
    verificationLabel: "Verification",
    verificationValue,
    backupLabel: "Backup",
    backupValue,
    fixtureCaption:
      input.mode === "fixture" ? "Serving fixture gateway data." : null,
  };

  const byNode: Record<FlowSignalKey, FlowNodeSignal> = {
    applications: input.applicationsError
      ? {
          kind: "note",
          text: `Could not load applications: ${input.applicationsError}`,
        }
      : input.applicationCount === null
        ? {
            kind: "note",
            text: "Application count not loaded yet.",
          }
        : {
            kind: "measured",
            text: `${input.applicationCount} registered application${input.applicationCount === 1 ? "" : "s"}.`,
          },
    gateway: {
      kind: "measured",
      text: `Gateway mode: ${input.mode}${storageStatus ? ` · storage ${storageStatus}` : ""}.`,
    },
    identity: {
      kind: "note",
      text:
        input.mode === "fixture"
          ? "Note — fixture session path; policy UI is Partial (Passkey/MFA Dummy). Not a live principal count."
          : "Note — session/policy UI is Partial; Passkey/MFA remains Dummy. Not a live principal count.",
    },
    revision:
      input.snapshot?.status.recoveryAttention !== undefined
        ? {
            kind: "measured",
            text: `Recovery attention: ${input.snapshot.status.recoveryAttention}. Open History for revisions.`,
          }
        : {
            kind: "note",
            text: "Note — open History for revision list and restore (no revision count on this page).",
          },
    portability: {
      kind: "note",
      text: "Note — Portability UI is Live; this page does not count archive operations.",
    },
    semantic: {
      kind: "deferred",
      text: "No live signal — AI / semantic layer is deferred (Dummy).",
    },
    metadata:
      datasetCount === null
        ? {
            kind: "note",
            text: "Dataset registry not loaded.",
          }
        : {
            kind: "measured",
            text: `${datasetCount} dataset${datasetCount === 1 ? "" : "s"} in snapshot.`,
          },
    objects: storageStatus
      ? {
          kind: "measured",
          text: `Object storage: ${storageStatus}. Download grants available in Health.`,
        }
      : {
          kind: "note",
          text: "Object storage status unavailable.",
        },
    audit: {
      kind: "note",
      text: "Note — trust events live in History; this page does not count audit rows.",
    },
    backup: backupStatus
      ? {
          kind: "measured",
          text: `Backup telemetry: ${backupStatus}${input.operational?.backup.summary ? ` — ${input.operational.backup.summary}` : ""}`,
        }
      : {
          kind: "note",
          text: "Backup telemetry unavailable.",
        },
  };

  return { workspace, byNode };
}
