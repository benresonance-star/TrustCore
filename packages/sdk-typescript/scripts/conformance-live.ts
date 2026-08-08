import {
  createIvansDiaryFixture,
  ivansDiarySchema,
} from "@trust-core/fixtures-ivans-diary";
import {
  createWeSketchFixture,
  weSketchSchema,
} from "@trust-core/fixtures-wesketch";
import {
  createTrustClient,
  runAppConformance,
  type AppConformanceProfile,
  type AppConformanceReport,
} from "../src/index.js";

const baseUrl = required("TRUST_CORE_BASE_URL");
const accessToken = required("TRUST_CORE_ACCESS_TOKEN");
const unassignedToken = required("TRUST_CORE_UNASSIGNED_ACCESS_TOKEN");
const reauthenticationProof = required("TRUST_CORE_REAUTH_PROOF");

const profiles = [
  profile(
    ivansDiarySchema,
    createIvansDiaryFixture(),
    ["original-audio", "editable-strokes", "rendered-fallback"],
    { resourceId: "text-hospital-1", field: "transcriptionConfidence" },
  ),
  profile(weSketchSchema, createWeSketchFixture(), [
    "selection-mask",
    "generated-image",
    "stroke-document",
  ]),
] as const;

const reports: AppConformanceReport[] = [];
for (const candidate of profiles) {
  const client = createTrustClient({
    baseUrl,
    accessToken,
    workspaceId: candidate.workspaceId,
  });
  const unassignedClient = createTrustClient({
    baseUrl,
    accessToken: unassignedToken,
    workspaceId: candidate.workspaceId,
  });
  reports.push(
    await runAppConformance({
      client,
      unassignedClient,
      profile: candidate,
      registrationIdempotencyKey: `release-0.4-register-${slug(candidate.manifest.namespace)}`,
      archiveRoundTrip: {
        reauthenticationProof,
        idempotencyPrefix: `release-0.4-roundtrip-${slug(candidate.manifest.namespace)}`,
      },
    }),
  );
}

console.log(JSON.stringify({ release: "0.4", reports }, null, 2));
if (
  reports.some(
    ({ passed, checks }) =>
      !passed ||
      checks.some(
        ({ name, status }) =>
          (name === "policy-separation" || name === "archive-round-trip") &&
          status !== "passed",
      ),
  )
)
  process.exitCode = 1;

function profile(
  schema: typeof ivansDiarySchema,
  fixture:
    | ReturnType<typeof createIvansDiaryFixture>
    | ReturnType<typeof createWeSketchFixture>,
  blobRoles: readonly string[],
  unknownFieldEvidence?: AppConformanceProfile["unknownFieldEvidence"],
): AppConformanceProfile {
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
        blobRoles,
        additionalFields: schema.resourceTypes.every(
          ({ additionalFields }) => additionalFields === "preserve",
        )
          ? "preserve"
          : "reject",
      },
      capabilities: [
        "dataset:read",
        "resource:read",
        "revision:create",
        "object:ingest",
        "relation:read",
        "history:read",
        "portability:read",
      ],
    },
    workspaceId: fixture.workspace.id,
    datasetId: fixture.dataset.id,
    expectedResourceTypes: schema.resourceTypes.map(({ name }) => name),
    expectedRelationTypes: schema.relationships.map(({ type }) => type),
    ...(unknownFieldEvidence ? { unknownFieldEvidence } : {}),
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live conformance.`);
  return value;
}

function slug(value: string): string {
  return value.replaceAll("/", "-");
}
