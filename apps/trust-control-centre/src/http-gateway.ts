import { TrustApiError, createTrustClient } from "@trust-core/sdk";
import type { ControlCentreGateway } from "./model";

let csrfToken =
  typeof document === "undefined" ? "" : (readCookie("trust_csrf") ?? "");
const base =
  (import.meta.env.VITE_TRUST_API_BASE as string | undefined)?.replace(
    /\/$/,
    "",
  ) ?? "/api";
const configuredWorkspace =
  (import.meta.env.VITE_TRUST_WORKSPACE_ID as string | undefined)?.trim() ?? "";
const client = createTrustClient({
  baseUrl: base,
  workspaceId: configuredWorkspace,
  credentials: "include",
  csrfToken: () => csrfToken,
});
export { TrustApiError as GatewayError };
export const httpGateway: ControlCentreGateway = {
  mode: "live",
  workspaceId: configuredWorkspace,
  getSnapshot: () => client.control.snapshot(),
  async getOperationalSnapshot() {
    const [storage, backup, verifications] = await Promise.all([
      client.health.storage(),
      client.health.backup(),
      client.verification.list(),
    ]);
    return {
      storage,
      backup,
      latestVerification: verifications.items[0] ?? null,
    };
  },
  getHistory: (workspaceId) => client.history.list({ workspaceId }),
  createArchiveExport: (workspaceId, datasetIds, reauthenticationProof) =>
    client.datasetsContext({ workspaceId }).portability.exports.create({
      datasetIds,
      reauthenticationProof,
    }),
  downloadArchiveExport: (workspaceId, exportId, reauthenticationProof) =>
    client
      .datasetsContext({ workspaceId })
      .portability.exports.downloadBytes(exportId, reauthenticationProof),
  async listPolicyAssignments(workspaceId) {
    return (
      await client.datasetsContext({ workspaceId }).policyAssignments.list()
    ).items;
  },
  createPolicyAssignment: (workspaceId, input) =>
    client.datasetsContext({ workspaceId }).policyAssignments.create({
      ...input,
      idempotencyKey: client.idempotency.create("policy-assignment"),
    }),
  revokePolicyAssignment: (workspaceId, assignmentId) =>
    client
      .datasetsContext({ workspaceId })
      .policyAssignments.revoke(assignmentId),
  restoreResource: (workspaceId, resourceId) =>
    client.datasetsContext({ workspaceId }).resources.restore(resourceId, {
      changeNote: "Restored from Trust Core Control Centre",
    }),
  async startAdminSession(token) {
    const session = await client.auth.startSession(token);
    csrfToken = session.csrfToken;
    return session;
  },
  async endAdminSession() {
    await client.auth.endSession();
    csrfToken = "";
  },
  beginFederatedLogin(returnTo = "/") {
    window.location.assign(client.auth.oidcUrl(returnTo));
  },
  runVerification: (workspaceId, level) =>
    client.datasetsContext({ workspaceId }).verification.run({ level }),
  uploadArchive: (workspaceId, bytes) =>
    client.datasetsContext({ workspaceId }).portability.archives.upload({
      bytes,
    }),
  createImportPlan: (workspaceId, archiveId, mode) =>
    client.datasetsContext({ workspaceId }).portability.plans.create({
      archiveId,
      mode,
      conflictMode: "reject_on_error",
      idempotencyKey: client.idempotency.create("import-plan"),
    }),
  executeImportPlan: (workspaceId, planId, reauthenticationProof) =>
    client.datasetsContext({ workspaceId }).portability.plans.execute(planId, {
      reauthenticationProof,
    }),
  getImportOperation: (workspaceId, operationId) =>
    client
      .datasetsContext({ workspaceId })
      .portability.operations.get(operationId),
};
function readCookie(name: string): string | undefined {
  return document.cookie
    .split(";")
    .map((item) => item.trim().split("="))
    .find(([key]) => key === name)?.[1];
}
