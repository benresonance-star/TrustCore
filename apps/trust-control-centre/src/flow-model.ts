import {
  Archive,
  Box,
  FileClock,
  Fingerprint,
  GitBranch,
  Network,
  PackageOpen,
  PanelsTopLeft,
  Sparkles,
  TableProperties,
  type LucideIcon,
} from "lucide-react";
import type { Section } from "./model";
import {
  getWiringEntry,
  type WiringEntryId,
  type WiringLevel,
} from "./wiring-status";

export type FlowNodeId =
  | "apps"
  | "gateway"
  | "identity"
  | "revision"
  | "portability"
  | "semantic"
  | "metadata"
  | "objects"
  | "audit"
  | "backup";

export type FlowSignalKey =
  | "applications"
  | "gateway"
  | "identity"
  | "revision"
  | "portability"
  | "semantic"
  | "metadata"
  | "objects"
  | "audit"
  | "backup";

export interface FlowNode {
  readonly id: FlowNodeId;
  readonly label: string;
  readonly note: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly wiringId: WiringEntryId;
  readonly deepLink: Section;
  readonly deepLinkLabel: string;
  readonly signalKey: FlowSignalKey;
  readonly Icon: LucideIcon;
}

export const flowNodes: readonly FlowNode[] = [
  {
    id: "apps",
    label: "Applications",
    note: "Foundation · WeSketch · Ivan",
    description:
      "Registered client apps that write through Trust API. Live count comes from applications.list; tenant/binding diagnostics live in Apps & Tenants (Partial). Registration and connection packs remain in Connections.",
    features: [
      "Register and list applications",
      "Open Apps & Tenants for storage bindings",
      "Download connection pack",
      "Workspace readiness probe",
      "TCAP method map via App protocol",
    ],
    wiringId: "flow.node.apps",
    deepLink: "apps",
    deepLinkLabel: "Apps & Tenants",
    signalKey: "applications",
    Icon: PanelsTopLeft,
  },
  {
    id: "gateway",
    label: "Trust API",
    note: "One governed entry point",
    description:
      "HTTP gateway for snapshot, health, history, access, and portability. Fixture mode serves synthetic data; live mode hits the configured Trust API base URL.",
    features: [
      "Control Centre snapshot",
      "Operational health and verification",
      "History and restore",
      "Access policy and session",
      "Portability export and import",
    ],
    wiringId: "flow.node.gateway",
    deepLink: "health",
    deepLinkLabel: "Health",
    signalKey: "gateway",
    Icon: Network,
  },
  {
    id: "identity",
    label: "Identity & policy",
    note: "Owner · role · permission",
    description:
      "Session sign-in, policy list/create/revoke, and access grants. Passkey/MFA lines remain preview-only Dummy controls in Access.",
    features: [
      "Session sign-in and sign-out",
      "Policy assign and revoke",
      "Owner and role grants",
      "Passkey/MFA preview (Dummy)",
    ],
    wiringId: "flow.node.identity",
    deepLink: "access",
    deepLinkLabel: "Access",
    signalKey: "identity",
    Icon: Fingerprint,
  },
  {
    id: "revision",
    label: "Revision engine",
    note: "Immutable history",
    description:
      "Ingest checkpoints, revision list, and restore. Maps to History and the Release 0.1 trust loop for immutable canonical history.",
    features: [
      "Object ingest checkpoints",
      "Revision list",
      "Restore resource",
      "Recovery bin",
    ],
    wiringId: "flow.node.revision",
    deepLink: "history",
    deepLinkLabel: "History",
    signalKey: "revision",
    Icon: GitBranch,
  },
  {
    id: "portability",
    label: "Portability",
    note: "Import · export · migrate",
    description:
      "Archive export, upload, import plan, and execute. Fixture keeps operations in memory; live mode hits Trust API portability flows.",
    features: [
      "Export archive",
      "Upload archive",
      "Import plan",
      "Execute import",
    ],
    wiringId: "flow.node.portability",
    deepLink: "portability",
    deepLinkLabel: "Portability",
    signalKey: "portability",
    Icon: PackageOpen,
  },
  {
    id: "semantic",
    label: "Semantic layer",
    note: "Derived, never canonical",
    description:
      "AI / semantic derivation is explicitly deferred. This node stays Dummy until a product surface exists. Derived indexes must never write canonical bytes.",
    features: [
      "Derived indexes (deferred)",
      "Never canonical",
      "No Control Centre surface yet",
    ],
    wiringId: "flow.node.semantic",
    deepLink: "platform-status",
    deepLinkLabel: "Platform status",
    signalKey: "semantic",
    Icon: Sparkles,
  },
  {
    id: "metadata",
    label: "Metadata store",
    note: "Identity and relationships",
    description:
      "Workspaces, datasets, resources, and relations from the Control Centre snapshot. Dataset create/edit is not exposed in this UI.",
    features: [
      "Workspaces",
      "Datasets",
      "Resources and relations",
      "Integrity labels",
    ],
    wiringId: "flow.node.metadata",
    deepLink: "datasets",
    deepLinkLabel: "Datasets",
    signalKey: "metadata",
    Icon: TableProperties,
  },
  {
    id: "objects",
    label: "Canonical objects",
    note: "Original bytes preserved",
    description:
      "Content-addressed blobs via storage adapters. Download grants are live; open Storage for operator diagnostics. Public multipart upload remains outstanding.",
    features: [
      "Content-addressed blobs",
      "Policy-gated download grants",
      "Storage provider diagnostics",
      "Quarantine scan status",
    ],
    wiringId: "flow.node.objects",
    deepLink: "storage",
    deepLinkLabel: "Storage",
    signalKey: "objects",
    Icon: Box,
  },
  {
    id: "audit",
    label: "Audit log",
    note: "Append-only trust events",
    description:
      "Append-only SHA-256 trust events surfaced through History recovery and trust-event paths.",
    features: [
      "Append-only trust events",
      "Hash-chained audit",
      "History event list",
    ],
    wiringId: "flow.node.audit",
    deepLink: "history",
    deepLinkLabel: "History",
    signalKey: "audit",
    Icon: FileClock,
  },
  {
    id: "backup",
    label: "Backup & archive",
    note: "Restore beyond the app",
    description:
      "Portability archives exist; health.backup may report not_configured until a backup telemetry provider ships. Restore beyond the app remains Partial.",
    features: [
      "Portability archives",
      "Backup health telemetry",
      "Restore beyond the app",
    ],
    wiringId: "flow.node.backup",
    deepLink: "health",
    deepLinkLabel: "Health",
    signalKey: "backup",
    Icon: Archive,
  },
] as const;

export function flowNodeLevel(node: FlowNode): WiringLevel {
  return getWiringEntry(node.wiringId).level;
}

export function flowBadgeCounts(): {
  live: number;
  partial: number;
  dummy: number;
} {
  let live = 0;
  let partial = 0;
  let dummy = 0;
  for (const node of flowNodes) {
    const level = flowNodeLevel(node);
    if (level === "live") live += 1;
    else if (level === "partial") partial += 1;
    else dummy += 1;
  }
  return { live, partial, dummy };
}
