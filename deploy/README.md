# Service deployment

Trust Core production services are deployed separately:

- `Dockerfile.api` runs the public Trust API;
- `Dockerfile.worker` runs reconciliation and durable background work;
- managed PostgreSQL is authoritative for metadata;
- Amazon S3 or another approved immutable adapter stores canonical objects;
- Vercel hosts only the static Control Centre defined by `vercel.json`.

Build images from the repository root:

```powershell
docker build -f deploy/Dockerfile.api -t trust-core-api .
docker build -f deploy/Dockerfile.worker -t trust-core-worker .
```

The API requires production database, object-storage, identity and secret
configuration documented in `.env.example` and
`docs/production-deployment.md`. The worker uses a distinct database role and
storage identity. Do not give either container migration-owner, backup,
replication or key-administration credentials.

Configure the static Control Centre with:

```text
VITE_TRUST_API_BASE=https://trust-api.example.com
VITE_TRUST_WORKSPACE_ID=<authorised-workspace-id>
```

The API must explicitly allow the Control Centre origin at the production
ingress. Browser cookies require HTTPS and same-site deployment or an approved
cross-site cookie design. Never point a production SPA at fixture mode.
