import { describe, expect, it } from "vitest";
import {
  missingAlertDeliveryProofs,
  operationalAlertKinds,
  requiredSeverity,
  validateOperationalAlert,
  type AlertDeliveryReceipt,
} from "../src/index.js";

describe("operational alert contract", () => {
  it("accepts content-free integrity alerts", () => {
    expect(
      validateOperationalAlert({
        kind: "integrity_failure",
        severity: "critical",
        occurredAt: "2026-08-05T10:00:00.000Z",
        service: "trust-api",
        environment: "production",
        workspaceId: "workspace-1",
        errorCode: "INTEGRITY_FAILURE",
        metadata: { objectsChecked: 12 },
      }),
    ).toEqual([]);
  });

  it("rejects content-bearing metadata and incorrect severity", () => {
    expect(
      validateOperationalAlert({
        kind: "missing_blob",
        severity: "warning",
        occurredAt: "2026-08-05T10:00:00.000Z",
        service: "trust-worker",
        environment: "production",
        metadata: { canonical_payload: "must not be logged" },
      }),
    ).toEqual(
      expect.arrayContaining([
        "Alert metadata key is forbidden: canonical_payload.",
        "missing_blob alerts must use critical severity.",
      ]),
    );
  });

  it("reports every alert without delivery evidence", () => {
    const receipts: AlertDeliveryReceipt[] = operationalAlertKinds
      .slice(0, -1)
      .map((kind) => ({
        alertKind: kind,
        destination: "operations",
        deliveredAt: "2026-08-05T10:00:00.000Z",
        externalReference: `alert-${kind}`,
      }));
    expect(missingAlertDeliveryProofs(receipts)).toEqual(["key_failure"]);
    expect(requiredSeverity("key_failure")).toBe("critical");
  });
});
