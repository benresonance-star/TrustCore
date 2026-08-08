import { expect } from "vitest";
import type { QuarantineScanRecord, QuarantineScanStore } from "../src/index.js";
import { QuarantineScanConflictError } from "../src/index.js";

export interface QuarantineScanStoreIdentityFixture {
  store: QuarantineScanStore;
  workspaceA: string;
  workspaceB: string;
  uploadA: string;
  uploadB: string;
}

/** Shared identity cases for in-memory and PostgreSQL quarantine scan stores. */
export async function assertQuarantineScanStoreIdentity(
  fixture: QuarantineScanStoreIdentityFixture,
): Promise<void> {
  const { store, workspaceA, workspaceB, uploadA, uploadB } = fixture;
  const createdAt = "2026-08-08T00:00:00.000Z";
  const scanningAt = "2026-08-08T00:01:00.000Z";
  const acceptedAt = "2026-08-08T00:02:00.000Z";
  const base: QuarantineScanRecord = {
    scanJobId: `scan-identity-${workspaceA}`,
    workspaceId: workspaceA,
    uploadId: uploadA,
    storageKey: `workspaces/${workspaceA}/temporary/identity`,
    state: "scanning",
    createdAt,
    updatedAt: scanningAt,
  };

  await store.save(base);
  await store.save(base);
  expect(await store.getByUploadId(workspaceA, uploadA)).toEqual(base);
  expect(await store.getByScanJobId(workspaceA, base.scanJobId)).toEqual(base);

  const accepted: QuarantineScanRecord = {
    ...base,
    state: "accepted",
    outcome: "clean",
    updatedAt: acceptedAt,
  };
  await store.save(accepted);
  expect(await store.getByUploadId(workspaceA, uploadA)).toEqual(accepted);

  await expect(
    store.save({
      ...base,
      scanJobId: `${base.scanJobId}-other`,
      updatedAt: scanningAt,
    }),
  ).rejects.toBeInstanceOf(QuarantineScanConflictError);

  await expect(
    store.save({
      ...accepted,
      storageKey: `workspaces/${workspaceA}/temporary/other`,
    }),
  ).rejects.toBeInstanceOf(QuarantineScanConflictError);

  await expect(
    store.save({
      ...accepted,
      createdAt: "2026-08-08T00:00:01.000Z",
    }),
  ).rejects.toBeInstanceOf(QuarantineScanConflictError);

  await expect(
    store.save({
      scanJobId: base.scanJobId,
      workspaceId: workspaceB,
      uploadId: uploadB,
      storageKey: `workspaces/${workspaceB}/temporary/identity`,
      state: "scanning",
      createdAt,
      updatedAt: scanningAt,
    }),
  ).rejects.toBeInstanceOf(QuarantineScanConflictError);

  expect(await store.getByUploadId(workspaceA, uploadA)).toEqual(accepted);
  expect(
    await store.getByUploadId(workspaceB, uploadB),
  ).toBeUndefined();
  expect(
    await store.getByScanJobId(workspaceB, base.scanJobId),
  ).toBeUndefined();
}
