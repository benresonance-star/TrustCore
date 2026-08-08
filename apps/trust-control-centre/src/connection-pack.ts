import type { AppProtocolBundle } from "@trust-core/app-protocol";
import type { ApplicationRegistration } from "@trust-core/protocol";
import type { ConnectionProbeResult } from "./connection-probe";

export const CONNECTION_PACK_SCHEMA_VERSION = "1.0.0" as const;
export const CONNECTION_PACK_SDK_PACKAGE = "@trust-core/sdk" as const;
export const CONNECTION_PACK_TCAP_VERSION = "TCAP/1.0" as const;

export interface TrustConnectionPack {
  readonly schemaVersion: typeof CONNECTION_PACK_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly apiBase: string;
  readonly applicationId: string;
  readonly sdkPackage: typeof CONNECTION_PACK_SDK_PACKAGE;
  readonly tcapVersion: typeof CONNECTION_PACK_TCAP_VERSION;
  readonly manifest: AppProtocolBundle["manifest"] | null;
  readonly methods: AppProtocolBundle["methods"] | null;
  readonly agentBrief: string;
  readonly policyAssignmentIds: readonly string[];
  readonly capabilityGrants: readonly string[];
  readonly probeResult: ConnectionProbeResult | null;
  readonly application: Pick<
    ApplicationRegistration,
    | "id"
    | "namespace"
    | "name"
    | "applicationVersion"
    | "capabilities"
    | "status"
  > | null;
}

export function buildConnectionPack(input: {
  workspaceId: string;
  apiBase: string;
  application: ApplicationRegistration | null;
  policyAssignmentIds: readonly string[];
  bundle: AppProtocolBundle | null;
  probeResult: ConnectionProbeResult | null;
}): TrustConnectionPack {
  return {
    schemaVersion: CONNECTION_PACK_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    apiBase: input.apiBase,
    applicationId: input.application?.id ?? "",
    sdkPackage: CONNECTION_PACK_SDK_PACKAGE,
    tcapVersion: CONNECTION_PACK_TCAP_VERSION,
    manifest: input.bundle?.manifest ?? null,
    methods: input.bundle?.methods ?? null,
    agentBrief:
      input.bundle?.agentBrief ??
      "Generate an App protocol bundle before handing off to an agent.",
    policyAssignmentIds: [...input.policyAssignmentIds],
    capabilityGrants: [...(input.application?.capabilities ?? [])],
    probeResult: input.probeResult,
    application: input.application
      ? {
          id: input.application.id,
          namespace: input.application.namespace,
          name: input.application.name,
          applicationVersion: input.application.applicationVersion,
          capabilities: input.application.capabilities,
          status: input.application.status,
        }
      : null,
  };
}

export function connectionPackFilename(applicationId: string): string {
  const slug = applicationId || "unregistered";
  return `trust-connection-pack-${slug}.json`;
}
