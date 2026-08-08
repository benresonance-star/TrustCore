import { randomUUID } from "node:crypto";
import { evaluatePolicy, type PolicyEvaluationInput } from "@trust-core/policy";
import type { AuthenticatedActor } from "@trust-core/protocol";
import { redactSensitive } from "@trust-core/storage";

export type TransferGrantOperation = "upload" | "download";

export interface TransferGrantConfig {
  /** Required server-bounded maximum TTL in seconds. */
  maxTtlSeconds: number;
}

export interface TransferTarget {
  workspaceId: string;
  /** Provider-neutral object id (upload/asset/revision), never a bucket/key. */
  objectId: string;
  /** Server-resolved storage locator key — never client-supplied for grants. */
  storageKey: string;
  mediaType?: string;
  expectedSha256?: string;
  expectedByteLength?: number;
  downloadable: boolean;
  quarantineState?: string;
}

export interface ClientTransferGrant {
  grantId: string;
  operation: TransferGrantOperation;
  objectId: string;
  workspaceId: string;
  expiresAt: string;
  transfer: {
    method: "PUT" | "GET";
    url: string;
    headers: Readonly<Record<string, string>>;
  };
}

export interface TransferSigner {
  signUpload(input: {
    storageKey: string;
    expiresAt: string;
    mediaType?: string;
    expectedByteLength?: number;
  }): Promise<{ url: string; headers: Readonly<Record<string, string>> }>;
  signDownload(input: {
    storageKey: string;
    expiresAt: string;
    fileName?: string;
  }): Promise<{ url: string; headers: Readonly<Record<string, string>> }>;
}

export interface GrantAuditSink {
  record(input: {
    action: string;
    actorId: string;
    workspaceId: string;
    subjectId: string;
    requestId: string;
    correlationId: string;
    metadata: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export interface IssueTransferGrantInput {
  actor: AuthenticatedActor;
  workspaceId: string;
  operation: TransferGrantOperation;
  target: TransferTarget;
  requestedTtlSeconds: number;
  requestId: string;
  correlationId: string;
  fileName?: string;
  /** Optional binding-scoped signer; defaults to constructor platform signer. */
  signer?: TransferSigner;
  policyInput: Omit<PolicyEvaluationInput, "action" | "scope"> & {
    scope: PolicyEvaluationInput["scope"];
  };
}

const BLOCKED_DOWNLOAD_STATES = new Set([
  "pending_upload",
  "uploaded",
  "scan_queued",
  "scanning",
  "rejected",
  "manual_review",
  "quarantined",
  "failed",
]);

export class TransferGrantService {
  constructor(
    private readonly config: TransferGrantConfig,
    private readonly signer: TransferSigner,
    private readonly audit: GrantAuditSink,
  ) {
    if (
      !Number.isSafeInteger(config.maxTtlSeconds) ||
      config.maxTtlSeconds <= 0
    ) {
      throw new Error("Transfer grant maxTtlSeconds must be a positive integer");
    }
  }

  async issue(input: IssueTransferGrantInput): Promise<ClientTransferGrant> {
    if (!input.workspaceId.trim()) {
      throw new GrantDeniedError("missing_workspace", "Workspace context is required");
    }
    if (input.target.workspaceId !== input.workspaceId) {
      throw new GrantDeniedError(
        "workspace_mismatch",
        "Transfer target workspace does not match request workspace",
      );
    }
    if (looksLikeClientKeyInjection(input.target.objectId)) {
      throw new GrantDeniedError(
        "invalid_object",
        "Object identifier must be provider-neutral",
      );
    }

    const action =
      input.operation === "upload" ? "object:ingest" : "blob:read";
    const decision = evaluatePolicy({
      ...input.policyInput,
      action,
      scope: {
        ...input.policyInput.scope,
        workspaceId: input.workspaceId,
      },
    });
    if (!decision.allowed) {
      await this.audit.record({
        action: `transfer_grant.denied.${input.operation}`,
        actorId: input.actor.id,
        workspaceId: input.workspaceId,
        subjectId: input.target.objectId,
        requestId: input.requestId,
        correlationId: input.correlationId,
        metadata: { reason: decision.reason },
      });
      throw new GrantDeniedError(
        "policy_denied",
        decision.reason,
      );
    }

    if (input.operation === "download") {
      if (
        !input.target.downloadable ||
        (input.target.quarantineState &&
          BLOCKED_DOWNLOAD_STATES.has(input.target.quarantineState))
      ) {
        throw new GrantDeniedError(
          "not_downloadable",
          "Object is not available for canonical download",
        );
      }
    }

    const ttlSeconds = Math.min(
      input.requestedTtlSeconds,
      this.config.maxTtlSeconds,
    );
    if (input.requestedTtlSeconds <= 0) {
      throw new GrantDeniedError("invalid_ttl", "Requested TTL must be positive");
    }
    if (input.requestedTtlSeconds > this.config.maxTtlSeconds) {
      // Cap rather than invent policy; still audit the clamp.
    }
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const grantId = randomUUID();

    const signer = input.signer ?? this.signer;
    let transfer: ClientTransferGrant["transfer"];
    try {
      if (input.operation === "upload") {
        const signed = await signer.signUpload({
          storageKey: input.target.storageKey,
          expiresAt,
          ...(input.target.mediaType
            ? { mediaType: input.target.mediaType }
            : {}),
          ...(input.target.expectedByteLength !== undefined
            ? { expectedByteLength: input.target.expectedByteLength }
            : {}),
        });
        transfer = { method: "PUT", url: signed.url, headers: signed.headers };
      } else {
        const signed = await signer.signDownload({
          storageKey: input.target.storageKey,
          expiresAt,
          ...(input.fileName
            ? { fileName: sanitizeFileName(input.fileName) }
            : {}),
        });
        transfer = { method: "GET", url: signed.url, headers: signed.headers };
      }
    } catch (error) {
      throw new GrantDeniedError(
        "signer_failed",
        redactSensitive(
          error instanceof Error ? error.message : "Transfer signer failed",
        ),
      );
    }

    await this.audit.record({
      action: `transfer_grant.issued.${input.operation}`,
      actorId: input.actor.id,
      workspaceId: input.workspaceId,
      subjectId: input.target.objectId,
      requestId: input.requestId,
      correlationId: input.correlationId,
      metadata: {
        grantId,
        ttlSeconds,
        expiresAt,
        // Never include transfer.url
      },
    });

    return {
      grantId,
      operation: input.operation,
      objectId: input.target.objectId,
      workspaceId: input.workspaceId,
      expiresAt,
      transfer,
    };
  }
}

export class GrantDeniedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GrantDeniedError";
  }
}

export class FakeTransferSigner implements TransferSigner {
  readonly signed: string[] = [];

  async signUpload(input: {
    storageKey: string;
    expiresAt: string;
  }): Promise<{ url: string; headers: Readonly<Record<string, string>> }> {
    this.signed.push(`upload:${input.storageKey}`);
    return {
      url: `https://transfer.example/upload/${encodeURIComponent(input.storageKey)}?exp=${encodeURIComponent(input.expiresAt)}`,
      headers: { "content-type": "application/octet-stream" },
    };
  }

  async signDownload(input: {
    storageKey: string;
    expiresAt: string;
    fileName?: string;
  }): Promise<{ url: string; headers: Readonly<Record<string, string>> }> {
    this.signed.push(`download:${input.storageKey}`);
    return {
      url: `https://transfer.example/download/${encodeURIComponent(input.storageKey)}?exp=${encodeURIComponent(input.expiresAt)}`,
      headers: input.fileName
        ? {
            "content-disposition": `attachment; filename="${input.fileName}"`,
          }
        : {},
    };
  }
}

function looksLikeClientKeyInjection(objectId: string): boolean {
  return (
    objectId.includes("/") ||
    objectId.toLowerCase().includes("workspaces/") ||
    objectId.includes("..")
  );
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
}

export type { PolicyEvaluationInput };
