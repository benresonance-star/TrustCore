export const appProtocolVersion = "TCAP/1.0" as const;

export const appCapabilities = [
  "dataset:read",
  "resource:read",
  "revision:create",
  "object:ingest",
  "blob:read",
  "relation:read",
  "history:read",
  "portability:read",
] as const;
export type AppCapability = (typeof appCapabilities)[number];

export interface AppProtocolManifest {
  readonly protocolVersion: typeof appProtocolVersion;
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
  readonly capabilities: readonly AppCapability[];
  readonly lifecycle: {
    readonly deletion: "logical-first";
    readonly revisionHistory: "append-only";
    readonly portability: "required";
  };
}

export interface AppProtocolInput {
  readonly namespace: string;
  readonly name: string;
  readonly applicationVersion: string;
  readonly schemaVersion: string;
  readonly resourceTypes: readonly string[];
  readonly relationTypes: readonly string[];
  readonly blobRoles: readonly string[];
  readonly capabilities: readonly AppCapability[];
  readonly additionalFields?: "preserve" | "reject";
}

export interface InterfaceMethod {
  readonly purpose: string;
  readonly sdk: string;
  readonly http: string;
  readonly required: boolean;
}

export interface AppProtocolBundle {
  readonly manifest: AppProtocolManifest;
  readonly methods: readonly InterfaceMethod[];
  readonly agentBrief: string;
}

export interface ManifestIssue {
  readonly path: string;
  readonly message: string;
}

const namespacePattern = /^[a-z][a-z0-9]*(?:[/-][a-z0-9][a-z0-9-]*)+$/;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const typePattern = /^[A-Z][A-Za-z0-9]*$/;
const tokenPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function createAppProtocolBundle(
  input: AppProtocolInput,
): AppProtocolBundle {
  const manifest: AppProtocolManifest = {
    protocolVersion: appProtocolVersion,
    namespace: input.namespace.trim(),
    name: input.name.trim(),
    applicationVersion: input.applicationVersion.trim(),
    schemaPackage: {
      key: `${input.namespace.trim()}/${input.schemaVersion.trim()}`,
      version: input.schemaVersion.trim(),
      resourceTypes: unique(input.resourceTypes),
      relationTypes: unique(input.relationTypes),
      blobRoles: unique(input.blobRoles),
      additionalFields: input.additionalFields ?? "preserve",
    },
    capabilities: unique(input.capabilities) as readonly AppCapability[],
    lifecycle: {
      deletion: "logical-first",
      revisionHistory: "append-only",
      portability: "required",
    },
  };
  const issues = validateAppProtocolManifest(manifest);
  if (issues.length)
    throw new Error(
      issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"),
    );
  const methods = interfaceMethods(manifest.capabilities);
  return { manifest, methods, agentBrief: agentBrief(manifest, methods) };
}

export function validateAppProtocolManifest(
  manifest: AppProtocolManifest,
): readonly ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  if (manifest.protocolVersion !== appProtocolVersion)
    issues.push({ path: "protocolVersion", message: "must be TCAP/1.0" });
  if (!namespacePattern.test(manifest.namespace))
    issues.push({
      path: "namespace",
      message: "must be a lowercase globally unique path",
    });
  if (!manifest.name.trim())
    issues.push({ path: "name", message: "must not be empty" });
  if (!semverPattern.test(manifest.applicationVersion))
    issues.push({ path: "applicationVersion", message: "must be semver" });
  if (!semverPattern.test(manifest.schemaPackage.version))
    issues.push({ path: "schemaPackage.version", message: "must be semver" });
  if (
    manifest.schemaPackage.key !==
    `${manifest.namespace}/${manifest.schemaPackage.version}`
  )
    issues.push({
      path: "schemaPackage.key",
      message: "must bind namespace and schema version",
    });
  if (!manifest.schemaPackage.resourceTypes.length)
    issues.push({
      path: "schemaPackage.resourceTypes",
      message: "must declare at least one resource type",
    });
  for (const value of manifest.schemaPackage.resourceTypes)
    if (!typePattern.test(value))
      issues.push({
        path: "schemaPackage.resourceTypes",
        message: `${value} must be UpperCamelCase`,
      });
  for (const [path, values] of [
    ["schemaPackage.relationTypes", manifest.schemaPackage.relationTypes],
    ["schemaPackage.blobRoles", manifest.schemaPackage.blobRoles],
  ] as const)
    for (const value of values)
      if (!tokenPattern.test(value))
        issues.push({
          path,
          message: `${value} is not a valid protocol token`,
        });
  for (const capability of manifest.capabilities)
    if (!(appCapabilities as readonly string[]).includes(capability))
      issues.push({
        path: "capabilities",
        message: `${capability} is not an app capability`,
      });
  return issues;
}

function interfaceMethods(
  capabilities: readonly AppCapability[],
): readonly InterfaceMethod[] {
  const methods: InterfaceMethod[] = [
    {
      purpose: "Register application manifest",
      sdk: "client.applications.register(manifest)",
      http: "POST /v1/applications",
      required: true,
    },
    {
      purpose: "List registered schema packages",
      sdk: "client.schemas.list()",
      http: "GET /v1/schemas",
      required: true,
    },
  ];
  const candidates: readonly [AppCapability, InterfaceMethod][] = [
    [
      "dataset:read",
      {
        purpose: "Read authorised datasets",
        sdk: "client.datasets.list()",
        http: "GET /v1/datasets",
        required: false,
      },
    ],
    [
      "resource:read",
      {
        purpose: "Read canonical resources",
        sdk: "client.resources.list()",
        http: "GET /v1/resources",
        required: false,
      },
    ],
    [
      "revision:create",
      {
        purpose: "Append a schema-versioned revision",
        sdk: "client.revisions.create(resourceId, command)",
        http: "POST /v1/resources/{resourceId}/revisions",
        required: false,
      },
    ],
    [
      "object:ingest",
      {
        purpose: "Ingest immutable blob bytes",
        sdk: "client.uploads.create(input)",
        http: "POST /v1/uploads",
        required: false,
      },
    ],
    [
      "object:ingest",
      {
        purpose: "Read upload quarantine scan status",
        sdk: "client.uploads.getScanStatus(uploadId)",
        http: "GET /v1/uploads/{uploadId}/scan-status",
        required: false,
      },
    ],
    [
      "blob:read",
      {
        purpose: "Issue a short-lived download transfer grant",
        sdk: "client.blobs.createDownloadGrant(input)",
        http: "POST /v1/blobs/download-grants",
        required: false,
      },
    ],
    [
      "relation:read",
      {
        purpose: "Read typed relationships",
        sdk: "client.relations.list()",
        http: "GET /v1/relations",
        required: false,
      },
    ],
    [
      "history:read",
      {
        purpose: "Read continuity history",
        sdk: "client.history.list()",
        http: "GET /v1/history",
        required: false,
      },
    ],
    [
      "portability:read",
      {
        purpose: "Inspect archive operations",
        sdk: "client.portability.operations.get(operationId)",
        http: "GET /v1/portability/operations/{operationId}",
        required: false,
      },
    ],
  ];
  for (const [capability, method] of candidates)
    if (capabilities.includes(capability)) methods.push(method);
  return methods;
}

function agentBrief(
  manifest: AppProtocolManifest,
  methods: readonly InterfaceMethod[],
): string {
  return `# Trust Core app integration brief

Implement ${manifest.name} against ${appProtocolVersion}. Do not access Trust Core PostgreSQL or object storage directly.

## Identity
- Namespace: ${manifest.namespace}
- Application version: ${manifest.applicationVersion}
- Schema package: ${manifest.schemaPackage.key}
- Capabilities: ${manifest.capabilities.join(", ")}

## Domain contract
- Resource types: ${manifest.schemaPackage.resourceTypes.join(", ")}
- Relation types: ${manifest.schemaPackage.relationTypes.join(", ") || "none"}
- Blob roles: ${manifest.schemaPackage.blobRoles.join(", ") || "none"}
- Unknown fields: ${manifest.schemaPackage.additionalFields}

## Interface methods
${methods.map((method) => `- ${method.purpose}: \`${method.sdk}\` (${method.http})`).join("\n")}

## Mandatory behaviour
- Use the public SDK/API only.
- Send a stable idempotency key for every write and retry.
- Send the expected head revision for optimistic concurrency.
- Preserve schema version, correlation IDs, relationships and blob roles.
- Treat history as append-only and deletion as logical-first.
- Pass manifest, permission, retry, conflict and archive round-trip conformance tests.
`;
}

function unique(values: readonly string[]): readonly string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort();
}
