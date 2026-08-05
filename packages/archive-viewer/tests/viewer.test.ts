import {
  assembleArchiveEntries,
  readTrustArchive,
  writeTrustArchive,
  type ArchiveRecord,
  type ArchiveSource,
} from "@trust-core/archive";
import { createIvansDiaryFixture } from "@trust-core/fixtures-ivans-diary";
import { createWeSketchFixture } from "@trust-core/fixtures-wesketch";
import { describe, expect, it } from "vitest";
import {
  projectArchive,
  renderArchiveBytes,
  renderArchiveHtml,
} from "../src/index.js";
import { runViewerCli } from "../src/cli.js";

describe("independent trust archive viewer", () => {
  it.each([
    ["Ivan's Diary", source(createIvansDiaryFixture())],
    ["WeSketch", source(createWeSketchFixture())],
  ])(
    "reconstructs %s directly from verified archive bytes",
    async (_name, input) => {
      const parsed = await readTrustArchive(
        await writeTrustArchive(assembleArchiveEntries(input)),
      );
      const model = projectArchive(parsed);
      const html = renderArchiveHtml(model);
      expect(model.workspace?.name).toContain("Synthetic Demo");
      expect(model.datasets).toHaveLength(1);
      expect(model.resources.length).toBeGreaterThan(5);
      expect(model.resources.some((item) => item.deleted)).toBe(true);
      expect(html).toContain("verified read-only reconstruction");
      expect(html).toContain(
        "No Trust API, database or originating application",
      );
    },
  );

  it("escapes archive-controlled labels", async () => {
    const input = source(createIvansDiaryFixture());
    const records = input.records.resources as readonly ArchiveRecord[];
    const parsed = await readTrustArchive(
      await writeTrustArchive(
        assembleArchiveEntries({
          ...input,
          records: {
            ...input.records,
            resources: [
              { ...records[0], title: "<script>alert(1)</script>" },
              ...records.slice(1),
            ],
          },
        }),
      ),
    );
    expect(renderArchiveHtml(projectArchive(parsed))).not.toContain("<script>");
  });

  it("runs as an offline CLI and refuses invalid input", async () => {
    const bytes = await writeTrustArchive(
      assembleArchiveEntries(source(createIvansDiaryFixture())),
    );
    const written: string[] = [];
    const messages: string[] = [];
    const io = {
      read: async () => bytes,
      write: async (_path: string, contents: string) => {
        written.push(contents);
      },
      log: (message: string) => {
        messages.push(message);
      },
      error: (message: string) => {
        messages.push(message);
      },
    };
    expect(await runViewerCli(["ivan.trustarchive"], io)).toBe(0);
    expect(written[0]).toBe(await renderArchiveBytes(bytes));
    expect(messages[0]).toContain("Verified archive");

    const invalidIo = { ...io, read: async () => new Uint8Array([1, 2, 3]) };
    expect(await runViewerCli(["invalid.trustarchive"], invalidIo)).toBe(1);
    expect(messages.at(-1)).toContain("Viewer refused the archive");
  });
});

function source(
  fixture:
    | ReturnType<typeof createIvansDiaryFixture>
    | ReturnType<typeof createWeSketchFixture>,
): ArchiveSource {
  const expanded = fixture as ReturnType<typeof createWeSketchFixture>;
  return {
    exportId: `viewer-${fixture.workspace.id}`,
    workspaceId: fixture.workspace.id,
    datasetIds: [fixture.dataset.id],
    createdAt: fixture.workspace.updatedAt,
    createdBy: "independent-viewer-test",
    sourceVersion: "0.2G",
    records: {
      workspaces: records([fixture.workspace]),
      datasets: records([fixture.dataset]),
      resources: records(fixture.resources),
      revisions: records(fixture.revisions),
      relations: records(fixture.relations),
      tombstones: records(fixture.tombstones),
      ...(expanded.blobs ? { blobs: records(expanded.blobs) } : {}),
      ...(expanded.revisionBlobs
        ? { "revision-blobs": records(expanded.revisionBlobs) }
        : {}),
    },
    ...(expanded.blobContents
      ? {
          blobs: expanded.blobs.map((blob) => ({
            sha256: blob.sha256,
            byteLength: blob.byteLength,
            bytes: expanded.blobContents.find(
              (value) => value.blobObjectId === blob.id,
            )!.bytes,
          })),
        }
      : {}),
  };
}
function records(values: readonly unknown[]): readonly ArchiveRecord[] {
  return values as readonly ArchiveRecord[];
}
