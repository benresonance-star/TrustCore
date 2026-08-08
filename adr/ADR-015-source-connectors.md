# ADR-015: Platform object storage vs user source connectors

## Decision

Trust Core keeps two separate seams for bytes that enter the platform:

1. **Platform blob store (`ObjectStorage`)** — content-addressed, immutable
   canonical objects (MinIO locally; Amazon S3 in production). Credentials are
   held on the Trust API / worker host via environment variables or IAM. Control
   Centre may diagnose connectivity and deep-link to provider consoles; it must
   not accept or store storage secrets in the browser.

2. **Future user source connectors (`SourceConnector`, name TBD)** — optional
   import paths from end-user drives such as Google Drive, Microsoft OneDrive,
   Apple iCloud, or local folders. These connectors authenticate with
   workspace/app OAuth (or equivalent), pull or receive files, and hand bytes
   into Trust Core through the existing public upload / ingest APIs.

A source connector **must not** implement or subclass `ObjectStorage`. Consumer
cloud drives are not substitutes for the platform’s content-addressed store.

## Consequences

- Amazon S3 / MinIO adapters remain under `@trust-core/storage-*` and composition
  roots (`storage-factory`, diagnostics, transfer grants).
- User-drive work is explicitly deferred in platform status until a separate
  design lands for OAuth, consent, and import UX.
- Deferred operational niceties (pause-ingest flag, API/worker config-drift
  signal, probe metrics dashboards, clock-skew diagnostics) stay out of the
  SourceConnector seam and may attach to platform storage diagnostics later.

Application-tenant BYOB bindings (ADR-016) are **canonical object-store**
configuration for connected apps. They are not SourceConnectors and must not be
confused with user-drive import paths.
