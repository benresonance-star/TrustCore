import { createIvansDiaryFixture, ivansDiarySchema } from "@trust-core/fixtures-ivans-diary";
import type { ControlCentreSnapshot } from "@trust-core/protocol";
import { SchemaRegistry } from "@trust-core/schema-registry";

const registry = new SchemaRegistry();
registry.publish(ivansDiarySchema, "2026-08-04T09:00:00.000Z");
const fixture = createIvansDiaryFixture();

const snapshot: ControlCentreSnapshot = {
  status: { protectedDatasets: 1, activeProjects: 1, latestVerifiedBackup: "Synthetic verification pending", recoveryAttention: 1, canonicalIntegrityPercent: 100, syncQueue: 0 },
  datasets: [{
    id: fixture.dataset.id,
    name: fixture.dataset.name,
    description: "Synthetic diary and sketchbooks — no personal information",
    kind: "personal",
    canonicalStore: "Fixture adapter",
    schema: "app/ivans-diary/1.0.0",
    objects: `${fixture.resources.length} resources`,
    storage: "Synthetic metadata only",
    lastVerified: "Not yet persisted",
    health: "review",
    recovery: "1 recoverable item",
    deleted: `${fixture.tombstones.length} recoverable`,
    recentEvents: ["Schema validation passed", "Synthetic fixture generated"],
  }],
};

export const fixtureProvider = {
  async getSnapshot(): Promise<ControlCentreSnapshot> { return structuredClone(snapshot); },
  async listSchemas() { return registry.list(); },
  async getSchema(key: string) { return registry.get(key); },
};
