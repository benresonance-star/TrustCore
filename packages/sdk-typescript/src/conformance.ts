import type { TrustClient } from "./client.js";
import { TrustApiError } from "./generated/transport.js";

export type ConformanceCheckStatus = "passed" | "failed" | "skipped";

export interface ConformanceCheck {
  readonly name: string;
  readonly status: ConformanceCheckStatus;
  readonly detail: string;
}

export interface AppConformanceProfile {
  readonly manifest: ConformanceManifest;
  readonly workspaceId: string;
  readonly datasetId: string;
  readonly expectedResourceTypes: readonly string[];
  readonly expectedRelationTypes: readonly string[];
  readonly unknownFieldEvidence?: {
    readonly resourceId: string;
    readonly field: string;
  };
}

export interface ConformanceManifest {
  readonly protocolVersion: "TCAP/1.0";
  readonly namespace: string;
  readonly name: string;
  readonly applicationVersion: string;
  readonly schemaPackage: {
    readonly key: string;
    readonly version: string;
    readonly resourceTypes: readonly string[];
    readonly relationTypes: readonly string[];
    readonly blobRoles: readonly string[];
    readonly additionalFields: "preserve" | "reject";
  };
  readonly capabilities: readonly string[];
}

export interface AppConformanceOptions {
  readonly client: TrustClient;
  readonly unassignedClient?: TrustClient;
  readonly profile: AppConformanceProfile;
  readonly registrationIdempotencyKey: string;
  readonly archiveRoundTrip?: {
    readonly reauthenticationProof: string;
    readonly idempotencyPrefix: string;
    readonly pollIntervalMs?: number;
    readonly pollAttempts?: number;
  };
}

export interface AppConformanceReport {
  readonly protocolVersion: "TCAP/1.0";
  readonly applicationNamespace: string;
  readonly passed: boolean;
  readonly checks: readonly ConformanceCheck[];
}

export async function runAppConformance(
  options: AppConformanceOptions,
): Promise<AppConformanceReport> {
  const { client, profile } = options;
  const checks: ConformanceCheck[] = [];
  await check(checks, "public-api-health", async () => {
    const health = await client.health.get();
    assert(health.status === "ok", "Trust API health is not ok.");
    return `Connected to ${health.service} in ${health.mode} mode.`;
  });

  let schemaId: string | undefined;
  await check(checks, "governed-schema-publication", async () => {
    const schema = await client.schemas.get(profile.manifest.schemaPackage.key);
    schemaId = schema.id;
    assert(
      schema.key === profile.manifest.schemaPackage.key,
      "Published schema key does not match TCAP.",
    );
    assert(
      schema.governance?.protocolVersion === profile.manifest.protocolVersion,
      "Schema is missing matching TCAP governance evidence.",
    );
    assert(
      schema.compatibility?.classification !== undefined,
      "Schema is missing compatibility classification.",
    );
    return `${schema.key} is ${schema.compatibility.classification}.`;
  });

  await check(checks, "registration-idempotency", async () => {
    assert(schemaId, "Schema publication must pass before registration.");
    const command = {
      namespace: profile.manifest.namespace,
      name: profile.manifest.name,
      applicationVersion: profile.manifest.applicationVersion,
      schemaPackageIds: [schemaId],
      capabilities: profile.manifest.capabilities,
      idempotencyKey: options.registrationIdempotencyKey,
    };
    const first = await client.applications.register(command);
    const replay = await client.applications.register(command);
    assert(
      first.id === replay.id,
      "Registration replay created a new identity.",
    );
    return `Registration ${first.id} replayed without duplication.`;
  });

  await check(checks, "resource-conformance", async () => {
    const resources = await client.resources.list({
      workspaceId: profile.workspaceId,
      datasetId: profile.datasetId,
    });
    const actual = new Set(
      resources.items.map(({ resourceType }) => resourceType),
    );
    const missing = profile.expectedResourceTypes.filter(
      (resourceType) => !actual.has(resourceType),
    );
    assert(!missing.length, `Missing resource types: ${missing.join(", ")}.`);
    return `${resources.items.length} resources cover the expected app types.`;
  });

  await check(checks, "relation-conformance", async () => {
    const relations = await client.relations.list({
      workspaceId: profile.workspaceId,
      datasetId: profile.datasetId,
    });
    const actual = new Set(
      relations.items.map(({ relationType }) => relationType),
    );
    const missing = profile.expectedRelationTypes.filter(
      (relationType) => !actual.has(relationType),
    );
    assert(!missing.length, `Missing relation types: ${missing.join(", ")}.`);
    return `${relations.items.length} relations cover the expected app graph.`;
  });

  await check(checks, "append-only-history", async () => {
    const history = await client.history.list({
      workspaceId: profile.workspaceId,
      datasetId: profile.datasetId,
    });
    assert(
      history.events.length > 0 || history.recoverable.length > 0,
      "No history or recoverable deletion evidence was returned.",
    );
    return `${history.events.length} events and ${history.recoverable.length} recoverable items are visible.`;
  });

  if (profile.unknownFieldEvidence)
    await check(checks, "unknown-field-preservation", async () => {
      const evidence = profile.unknownFieldEvidence!;
      const graph = await client.revisions.graph(evidence.resourceId);
      assert(
        graph.revisions.some((revision) =>
          Object.hasOwn(revision.canonicalPayload, evidence.field),
        ),
        `Unknown field ${evidence.field} was not preserved.`,
      );
      return `${evidence.field} remains present in immutable revision history.`;
    });
  else
    checks.push({
      name: "unknown-field-preservation",
      status: "skipped",
      detail: "Profile declares a rejecting schema and no preservation probe.",
    });

  if (options.unassignedClient)
    await check(checks, "policy-separation", async () => {
      try {
        await options.unassignedClient!.resources.list({
          workspaceId: profile.workspaceId,
          datasetId: profile.datasetId,
        });
      } catch (error) {
        assert(
          error instanceof TrustApiError &&
            (error.status === 403 || error.status === 404),
          "Unassigned access failed for an unexpected reason.",
        );
        return "Registration and schema publication did not grant dataset access.";
      }
      throw new Error("Unassigned application could read the dataset.");
    });
  else
    checks.push({
      name: "policy-separation",
      status: "skipped",
      detail: "No unassigned application client was supplied.",
    });

  if (options.archiveRoundTrip)
    await check(checks, "archive-round-trip", () =>
      runArchiveRoundTrip(client, profile, options.archiveRoundTrip!),
    );
  else
    checks.push({
      name: "archive-round-trip",
      status: "skipped",
      detail: "No reauthentication proof was supplied.",
    });

  return {
    protocolVersion: "TCAP/1.0",
    applicationNamespace: profile.manifest.namespace,
    passed: checks.every(({ status }) => status !== "failed"),
    checks,
  };
}

async function runArchiveRoundTrip(
  client: TrustClient,
  profile: AppConformanceProfile,
  options: NonNullable<AppConformanceOptions["archiveRoundTrip"]>,
): Promise<string> {
  const prefix = options.idempotencyPrefix;
  const exported = await client.portability.exports.create({
    datasetIds: [profile.datasetId],
    idempotencyKey: `${prefix}-export`,
    reauthenticationProof: options.reauthenticationProof,
  });
  const download = await client.portability.exports.download(
    exported.id,
    options.reauthenticationProof,
  );
  const candidate = await client.portability.archives.upload({
    bytes: decodeBase64(download.archiveBase64),
    idempotencyKey: `${prefix}-upload`,
  });
  assert(
    candidate.status === "verified",
    "Exported archive failed verification.",
  );
  const plan = await client.portability.plans.create({
    archiveId: candidate.id,
    idempotencyKey: `${prefix}-plan`,
    mode: "preserve_ids",
    conflictMode: "reject_on_error",
  });
  assert(plan.status === "ready", "Archive round-trip plan is not executable.");
  let operation = await client.portability.plans.execute(plan.id, {
    idempotencyKey: `${prefix}-execute`,
    reauthenticationProof: options.reauthenticationProof,
  });
  const attempts = options.pollAttempts ?? 30;
  for (
    let attempt = 0;
    operation.status !== "completed" && attempt < attempts;
    attempt += 1
  ) {
    await delay(options.pollIntervalMs ?? 200);
    operation = await client.portability.operations.get(operation.id);
  }
  assert(operation.status === "completed", "Archive import did not complete.");
  return `Archive ${candidate.id} completed operation ${operation.id}.`;
}

async function check(
  checks: ConformanceCheck[],
  name: string,
  run: () => Promise<string>,
): Promise<void> {
  try {
    checks.push({ name, status: "passed", detail: await run() });
  } catch (error) {
    checks.push({
      name,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
