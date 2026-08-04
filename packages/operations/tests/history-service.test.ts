import { describe, expect, it } from "vitest";
import type { Resource, Revision, Tombstone } from "@trust-core/core";
import { HistoryConflictError, ResourceHistoryService, type HistoryAuditEvent, type HistoryRepository } from "../src/index.js";

class MemoryHistory implements HistoryRepository {
  resources = new Map<string, Resource>(); revisions = new Map<string, Revision>(); tombstones = new Map<string, Tombstone>();
  events: HistoryAuditEvent[] = [];
  async transaction<T>(work: (repository: HistoryRepository) => Promise<T>): Promise<T> { const snapshot = structuredClone({ resources: [...this.resources], revisions: [...this.revisions], tombstones: [...this.tombstones] }); try { return await work(this); } catch (error) { this.resources = new Map(snapshot.resources); this.revisions = new Map(snapshot.revisions); this.tombstones = new Map(snapshot.tombstones); throw error; } }
  async getResource(workspaceId: string, resourceId: string) { const value = this.resources.get(resourceId); return value?.workspaceId === workspaceId ? value : undefined; }
  async getRevision(workspaceId: string, revisionId: string) { const value = this.revisions.get(revisionId); return value?.workspaceId === workspaceId ? value : undefined; }
  async appendRevision(revision: Revision) { this.revisions.set(revision.id, revision); }
  async setResourceHead(input: { workspaceId: string; resourceId: string; expectedRevisionId: string | null; nextRevisionId: string | null; status: Resource["status"]; updatedAt: string }) { const value = await this.getResource(input.workspaceId, input.resourceId); if (!value || value.currentRevisionId !== input.expectedRevisionId) return false; this.resources.set(value.id, { ...value, currentRevisionId: input.nextRevisionId, status: input.status, updatedAt: input.updatedAt }); return true; }
  async addTombstone(value: Tombstone) { this.tombstones.set(value.id, value); }
  async getOpenTombstone(workspaceId: string, resourceId: string) { return [...this.tombstones.values()].find((item) => item.workspaceId === workspaceId && item.subjectId === resourceId && item.purgeState === "not_eligible"); }
  async closeTombstone(workspaceId: string, tombstoneId: string) { const value = this.tombstones.get(tombstoneId); if (value?.workspaceId === workspaceId) this.tombstones.set(value.id, { ...value, purgeState: "eligible" }); }
  async appendAudit(event: HistoryAuditEvent) { this.events.push(event); }
}
const baseResource: Resource = { id: "resource", workspaceId: "workspace", datasetId: "dataset", resourceType: "JournalPage", title: "Day one", status: "active", currentRevisionId: null, createdBy: "ivan", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
function harness() { const repository = new MemoryHistory(); repository.resources.set(baseResource.id, baseResource); let id = 0; const service = new ResourceHistoryService(repository, () => "2026-01-02T00:00:00.000Z", () => `id-${++id}`); return { repository, events: repository.events, service }; }

describe("resource history", () => {
  it("creates immutable sequential revisions and advances the resource head", async () => {
    const { repository, service } = harness();
    const first = await service.createRevision({ workspaceId: "workspace", resourceId: "resource", expectedRevisionId: null, schemaPackageId: "schema", schemaVersion: "1.0.0", canonicalPayload: { text: "First" }, actorId: "ivan" });
    const second = await service.createRevision({ workspaceId: "workspace", resourceId: "resource", expectedRevisionId: first.id, schemaPackageId: "schema", schemaVersion: "1.0.0", canonicalPayload: { text: "Second" }, actorId: "ivan" });
    expect([first.revisionNumber, second.revisionNumber, second.parentRevisionId]).toEqual([1, 2, first.id]);
    expect(repository.resources.get("resource")?.currentRevisionId).toBe(second.id);
  });
  it("rejects stale writers without leaving an orphan revision", async () => {
    const { repository, service } = harness();
    const first = await service.createRevision({ workspaceId: "workspace", resourceId: "resource", expectedRevisionId: null, schemaPackageId: "schema", schemaVersion: "1", canonicalPayload: { text: "First" }, actorId: "ivan" });
    await expect(service.createRevision({ workspaceId: "workspace", resourceId: "resource", expectedRevisionId: null, schemaPackageId: "schema", schemaVersion: "1", canonicalPayload: { text: "Stale" }, actorId: "ivan" })).rejects.toBeInstanceOf(HistoryConflictError);
    expect(repository.revisions.size).toBe(1); expect(repository.resources.get("resource")?.currentRevisionId).toBe(first.id);
  });
  it("logically deletes and restores as a new traceable revision", async () => {
    const { repository, events, service } = harness();
    const original = await service.createRevision({ workspaceId: "workspace", resourceId: "resource", expectedRevisionId: null, schemaPackageId: "schema", schemaVersion: "1", canonicalPayload: { text: "Keep me" }, actorId: "ivan" });
    await service.deleteResource({ workspaceId: "workspace", resourceId: "resource", expectedRevisionId: original.id, actorId: "admin", recoverUntil: "2027-01-01T00:00:00.000Z" });
    expect(repository.resources.get("resource")?.status).toBe("deleted_logically");
    const restored = await service.restoreResource({ workspaceId: "workspace", resourceId: "resource", actorId: "admin" });
    expect(restored.source).toBe("restore"); expect(restored.restoredFromRevisionId).toBe(original.id); expect(restored.canonicalPayload).toEqual(original.canonicalPayload);
    expect(repository.resources.get("resource")?.status).toBe("active"); expect(events.map((item) => item.action)).toEqual(["revision.created", "resource.deleted_logically", "revision.created"]);
  });
});
