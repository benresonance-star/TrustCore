# Trust Archive 0.2 format contract

The portable container extension is `.trustarchive`. The final transport is a
documented ZIP64 archive. Checkpoint 0.2A defines the deterministic logical entry
set independently of a ZIP implementation so assembly and verification can be
tested without PostgreSQL, MinIO or a platform-specific archive library.

Required entries are `manifest.json`, `README.txt`, record JSONL files,
content-addressed blobs and `checksums/sha256sums.txt`. Paths use `/`, are
relative, contain no empty, dot or parent segments, contain no control characters
and must not be absolute or drive-qualified.

JSONL records are sorted by stable `id` where present and encoded as canonical
JSON with recursively sorted object keys. Unknown fields are retained. Blobs use
`blobs/{first-two-sha256-characters}/{sha256}` and their bytes must match both
declared SHA-256 and byte length.

The checksum file contains every entry except itself and signatures, sorted by
path as lowercase SHA-256, two spaces, then path. Importers reject missing,
duplicate, unexpected-unchecked or mismatched entries.

Limits are enforced before extraction and again while reading: entry count,
individual uncompressed bytes, total uncompressed bytes and compression ratio.
Checkpoint 0.2B binds these rules to ZIP64 using strict, ambiguity-checking
container parsing. It rejects encrypted or ambiguous entries, traversal,
duplicates, explicit directories, symbolic links, unsupported compression,
oversized entries, excessive aggregate expansion and compression-ratio bombs
before extraction. CRC/signature, local-header agreement, overlap and extracted
size are checked while reading. A parsed container still carries its logical
verification report; extraction never implies checksum validity.

## 0.2C dry-run import planning

Import planning is pure and non-mutating. It refuses failed archive evidence,
supports `preserve_ids` and `mapped_workspace`, and produces dependency-ordered
actions with `insert`, `already_present` or `blocked` dispositions. Unknown
record fields remain present in planned records.

`reject_on_error` blocks all pending inserts when any conflict or graph error is
present. `report_only` describes conflicts but is never executable. Immutable
schema identities with different digests and existing IDs with different
canonical content are conflicts; identical content is resumable
`already_present` state.

The deterministic plan ID binds the verified archive manifest, import mode,
workspace mapping and intended record/blob identities. It deliberately remains
stable as target records move from pending to already present. Execution must
still obtain and validate a fresh target assessment under transaction/operation
locking; a plan ID is not authority to write.

## 0.2D execution kernel

Only a verified archive and a ready, reject-on-error plan may execute. The
executor recomputes plan identity before any target access and rejects altered
actions or archive substitution. A durable operation advances through:

```text
authorised
→ target_revalidated
→ temporary_blobs_staged
→ staged_blobs_verified
→ immutable_blobs_committed
→ metadata_committed
→ audit_committed
→ completed
```

Every target effect is required to be idempotent for the operation/plan identity.
Blob bytes are SHA-256 checked before staging and checked again through the target
adapter before immutable commit. Metadata is handed to one atomic adapter
boundary only after canonical blobs exist. A stale target assessment stops before
staging. The source executor does not provide database or object-store privilege;
production ports must preserve the existing RLS, immutable-key and audit rules.

## 0.2F imported audit lineage

Every manifest carries a `source_chain` audit-lineage descriptor with source
workspace, event count and available first/last event hashes. Verification binds
the count and boundary hashes to the exported audit records. Import execution
passes this descriptor to the target audit adapter.

The target must preserve imported source events as source evidence and append a
new target-native `archive.imported` event that links the export ID, plan ID,
operation ID and source boundary hashes. It must never splice foreign events
into the target hash chain as if they were target-native history. The in-memory
candidate proves the adapter boundary; atomic PostgreSQL linkage remains part of
0.2H.

## 0.2G independent reference viewer

`@trust-core/archive-viewer` consumes only the strict reader's verified archive
result. It projects workspace, dataset, resource, revision, deletion and audit
lineage information into a provider-neutral read-only model and can render a
self-contained escaped HTML view. It must not depend on the Trust API, source
application, PostgreSQL or object store, and it refuses unverified input.

The source tests reconstruct both synthetic application fixtures. The release
gate additionally requires the viewer to open archives produced before live
source-store destruction on the Docker-capable PC.
