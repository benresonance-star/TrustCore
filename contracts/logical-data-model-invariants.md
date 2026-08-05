# Logical Data Model invariant matrix

This matrix assigns each logical invariant to its authoritative enforcement
layers. Multiple layers are deliberate defence in depth; the first named layer
is not permission to omit the others.

| ID     | Invariant                                                              | Contract/type                       | Service/policy                           | PostgreSQL                                | Object storage                      | Archive/import                                     |
| ------ | ---------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- | ----------------------------------------- | ----------------------------------- | -------------------------------------------------- |
| LDM-01 | Every tenant record resolves to exactly one workspace                  | Workspace-scoped IDs                | Authenticated workspace context          | FKs, RLS, composite FKs                   | Workspace key prefix                | Manifest workspace plus reference validation       |
| LDM-02 | Applications never gain access merely by registration                  | Capability and assignment contracts | Registration + capability + scoped role  | Registration and assignment rows          | No direct credentials               | Import cannot create active authority implicitly   |
| LDM-03 | Revisions are immutable and monotonically numbered per resource        | Revision contract                   | Expected-head check                      | Unique number, immutability triggers      | N/A                                 | Parentage and content validation                   |
| LDM-04 | Restore appends and cites its source                                   | Restore contract                    | History service                          | Revision FK and immutable history         | Existing bytes retained             | Restored lineage survives round trip               |
| LDM-05 | Canonical bytes are immutable and digest-addressed                     | Blob contract                       | Hash before/after write                  | Workspace/digest uniqueness               | Immutable commit key                | Checksums and byte lengths verified twice          |
| LDM-06 | A resource head points to its own revision                             | Resource/revision contract          | Transactional head update                | Deferred composite FK                     | N/A                                 | Reference validation before commit                 |
| LDM-07 | Cross-workspace references are rejected                                | Scoped entity contracts             | Command validation                       | Composite FKs and RLS where representable | Workspace prefix                    | Complete graph validation                          |
| LDM-08 | Deletion is logical by default                                         | Tombstone lifecycle                 | Delete command                           | Tombstone plus protected history          | Referenced bytes retained           | Tombstone and prior revision exported              |
| LDM-09 | Retention or legal hold prevents purge                                 | Retention contract                  | Purge authorization                      | Physical model pending                    | Delete denied while referenced      | Policy must survive import                         |
| LDM-10 | Audit evidence is append-only and hash chained                         | Audit contract                      | Serialized append                        | Immutability trigger                      | N/A                                 | Source chain retained; import linkage pending      |
| LDM-11 | External writes are idempotent                                         | Operation contract                  | Request binding and resume               | Unique operation identity                 | Idempotent temporary/canonical keys | Deterministic plan and operation IDs               |
| LDM-12 | Interrupted cross-store work resumes, reconciles or quarantines        | State machine                       | Checkpoint handlers                      | Durable state/outbox                      | Temporary/canonical separation      | Eight import checkpoints                           |
| LDM-13 | Policy assignments and grants are revoked, not erased                  | Policy contracts                    | Active-at-time evaluation                | `revoked_at` history                      | N/A                                 | Security state is not silently activated on import |
| LDM-14 | Break-glass is narrow, expiring, reasoned and audited                  | Eligible action set                 | Policy evaluation                        | Expiry/reason checks                      | N/A                                 | Grant import cannot bypass target policy           |
| LDM-15 | Unknown permitted fields survive portability                           | Schema compatibility                | Schema validator                         | JSONB                                     | Byte preservation                   | Canonical JSONL retains unknown fields             |
| LDM-16 | A verified archive is necessary but not sufficient authority to import | Import contract                     | Re-auth, policy, fresh target assessment | Production adapter pending                | Staging isolation pending           | Verified archive + ready plan + authorization      |
| LDM-17 | Derived systems cannot control canonical evidence                      | Processing boundary                 | No canonical mutation capability         | Separate persistence/roles                | Separate namespace/account          | Derived records excluded or classified explicitly  |
| LDM-18 | Provider identifiers are never portable identity                       | Logical model                       | Adapter translation                      | Provider fields isolated                  | Provider-local locator              | Import derives new locator from digest             |

## Gate interpretation

- Rows marked `pending` identify evidence required in later checkpoints; they
  are not silently assumed complete.
- Source-only tests can prove contract, policy and provider-neutral behavior.
- PostgreSQL/MinIO recovery and process-interruption claims require the deferred
  PC/Docker gate.
