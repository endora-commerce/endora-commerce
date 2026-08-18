# Single-VPS deployment

Deploys the whole platform (backend API + co-located workers, storefront, admin)
plus its stateful services (PostgreSQL, Redis, Meilisearch) onto **one VPS**.
TLS is **not** handled by this stack — the VPS's **existing host nginx** already
terminates SSL (Let's Encrypt) and reverse-proxies the public domains to the
apps, which are published on loopback host ports. Images are built and pushed by
**GitLab CI/CD**; the VPS only pulls and runs them.

```
                 ┌──────────────────────── VPS ────────────────────────┐
 Internet ──▶ host nginx (:80/:443, Let's Encrypt — already installed)  │
                 ├─ example.com        → 127.0.0.1:3000 → storefront:3000 (Next.js SSR)
                 ├─ admin.example.com  → 127.0.0.1:8080 → admin:80        (nginx static SPA)
                 └─ api.example.com    → 127.0.0.1:3001 → backend:3001    (Fastify + workers)
                      backend ─▶ postgres / redis / meilisearch (named volumes)
                 └─────────────────────────────────────────────────────┘
```

The Docker stack binds the three apps to `127.0.0.1` only, so they are reachable
**solely** through the host nginx — never directly from the internet.

## Files

| File | Purpose |
|------|---------|
| `compose.prod.yml` | Runtime topology — pulls images by tag, wires services, publishes apps on loopback ports |
| `nginx.example.conf` | **Template** server blocks for the host nginx (proxy + certbot TLS) — copied & adapted on the VPS, **not** applied by CI |
| `.env.prod.example` | Template for `deploy/.env` (secrets, domains, registry, host ports) — **copied to the VPS, never committed** |
| `../.gitlab-ci.yml` | quality → test → build → deploy pipeline |
| `../backend/Dockerfile` `../storefront/Dockerfile` `../admin/Dockerfile` | per-app images |

Apps run via `tsx` (backend) / Next standalone (storefront) / nginx (admin).
The backend runs API **and** BullMQ workers in one process (`BACKEND_ROLE=all`).

---

## One-time VPS provisioning

1. **DNS** — point `A`/`AAAA` records for all three (sub)domains at the VPS IP.
   Let's Encrypt issuance fails until DNS resolves.

2. **Host packages** — install Docker Engine + the compose plugin; add the
   deploy user to the `docker` group. nginx + certbot are assumed already
   present (this is the existing reverse proxy).

3. **Deploy dir + secrets**:
   ```bash
   sudo mkdir -p /opt/b2b && sudo chown "$USER" /opt/b2b
   cd /opt/b2b
   # copy deploy/.env.prod.example here as .env, then fill in every value:
   #   - REGISTRY_IMAGE = your $CI_REGISTRY_IMAGE (e.g. registry.gitlab.com/group/project)
   #   - the three domains (no ACME email — the host nginx owns TLS)
   #   - keep the *_HOST_PORT loopback binds unless a port clashes on the host
   #   - generate each secret:  openssl rand -hex 32   /   openssl rand -base64 32
   chmod 600 .env
   ```

4. **Host nginx vhosts** — wire the existing nginx to the loopback ports and let
   certbot issue/attach the certs. `deploy/nginx.example.conf` is a ready
   template:
   ```bash
   sudo cp /opt/b2b/nginx.example.conf /etc/nginx/sites-available/b2b   # or copy from the repo
   # edit the three server_name lines to your real domains
   sudo ln -s /etc/nginx/sites-available/b2b /etc/nginx/sites-enabled/b2b
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d example.com -d admin.example.com -d api.example.com
   ```
   certbot rewrites each block to add `listen 443 ssl` + the cert paths + an
   HTTP→HTTPS redirect, and sets up auto-renewal. The compose stack must be up
   (so the loopback ports answer) before `nginx -t` passes a proxied request,
   but certbot's HTTP-01 challenge on :80 does not need the apps running.

5. **Registry access** — the deploy job logs the VPS into the registry with the
   pipeline job token automatically. For manual `pull`s, run once:
   `docker login registry.gitlab.com`.

6. **GitLab CI/CD variables** — set the variables listed at the top of
   `../.gitlab-ci.yml`: domains + `SALES_CHANNEL_CODE`/`DEFAULT_LOCALE` as plain;
   `DEPLOY_*` as protected/masked. `SSH_PRIVATE_KEY` and `SSH_KNOWN_HOSTS` must be
   **type `File`** (not `Variable`) — masked variables cannot hold the newlines an
   SSH key / `known_hosts` contain. When pasting the key, keep the **trailing
   newline** or `ssh-add` rejects it.

---

## First deploy

1. Push to the default branch → `quality`, `test`, `build` run automatically and
   push `:$CI_COMMIT_SHORT_SHA` + `:latest` images.
2. Run the manual **`deploy`** job. It ships `compose.prod.yml` (the host nginx
   config stays on the VPS, owned by the operator), pulls the tagged images, runs
   migrations (`backend-migrate`), and starts the stack.
3. **Seed test data** + **create an admin user** (once), on the VPS:
   ```bash
   cd /opt/b2b
   export IMAGE_TAG=<deployed-sha>   # or: latest
   # demo catalog — TEST/STAGING HOSTS ONLY, see the warning below:
   docker compose --env-file .env -f compose.prod.yml --profile seed run --rm seed
   # admin user (interactive prompts):
   docker compose --env-file .env -f compose.prod.yml run --rm backend \
     pnpm exec tsx src/modules/admin_users/scripts/create-admin.ts
   ```

   > **Never run the `seed` profile against a client's deployment.** It runs the developer demo
   > seed, which **truncates the public catalog and business tables**, and the compose service
   > sets `ALLOW_DEV_SEED_IN_PRODUCTION=true` permanently so the script's own guard does not
   > stop it. It exists to populate a demo host and is correct for that. Creating the admin user
   > (the second command) is required everywhere.

4. **For a real client deployment, work through
   `docs/docs/deployment/first-deployment-checklist.md`.** This file gets the stack running;
   that one covers what the code cannot decide for the operator — permission grants, module
   activation, seller identity, gateway environments, backups, and the environment values
   these templates do not carry (`PUBLIC_API_BASE_URL`, `REVALIDATE_SECRET`, `SMTP_URL`).

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
