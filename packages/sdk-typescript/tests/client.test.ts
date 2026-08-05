import { createHash } from "node:crypto";
import { createIvansDiaryFixture } from "@trust-core/fixtures-ivans-diary";
import { createWeSketchFixture } from "@trust-core/fixtures-wesketch";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  TrustApiError,
  createTrustClient,
} from "../src/index.js";

describe("Trust Core TypeScript SDK", () => {
  it("adds auth and application/workspace/dataset context", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createTrustClient({
      baseUrl: "https://trust.example/api/",
      accessToken: "token",
      workspaceId: "workspace",
      applicationId: "application",
      fetch,
    });
    await client.resources.list({ datasetId: "dataset" });
    expect(fetch).toHaveBeenCalledWith(
      "https://trust.example/api/v1/resources",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          authorization: "Bearer token",
          "x-trust-workspace-id": "workspace",
          "x-trust-application-id": "application",
          "x-trust-dataset-id": "dataset",
        }),
      }),
    );
  });

  it("exposes stable typed API errors", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "RESOURCE_NOT_FOUND",
          message: "Missing",
          requestId: "request-1",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createTrustClient({
      baseUrl: "https://trust.example",
      workspaceId: "workspace",
      fetch,
    });
    await expect(client.resources.get("missing")).rejects.toMatchObject({
      name: "TrustApiError",
      status: 404,
      code: "RESOURCE_NOT_FOUND",
      requestId: "request-1",
    });
    await client.resources
      .get("missing")
      .catch((error) => expect(error).toBeInstanceOf(TrustApiError));
  });

  it("runs the bounded expected-hash upload flow", async () => {
    const bytes = new TextEncoder().encode("bounded");
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({
          id: "upload",
          workspaceId: "workspace",
          operationId: "operation",
          state: "requested",
          status: "pending",
          mediaType: "text/plain",
          expectedByteLength: bytes.byteLength,
          expectedSha256,
          expiresAt: "2026-08-05T00:00:00.000Z",
          createdAt: "2026-08-04T00:00:00.000Z",
          updatedAt: "2026-08-04T00:00:00.000Z",
          completedAt: null,
          blobId: null,
        }),
      )
      .mockResolvedValueOnce(
        json({
          id: "upload",
          workspaceId: "workspace",
          operationId: "operation",
          state: "completed",
          status: "succeeded",
          mediaType: "text/plain",
          expectedByteLength: bytes.byteLength,
          expectedSha256,
          expiresAt: "2026-08-05T00:00:00.000Z",
          createdAt: "2026-08-04T00:00:00.000Z",
          updatedAt: "2026-08-04T00:00:01.000Z",
          completedAt: "2026-08-04T00:00:01.000Z",
          blobId: "blob",
        }),
      );
    const client = createTrustClient({
      baseUrl: "https://trust.example",
      workspaceId: "workspace",
      fetch,
    });
    const completed = await client.uploads.create({
      bytes,
      mediaType: "text/plain",
      idempotencyKey: "upload-key",
    });
    expect(completed.status).toBe("succeeded");
    const createBody = JSON.parse(
      String(fetch.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(createBody).toMatchObject({
      workspaceId: "workspace",
      idempotencyKey: "upload-key",
      expectedByteLength: bytes.byteLength,
      expectedSha256,
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      workspaceId: "workspace",
      bytesBase64: "Ym91bmRlZA==",
    });
    await expect(
      client.uploads.create({
        bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1),
        mediaType: "application/octet-stream",
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("supports CSRF sessions and idempotency helpers", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(undefined, { status: 204 }));
    const client = createTrustClient({
      baseUrl: "https://trust.example",
      workspaceId: "workspace",
      csrfToken: "csrf",
      fetch,
    });
    await client.auth.endSession();
    expect(fetch).toHaveBeenCalledWith(
      "https://trust.example/v1/auth/session",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-trust-csrf": "csrf" }),
      }),
    );
    expect(client.idempotency.create("revision")).toMatch(/^revision-/);
  });

  it("exposes typed portability upload, planning and guarded execution", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: "archive", status: "verified" }))
      .mockResolvedValueOnce(json({ id: "plan", status: "ready" }))
      .mockResolvedValueOnce(
        json({ id: "operation", checkpoint: "completed" }),
      );
    const client = createTrustClient({
      baseUrl: "https://trust.example",
      workspaceId: "workspace",
      fetch,
    });
    await client.portability.archives.upload({
      bytes: new TextEncoder().encode("archive"),
      idempotencyKey: "archive-key",
    });
    await client.portability.plans.create({
      archiveId: "archive",
      idempotencyKey: "plan-key",
      mode: "mapped_workspace",
      conflictMode: "reject_on_error",
    });
    await client.portability.plans.execute("plan", {
      idempotencyKey: "execute-key",
      reauthenticationProof: "fresh-proof",
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      workspaceId: "workspace",
      idempotencyKey: "archive-key",
      archiveBase64: "YXJjaGl2ZQ==",
    });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      workspaceId: "workspace",
      idempotencyKey: "execute-key",
      confirmation: "IMPORT",
    });
    expect(
      new Headers(fetch.mock.calls[2]?.[1]?.headers).get("x-trust-reauth"),
    ).toBe("fresh-proof");
  });

  it("reads both application fixtures through only the public SDK surface", async () => {
    const fixtures = [createIvansDiaryFixture(), createWeSketchFixture()];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const workspaceId = new Headers(init?.headers).get(
        "x-trust-workspace-id",
      );
      const fixture = fixtures.find(
        (item) => item.workspace.id === workspaceId,
      );
      const path = new URL(String(input)).pathname;
      if (!fixture) return json({ items: [] });
      if (path === "/v1/datasets") return json({ items: [fixture.dataset] });
      if (path === "/v1/resources") return json({ items: fixture.resources });
      if (path === "/v1/relations") return json({ items: fixture.relations });
      return new Response(undefined, { status: 404 });
    });
    for (const fixture of fixtures) {
      const client = createTrustClient({
        baseUrl: "https://trust.example",
        workspaceId: fixture.workspace.id,
        fetch,
      });
      const [datasets, resources, relations] = await Promise.all([
        client.datasets.list(),
        client.resources.list({ datasetId: fixture.dataset.id }),
        client.relations.list({ datasetId: fixture.dataset.id }),
      ]);
      expect(datasets.items).toEqual([
        expect.objectContaining({ id: fixture.dataset.id }),
      ]);
      expect(resources.items).toHaveLength(fixture.resources.length);
      expect(relations.items).toHaveLength(fixture.relations.length);
    }
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
