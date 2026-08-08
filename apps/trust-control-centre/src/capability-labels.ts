import type { AppCapability } from "@trust-core/app-protocol";

export const capabilityLabels: Readonly<Record<AppCapability, string>> = {
  "dataset:read": "App can read datasets",
  "resource:read": "App can read resources",
  "revision:create": "App can create revisions",
  "object:ingest": "App can ingest files",
  "blob:read": "App can read files",
  "relation:read": "App can read relations",
  "history:read": "App can read history",
  "portability:read": "App can read portability archives",
};

export function labelForCapability(capability: AppCapability): string {
  return capabilityLabels[capability];
}
