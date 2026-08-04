# ADR-002: Separate resources, revisions and blobs

## Decision

A Resource is stable identity, a Revision is immutable application state, and a BlobObject is immutable bytes.

## Consequences

The kernel remains application-neutral, duplicate bytes may be safely reused within a workspace, and history survives changes in application presentation.
