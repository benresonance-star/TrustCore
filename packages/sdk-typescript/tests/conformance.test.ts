import {
  createIvansDiaryFixture,
  ivansDiarySchema,
} from "@trust-core/fixtures-ivans-diary";
import {
  createWeSketchFixture,
  weSketchSchema,
} from "@trust-core/fixtures-wesketch";
import { describe, expect, it } from "vitest";
import {
  TrustApiError,
  runAppConformance,
  type AppConformanceProfile,
  type TrustClient,
} from "../src/index.js";

describe("live TCAP application conformance", () => {
  it("runs Ivan's Diary and WeSketch through public SDK facades", async () => {
    const cases = [
      {
        fixture: createIvansDiaryFixture(),
        schema: ivansDiarySchema,
        unknownFieldEvidence: {
          resourceId: "text-hospital-1",
          field: "transcriptionConfidence",
        },
      },
      {
        fixture: createWeSketchFixture(),
        schema: weSketchSchema,
      },
    ] as const;

    for (const candidate of cases) {
      const profile = createProfile(candidate);
      const report = await runAppConformance({
        client: publicClient(candidate),
        unassignedClient: deniedClient(),
        profile,
        registrationIdempotencyKey: `register-${candidate.schema.name}`,
        archiveRoundTrip: {
          reauthenticationProof: "fresh-proof",
          idempotencyPrefix: `roundtrip-${candidate.schema.name}`,
          pollIntervalMs: 0,
        },
      });
      expect(report.passed, JSON.stringify(report.checks, null, 2)).toBe(true);
      expect(report.checks.filter(({ status }) => status === "failed")).toEqual(
        [],
      );
      expect(
        report.checks.find(({ name }) => name === "archive-round-trip")?.status,
      ).toBe("passed");
      expect(
        report.checks.find(({ name }) => name === "policy-separation")?.status,
      ).toBe("passed");
    }
  });
});

function createProfile(candidate: {
  readonly fixture:
    | ReturnType<typeof createIvansDiaryFixture>
    | ReturnType<typeof createWeSketchFixture>;
  readonly schema: typeof ivansDiarySchema;
  readonly unknownFieldEvidence?: AppConformanceProfile["unknownFieldEvidence"];
}): AppConformanceProfile {
  const { fixture, schema } = candidate;
  return {
    manifest: {
      protocolVersion: "TCAP/1.0",
      namespace: `${schema.namespace}/${schema.name}`,
      name: schema.title,
      applicationVersion: "1.0.0",
      schemaPackage: {
        key: `${schema.namespace}/${schema.name}/${schema.version}`,
        version: schema.version,
        resourceTypes: schema.resourceTypes.map(({ name }) => name),
        relationTypes: schema.relationships.map(({ type }) => type),
        blobRoles: [],
        additionalFields: schema.resourceTypes.every(
          ({ additionalFields }) => additionalFields === "preserve",
        )
          ? "preserve"
          : "reject",
      },
      capabilities: [
        "dataset:read",
        "resource:read",
        "relation:read",
        "history:read",
        "portability:read",
      ],
    },
    workspaceId: fixture.workspace.id,
    datasetId: fixture.dataset.id,
    expectedResourceTypes: schema.resourceTypes.map(({ name }) => name),
    expectedRelationTypes: schema.relationships.map(({ type }) => type),
    ...(candidate.unknownFieldEvidence
      ? { unknownFieldEvidence: candidate.unknownFieldEvidence }
      : {}),
  };
}

function publicClient(candidate: {
  readonly fixture:
    | ReturnType<typeof createIvansDiaryFixture>
    | ReturnType<typeof createWeSketchFixture>;
  readonly schema: typeof ivansDiarySchema;
}): TrustClient {
  const { fixture, schema } = candidate;
  const registration = {
    id: `application-${schema.name}`,
    workspaceId: fixture.workspace.id,
    namespace: `app/${schema.name}`,
    name: schema.title,
    applicationVersion: "1.0.0",
    schemaPackageIds: [`schema-${schema.name}`],
    capabilities: [],
    status: "active" as const,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
  return {
    health: {
      get: async () => ({
        service: "trust-api",
        status: "ok",
        mode: "live",
        checkedAt: "2026-08-05T00:00:00.000Z",
      }),
    },
    schemas: {
      get: async () => ({
        id: `schema-${schema.name}`,
        key: `${schema.namespace}/${schema.name}/${schema.version}`,
        digest: "digest",
        status: "active",
        publishedAt: "2026-08-05T00:00:00.000Z",
        manifest: schema,
        governance: {
          protocolVersion: "TCAP/1.0",
          applicationNamespace: `app/${schema.name}`,
          applicationVersion: "1.0.0",
          approvedBy: "release-admin",
          approvalId: "approval-1",
          idempotencyKey: "publish-1",
        },
        compatibility: {
          classification: "initial",
          previousKey: null,
          changes: [],
        },
      }),
    },
    applications: { register: async () => registration },
    resources: { list: async () => ({ items: fixture.resources }) },
    relations: { list: async () => ({ items: fixture.relations }) },
    history: {
      list: async () => ({
        events: [
          {
            id: "event",
            action: "fixture.loaded",
            subjectId: fixture.dataset.id,
            actorId: "fixture",
            occurredAt: "2026-08-05T00:00:00.000Z",
            metadata: {},
          },
        ],
        recoverable: [],
      }),
    },
    revisions: {
      graph: async (resourceId: string) => ({
        resourceId,
        headRevisionId:
          fixture.resources.find(({ id }) => id === resourceId)
            ?.currentRevisionId ?? null,
        revisions: fixture.revisions.filter(
          (revision) => revision.resourceId === resourceId,
        ),
      }),
    },
    portability: {
      exports: {
        create: async () => ({ id: "export", status: "ready" }),
        download: async () => ({
          id: "export",
          status: "ready",
          archiveBase64: "YXJjaGl2ZQ==",
        }),
      },
      archives: {
        upload: async () => ({ id: "archive", status: "verified" }),
      },
      plans: {
        create: async () => ({ id: "plan", status: "ready" }),
        execute: async () => ({
          id: "operation",
          status: "completed",
          checkpoint: "completed",
        }),
      },
      operations: {
        get: async () => ({
          id: "operation",
          status: "completed",
          checkpoint: "completed",
        }),
      },
    },
  } as unknown as TrustClient;
}

function deniedClient(): TrustClient {
  return {
    resources: {
      list: async () => {
        throw new TrustApiError(403, {
          code: "PERMISSION_DENIED",
          message: "Policy assignment required.",
        });
      },
    },
  } as unknown as TrustClient;
}
