# Trust Core invariants

1. Canonical blob bytes are never overwritten.
2. Every canonical blob is SHA-256 verifiable.
3. Revisions are append-only.
4. Restoration appends a new revision.
5. Every tenant record belongs to one workspace.
6. All canonical writes pass through policy-checked commands.
7. Deletion is logical by default.
8. A retained reference prevents blob purge.
9. Audit events are append-only and hash chained.
10. Meaningful conflicts never use silent last-write-wins.
11. Exports must reconstruct data independently.
12. Derived systems never control canonical evidence.
