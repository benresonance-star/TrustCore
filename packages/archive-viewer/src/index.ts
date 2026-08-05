import type { ArchiveRecord, ParsedTrustArchive } from "@trust-core/archive";
import { readTrustArchive } from "@trust-core/archive";

export interface ArchiveViewerModel {
  readonly exportId: string;
  readonly workspace: ViewerItem | null;
  readonly datasets: readonly ViewerItem[];
  readonly resources: readonly ViewerResource[];
  readonly counts: Readonly<Record<string, number>>;
  readonly audit: {
    readonly eventCount: number;
    readonly firstEventHash: string | null;
    readonly lastEventHash: string | null;
  };
}
export interface ViewerItem {
  readonly id: string;
  readonly name: string;
}
export interface ViewerResource extends ViewerItem {
  readonly type: string;
  readonly status: string;
  readonly revisionCount: number;
  readonly deleted: boolean;
}

export function projectArchive(
  archive: ParsedTrustArchive,
): ArchiveViewerModel {
  if (!archive.verification.valid)
    throw new Error("The independent viewer refuses an unverified archive.");
  const records = archive.verification.records;
  const revisionsByResource = countBy(records.revisions ?? [], "resourceId");
  const deleted = new Set(
    (records.tombstones ?? [])
      .filter((item) => item.subjectKind === "resource")
      .map((item) => string(item.subjectId)),
  );
  const workspaceRecord = (records.workspaces ?? []).find(
    (item) => item.id === archive.manifest.workspaceId,
  );
  return {
    exportId: archive.manifest.exportId,
    workspace: workspaceRecord
      ? { id: string(workspaceRecord.id), name: label(workspaceRecord) }
      : null,
    datasets: (records.datasets ?? []).map((item) => ({
      id: string(item.id),
      name: label(item),
    })),
    resources: (records.resources ?? []).map((item) => {
      const id = string(item.id);
      return {
        id,
        name: label(item),
        type: string(item.resourceType, "Resource"),
        status: string(item.status, "unknown"),
        revisionCount: revisionsByResource.get(id) ?? 0,
        deleted: deleted.has(id),
      };
    }),
    counts: archive.manifest.recordCounts,
    audit: {
      eventCount: archive.manifest.auditLineage.eventCount,
      firstEventHash: archive.manifest.auditLineage.firstEventHash,
      lastEventHash: archive.manifest.auditLineage.lastEventHash,
    },
  };
}

export function renderArchiveHtml(model: ArchiveViewerModel): string {
  const resources = model.resources
    .map(
      (item) =>
        `<tr><td>${escape(item.name)}</td><td>${escape(item.type)}</td><td>${item.revisionCount}</td><td>${escape(item.deleted ? "Deleted · recoverable" : item.status)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(model.workspace?.name ?? "Trust archive")}</title><style>${styles}</style></head><body><main><header><small>Independent Trust Archive viewer</small><h1>${escape(model.workspace?.name ?? "Unknown workspace")}</h1><p>Export ${escape(model.exportId)} · verified read-only reconstruction</p></header><section class="metrics"><div><strong>${model.datasets.length}</strong><span>Datasets</span></div><div><strong>${model.resources.length}</strong><span>Resources</span></div><div><strong>${model.audit.eventCount}</strong><span>Audit events</span></div></section><section><h2>Resources</h2><table><thead><tr><th>Name</th><th>Type</th><th>Revisions</th><th>State</th></tr></thead><tbody>${resources}</tbody></table></section><footer>No Trust API, database or originating application was required to render this view.</footer></main></body></html>`;
}

export async function renderArchiveBytes(bytes: Uint8Array): Promise<string> {
  return renderArchiveHtml(projectArchive(await readTrustArchive(bytes)));
}

function countBy(records: readonly ArchiveRecord[], key: string) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = string(record[key]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
function label(value: ArchiveRecord) {
  return string(value.name, string(value.title, string(value.id, "Untitled")));
}
function string(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
const styles = `:root{font-family:Inter,ui-sans-serif,system-ui;color:#17201d;background:#f4f5f1}body{margin:0}main{max-width:960px;margin:auto;padding:48px 24px}header{border-bottom:1px solid #d9ddd7;padding-bottom:24px}h1{font-size:36px;margin:8px 0}p,small,footer{color:#66706a}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.metrics div{display:grid;padding:18px;background:white;border:1px solid #d9ddd7;border-radius:12px}.metrics strong{font-size:28px}.metrics span{color:#66706a}section{margin-top:28px}table{width:100%;border-collapse:collapse;background:white;border:1px solid #d9ddd7}th,td{text-align:left;padding:12px;border-bottom:1px solid #e5e8e3}th{color:#66706a;font-size:12px}footer{margin-top:24px;font-size:12px}@media(max-width:600px){.metrics{grid-template-columns:1fr}main{padding:24px 14px}table{font-size:12px}}`;
