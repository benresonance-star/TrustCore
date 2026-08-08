import type {
  ServiceHealth,
  StorageHealthDetails,
  StorageIssueClass,
  StorageProbeResult,
  UploadScanState,
} from "@trust-core/protocol";
import type { RemediationKey } from "./remediation";

export type StorageOperatorStatus =
  "Connected" | "Configured" | "Not set up" | "Needs attention";

export type ScanLifecycleLabel =
  | "Uploaded"
  | "Scanning"
  | "Available"
  | "Blocked"
  | "Held for review"
  | "Awaiting scanner";

export function parseStorageHealthDetails(
  health: ServiceHealth | null | undefined,
): StorageHealthDetails | null {
  if (
    !health ||
    typeof health.details !== "object" ||
    health.details === null
  ) {
    return null;
  }
  const details = health.details as Partial<StorageHealthDetails>;
  if (
    typeof details.provider !== "string" ||
    typeof details.objectStorageConfigured !== "boolean"
  ) {
    return null;
  }
  return details as StorageHealthDetails;
}

export function storageOperatorStatus(
  health: ServiceHealth | null | undefined,
): StorageOperatorStatus {
  if (!health) return "Needs attention";
  const details = parseStorageHealthDetails(health);
  if (
    health.status === "not_configured" ||
    details?.objectStorageConfigured === false
  ) {
    return "Not set up";
  }
  if (details?.probe && !details.probe.ok) return "Needs attention";
  if (details?.probe?.ok === true) return "Connected";
  if ((details?.failedVerificationObjects ?? 0) > 0) return "Needs attention";
  if (details?.objectStorageConfigured) return "Configured";
  return "Needs attention";
}

export function remediationKeyForIssueClass(
  issueClass: StorageIssueClass | null | undefined,
): RemediationKey {
  switch (issueClass) {
    case "not_configured":
      return "storage_env";
    case "auth":
      return "storage_auth";
    case "permission":
      return "storage_permission";
    case "not_found":
      return "storage_not_found";
    case "wrong_region":
      return "storage_wrong_region";
    case "network":
      return "storage_network";
    case "provider_outage":
      return "storage_outage";
    case "internal":
      return "storage_internal";
    default:
      return "storage_degraded";
  }
}

export function remediationKeyForHealth(
  health: ServiceHealth | null | undefined,
): RemediationKey {
  const details = parseStorageHealthDetails(health);
  const issueClass = details?.probe?.issueClass;
  if (issueClass) return remediationKeyForIssueClass(issueClass);
  if (!health || health.status === "not_configured") return "storage_env";
  if (health.status === "degraded") return "storage_degraded";
  return "storage_degraded";
}

export const managedOnServerCopy =
  "Storage access is managed on the server (environment variables or IAM). This screen diagnoses the connection and links to the provider console — it does not store secrets in the browser.";

export const reconnectChecklist: readonly string[] = [
  "Open the provider console using the button below (or your cloud account).",
  "Confirm the bucket, region, and IAM role or keys on the Trust API host.",
  "Grant the minimal object-storage actions listed in the deploy README.",
  "Restart or reload the API process if env vars changed, then run Test connection.",
];

export function mapScanStateToLifecycle(
  state: UploadScanState | string | undefined,
  options: { scannerConfigured?: boolean } = {},
): ScanLifecycleLabel {
  switch (state) {
    case "pending_upload":
    case "uploaded":
      return "Uploaded";
    case "scan_queued":
    case "scanning":
    case "promotion_pending":
    case "accepted":
      return options.scannerConfigured === false
        ? "Awaiting scanner"
        : "Scanning";
    case "promoted":
      return "Available";
    case "rejected":
    case "failed":
      return "Blocked";
    case "manual_review":
      return "Held for review";
    default:
      return options.scannerConfigured === false
        ? "Awaiting scanner"
        : "Uploaded";
  }
}

export function mapScanStateToLifecycleLabel(
  state: UploadScanState | string | undefined,
  options: { scannerConfigured?: boolean } = {},
): ScanLifecycleLabel {
  return mapScanStateToLifecycle(state, options);
}

export function primaryConsoleLink(details: StorageHealthDetails | null) {
  return details?.consoleLinks?.[0] ?? null;
}

export function probeFromDetails(
  details: StorageHealthDetails | null,
): StorageProbeResult | null {
  return details?.probe ?? null;
}
