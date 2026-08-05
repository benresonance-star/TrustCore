# Checkpoint 0.2E — Logical Data Model and contract alignment

## Outcome

Trust Core now has a provider-independent Logical Data Model covering canonical,
security, operational, portable and derived boundaries. It is backed by an
enforcement matrix mapping invariants across contracts, services, PostgreSQL,
object storage and archive/import behavior.

## Added

- `docs/logical-data-model.md` with entity semantics, cardinalities, lifecycle,
  identity rules, portability flow and Large Database Model boundary;
- `contracts/logical-data-model-invariants.md` with eighteen cross-layer
  invariants;
- explicit representation of the 0.2F contract inputs and 0.2H physical proof
  dependencies.

## Alignment findings

1. Retention policy is referenced but lacks a first-class physical table and
   public contract.
2. Blob encryption fields exist physically but are absent from the core domain
   projection.
3. Tombstone reason/restoration fields are not aligned across domain and
   physical projections.
4. Imported audit-chain preservation and target linkage need an explicit
   contract.
5. Identity-session JSON is acceptable only as an authentication cache, never
   as canonical authorization data.

These are recorded gaps, not falsely completed implementation. Items 1, 3 and 4
must be resolved in the Portability API/production adapter design. Item 2 is
required before the cloud recovery milestone.

## Gate status

`0.2E LOGICAL MODEL CANDIDATE: PASS`

This is documentation and contract evidence. It does not close the Release 0.2
portability gate and makes no new PostgreSQL, MinIO or Docker claim.
