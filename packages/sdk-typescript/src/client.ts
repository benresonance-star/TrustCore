import type {
  AdminSession,
  ApplicationRegistration,
  ArchiveCandidate,
  ArchiveDownload,
  ArchiveExportSummary,
  AuditEventRecord,
  ControlCentreSnapshot,
  CreatePolicyAssignmentCommand,
  CreateImportPlanCommand,
  CreateRetentionPolicyCommand,
  DatasetRecord,
  DeleteResourceCommand,
  DeleteResourceResult,
  HealthResponse,
  HistorySnapshot,
  ImportOperationSummary,
  ImportPlanSummary,
  ListResponse,
  ObjectIngestCommand,
  ObjectIngestResult,
  OperationSummary,
  PolicyAssignment,
  RegisterApplicationCommand,
  RelationRecord,
  RetentionPolicyRecord,
  ResourceRecord,
  RestoreResourceCommand,
  RevokePolicyAssignmentCommand,
  RevisionCommand,
  RevisionCommandResult,
  RevisionGraph,
  RunVerificationCommand,
  SchemaPackage,
  ServiceHealth,
  UploadSession,
  UploadScanStatus,
  UpdateRetentionPolicyCommand,
  VerificationRunResult,
  WorkspaceSummary,
} from "./generated/types.js";
import { createTransport } from "./generated/transport.js";
import type {
  TransportConfiguration,
  TrustTransport,
  ValueProvider,
} from "./generated/transport.js";

export const MAX_UPLOAD_BYTES = 750_000;
export const MAX_ARCHIVE_UPLOAD_BYTES = 8_000_000;
export interface TrustClientConfiguration extends TransportConfiguration {}
export interface UploadInput {
  bytes: Blob | Uint8Array | ArrayBuffer;
  mediaType: string;
  idempotencyKey?: string;
  expiresInSeconds?: number;
}
export interface ArchiveBinaryDownload {
  id: string;
  mediaType: "application/vnd.trust-core.archive+zip";
  filename: string;
  bytes: Uint8Array;
  sha256?: string;
}
export interface RequestContext {
  workspaceId?: string;
  datasetId?: string;
  applicationId?: string;
}
type WorkspaceCommand<T extends { workspaceId: string }> = Omit<
  T,
  "workspaceId"
>;

export interface TrustClient {
  workspaces: { list(): Promise<ListResponse<WorkspaceSummary>> };
  applications: {
    list(): Promise<ListResponse<ApplicationRegistration>>;
    register(
      command: WorkspaceCommand<RegisterApplicationCommand>,
    ): Promise<ApplicationRegistration>;
  };
  policyAssignments: {
    list(): Promise<ListResponse<PolicyAssignment>>;
    create(
      command: WorkspaceCommand<CreatePolicyAssignmentCommand>,
    ): Promise<PolicyAssignment>;
    revoke(
      assignmentId: string,
      command?: Omit<
        WorkspaceCommand<RevokePolicyAssignmentCommand>,
        "idempotencyKey"
      > & {
        idempotencyKey?: string;
      },
    ): Promise<PolicyAssignment>;
  };
  schemas: {
    list(): Promise<ListResponse<SchemaPackage>>;
    get(schemaKey: string): Promise<SchemaPackage>;
  };
  datasets: {
    list(context?: RequestContext): Promise<ListResponse<DatasetRecord>>;
    get(datasetId: string): Promise<DatasetRecord>;
  };
  retentionPolicies: {
    list(): Promise<ListResponse<RetentionPolicyRecord>>;
    get(policyId: string): Promise<RetentionPolicyRecord>;
    create(
      command: WorkspaceCommand<CreateRetentionPolicyCommand>,
    ): Promise<RetentionPolicyRecord>;
    update(
      policyId: string,
      command: WorkspaceCommand<UpdateRetentionPolicyCommand>,
    ): Promise<RetentionPolicyRecord>;
  };
  resources: {
    list(context?: RequestContext): Promise<ListResponse<ResourceRecord>>;
    get(resourceId: string): Promise<ResourceRecord>;
    delete(
      resourceId: string,
      command: WorkspaceCommand<DeleteResourceCommand>,
    ): Promise<DeleteResourceResult>;
    restore(
      resourceId: string,
      command?: WorkspaceCommand<RestoreResourceCommand>,
    ): Promise<RevisionCommandResult>;
  };
  revisions: {
    graph(resourceId: string): Promise<RevisionGraph>;
    create(
      resourceId: string,
      command: WorkspaceCommand<RevisionCommand>,
    ): Promise<RevisionCommandResult>;
  };
  datasetsContext(context: RequestContext): TrustClient;
  relations: {
    list(context?: RequestContext): Promise<ListResponse<RelationRecord>>;
  };
  history: { list(context?: RequestContext): Promise<HistorySnapshot> };
  audit: {
    list(context?: RequestContext): Promise<ListResponse<AuditEventRecord>>;
  };
  verification: {
    run(
      command: WorkspaceCommand<RunVerificationCommand>,
    ): Promise<VerificationRunResult>;
    list(): Promise<ListResponse<VerificationRunResult>>;
    get(reportId: string): Promise<VerificationRunResult>;
  };
  operations: { get(operationId: string): Promise<OperationSummary> };
  health: {
    get(): Promise<HealthResponse>;
    storage(): Promise<ServiceHealth>;
    probeStorage(input?: {
      tier?: "connectivity" | "ingest";
    }): Promise<ServiceHealth>;
    backup(): Promise<ServiceHealth>;
  };
  uploads: {
    create(input: UploadInput): Promise<UploadSession>;
    get(uploadId: string): Promise<UploadSession>;
    getScanStatus(uploadId: string): Promise<UploadScanStatus>;
  };
  blobs: {
    createDownloadGrant(input: {
      objectId: string;
      requestedTtlSeconds?: number;
      fileName?: string;
      idempotencyKey?: string;
    }): Promise<{
      grantId: string;
      objectId: string;
      workspaceId: string;
      expiresAt: string;
      transfer: {
        method: "GET";
        url: string;
        headers: Readonly<Record<string, string>>;
      };
    }>;
  };
  objects: {
    ingest(
      command: WorkspaceCommand<ObjectIngestCommand>,
    ): Promise<ObjectIngestResult>;
  };
  portability: {
    exports: {
      create(input: {
        datasetIds: readonly string[];
        idempotencyKey?: string;
        reauthenticationProof: string;
      }): Promise<ArchiveExportSummary>;
      download(
        exportId: string,
        reauthenticationProof: string,
      ): Promise<ArchiveDownload>;
      downloadBytes(
        exportId: string,
        reauthenticationProof: string,
      ): Promise<ArchiveBinaryDownload>;
    };
    archives: {
      upload(input: {
        bytes: Blob | Uint8Array | ArrayBuffer;
        idempotencyKey?: string;
      }): Promise<ArchiveCandidate>;
      get(archiveId: string): Promise<ArchiveCandidate>;
    };
    plans: {
      create(
        command: WorkspaceCommand<CreateImportPlanCommand>,
      ): Promise<ImportPlanSummary>;
      get(planId: string): Promise<ImportPlanSummary>;
      execute(
        planId: string,
        input: { idempotencyKey?: string; reauthenticationProof: string },
      ): Promise<ImportOperationSummary>;
    };
    operations: {
      get(operationId: string): Promise<ImportOperationSummary>;
    };
  };
  control: { snapshot(): Promise<ControlCentreSnapshot> };
  auth: {
    oidcUrl(returnTo?: string): string;
    startSession(token: string): Promise<AdminSession>;
    endSession(): Promise<void>;
  };
  idempotency: { create(prefix?: string): string };
}

export function createTrustClient(
  configuration: TrustClientConfiguration,
): TrustClient {
  return createClient(configuration, createTransport(configuration), {});
}

function createClient(
  configuration: TrustClientConfiguration,
  transport: TrustTransport,
  boundContext: RequestContext,
): TrustClient {
  const contextHeaders = (
    context: RequestContext = {},
  ): Readonly<Record<string, string>> => {
    const merged = { ...boundContext, ...context };
    return {
      ...(merged.workspaceId
        ? { "x-trust-workspace-id": merged.workspaceId }
        : {}),
      ...(merged.datasetId ? { "x-trust-dataset-id": merged.datasetId } : {}),
      ...(merged.applicationId
        ? { "x-trust-application-id": merged.applicationId }
        : {}),
    };
  };
  const workspace = async (): Promise<string> => {
    const configured =
      boundContext.workspaceId ??
      (await resolveValue(configuration.workspaceId));
    if (!configured)
      throw new Error("A workspaceId is required for this command.");
    return configured;
  };
  const command = async <T extends object>(
    value: T,
  ): Promise<T & { workspaceId: string }> => ({
    ...value,
    workspaceId: await workspace(),
  });
  return {
    workspaces: {
      list: () =>
        transport.request("/v1/workspaces", { headers: contextHeaders() }),
    },
    applications: {
      list: () =>
        transport.request("/v1/applications", { headers: contextHeaders() }),
      register: async (value) =>
        transport.request("/v1/applications", {
          method: "POST",
          headers: contextHeaders(),
          body: await command(value),
        }),
    },
    policyAssignments: {
      list: () =>
        transport.request("/v1/policy-assignments", {
          headers: contextHeaders(),
        }),
      create: async (value) =>
        transport.request("/v1/policy-assignments", {
          method: "POST",
          headers: contextHeaders(),
          body: await command(value),
        }),
      revoke: async (id, value = {}) =>
        transport.request(`/v1/policy-assignments/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: contextHeaders(),
          body: await command({
            idempotencyKey:
              value.idempotencyKey ?? createIdempotencyKey("revoke-policy"),
          }),
        }),
    },
    schemas: {
      list: () =>
        transport.request("/v1/schemas", { headers: contextHeaders() }),
      get: (key) =>
        transport.request(`/v1/schemas/${encodeURIComponent(key)}`, {
          headers: contextHeaders(),
        }),
    },
    datasets: {
      list: (context) =>
        transport.request("/v1/datasets", { headers: contextHeaders(context) }),
      get: (id) =>
        transport.request(`/v1/datasets/${encodeURIComponent(id)}`, {
          headers: contextHeaders(),
        }),
    },
    retentionPolicies: {
      list: () =>
        transport.request("/v1/retention-policies", {
          headers: contextHeaders(),
        }),
      get: (id) =>
        transport.request(`/v1/retention-policies/${encodeURIComponent(id)}`, {
          headers: contextHeaders(),
        }),
      create: async (value) =>
        transport.request("/v1/retention-policies", {
          method: "POST",
          headers: contextHeaders(),
          body: await command(value),
        }),
      update: async (id, value) =>
        transport.request(`/v1/retention-policies/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: contextHeaders(),
          body: await command(value),
        }),
    },
    resources: {
      list: (context) =>
        transport.request("/v1/resources", {
          headers: contextHeaders(context),
        }),
      get: (id) =>
        transport.request(`/v1/resources/${encodeURIComponent(id)}`, {
          headers: contextHeaders(),
        }),
      delete: async (id, value) =>
        transport.request(`/v1/resources/${encodeURIComponent(id)}/delete`, {
          method: "POST",
          headers: contextHeaders(),
          body: await command(value),
        }),
      restore: async (id, value = {}) =>
        transport.request(`/v1/resources/${encodeURIComponent(id)}/restore`, {
          method: "POST",
          headers: contextHeaders(),
          body: await command(value),
        }),
    },
    revisions: {
      graph: (id) =>
        transport.request(
          `/v1/resources/${encodeURIComponent(id)}/revision-graph`,
          { headers: contextHeaders() },
        ),
      create: async (id, value) =>
        transport.request(`/v1/resources/${encodeURIComponent(id)}/revisions`, {
          method: "POST",
          headers: contextHeaders(),
          body: await command(value),
        }),
    },
    datasetsContext: (context) =>
      createClient(configuration, transport, { ...boundContext, ...context }),
    relations: {
      list: (context) =>
        transport.request("/v1/relations", {
          headers: contextHeaders(context),
        }),
    },
    history: {
      list: (context) =>
        transport.request("/v1/history", { headers: contextHeaders(context) }),
    },
    audit: {
      list: (context) =>
        transport.request("/v1/audit/events", {
          headers: contextHeaders(context),
        }),
    },
    verification: {
      run: async (value) =>
        transport.request("/v1/verification/runs", {
          method: "POST",
          headers: contextHeaders(),
          body: await command(value),
        }),
      list: () =>
        transport.request("/v1/verification/reports", {
          headers: contextHeaders(),
        }),
      get: (id) =>
        transport.request(
          `/v1/verification/reports/${encodeURIComponent(id)}`,
          { headers: contextHeaders() },
        ),
    },
    operations: {
      get: (id) =>
        transport.request(`/v1/operations/${encodeURIComponent(id)}`, {
          headers: contextHeaders(),
        }),
    },
    health: {
      get: () => transport.request("/health", { public: true }),
      storage: () =>
        transport.request("/v1/health/storage", { headers: contextHeaders() }),
      probeStorage: async (input = {}) =>
        transport.request("/v1/health/storage/probe", {
          method: "POST",
          headers: contextHeaders(),
          body: {
            workspaceId: await workspace(),
            ...(input.tier ? { tier: input.tier } : {}),
          },
        }),
      backup: () =>
        transport.request("/v1/health/backup", { headers: contextHeaders() }),
    },
    uploads: {
      create: async (input) =>
        upload(transport, contextHeaders(), await workspace(), input),
      get: (id) =>
        transport.request(`/v1/uploads/${encodeURIComponent(id)}`, {
          headers: contextHeaders(),
        }),
      getScanStatus: (id) =>
        transport.request(`/v1/uploads/${encodeURIComponent(id)}/scan-status`, {
          headers: contextHeaders(),
        }),
    },
    blobs: {
      createDownloadGrant: async (input) =>
        transport.request("/v1/blobs/download-grants", {
          method: "POST",
          headers: contextHeaders(),
          body: {
            workspaceId: await workspace(),
            objectId: input.objectId,
            requestedTtlSeconds: input.requestedTtlSeconds ?? 60,
            ...(input.fileName ? { fileName: input.fileName } : {}),
            idempotencyKey:
              input.idempotencyKey ?? createIdempotencyKey("download-grant"),
          },
        }),
    },
    objects: {
      ingest: async (value) =>
        transport.request("/v1/objects/ingest", {
          method: "POST",
          headers: contextHeaders(),
          body: await command(value),
        }),
    },
    portability: {
      exports: {
        create: async (input) =>
          transport.request("/v1/portability/exports", {
            method: "POST",
            headers: {
              ...contextHeaders(),
              "x-trust-reauth": input.reauthenticationProof,
            },
            body: {
              workspaceId: await workspace(),
              datasetIds: input.datasetIds,
              idempotencyKey:
                input.idempotencyKey ?? createIdempotencyKey("export"),
            },
          }),
        download: (id, reauthenticationProof) =>
          transport.request(
            `/v1/portability/exports/${encodeURIComponent(id)}/download`,
            {
              headers: {
                ...contextHeaders(),
                "x-trust-reauth": reauthenticationProof,
              },
            },
          ),
        downloadBytes: async (id, reauthenticationProof) => {
          const response = await transport.requestBinary(
            `/v1/portability/exports/${encodeURIComponent(id)}/download`,
            {
              headers: {
                ...contextHeaders(),
                "x-trust-reauth": reauthenticationProof,
              },
            },
          );
          return {
            id,
            mediaType: "application/vnd.trust-core.archive+zip",
            filename:
              dispositionFilename(
                response.headers.get("content-disposition"),
              ) ?? `${id}.trustarchive`,
            bytes: response.bytes,
            ...(response.headers.get("x-trust-archive-sha256")
              ? {
                  sha256: response.headers.get("x-trust-archive-sha256")!,
                }
              : {}),
          };
        },
      },
      archives: {
        upload: async (input) => {
          const bytes = await toBytes(input.bytes);
          if (bytes.byteLength > MAX_ARCHIVE_UPLOAD_BYTES)
            throw new RangeError(
              `Archive exceeds the ${MAX_ARCHIVE_UPLOAD_BYTES} byte SDK candidate limit.`,
            );
          return transport.request("/v1/portability/archives", {
            method: "POST",
            headers: contextHeaders(),
            body: {
              workspaceId: await workspace(),
              idempotencyKey:
                input.idempotencyKey ?? createIdempotencyKey("archive"),
              archiveBase64: base64(bytes),
            },
          });
        },
        get: (id) =>
          transport.request(
            `/v1/portability/archives/${encodeURIComponent(id)}`,
            { headers: contextHeaders() },
          ),
      },
      plans: {
        create: async (value) =>
          transport.request("/v1/portability/plans", {
            method: "POST",
            headers: contextHeaders(),
            body: await command(value),
          }),
        get: (id) =>
          transport.request(`/v1/portability/plans/${encodeURIComponent(id)}`, {
            headers: contextHeaders(),
          }),
        execute: async (id, input) =>
          transport.request(
            `/v1/portability/plans/${encodeURIComponent(id)}/execute`,
            {
              method: "POST",
              headers: {
                ...contextHeaders(),
                "x-trust-reauth": input.reauthenticationProof,
              },
              body: {
                workspaceId: await workspace(),
                idempotencyKey:
                  input.idempotencyKey ?? createIdempotencyKey("import"),
                confirmation: "IMPORT",
              },
            },
          ),
      },
      operations: {
        get: (id) =>
          transport.request(
            `/v1/portability/operations/${encodeURIComponent(id)}`,
            { headers: contextHeaders() },
          ),
      },
    },
    control: {
      snapshot: () =>
        transport.request("/v1/control-centre/snapshot", {
          headers: contextHeaders(),
        }),
    },
    auth: {
      oidcUrl: (returnTo = "/") =>
        transport.url(
          `/v1/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`,
        ),
      startSession: (token: string) =>
        transport.request("/v1/auth/session", {
          method: "POST",
          public: true,
          headers: { authorization: `Bearer ${token}` },
        }),
      endSession: () =>
        transport.request("/v1/auth/session", { method: "DELETE" }),
    },
    idempotency: { create: createIdempotencyKey },
  };
}

async function upload(
  transport: TrustTransport,
  headers: Readonly<Record<string, string>>,
  workspaceId: string,
  input: UploadInput,
): Promise<UploadSession> {
  const bytes = await toBytes(input.bytes);
  if (bytes.byteLength > MAX_UPLOAD_BYTES)
    throw new RangeError(
      `Upload exceeds the ${MAX_UPLOAD_BYTES} byte SDK limit.`,
    );
  const expectedSha256 = await sha256(bytes);
  const created = await transport.request<UploadSession>("/v1/uploads", {
    method: "POST",
    headers,
    body: {
      workspaceId,
      idempotencyKey: input.idempotencyKey ?? createIdempotencyKey("upload"),
      mediaType: input.mediaType,
      expectedByteLength: bytes.byteLength,
      expectedSha256,
      ...(input.expiresInSeconds === undefined
        ? {}
        : { expiresInSeconds: input.expiresInSeconds }),
    },
  });
  return transport.request(
    `/v1/uploads/${encodeURIComponent(created.id)}/complete`,
    {
      method: "POST",
      headers,
      body: { workspaceId, bytesBase64: base64(bytes) },
    },
  );
}

function createIdempotencyKey(prefix = "request"): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
async function resolveValue(value: ValueProvider): Promise<string | undefined> {
  return typeof value === "function" ? await value() : value;
}
async function toBytes(
  value: Blob | Uint8Array | ArrayBuffer,
): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(await value.arrayBuffer());
}
async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error("Web Crypto is required for bounded uploads.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function dispositionFilename(value: string | null): string | undefined {
  const match = value?.match(/filename="([^"]+)"/i);
  return match?.[1];
}
