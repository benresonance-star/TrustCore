# Recovery runbook — initial outline

The first release must prove reconstruction, not merely backup creation.

Required drills:

1. Re-run an interrupted upload operation idempotently.
2. Reconcile an immutable blob whose metadata transaction failed.
3. Detect metadata pointing to a missing blob.
4. Restore PostgreSQL and verify the audit chain.
5. Rebuild a dataset from a future `.trustarchive` in Release 0.2.

No recovery is considered successful until hashes and relationships verify.
