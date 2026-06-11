# Single-VPS deployment

Deploys the whole platform (backend API + co-located workers, storefront, admin)
plus its stateful services (PostgreSQL, Redis, Meilisearch) onto **one VPS**,
fronted by **Caddy** with automatic HTTPS. Images are built and pushed by
**GitLab CI/CD**; the VPS only pulls and runs them.

```
                 ┌──────────────── VPS ────────────────┐
 Internet ──▶ Caddy (:80/:443, Let's Encrypt)          │
                 ├─ example.com        → storefront:3000 (Next.js SSR)
                 ├─ admin.example.com  → admin:80        (nginx static SPA)
                 └─ api.example.com    → backend:3001    (Fastify + workers)
                      backend ─▶ postgres / redis / meilisearch (named volumes)
                 └─────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `compose.prod.yml` | Runtime topology — pulls images by tag, wires services |
| `Caddyfile` | Reverse proxy + automatic HTTPS for the three (sub)domains |
| `.env.prod.example` | Template for `deploy/.env` (secrets, domains, registry) — **copied to the VPS, never committed** |
| `../.gitlab-ci.yml` | quality → test → build → deploy pipeline |
| `../backend/Dockerfile` `../storefront/Dockerfile` `../admin/Dockerfile` | per-app images |

Apps run via `tsx` (backend) / Next standalone (storefront) / nginx (admin).
The backend runs API **and** BullMQ workers in one process (`BACKEND_ROLE=all`).

---

## One-time VPS provisioning

1. **DNS** — point `A`/`AAAA` records for all three (sub)domains at the VPS IP.
   Let's Encrypt issuance fails until DNS resolves.

2. **Host packages** — install Docker Engine + the compose plugin; add the
   deploy user to the `docker` group.

3. **Deploy dir + secrets**:
   ```bash
   sudo mkdir -p /opt/b2b && sudo chown "$USER" /opt/b2b
   cd /opt/b2b
   # copy deploy/.env.prod.example here as .env, then fill in every value:
   #   - REGISTRY_IMAGE = your $CI_REGISTRY_IMAGE (e.g. registry.gitlab.com/group/project)
   #   - the three domains + ACME_EMAIL
   #   - generate each secret:  openssl rand -hex 32   /   openssl rand -base64 32
   chmod 600 .env
   ```

4. **Registry access** — the deploy job logs the VPS into the registry with the
   pipeline job token automatically. For manual `pull`s, run once:
   `docker login registry.gitlab.com`.

5. **GitLab CI/CD variables** — set the variables listed at the top of
   `../.gitlab-ci.yml` (domains + `SALES_CHANNEL_CODE`/`DEFAULT_LOCALE` as plain;
   the `SSH_*` and `DEPLOY_*` as protected/masked).

---

## First deploy

1. Push to the default branch → `quality`, `test`, `build` run automatically and
   push `:$CI_COMMIT_SHORT_SHA` + `:latest` images.
2. Run the manual **`deploy`** job. It ships `compose.prod.yml` + `Caddyfile`,
   pulls the tagged images, runs migrations (`backend-migrate`), and starts the stack.
3. **Seed test data** + **create an admin user** (once), on the VPS:
   ```bash
   cd /opt/b2b
   export IMAGE_TAG=<deployed-sha>   # or: latest
   # demo catalog:
   docker compose --env-file .env -f compose.prod.yml --profile seed run --rm seed
   # admin user (interactive prompts):
   docker compose --env-file .env -f compose.prod.yml run --rm backend \
     pnpm exec tsx src/modules/admin_users/scripts/create-admin.ts
   ```

Subsequent deploys: just run the `deploy` job. Migrations run before the API
starts every time; rollback = re-run `deploy` from an older pipeline (its images
are tagged by that commit's SHA).

---

## Operations che-sheet (on the VPS, in `/opt/b2b`)

```bash
# status / logs
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs -f backend

# DB backup (recommended via cron — see note below)
docker compose -f compose.prod.yml exec -T postgres \
  pg_dump -U b2b b2b | gzip > backup-$(date +%F).sql.gz

# manual migration / cache clear
docker compose --env-file .env -f compose.prod.yml run --rm backend \
  pnpm exec tsx src/db/migrate.ts up
```

### Notes & caveats

- **RAM**: building happens in CI, but the running stack (2 Node processes +
  Postgres + Redis + Meilisearch) wants **≥ 4 GB** (8 GB comfortable).
- **Backups**: Postgres data lives in the `postgres-data` volume. Add a cron job
  running the `pg_dump` above off-box (e.g. to object storage) — a stray
  `docker compose down -v` wipes the volume.
- **Build path is validated locally**: all three images have been built and
  smoke-tested (`docker build -f <app>/Dockerfile .` from the repo root) — backend
  boots its full module graph via `tsx` (fails only on an absent DB), admin serves
  the SPA, storefront's standalone server starts and listens. `docker compose
  -f deploy/compose.prod.yml config` also validates. The CI runner uses BuildKit
  (`docker:dind`); a local legacy builder works too.
- **Single environment**: this setup targets one test/staging host. For
  staging+prod, parameterise domains/volumes per environment (or use a second VPS).
