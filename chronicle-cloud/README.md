# Chronicle (cloud)

A private campaign wiki for Cloudflare Pages + Supabase Free. Players enter with a shared access
code; the DM signs in with an account. A player never receives anything the DM has not revealed:
that is enforced by PostgreSQL Row Level Security, and tested.

- Setup: `../docs/deployment/cloudflare-supabase-setup.md`
- Architecture: `../docs/architecture/chronicle-cloud-architecture.md`
- Security: `../docs/security/access-control.md`, `../docs/security/rls-test-matrix.md`
- Importing from Kanka: `../docs/migration/kanka-import-plan.md`

## Develop locally (needs Docker, PostgreSQL 16 binaries, Node 22)

```bash
npm ci
bash scripts/local-stack.sh up     # local Supabase subset on 127.0.0.1:54321
npm test                           # unit tests
npm run test:db                    # database, storage, enrollment and importer tests (wipes local data)
bash scripts/local-stack.sh seed   # synthetic sample campaign; credentials in .local/dev-credentials
bash scripts/e2e-local.sh          # build, serve with wrangler pages dev, run Playwright
npm run lint && npm run typecheck
```

Everything under `.local/` is disposable and gitignored. Sample content is synthetic.
