import { describe, expect, it } from "vitest";
import { appendAuditEvent, verifyAuditChain } from "../packages/audit/src/index.js";
import { assertNextRevision } from "../packages/core/src/index.js";
import type { Resource, Revision } from "../packages/core/src/index.js";
import { transitionUpload } from "../packages/operations/src/index.js";
import type { UploadState } from "../packages/operations/src/index.js";
import { canonicalObjectKey } from "../packages/storage/src/index.js";
import { DurableCheckpointRunner,FailOnceAt,uploadCheckpoints,type CheckpointStore,type UploadCheckpoint } from "../packages/reconciliation/src/index.js";
import { verifyResourceGraph } from "../packages/verification/src/index.js";

describe("Release 0.1 trust-loop checkpoint", () => {
  it("preserves operation, revision, object-key, audit and resumability invariants", async () => {
    const now = "2026-08-03T00:00:00.000Z";
    const resource: Resource = {
      id: "resource_1", workspaceId: "workspace_1", datasetId: "dataset_1",
      resourceType: "fixture.page", title: null, status: "active",
      currentRevisionId: "revision_1", createdBy: "actor_1", createdAt: now, updatedAt: now,
    };
    const first: Revision = {
      id: "revision_1", workspaceId: "workspace_1", datasetId: "dataset_1", resourceId: "resource_1",
      revisionNumber: 1, parentRevisionId: null, mergeParentRevisionIds: [], schemaPackageId: "schema_1",
      schemaVersion: "1.0.0", canonicalPayload: { title: "Original" }, canonicalPayloadHash: "1".repeat(64),
      createdBy: "actor_1", createdOnDeviceId: null, source: "user", changeNote: null,
      restoredFromRevisionId: null, createdAt: now,
    };
    const second: Revision = {
      ...first, id: "revision_2", revisionNumber: 2, parentRevisionId: first.id,
      canonicalPayload: { title: "Revised" }, canonicalPayloadHash: "2".repeat(64),
    };
    assertNextRevision({ resource, currentRevision: first, proposed: second });

    const uploadPath: UploadState[] = [
      "authorised", "temporary_upload_created", "bytes_received", "hash_verified",
      "immutable_object_committed", "metadata_committed", "audit_committed", "completed",
    ];
    let uploadState: UploadState = "requested";
    for (const next of uploadPath) uploadState = transitionUpload(uploadState, next);
    expect(uploadState).toBe("completed");

    const key = canonicalObjectKey("workspace_1", "ab" + "0".repeat(62));
    expect(key).not.toContain("Original");

    const auditOne = appendAuditEvent({
      id: "event_1", workspaceId: "workspace_1", actorType: "user", actorId: "actor_1",
      action: "resource.created", subjectKind: "resource", subjectId: resource.id, timestamp: now,
      requestId: "request_1", correlationId: "correlation_1", metadata: {},
    });
    const auditTwo = appendAuditEvent({
      id: "event_2", workspaceId: "workspace_1", actorType: "user", actorId: "actor_1",
      action: "revision.created", subjectKind: "revision", subjectId: second.id, timestamp: now,
      requestId: "request_2", correlationId: "correlation_1", metadata: {},
    }, auditOne.eventHash);
    expect(verifyAuditChain([auditOne, auditTwo])).toBe(true);
    expect(verifyResourceGraph(resource,[first,second])).toEqual([]);

    const checkpoints:UploadCheckpoint[]=[];
    const store:CheckpointStore={completed:async()=>checkpoints,markCompleted:async(_id,checkpoint)=>{checkpoints.push(checkpoint);}};
    const effects=Object.fromEntries(uploadCheckpoints.map(checkpoint=>[checkpoint,async()=>undefined])) as Record<UploadCheckpoint,()=>Promise<void>>;
    const resumable=new DurableCheckpointRunner(store,new FailOnceAt("immutable_object_committed"));
    await expect(resumable.run("operation_1",effects)).rejects.toThrow("immutable_object_committed");
    await resumable.run("operation_1",effects);
    expect(checkpoints).toEqual(uploadCheckpoints);
    process.stdout.write("TRUST TEST CANDIDATE: PASS (service adapters; Docker gate pending)\n");
  });
});
