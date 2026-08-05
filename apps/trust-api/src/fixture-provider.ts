import {
  createIvansDiaryFixture,
  createIvansDiaryPublicationRequest,
} from "@trust-core/fixtures-ivans-diary";
import {
  createWeSketchFixture,
  createWeSketchPublicationRequest,
} from "@trust-core/fixtures-wesketch";
import type { ControlCentreSnapshot } from "@trust-core/protocol";
import { SchemaRegistry } from "@trust-core/schema-registry";

const registry = new SchemaRegistry();
const fixtureApproval = {
  approvedBy: "fixture-release-controller",
  approvalId: "release-0.4-fixture-schemas",
} as const;
registry.publishGoverned(
  createIvansDiaryPublicationRequest(
    fixtureApproval,
    "release-0.4-ivans-diary-1.0.0",
  ),
  "2026-08-04T09:00:00.000Z",
);
registry.publishGoverned(
  createWeSketchPublicationRequest(
    fixtureApproval,
    "release-0.4-wesketch-1.0.0",
  ),
  "2026-08-04T10:00:00.000Z",
);
const diary = createIvansDiaryFixture();
const weSketch = createWeSketchFixture();

const snapshot: ControlCentreSnapshot = {
  status: {
    protectedDatasets: 2,
    activeProjects: 2,
    latestVerifiedBackup: "Synthetic verification pending",
    recoveryAttention: 2,
    canonicalIntegrityPercent: 100,
    canonicalIntegrityStatus: "verified",
    syncQueue: 0,
  },
  datasets: [
    {
      id: diary.dataset.id,
      name: diary.dataset.name,
      description: "Synthetic diary and sketchbooks — no personal information",
      kind: "personal",
      canonicalStore: "Fixture adapter",
      schema: "app/ivans-diary/1.0.0",
      objects: `${diary.resources.length} resources`,
      storage: "Synthetic metadata only",
      lastVerified: "Not yet persisted",
      health: "review",
      recovery: "1 recoverable item",
      deleted: `${diary.tombstones.length} recoverable`,
      recentEvents: ["Schema validation passed", "Synthetic fixture generated"],
    },
    {
      id: weSketch.dataset.id,
      name: weSketch.dataset.name,
      description:
        "Synthetic creative-generation provenance — no personal information",
      kind: "creative",
      canonicalStore: "Fixture adapter",
      schema: "app/wesketch/1.0.0",
      objects: `${weSketch.resources.length} resources`,
      storage: `${weSketch.blobs.length} referenced synthetic blobs`,
      lastVerified: "Not yet persisted",
      health: "review",
      recovery: "1 recoverable generated output",
      deleted: `${weSketch.tombstones.length} recoverable`,
      recentEvents: [
        "Full generation lineage reconstructed",
        "Schema validation passed",
      ],
    },
  ],
};

export const fixtureProvider = {
  async getSnapshot(): Promise<ControlCentreSnapshot> {
    return structuredClone(snapshot);
  },
  async listSchemas() {
    return registry.list();
  },
  async getSchema(key: string) {
    return registry.get(key);
  },
};
