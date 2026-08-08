import { createHash, randomUUID } from "node:crypto";
import {
  ResourceHistoryService,
  TransferGrantService,
  GrantDeniedError,
  QuarantineScanOrchestrator,
  FakeMalwareScanner,
  toUploadScanStatus,
  type ObjectIngestResult,
  type ObjectIngestService,
  type TransferSigner,
  type QuarantineScanRecord,
} from "@trust-core/operations";
import { isPolicyAction } from "@trust-core/policy";
import {
  PostgresBlobCatalog,
  PostgresContractRepository,
  PostgresHistoryRepository,
  PostgresQuarantineScanStore,
  PostgresRetentionPolicyRepository,
  PostgresVerificationCatalog,
  deterministicUuid,
  inTransaction,
  type DatabasePool,
} from "@trust-core/persistence-postgres";
import type {
  ApplicationRegistration,
  AuthenticatedActor,
  AcceptStoragePlanCommand,
  CompleteUploadCommand,
  CreateDownloadGrantCommand,
  CreatePolicyAssignmentCommand,
  CreateRetentionPolicyCommand,
  CreateUploadCommand,
  CreateApplicationTenantCommand,
  CutoverStorageMigrateCommand,
  DeleteResourceCommand,
  DeleteResourceResult,
  DownloadGrant,
  HistorySnapshot,
  PolicyAssignment,
  ProbeStorageCommand,
  ProbeStorageBindingCommand,
  RecoverableItem,
  RegisterApplicationCommand,
  RestoreResourceCommand,
  RevokePolicyAssignmentCommand,
  RevisionCommand,
  RevisionCommandResult,
  RunVerificationCommand,
  ServiceHealth,
  StorageHealthDetails,
  StorageProbeTier,
  TrustEventSummary,
  UpdateRetentionPolicyCommand,
  UploadScanStatus,
  UpsertStorageBindingCommand,
  RefreshStoragePlanCommand,
  VerificationRunResult,
} from "@trust-core/protocol";
import type { ObjectStorage } from "@trust-core/storage";
import type {
  BlobVerificationService,
  StructuralVerificationService,
} from "@trust-core/verification";
import type { CommandProvider, ObjectIngestCommand } from "./app.js";
import { createAppStorageCommandMethods } from "./app-storage-commands.js";
import { PostgresAppStorageRegistry } from "./postgres-app-storage-registry.js";
import {
  ProbeRateLimiter,
  StorageHealthCache,
  assertNoSecretFields,
  isFakeScannerEnabled,
  runStorageProbe,
  toStorageHealthDetails,
  type SafeStorageConfig,
  type StorageBucketProber,
} from "./storage-diagnostics.js";

const maxUploadBytes = 750_000;

export type StorageDiagnosticsOptions = {
  storage?: ObjectStorage;
  config: SafeStorageConfig;
  prober?: StorageBucketProber;
};

export class PostgresCommandProvider implements CommandProvider {
  private readonly history: ResourceHistoryService;
  private readonly contracts: PostgresContractRepository;
  private readonly reports: PostgresVerificationCatalog;
  private readonly retention: PostgresRetentionPolicyRepository;
  private readonly blobs: PostgresBlobCatalog;
  private readonly scans: PostgresQuarantineScanStore;
  private readonly grantService?: TransferGrantService;
  private readonly healthCache = new StorageHealthCache();
  private readonly probeLimiter = new ProbeRateLimiter();
  private readonly scanOrchestrator: QuarantineScanOrchestrator;
  private readonly appStorage: ReturnType<typeof createAppStorageCommandMethods>;
  constructor(
    private readonly pool: DatabasePool,
    private readonly verification?: {
      blob: BlobVerificationService;
      structural: StructuralVerificationService;
    },
    private readonly ingest?: ObjectIngestService,
    grantOptions?: {
      signer: TransferSigner;
      maxTtlSeconds: number;
    },
    private readonly clock: () => Date = () => new Date(),
    private readonly storageDiagnostics?: StorageDiagnosticsOptions,
  ) {
    this.appStorage = createAppStorageCommandMethods(
      new PostgresAppStorageRegistry(pool),
    );
    this.history = new ResourceHistoryService(
      new PostgresHistoryRepository(pool),
    );
    this.contracts = new PostgresContractRepository(pool);
    this.reports = new PostgresVerificationCatalog(pool);
    this.retention = new PostgresRetentionPolicyRepository(pool);
    this.blobs = new PostgresBlobCatalog(pool);
    this.scans = new PostgresQuarantineScanStore(pool);
    this.scanOrchestrator = new QuarantineScanOrchestrator(
      new FakeMalwareScanner(),
      this.scans,
      this.clock,
    );
    this.grantService = grantOptions
      ? new TransferGrantService(
          { maxTtlSeconds: grantOptions.maxTtlSeconds },
          grantOptions.signer,
          {
            async record() {
              // Audit persistence for grants is deferred to the existing audit path.
            },
          },
        )
      : undefined;
  }

  async listWorkspaces(workspaceId: string) {
    return { items: await this.contracts.listWorkspaces(workspaceId) };
  }
  async listApplications(workspaceId: string) {
    return { items: await this.contracts.listApplications(workspaceId) };
  }
  async registerApplication(
    _actor: AuthenticatedActor,
    command: RegisterApplicationCommand,
  ): Promise<ApplicationRegistration> {
    if (command.capabilities.some((capability) => !isPolicyAction(capability)))
      throw codedError(
        "INVALID_COMMAND",
        "Application capability is not recognized.",
      );
    const now = this.clock().toISOString();
    return this.contracts.registerApplication({
      id: randomUUID(),
      workspaceId: command.workspaceId,
      namespace: command.namespace,
      name: command.name,
      applicationVersion: command.applicationVersion,
      schemaPackageIds: command.schemaPackageIds,
      capabilities: command.capabilities,
      idempotencyKey: command.idempotencyKey,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
  async listPolicyAssignments(workspaceId: string) {
    return { items: await this.contracts.listPolicyAssignments(workspaceId) };
  }
  async createPolicyAssignment(
    actor: AuthenticatedActor,
    command: CreatePolicyAssignmentCommand,
  ): Promise<PolicyAssignment> {
    const id = deterministicUuid(
      `policy-assignment:${command.workspaceId}:${actor.id}:${command.idempotencyKey}`,
    );
    const existing = (
      await this.contracts.listPolicyAssignments(command.workspaceId)
    ).find((assignment) => assignment.id === id);
    if (existing) {
      if (samePolicyAssignment(existing, command)) return existing;
      throw codedError(
        "IDEMPOTENCY_CONFLICT",
        "Policy assignment idempotency key was reused with different input.",
      );
    }
    const created = await this.contracts.createPolicyAssignment({
      id,
      workspaceId: command.workspaceId,
      principalType: command.principalType,
      principalId: command.principalId,
      role: command.role,
      scopeKind: command.scopeKind,
      scopeId: command.scopeId,
      createdBy: actor.id,
      createdAt: this.clock().toISOString(),
    });
    await this.contracts.recordPolicyAssignmentChange({
      workspaceId: command.workspaceId,
      actor,
      assignmentId: created.id,
      action: "policy_assignment.created",
      requestId: command.idempotencyKey,
      occurredAt: created.createdAt,
      metadata: {
        principalType: created.principalType,
        principalId: created.principalId,
        role: created.role,
        scopeKind: created.scopeKind,
        scopeId: created.scopeId,
      },
    });
    return created;
  }
  async revokePolicyAssignment(
    assignmentId: string,
    actor: AuthenticatedActor,
    command: RevokePolicyAssignmentCommand,
  ): Promise<PolicyAssignment> {
    const assignment = await this.contracts.getPolicyAssignment(
      command.workspaceId,
      assignmentId,
    );
    if (!assignment)
      throw codedError(
        "POLICY_ASSIGNMENT_NOT_FOUND",
        "Policy assignment was not found.",
      );
    if (assignment.revokedAt) return assignment;
    const revokedAt = this.clock().toISOString();
    await this.contracts.revokePolicyAssignment(
      command.workspaceId,
      assignmentId,
      revokedAt,
    );
    await this.contracts.recordPolicyAssignmentChange({
      workspaceId: command.workspaceId,
      actor,
      assignmentId,
      action: "policy_assignment.revoked",
      requestId: command.idempotencyKey,
      occurredAt: revokedAt,
      metadata: {},
    });
    return { ...assignment, revokedAt };
  }
  async listDatasets(workspaceId: string) {
    return { items: await this.contracts.listDatasets(workspaceId) };
  }
  getDataset(workspaceId: string, datasetId: string) {
    return this.contracts.getDataset(workspaceId, datasetId);
  }
  async listRetentionPolicies(workspaceId: string) {
    return { items: await this.retention.list(workspaceId) };
  }
  getRetentionPolicy(workspaceId: string, policyId: string) {
    return this.retention.get(workspaceId, policyId);
  }
  createRetentionPolicy(
    actor: AuthenticatedActor,
    command: CreateRetentionPolicyCommand,
  ) {
    return this.retention.create({
      ...retentionValues(command),
      id: randomUUID(),
      workspaceId: command.workspaceId,
      actorId: actor.id,
      idempotencyKey: command.idempotencyKey,
      at: this.clock().toISOString(),
    });
  }
  updateRetentionPolicy(
    policyId: string,
    actor: AuthenticatedActor,
    command: UpdateRetentionPolicyCommand,
  ) {
    return this.retention.update(policyId, {
      ...retentionValues(command),
      id: policyId,
      workspaceId: command.workspaceId,
      actorId: actor.id,
      idempotencyKey: command.idempotencyKey,
      expectedUpdatedAt: command.expectedUpdatedAt,
      at: this.clock().toISOString(),
    });
  }
  async listResources(workspaceId: string, datasetId?: string) {
    return {
      items: await this.contracts.listResources(workspaceId, datasetId),
    };
  }
  getResource(workspaceId: string, resourceId: string) {
    return this.contracts.getResource(workspaceId, resourceId);
  }
  getRevisionGraph(workspaceId: string, resourceId: string) {
    return this.contracts.getRevisionGraph(workspaceId, resourceId);
  }
  async listRelations(workspaceId: string, datasetId?: string) {
    return {
      items: await this.contracts.listRelations(workspaceId, {
        ...(datasetId ? { datasetId } : {}),
      }),
    };
  }
  async listDeletedResources(workspaceId: string, datasetId?: string) {
    return {
      items: (await this.getHistory(workspaceId, datasetId)).recoverable,
    };
  }
  async listAuditEvents(workspaceId: string, datasetId?: string) {
    return {
      items: await this.contracts.listAuditEvents(workspaceId, datasetId),
    };
  }

  async getHistory(
    workspaceId: string,
    datasetId?: string,
  ): Promise<HistorySnapshot> {
    return inTransaction(this.pool, async (db) => {
      await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
        workspaceId,
      ]);
      const values = datasetId ? [workspaceId, datasetId] : [workspaceId];
      const datasetFilter = datasetId ? " AND t.dataset_id=$2" : "";
      const deleted = await db.query<RecoverableRow>(
        `SELECT t.id AS tombstone_id,t.workspace_id,t.dataset_id,t.subject_id AS resource_id,r.title AS resource_title,r.resource_type,t.deleted_at,t.recover_until,t.deleted_by,t.prior_revision_id FROM tombstones t JOIN resources r ON r.id=t.subject_id::uuid AND r.workspace_id=t.workspace_id WHERE t.workspace_id=$1${datasetFilter} AND t.subject_kind='resource' AND t.restored_at IS NULL AND t.purge_state<>'purged' ORDER BY t.deleted_at DESC LIMIT 100`,
        values,
      );
      const events = await db.query<EventRow>(
        `SELECT id,action,subject_id,actor_id,occurred_at,metadata_json FROM audit_events WHERE workspace_id=$1${datasetId ? " AND dataset_id=$2" : ""} ORDER BY occurred_at DESC,id DESC LIMIT 100`,
        values,
      );
      return {
        recoverable: deleted.rows.map(mapRecoverable),
        events: events.rows.map(mapEvent),
      };
    });
  }
  async createRevision(
    resourceId: string,
    actor: AuthenticatedActor,
    command: RevisionCommand,
  ): Promise<RevisionCommandResult> {
    return revisionResult(
      await this.history.createRevision({
        ...command,
        resourceId,
        actorId: actor.id,
      }),
    );
  }
  async deleteResource(
    resourceId: string,
    actor: AuthenticatedActor,
    command: DeleteResourceCommand,
  ): Promise<DeleteResourceResult> {
    const tombstone = await this.history.deleteResource({
      workspaceId: command.workspaceId,
      resourceId,
      expectedRevisionId: command.expectedRevisionId,
      actorId: actor.id,
      recoverUntil: command.recoverUntil,
      reason: command.reason,
    });
    return {
      resourceId,
      tombstoneId: tombstone.id,
      deletedAt: tombstone.deletedAt,
      recoverUntil: tombstone.recoverUntil,
    };
  }
  async restoreResource(
    resourceId: string,
    actor: AuthenticatedActor,
    command: RestoreResourceCommand,
  ): Promise<RevisionCommandResult> {
    return revisionResult(
      await this.history.restoreResource({
        workspaceId: command.workspaceId,
        resourceId,
        actorId: actor.id,
        ...(command.changeNote ? { changeNote: command.changeNote } : {}),
      }),
    );
  }

  async runVerification(
    _actor: AuthenticatedActor,
    command: RunVerificationCommand,
  ): Promise<VerificationRunResult> {
    if (!this.verification)
      throw new Error("Object verification adapter is not configured.");
    switch (command.level) {
      case "metadata":
      case "full_blob":
        return this.verification.blob.run({
          workspaceId: command.workspaceId,
          level: command.level,
        });
      case "resource":
      case "dataset":
      case "workspace":
        return this.verification.structural.run({
          workspaceId: command.workspaceId,
          level: command.level,
          ...(command.scope ? { scope: command.scope } : {}),
        });
      default:
        return assertNever(command.level);
    }
  }
  async listVerificationReports(workspaceId: string) {
    return { items: await this.reports.listReports(workspaceId) };
  }
  getVerificationReport(workspaceId: string, reportId: string) {
    return this.reports.getReport(workspaceId, reportId);
  }
  getOperation(workspaceId: string, operationId: string) {
    return this.contracts.getOperation(workspaceId, operationId);
  }

  async getStorageHealth(workspaceId: string): Promise<ServiceHealth> {
    const catalog = await this.loadCatalogCounts(workspaceId);
    const cached = this.healthCache.get();
    if (cached) {
      const details: StorageHealthDetails = {
        ...cached.details,
        cataloguedObjects: catalog.objects,
        failedVerificationObjects: catalog.failed,
      };
      assertNoSecretFields(details as unknown as Record<string, unknown>);
      return {
        status: this.deriveStorageStatus(details, catalog),
        checkedAt: this.clock().toISOString(),
        summary: this.deriveStorageSummary(details, catalog),
        details: details as unknown as Readonly<Record<string, unknown>>,
      };
    }

    const config = this.resolveSafeConfig();
    const details = toStorageHealthDetails(config, null, {
      cataloguedObjects: catalog.objects,
      failedVerificationObjects: catalog.failed,
    });
    assertNoSecretFields(details as unknown as Record<string, unknown>);

    return {
      status: this.deriveStorageStatus(details, catalog),
      checkedAt: this.clock().toISOString(),
      summary: this.deriveStorageSummary(details, catalog),
      details: details as unknown as Readonly<Record<string, unknown>>,
    };
  }

  async probeStorageHealth(
    actor: AuthenticatedActor,
    command: ProbeStorageCommand,
  ): Promise<ServiceHealth> {
    const tier: StorageProbeTier =
      command.tier === "ingest" ? "ingest" : "connectivity";
    const rateKey = command.workspaceId;
    if (!this.probeLimiter.tryAcquire(rateKey)) {
      const latest = this.healthCache.getLatest();
      if (latest?.details.probe) {
        const catalog = await this.loadCatalogCounts(command.workspaceId);
        const details: StorageHealthDetails = {
          ...latest.details,
          cataloguedObjects: catalog.objects,
          failedVerificationObjects: catalog.failed,
        };
        return {
          status: this.deriveStorageStatus(details, catalog),
          checkedAt: this.clock().toISOString(),
          summary: `${latest.summary} (coalesced; probe rate-limited)`,
          details: details as unknown as Readonly<Record<string, unknown>>,
        };
      }
      const recentlyProbed = await this.hasRecentStorageProbe(
        command.workspaceId,
      );
      if (recentlyProbed) {
        throw codedError(
          "COMMAND_REJECTED",
          "Storage probe rate limit reached. Wait a few seconds and retry.",
        );
      }
      throw codedError(
        "COMMAND_REJECTED",
        "Storage probe rate limit reached. Wait a few seconds and retry.",
      );
    }

    if (await this.hasRecentStorageProbe(command.workspaceId)) {
      const latest = this.healthCache.getLatest();
      if (latest?.details.probe) {
        const catalog = await this.loadCatalogCounts(command.workspaceId);
        const details: StorageHealthDetails = {
          ...latest.details,
          cataloguedObjects: catalog.objects,
          failedVerificationObjects: catalog.failed,
        };
        return {
          status: this.deriveStorageStatus(details, catalog),
          checkedAt: this.clock().toISOString(),
          summary: `${latest.summary} (coalesced; recent probe reused)`,
          details: details as unknown as Readonly<Record<string, unknown>>,
        };
      }
    }

    const catalog = await this.loadCatalogCounts(command.workspaceId);
    const config = this.resolveSafeConfig();
    const probe = await runStorageProbe({
      tier,
      config,
      prober: this.storageDiagnostics?.prober,
      storage: this.storageDiagnostics?.storage,
      workspaceId: command.workspaceId,
      now: this.clock,
    });

    const details = toStorageHealthDetails(config, probe, {
      cataloguedObjects: catalog.objects,
      failedVerificationObjects: catalog.failed,
    });
    assertNoSecretFields(details as unknown as Record<string, unknown>);

    const status = this.deriveStorageStatus(details, catalog);
    const summary = probe.summary;

    this.healthCache.set({ details, status, summary });

    const requestId = randomUUID();
    await this.contracts.recordStorageProbe({
      workspaceId: command.workspaceId,
      actor,
      requestId,
      occurredAt: this.clock().toISOString(),
      metadata: {
        probeId: probe.probeId,
        tier: probe.tier,
        ok: probe.ok,
        issueClass: probe.issueClass,
        issueCode: probe.issueCode,
        latencyMs: probe.latencyMs,
        bucketRegion: probe.bucketRegion ?? null,
        regionMatch: probe.regionMatch ?? null,
        ...(probe.billingHint ? { billingHint: probe.billingHint } : {}),
      },
    });

    return {
      status,
      checkedAt: probe.checkedAt,
      summary,
      details: details as unknown as Readonly<Record<string, unknown>>,
    };
  }

  private deriveStorageStatus(
    details: StorageHealthDetails,
    catalog: { objects: number; failed: number },
  ): ServiceHealth["status"] {
    if (!details.objectStorageConfigured) return "not_configured";
    if (catalog.failed > 0) return "degraded";
    if (details.probe && !details.probe.ok) return "degraded";
    if (details.probe?.ok) return "healthy";
    // Configured but not live-verified yet — do not claim healthy/Connected.
    return "degraded";
  }

  private deriveStorageSummary(
    details: StorageHealthDetails,
    catalog: { objects: number; failed: number },
  ): string {
    if (!details.objectStorageConfigured) {
      return "Object storage is not configured for this API process.";
    }
    if (catalog.failed > 0) {
      return "Object storage is configured, but some objects failed verification.";
    }
    if (details.probe && !details.probe.ok) {
      return details.probe.summary;
    }
    if (details.probe?.ok) {
      return details.probe.summary;
    }
    return "Object storage is configured on the API host but not live-verified. Run Test connection.";
  }

  private async hasRecentStorageProbe(workspaceId: string): Promise<boolean> {
    const result = await inTransaction(this.pool, async (db) => {
      await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
        workspaceId,
      ]);
      return db.query<{ ok: number }>(
        `SELECT 1::int AS ok
         FROM audit_events
         WHERE workspace_id=$1
           AND action='storage.health.probed'
           AND occurred_at > NOW() - INTERVAL '5 seconds'
         LIMIT 1`,
        [workspaceId],
      );
    });
    return (result.rowCount ?? 0) > 0;
  }

  private resolveSafeConfig(): SafeStorageConfig {
    if (this.storageDiagnostics?.config) return this.storageDiagnostics.config;
    return {
      provider: "minio",
      region: "us-east-1",
      bucket: "",
      credentialMode: "missing",
      endpointHost: null,
      consoleUrl: null,
      transferSignerConfigured: Boolean(this.grantService),
      objectStorageConfigured: Boolean(this.ingest),
      expectedBucketOwner: null,
    };
  }

  private async loadCatalogCounts(workspaceId: string) {
    const counts = await inTransaction(this.pool, async (db) => {
      await db.query("SELECT set_config('trust.workspace_id',$1,true)", [
        workspaceId,
      ]);
      return db.query<{ objects: number; failed: number }>(
        "SELECT count(*)::int AS objects,count(*) FILTER (WHERE verification_state='failed')::int AS failed FROM blob_objects WHERE workspace_id=$1",
        [workspaceId],
      );
    });
    return counts.rows[0] ?? { objects: 0, failed: 0 };
  }

  async getBackupHealth(_workspaceId: string): Promise<ServiceHealth> {
    return {
      status: "not_configured",
      checkedAt: this.clock().toISOString(),
      summary: "No backup telemetry provider is configured.",
      details: { backupTelemetryConfigured: false },
    };
  }

  createUpload(actor: AuthenticatedActor, command: CreateUploadCommand) {
    if (command.expectedByteLength > maxUploadBytes)
      throw codedError(
        "REQUEST_TOO_LARGE",
        "Upload exceeds the bounded facade limit.",
      );
    const now = this.clock();
    const expiresInSeconds = command.expiresInSeconds ?? 900;
    return this.contracts.createUploadSession({
      ...command,
      expiresInSeconds,
      actorId: actor.id,
      principalType: actor.principalType ?? "user",
      now: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + expiresInSeconds * 1000,
      ).toISOString(),
    });
  }
  getUpload(workspaceId: string, uploadId: string, actor: AuthenticatedActor) {
    return this.contracts.getUploadSession(workspaceId, uploadId, actor);
  }
  async getUploadScanStatus(
    workspaceId: string,
    uploadId: string,
    actor: AuthenticatedActor,
  ): Promise<UploadScanStatus | undefined> {
    const session = await this.contracts.getUploadSession(
      workspaceId,
      uploadId,
      actor,
    );
    if (!session) return undefined;
    const record = await this.scans.getByUploadId(workspaceId, uploadId);
    return record ? toUploadScanStatus(record) : undefined;
  }
  async completeUpload(
    uploadId: string,
    actor: AuthenticatedActor,
    command: CompleteUploadCommand,
  ) {
    if (!this.ingest)
      throw new Error("Object ingest adapter is not configured.");
    const session = await this.contracts.getUploadSession(
      command.workspaceId,
      uploadId,
      actor,
    );
    if (!session)
      throw codedError("OPERATION_NOT_FOUND", "Upload session was not found.");
    const bytes = decodeBase64(command.bytesBase64);
    if (bytes.byteLength !== session.expectedByteLength)
      throw codedError(
        "COMMAND_REJECTED",
        "Upload byte length does not match the session expectation.",
      );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== session.expectedSha256)
      throw codedError(
        "COMMAND_REJECTED",
        "Upload hash does not match the session expectation.",
      );
    if (session.state === "completed") return session;
    if (Date.parse(session.expiresAt) <= this.clock().getTime())
      throw codedError("COMMAND_REJECTED", "Upload session has expired.");
    const result = await this.ingest.ingest({
      workspaceId: command.workspaceId,
      actorId: actor.id,
      principalType: actor.principalType ?? "user",
      idempotencyKey: `upload:${uploadId}`,
      mediaType: session.mediaType,
      bytes,
    });
    await this.queueScanAfterIngest({
      workspaceId: command.workspaceId,
      uploadId,
      storageKey: result.blob.storageKey,
    });
    return this.contracts.completeUploadSession({
      workspaceId: command.workspaceId,
      uploadId,
      actor,
      blobId: result.blob.id,
      ingestOperationId: result.operationId,
      completedAt: this.clock().toISOString(),
    });
  }

  private async queueScanAfterIngest(input: {
    workspaceId: string;
    uploadId: string;
    storageKey: string;
  }): Promise<void> {
    const scanJobId = randomUUID();
    let record = await this.scanOrchestrator.queueUploaded({
      scanJobId,
      workspaceId: input.workspaceId,
      uploadId: input.uploadId,
      storageKey: input.storageKey,
    });
    if (!isFakeScannerEnabled()) return;
    record = await this.scanOrchestrator.handleCallback({
      scanJobId,
      workspaceId: input.workspaceId,
      outcome: "clean",
      authentic: true,
      engine: "fake",
    });
    await this.advanceFakePromotion(record);
  }

  private async advanceFakePromotion(
    record: QuarantineScanRecord,
  ): Promise<void> {
    if (record.state !== "accepted") return;
    const pending: QuarantineScanRecord = {
      ...record,
      state: "promotion_pending",
      updatedAt: this.clock().toISOString(),
    };
    await this.scans.save(pending);
    await this.scans.save({
      ...pending,
      state: "promoted",
      updatedAt: this.clock().toISOString(),
    });
  }

  async createDownloadGrant(
    actor: AuthenticatedActor,
    command: CreateDownloadGrantCommand,
  ): Promise<DownloadGrant> {
    if (!this.grantService) {
      throw codedError(
        "COMMAND_BOUNDARY_UNAVAILABLE",
        "Download grants require a configured transfer signer.",
      );
    }
    const blob = await this.blobs.findById(
      command.workspaceId,
      command.objectId,
    );
    if (!blob) {
      throw codedError("OPERATION_NOT_FOUND", "Blob object was not found.");
    }
    const downloadable = blob.verificationState === "verified";
    try {
      const grant = await this.grantService.issue({
        actor,
        workspaceId: command.workspaceId,
        operation: "download",
        target: {
          workspaceId: command.workspaceId,
          objectId: blob.id,
          storageKey: blob.storageKey,
          mediaType: blob.mediaType,
          expectedSha256: blob.sha256,
          expectedByteLength: blob.byteLength,
          downloadable,
          quarantineState: downloadable ? undefined : "quarantined",
        },
        requestedTtlSeconds: command.requestedTtlSeconds,
        requestId: command.idempotencyKey,
        correlationId: command.idempotencyKey,
        ...(command.fileName ? { fileName: command.fileName } : {}),
        policyInput: {
          principal: {
            id: actor.id,
            type: actor.principalType ?? "user",
            roles: actor.roles,
            workspaceIds: actor.workspaceIds,
          },
          scope: { workspaceId: command.workspaceId },
        },
      });
      return {
        grantId: grant.grantId,
        objectId: grant.objectId,
        workspaceId: grant.workspaceId,
        expiresAt: grant.expiresAt,
        transfer: {
          method: "GET",
          url: grant.transfer.url,
          headers: grant.transfer.headers,
        },
      };
    } catch (error) {
      if (error instanceof GrantDeniedError) {
        throw codedError("PERMISSION_DENIED", error.message);
      }
      throw error;
    }
  }

  async ingestObject(
    actor: AuthenticatedActor,
    command: ObjectIngestCommand,
  ): Promise<ObjectIngestResult> {
    if (!this.ingest)
      throw new Error("Object ingest adapter is not configured.");
    const bytes = decodeBase64(command.bytesBase64);
    if (bytes.byteLength > maxUploadBytes)
      throw codedError(
        "REQUEST_TOO_LARGE",
        "Object exceeds the bounded API limit.",
      );
    return this.ingest.ingest({
      workspaceId: command.workspaceId,
      actorId: actor.id,
      principalType: actor.principalType ?? "user",
      idempotencyKey: command.idempotencyKey,
      mediaType: command.mediaType,
      bytes,
    });
  }

  listApplicationTenants(workspaceId: string, applicationId: string) {
    return this.appStorage.listApplicationTenants(workspaceId, applicationId);
  }
  createApplicationTenant(
    actor: AuthenticatedActor,
    command: CreateApplicationTenantCommand,
  ) {
    return this.appStorage.createApplicationTenant(actor, command);
  }
  getEffectiveStorage(
    workspaceId: string,
    applicationId: string,
    applicationTenantId?: string,
  ) {
    return this.appStorage.getEffectiveStorage(
      workspaceId,
      applicationId,
      applicationTenantId,
    );
  }
  async getStorageBindingRollup(workspaceId: string) {
    const apps = await this.contracts.listApplications(workspaceId);
    return this.appStorage.getStorageBindingRollup(
      workspaceId,
      apps.map((item) => ({ id: item.id, name: item.name })),
    );
  }
  upsertStorageBinding(
    actor: AuthenticatedActor,
    command: UpsertStorageBindingCommand,
  ) {
    return this.appStorage.upsertStorageBinding(actor, command);
  }
  probeStorageBinding(
    actor: AuthenticatedActor,
    command: ProbeStorageBindingCommand,
  ) {
    return this.appStorage.probeStorageBinding(actor, command);
  }
  refreshStoragePlan(
    actor: AuthenticatedActor,
    command: RefreshStoragePlanCommand,
  ) {
    return this.appStorage.refreshStoragePlan(actor, command);
  }
  acceptStoragePlan(
    actor: AuthenticatedActor,
    command: AcceptStoragePlanCommand,
  ) {
    return this.appStorage.acceptStoragePlan(actor, command);
  }
  disableStorageBinding(
    actor: AuthenticatedActor,
    bindingId: string,
    workspaceId: string,
  ) {
    return this.appStorage.disableStorageBinding(actor, bindingId, workspaceId);
  }
  rollbackStorageBinding(
    actor: AuthenticatedActor,
    bindingId: string,
    workspaceId: string,
  ) {
    return this.appStorage.rollbackStorageBinding(
      actor,
      bindingId,
      workspaceId,
    );
  }
  cutoverStorageMigrate(
    actor: AuthenticatedActor,
    command: CutoverStorageMigrateCommand,
  ) {
    return this.appStorage.cutoverStorageMigrate(actor, command);
  }
}
function samePolicyAssignment(
  assignment: PolicyAssignment,
  command: CreatePolicyAssignmentCommand,
): boolean {
  return (
    assignment.workspaceId === command.workspaceId &&
    assignment.principalType === command.principalType &&
    assignment.principalId === command.principalId &&
    assignment.role === command.role &&
    assignment.scopeKind === command.scopeKind &&
    assignment.scopeId === command.scopeId
  );
}

function decodeBase64(value: string): Buffer {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw codedError("INVALID_COMMAND", "Object bytes are not valid base64.");
  return Buffer.from(value, "base64");
}
function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
function revisionResult(result: {
  resourceId: string;
  id: string;
  revisionNumber: number;
  source: RevisionCommandResult["source"];
  createdAt: string;
}): RevisionCommandResult {
  return {
    resourceId: result.resourceId,
    revisionId: result.id,
    revisionNumber: result.revisionNumber,
    source: result.source,
    createdAt: result.createdAt,
  };
}
interface RecoverableRow {
  tombstone_id: string;
  workspace_id: string;
  dataset_id: string;
  resource_id: string;
  resource_title: string | null;
  resource_type: string;
  deleted_at: string | Date;
  recover_until: string | Date | null;
  deleted_by: string;
  prior_revision_id: string | null;
}
interface EventRow {
  id: string;
  action: string;
  subject_id: string;
  actor_id: string;
  occurred_at: string | Date;
  metadata_json: Record<string, unknown>;
}
const iso = (value: string | Date) => new Date(value).toISOString();
function mapRecoverable(row: RecoverableRow): RecoverableItem {
  return {
    tombstoneId: row.tombstone_id,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    resourceId: row.resource_id,
    resourceTitle: row.resource_title,
    resourceType: row.resource_type,
    deletedAt: iso(row.deleted_at),
    recoverUntil: row.recover_until ? iso(row.recover_until) : null,
    deletedBy: row.deleted_by,
    priorRevisionId: row.prior_revision_id,
  };
}
function mapEvent(row: EventRow): TrustEventSummary {
  return {
    id: row.id,
    action: row.action,
    subjectId: row.subject_id,
    actorId: row.actor_id,
    occurredAt: iso(row.occurred_at),
    metadata: row.metadata_json,
  };
}
function assertNever(value: never): never {
  throw new Error(`Unhandled verification level: ${String(value)}`);
}

const retentionKnownFields = new Set([
  "workspaceId",
  "name",
  "recoveryWindowDays",
  "minimumHistoryDays",
  "backupRetentionDays",
  "purgeEnabled",
  "idempotencyKey",
  "expectedUpdatedAt",
  "extensions",
]);
function retentionValues(command: CreateRetentionPolicyCommand) {
  const unknown = Object.fromEntries(
    Object.entries(command).filter(([key]) => !retentionKnownFields.has(key)),
  );
  return {
    name: command.name,
    recoveryWindowDays: command.recoveryWindowDays,
    minimumHistoryDays: command.minimumHistoryDays,
    backupRetentionDays: command.backupRetentionDays,
    purgeEnabled: command.purgeEnabled,
    extensions: { ...unknown, ...(command.extensions ?? {}) },
  };
}
