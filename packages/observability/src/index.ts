export const operationalAlertKinds = [
  "integrity_failure",
  "missing_blob",
  "audit_chain_failure",
  "backup_stale",
  "privileged_access_denied",
  "cross_workspace_access",
  "anomalous_export",
  "purge_activity",
  "key_failure",
] as const;

export type OperationalAlertKind = (typeof operationalAlertKinds)[number];
export type OperationalSeverity = "warning" | "critical";

export interface OperationalAlert {
  readonly kind: OperationalAlertKind;
  readonly severity: OperationalSeverity;
  readonly occurredAt: string;
  readonly service: string;
  readonly environment: string;
  readonly workspaceId?: string;
  readonly actorId?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly operationId?: string;
  readonly subjectId?: string;
  readonly errorCode?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AlertDeliveryReceipt {
  readonly alertKind: OperationalAlertKind;
  readonly destination: string;
  readonly deliveredAt: string;
  readonly externalReference: string;
}

export interface OperationalAlertSink {
  deliver(alert: OperationalAlert): Promise<AlertDeliveryReceipt>;
}

const forbiddenMetadataKeys =
  /(^|_)(content|payload|prompt|transcript|drawing|secret|token|cookie|password|bytes)($|_)/i;

export function validateOperationalAlert(
  alert: OperationalAlert,
): readonly string[] {
  const issues: string[] = [];
  if (!Number.isFinite(Date.parse(alert.occurredAt))) {
    issues.push("Alert timestamp is invalid.");
  }
  if (alert.service.trim().length === 0 || alert.environment.trim().length === 0) {
    issues.push("Alert service and environment are required.");
  }
  for (const key of Object.keys(alert.metadata ?? {})) {
    if (forbiddenMetadataKeys.test(key)) {
      issues.push(`Alert metadata key is forbidden: ${key}.`);
    }
  }
  if (requiredSeverity(alert.kind) !== alert.severity) {
    issues.push(
      `${alert.kind} alerts must use ${requiredSeverity(alert.kind)} severity.`,
    );
  }
  return issues;
}

export function requiredSeverity(
  kind: OperationalAlertKind,
): OperationalSeverity {
  switch (kind) {
    case "integrity_failure":
    case "missing_blob":
    case "audit_chain_failure":
    case "key_failure":
      return "critical";
    case "backup_stale":
    case "privileged_access_denied":
    case "cross_workspace_access":
    case "anomalous_export":
    case "purge_activity":
      return "warning";
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown operational alert kind: ${String(unreachable)}`);
    }
  }
}

export function missingAlertDeliveryProofs(
  receipts: readonly AlertDeliveryReceipt[],
): readonly OperationalAlertKind[] {
  const delivered = new Set(receipts.map((receipt) => receipt.alertKind));
  return operationalAlertKinds.filter((kind) => !delivered.has(kind));
}
