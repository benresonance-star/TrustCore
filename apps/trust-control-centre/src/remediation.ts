export type RemediationKey =
  | "sign_in"
  | "workspace_env"
  | "storage_env"
  | "storage_degraded"
  | "backup_not_configured"
  | "register_app"
  | "grant_access"
  | "probe_failed"
  | "http_401"
  | "http_403"
  | "http_generic";

const copy: Readonly<Record<RemediationKey, string>> = {
  sign_in:
    "Open the administrator sign-in screen and continue with organisation identity, or use a bootstrap token in development.",
  workspace_env:
    "Set VITE_TRUST_WORKSPACE_ID for the Control Centre build, then reload. The workspace must already exist in Trust API.",
  storage_env:
    "Object storage is not configured on the Trust API host. A server operator must set TRUST_STORAGE_PROVIDER and related bucket credentials (see deploy README).",
  storage_degraded:
    "Canonical storage reported a degraded state. Check Trust API storage health and object-store connectivity before registering apps that ingest blobs.",
  backup_not_configured:
    "Backup telemetry is not configured. Continuity still works for verified storage; a server operator must attach a backup telemetry provider for this row to turn green.",
  register_app:
    "Use Connections → Register application with a namespace, name, version, and capabilities, then retry.",
  grant_access:
    "After registration, grant the application a role (for example editor or auditor) on the workspace or a dataset.",
  probe_failed:
    "Confirm you are signed in, the workspace id is correct, and Trust API is reachable. Copy any status code shown and check History for related events.",
  http_401:
    "Administrator session expired or is missing. Sign in again, then retry the action.",
  http_403:
    "This administrator principal is not allowed to perform that action. Use an owner or admin role, or adjust policy assignments.",
  http_generic:
    "The Trust API rejected the request. Copy the status code and operation details, then inspect API logs or History.",
};

export function remediationFor(key: RemediationKey): string {
  return copy[key];
}

export function remediationForHttpStatus(status: number): string {
  if (status === 401) return remediationFor("http_401");
  if (status === 403) return remediationFor("http_403");
  return `${remediationFor("http_generic")} (HTTP ${status}).`;
}

export function formatGatewayError(error: unknown): {
  message: string;
  remediation: string;
  status?: number;
} {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Request failed unexpectedly.";
  return {
    message,
    remediation:
      status === undefined
        ? remediationFor("http_generic")
        : remediationForHttpStatus(status),
    ...(status === undefined ? {} : { status }),
  };
}
