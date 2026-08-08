import { describe, expect, it } from "vitest";
import {
  evaluateOidcAcceptance,
  oidcAcceptanceChecks,
} from "../src/index.js";

describe("organisation OIDC acceptance evidence", () => {
  it("requires all external identity exercises", () => {
    const report = evaluateOidcAcceptance({
      sourceCommit: "a".repeat(40),
      issuer: "https://identity.example.test",
      tenantReference: "production-acceptance",
      results: oidcAcceptanceChecks.map((check) => ({
        check,
        passed: true,
        occurredAt: "2026-08-05T10:00:00.000Z",
        evidenceUri: `artifact:oidc/${check}.json`,
      })),
    });
    expect(report).toEqual({ passed: true, issues: [] });
  });

  it("rejects insecure issuers and incomplete evidence", () => {
    const report = evaluateOidcAcceptance({
      sourceCommit: "dirty-tree",
      issuer: "http://identity.example.test",
      tenantReference: "",
      results: [],
    });
    expect(report.passed).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        "OIDC evidence must identify an exact Git commit.",
        "OIDC issuer must use HTTPS.",
        "OIDC evidence must identify the tested tenant.",
        "OIDC acceptance check is missing: session_revocation.",
      ]),
    );
  });
});
