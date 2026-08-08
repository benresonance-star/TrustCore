export const oidcAcceptanceChecks = [
  "authorization_code_pkce",
  "deny_by_default_claim_mapping",
  "mfa_or_passkey_assurance",
  "user_disablement",
  "session_revocation",
  "fresh_same_principal_reauthentication",
] as const;

export type OidcAcceptanceCheck = (typeof oidcAcceptanceChecks)[number];

export interface OidcAcceptanceResult {
  readonly check: OidcAcceptanceCheck;
  readonly passed: boolean;
  readonly occurredAt: string;
  readonly evidenceUri: string;
}

export interface OidcAcceptanceEvidence {
  readonly sourceCommit: string;
  readonly issuer: string;
  readonly tenantReference: string;
  readonly results: readonly OidcAcceptanceResult[];
}

export interface OidcAcceptanceReport {
  readonly passed: boolean;
  readonly issues: readonly string[];
}

export function evaluateOidcAcceptance(
  evidence: OidcAcceptanceEvidence,
): OidcAcceptanceReport {
  const issues: string[] = [];
  if (!/^[a-f0-9]{40}$/.test(evidence.sourceCommit)) {
    issues.push("OIDC evidence must identify an exact Git commit.");
  }
  if (!isHttpsUrl(evidence.issuer)) {
    issues.push("OIDC issuer must use HTTPS.");
  }
  if (evidence.tenantReference.trim().length === 0) {
    issues.push("OIDC evidence must identify the tested tenant.");
  }
  const byCheck = new Map<OidcAcceptanceCheck, OidcAcceptanceResult>();
  for (const result of evidence.results) {
    if (byCheck.has(result.check)) {
      issues.push(`OIDC acceptance check is duplicated: ${result.check}.`);
      continue;
    }
    byCheck.set(result.check, result);
    if (!result.passed) {
      issues.push(`OIDC acceptance check failed: ${result.check}.`);
    }
    if (!Number.isFinite(Date.parse(result.occurredAt))) {
      issues.push(`OIDC acceptance timestamp is invalid: ${result.check}.`);
    }
    if (!/^(https:\/\/|artifact:)[^\s]+$/.test(result.evidenceUri)) {
      issues.push(`OIDC acceptance evidence URI is invalid: ${result.check}.`);
    }
  }
  for (const check of oidcAcceptanceChecks) {
    if (!byCheck.has(check)) {
      issues.push(`OIDC acceptance check is missing: ${check}.`);
    }
  }
  return { passed: issues.length === 0, issues };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
