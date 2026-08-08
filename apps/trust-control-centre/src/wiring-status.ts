export type WiringLevel = "live" | "partial" | "dummy";

export type GatewayMode = "fixture" | "live";

export interface WiringEntry {
  readonly id: string;
  readonly label: string;
  readonly level: WiringLevel;
  /** What is wired and what is not — shown in tooltip / aria-label. */
  readonly detail: string;
}

export const wiringLevelLabels: Readonly<Record<WiringLevel, string>> = {
  live: "Live",
  partial: "Partial",
  dummy: "Dummy",
};

const entries = {
  "section.home": {
    id: "section.home",
    label: "Home",
    level: "partial",
    detail:
      "Recent projects come from gateway.getSnapshot(). “+ New project” requires Foundation/API provision; Common components are Foundation — not Trust Core.",
  },
  "section.datasets": {
    id: "section.datasets",
    label: "Datasets",
    level: "partial",
    detail:
      "Registry and detail panels read Control Centre snapshot data. Register export belongs in Portability; dataset create/edit is not exposed here.",
  },
  "section.flow": {
    id: "section.flow",
    label: "System overview",
    level: "partial",
    detail:
      "Topology, inspector, and workspace signals use gateway snapshot/health/applications where available. Several node signals are status notes, not measured telemetry. Semantic layer remains Dummy. Prefer Connections for setup; Platform status for the release catalog.",
  },
  "flow.node.apps": {
    id: "flow.node.apps",
    label: "Applications",
    level: "partial",
    detail:
      "Application list/register live in Connections. Overview shows registered count; application-principal auth probe is not covered here.",
  },
  "flow.node.gateway": {
    id: "flow.node.gateway",
    label: "Trust API",
    level: "live",
    detail:
      "Control Centre gateway mode and storage health from snapshot/operational APIs. Does not configure API credentials from this diagram.",
  },
  "flow.node.identity": {
    id: "flow.node.identity",
    label: "Identity & policy",
    level: "partial",
    detail:
      "Session and policy flows are gateway-wired in Access. Passkey/MFA remains Dummy preview copy.",
  },
  "flow.node.revision": {
    id: "flow.node.revision",
    label: "Revision engine",
    level: "live",
    detail:
      "History list/restore is Live. Overview links into History; it does not mutate revisions from the canvas.",
  },
  "flow.node.portability": {
    id: "flow.node.portability",
    label: "Portability",
    level: "live",
    detail:
      "Export/import flows are Live in Portability. Overview does not run archive operations from the canvas.",
  },
  "flow.node.semantic": {
    id: "flow.node.semantic",
    label: "Semantic layer",
    level: "dummy",
    detail:
      "AI / semantic layer is explicitly deferred. No API calls; derived indexes must never write canonical bytes.",
  },
  "flow.node.metadata": {
    id: "flow.node.metadata",
    label: "Metadata store",
    level: "partial",
    detail:
      "Datasets and integrity labels come from gateway snapshot. Create/edit is not exposed in Control Centre.",
  },
  "flow.node.objects": {
    id: "flow.node.objects",
    label: "Canonical objects",
    level: "partial",
    detail:
      "Storage diagnostics and download grants. Public multipart upload remains outstanding; open Storage for provider connection checks.",
  },
  "flow.node.audit": {
    id: "flow.node.audit",
    label: "Audit log",
    level: "live",
    detail:
      "Trust events are available via History. Overview does not append audit events from the canvas.",
  },
  "flow.node.backup": {
    id: "flow.node.backup",
    label: "Backup & archive",
    level: "partial",
    detail:
      "Reads health.backup and links to Health/Portability. Telemetry may report not_configured until a provider exists.",
  },
  "section.health": {
    id: "section.health",
    label: "Health",
    level: "partial",
    detail:
      "Metrics use snapshot plus gateway.getOperationalSnapshot and runVerification. Storage diagnostics live under Storage; backup telemetry is often not_configured.",
  },
  "section.storage": {
    id: "section.storage",
    label: "Storage",
    level: "partial",
    detail:
      "Operator diagnostics for the platform blob store: health details, Test connection (probe), and allowlisted provider console links. Credentials stay on the API host — no secrets in the browser.",
  },
  "section.history": {
    id: "section.history",
    label: "History",
    level: "live",
    detail:
      "Wired to gateway.getHistory and restoreResource (SDK history.list / resources.restore). Recovery bin and trust events use that path.",
  },
  "section.portability": {
    id: "section.portability",
    label: "Portability",
    level: "live",
    detail:
      "Wired to gateway export, archive upload, import plan, and execute flows. Fixture mode keeps operations in memory; live mode hits Trust API.",
  },
  "section.app-protocol": {
    id: "section.app-protocol",
    label: "App protocol",
    level: "live",
    detail:
      "Generates real TCAP/1.0 manifests and method maps via @trust-core/app-protocol locally. Does not register applications over HTTP by itself.",
  },
  "section.access": {
    id: "section.access",
    label: "Access",
    level: "partial",
    detail:
      "Policy list/create/revoke and session sign-in/out are gateway-wired. Passkey/MFA lines are preview copy only.",
  },
  "section.connections": {
    id: "section.connections",
    label: "Connections",
    level: "live",
    detail:
      "Wired to applications.list/register, policy assignment grants, session snapshot probe, and connection-pack download. Application-principal auth is not probed.",
  },
  "section.platform-status": {
    id: "section.platform-status",
    label: "Platform status",
    level: "live",
    detail:
      "Catalog-driven status page from wiring-status.ts. Lists implemented and outstanding platform work; does not call the API.",
  },
  "control.home.new-project": {
    id: "control.home.new-project",
    label: "New project",
    level: "dummy",
    detail:
      "Requires Foundation or API dataset provision. Control Centre does not create projects or datasets.",
  },
  "control.home.common-components": {
    id: "control.home.common-components",
    label: "Common components",
    level: "dummy",
    detail:
      "Foundation — not Trust Core. Local UI selection only; Documents/Tasks/Notes are not Control Centre backends.",
  },
  "control.datasets.export-register": {
    id: "control.datasets.export-register",
    label: "Export register",
    level: "dummy",
    detail:
      "Requires Portability export flow. This register button does not call an API; use Portability to create archives.",
  },
  "control.health.run-verification": {
    id: "control.health.run-verification",
    label: "Run full verification",
    level: "live",
    detail:
      "Wired to gateway.runVerification → client.verification.run. Does not configure storage providers or backup jobs.",
  },
  "control.health.backup": {
    id: "control.health.backup",
    label: "Backup health",
    level: "partial",
    detail:
      "Reads gateway health.backup; API often reports not_configured until a backup telemetry provider exists.",
  },
  "control.health.transfers": {
    id: "control.health.transfers",
    label: "Download grants",
    level: "live",
    detail:
      "Wired to gateway.createDownloadGrant → client.blobs.createDownloadGrant. Does not configure storage credentials in the browser.",
  },
  "control.health.quarantine": {
    id: "control.health.quarantine",
    label: "Quarantine scan",
    level: "partial",
    detail:
      "Per-upload scan status uses gateway.getUploadScanStatus. Workspace-wide quarantine summary remains fixture/partial until a public list endpoint exists.",
  },
  "control.access.passkey-mfa": {
    id: "control.access.passkey-mfa",
    label: "Passkey / MFA",
    level: "dummy",
    detail:
      "Preview assurance copy only. Session auth uses admin token or OIDC; passkey enrollment is not implemented in this UI.",
  },
} as const satisfies Record<string, WiringEntry>;

export type WiringEntryId = keyof typeof entries;

export const wiringEntries: Readonly<Record<WiringEntryId, WiringEntry>> =
  entries;

export const sectionWiringIds = {
  home: "section.home",
  datasets: "section.datasets",
  flow: "section.flow",
  health: "section.health",
  storage: "section.storage",
  history: "section.history",
  portability: "section.portability",
  "app-protocol": "section.app-protocol",
  access: "section.access",
  connections: "section.connections",
  "platform-status": "section.platform-status",
} as const satisfies Record<string, WiringEntryId>;

export function getWiringEntry(id: WiringEntryId): WiringEntry {
  return wiringEntries[id];
}

export function wiringTooltip(id: WiringEntryId, mode: GatewayMode): string {
  const entry = getWiringEntry(id);
  const level = wiringLevelLabels[entry.level];
  const base = `${level}: ${entry.detail}`;
  if (mode === "fixture" && entry.level !== "dummy") {
    return `${base} Currently serving fixture gateway data.`;
  }
  return base;
}

export interface PlatformStatusItem {
  readonly id: string;
  readonly text: string;
}

export const platformStatus = {
  implemented: [
    {
      id: "rel-01",
      text: "Release 0.1 trust loop (ingest, revisions, recovery, verification)",
    },
    {
      id: "rel-02",
      text: "Release 0.2 portability (archive export/import gates)",
    },
    {
      id: "tcap",
      text: "TCAP/1.0 app protocol + Control Centre generator",
    },
    {
      id: "cc-gateway",
      text: "Control Centre live gateway (snapshot, health, history, access, portability)",
    },
    {
      id: "s3-adapter",
      text: "S3 adapter with shared contracts and Docker MinIO proof",
    },
    {
      id: "s3-multipart",
      text: "Internal multipart + ranged download primitives",
    },
    {
      id: "download-grants",
      text: "Policy-gated download grants (POST /v1/blobs/download-grants)",
    },
    {
      id: "quarantine",
      text: "Quarantine scan orchestration + promotion primitives (services)",
    },
  ],
  outstanding: [
    {
      id: "public-multipart",
      text: "Public multipart upload API (protocol gate A)",
    },
    {
      id: "cc-grants-ui",
      text: "Control Centre UI for multipart upload and workspace quarantine summary",
    },
    {
      id: "user-drive-connectors",
      text: "User cloud-drive connectors (Google/Microsoft/Apple/local) — deferred; see ADR-015",
    },
    {
      id: "storage-ops-niceties",
      text: "Storage ops niceties deferred: pause-ingest, worker config-drift UI, probe metrics, clock-skew diagnostic",
    },
    {
      id: "app-principal-probe",
      text: "Application-principal connection probe (beyond admin session snapshot)",
    },
    {
      id: "backup-telemetry",
      text: "Backup telemetry provider (health.backup beyond not_configured)",
    },
    {
      id: "rel-03",
      text: "Release 0.3 cloud and recovery proof",
    },
    {
      id: "foundation-sync",
      text: "Foundation sync client / desktop virtual drive",
    },
    {
      id: "ai-semantic",
      text: "AI / semantic layer (explicitly deferred)",
    },
    {
      id: "kms-governance",
      text: "Production KMS / Object Lock governance (excluded from Composer scope)",
    },
  ],
} as const satisfies {
  implemented: readonly PlatformStatusItem[];
  outstanding: readonly PlatformStatusItem[];
};

export function platformStatusCounts(): {
  implemented: number;
  partial: number;
  outstanding: number;
  dummy: number;
} {
  let live = 0;
  let partial = 0;
  let dummy = 0;
  for (const entry of Object.values(wiringEntries)) {
    // Diagram node badges are documentation wiring, not Control Centre surfaces.
    if (entry.id.startsWith("flow.node.")) continue;
    if (entry.level === "live") live += 1;
    else if (entry.level === "partial") partial += 1;
    else dummy += 1;
  }
  return {
    implemented: platformStatus.implemented.length,
    partial,
    outstanding: platformStatus.outstanding.length,
    dummy,
  };
}
