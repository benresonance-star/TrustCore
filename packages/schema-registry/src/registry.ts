import { schemaDigest } from "./canonical.js";
import {
  assertVersionMatchesCompatibility,
  classifyCompatibility,
} from "./compatibility.js";
import type {
  GovernedPublicationRequest,
  PublicationGovernance,
  PublishedSchemaPackage,
  SchemaPackageManifest,
} from "./types.js";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export class SchemaRegistry {
  readonly #packages = new Map<string, PublishedSchemaPackage>();
  readonly #publicationRequests = new Map<
    string,
    { readonly fingerprint: string; readonly packageKey: string }
  >();

  publishGoverned(
    request: GovernedPublicationRequest,
    publishedAt = new Date().toISOString(),
  ): PublishedSchemaPackage {
    assertGovernedRequest(request);
    const requestKey = `${request.application.namespace}:${request.idempotencyKey}`;
    const fingerprint = schemaDigest(request);
    const replay = this.#publicationRequests.get(requestKey);
    if (replay) {
      if (replay.fingerprint !== fingerprint)
        throw new Error(
          "Idempotency key was already used for a different schema publication.",
        );
      return this.get(replay.packageKey)!;
    }
    const previous = this.#latest(request.manifest);
    const compatibility = classifyCompatibility(
      previous?.manifest,
      request.manifest,
    );
    if (compatibility.classification !== request.expectedCompatibility)
      throw new Error(
        `Expected ${request.expectedCompatibility} compatibility but classified ${compatibility.classification}.`,
      );
    assertVersionMatchesCompatibility(
      previous?.manifest,
      request.manifest,
      compatibility,
    );
    const governance: PublicationGovernance = {
      protocolVersion: request.application.protocolVersion,
      applicationNamespace: request.application.namespace,
      applicationVersion: request.application.applicationVersion,
      approvedBy: request.approval.approvedBy,
      approvalId: request.approval.approvalId,
      idempotencyKey: request.idempotencyKey,
    };
    const published = this.#publish(
      request.manifest,
      publishedAt,
      governance,
      compatibility,
    );
    this.#publicationRequests.set(requestKey, {
      fingerprint,
      packageKey: published.key,
    });
    return published;
  }

  #publish(
    manifest: SchemaPackageManifest,
    publishedAt: string,
    governance?: PublicationGovernance,
    compatibility = classifyCompatibility(
      this.#latest(manifest)?.manifest,
      manifest,
    ),
  ): PublishedSchemaPackage {
    if (!SEMVER.test(manifest.version)) throw new Error(`Invalid semantic version: ${manifest.version}`);
    const key = `${manifest.namespace}/${manifest.name}/${manifest.version}`;
    if (this.#packages.has(key)) throw new Error(`Schema version already published: ${key}`);
    assertManifestReferences(manifest);
    const digest = schemaDigest(manifest);
    const published = Object.freeze({
      id: `schema:${digest}`,
      key,
      digest,
      status: "active" as const,
      publishedAt,
      manifest: deepFreeze(structuredClone(manifest)),
      compatibility: deepFreeze(structuredClone(compatibility)),
      ...(governance
        ? { governance: deepFreeze(structuredClone(governance)) }
        : {}),
    });
    this.#packages.set(key, published);
    return published;
  }

  get(key: string): PublishedSchemaPackage | undefined {
    const value = this.#packages.get(key);
    return value ? deepFreeze(structuredClone(value)) : undefined;
  }

  list(): readonly PublishedSchemaPackage[] {
    return [...this.#packages.values()].map((item) =>
      deepFreeze(structuredClone(item)),
    );
  }

  #latest(
    manifest: SchemaPackageManifest,
  ): PublishedSchemaPackage | undefined {
    return [...this.#packages.values()]
      .filter(
        ({ manifest: candidate }) =>
          candidate.namespace === manifest.namespace &&
          candidate.name === manifest.name,
      )
      .sort((left, right) =>
        right.manifest.version.localeCompare(
          left.manifest.version,
          undefined,
          { numeric: true },
        ),
      )[0];
  }
}

function assertManifestReferences(manifest: SchemaPackageManifest): void {
  const names = new Set(manifest.resourceTypes.map((item) => item.name));
  if (names.size !== manifest.resourceTypes.length) throw new Error("Resource type names must be unique");
  for (const relation of manifest.relationships) {
    for (const type of [...relation.sourceTypes, ...relation.targetTypes]) {
      if (!names.has(type)) throw new Error(`Relationship ${relation.type} references unknown resource type ${type}`);
    }
  }
}

function assertGovernedRequest(request: GovernedPublicationRequest): void {
  if (
    !request.approval.approvedBy.trim() ||
    !request.approval.approvalId.trim() ||
    !request.idempotencyKey.trim()
  )
    throw new Error(
      "Governed publication requires an approver, approval ID and idempotency key.",
    );
  const manifest = request.manifest;
  const application = request.application;
  const packageKey = `${manifest.namespace}/${manifest.name}/${manifest.version}`;
  if (application.namespace !== `${manifest.namespace}/${manifest.name}`)
    throw new Error("TCAP namespace does not own the schema package.");
  if (
    application.schemaPackage.key !== packageKey ||
    application.schemaPackage.version !== manifest.version
  )
    throw new Error("TCAP schema identity does not match the publication.");
  assertSameMembers(
    application.schemaPackage.resourceTypes,
    manifest.resourceTypes.map(({ name }) => name),
    "resource types",
  );
  assertSameMembers(
    application.schemaPackage.relationTypes,
    manifest.relationships.map(({ type }) => type),
    "relation types",
  );
  if (
    manifest.resourceTypes.some(
      ({ additionalFields }) =>
        additionalFields !== application.schemaPackage.additionalFields,
    )
  )
    throw new Error(
      "TCAP unknown-field policy does not match every resource type.",
    );
}

function assertSameMembers(
  declared: readonly string[],
  actual: readonly string[],
  label: string,
): void {
  const normalized = (values: readonly string[]) =>
    [...new Set(values)].sort().join("\u0000");
  if (normalized(declared) !== normalized(actual))
    throw new Error(`TCAP ${label} do not match the schema manifest.`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value))
      if (nested && typeof nested === "object") deepFreeze(nested);
  }
  return value;
}
