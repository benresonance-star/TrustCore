import { describe, expect, it } from "vitest";
import {
  formatGatewayError,
  remediationFor,
  remediationForHttpStatus,
} from "../src/remediation";

describe("remediation helpers", () => {
  it("returns stable copy for known keys", () => {
    expect(remediationFor("workspace_env")).toContain(
      "VITE_TRUST_WORKSPACE_ID",
    );
    expect(remediationFor("storage_env")).toContain("TRUST_STORAGE_PROVIDER");
    expect(remediationFor("backup_not_configured")).toContain(
      "Backup telemetry",
    );
  });

  it("maps HTTP statuses", () => {
    expect(remediationForHttpStatus(401)).toContain("Sign in again");
    expect(remediationForHttpStatus(403)).toContain("not allowed");
    expect(remediationForHttpStatus(500)).toContain("HTTP 500");
  });

  it("formats gateway errors with status when present", () => {
    const formatted = formatGatewayError({
      message: "Unauthorized",
      status: 401,
    });
    expect(formatted.message).toBe("Unauthorized");
    expect(formatted.status).toBe(401);
    expect(formatted.remediation).toContain("Sign in again");
  });
});
