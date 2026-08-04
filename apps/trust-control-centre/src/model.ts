export type Section = "home" | "datasets" | "flow" | "health" | "history" | "access";

export type { ControlCentreSnapshot, DatasetSummary, SystemStatus } from "@trust-core/protocol";
import type { AdminSession, ControlCentreSnapshot, HistorySnapshot, RevisionCommandResult, VerificationRunResult } from "@trust-core/protocol";

export interface ControlCentreGateway {
  getSnapshot(): Promise<ControlCentreSnapshot>;
  getHistory(workspaceId: string): Promise<HistorySnapshot>;
  restoreResource(workspaceId: string, resourceId: string): Promise<RevisionCommandResult>;
  startAdminSession(token: string): Promise<AdminSession>;
  endAdminSession(): Promise<void>;
  beginFederatedLogin(returnTo?: string): void;
  runVerification(workspaceId:string,level:"metadata"|"full_blob"):Promise<VerificationRunResult>;
}
