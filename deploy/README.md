# Single-VPS deployment

Deploys the whole platform (backend API + co-located workers, storefront, admin)
plus its stateful services (PostgreSQL, Redis, Meilisearch) onto **one VPS**.
TLS is **not** handled by this stack — the VPS's **existing host nginx** already
terminates SSL (Let's Encrypt) and reverse-proxies the public domains to the
apps, which are published on loopback host ports. The VPS only pulls and runs
images; building and pushing them is a registry and a pipeline of the operator's
own.

**This repository's CI does not deploy this stack anywhere** (D-274). It builds
the three images on the default branch, as the proof that they still build, and
nothing ships them to a host: the live demo is never deployed over from here. The
procedure below is the one a client — or anyone standing this file up on a host
of their own — performs.

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
| `nginx.docs.example.conf` | **Template** server block for the documentation site — a static root, no proxy; copied & adapted on the VPS, **not** applied by CI |
| `publish-docs.sh` | Shipped to the VPS by `publish:docs` and run there — flips `current` onto the transferred release, records it, prunes to five |
| `.env.prod.example` | Template for `deploy/.env` (secrets, domains, registry, host ports) — **copied to the VPS, never committed** |
| `../.gitlab-ci.yml` | quality → test → build pipeline, plus the documentation publication; it deploys no application stack (D-274) |
| `../backend/Dockerfile` `../storefront/Dockerfile` `../admin/Dockerfile` | per-app images |

Apps run built output: `node dist/index.js` (backend, feature 080 D-165) / Next standalone
(storefront) / nginx (admin).
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

5. **Registry access** — log the VPS into whichever registry holds your images,
   once: `docker login <your-registry>`. A pipeline that deploys for you can do it
   per run with a short-lived token instead.

6. **Build inputs** — the storefront and the admin inline their public origins at
   build time, so the images must be built with your domains. The inputs, and the
   build argument each image reads, are declared once in
   `packages/cli/src/lib/instance-build-inputs.ts`; `../.gitlab-ci.yml`'s `build:*`
   jobs are this repository's own use of that declaration.

---

## First deploy

This repository's CI stops at building images; it has no job that deploys this
stack, and none may be added (D-274 — `backend/test/unit/ci/live-demo-deploy.test.ts`
refuses one). A deployment is therefore the operator's own act, on the host:

1. **Build and push the three images** with your build inputs (step 6 above), tagged
   by commit, to the registry `.env`'s `REGISTRY_IMAGE` names.
2. **Copy `compose.prod.yml`** into the deploy directory beside `.env`, then start
   the stack:
   ```bash
   cd /opt/b2b
   export IMAGE_TAG=<sha>
   docker compose --env-file .env -f compose.prod.yml pull
   docker compose --env-file .env -f compose.prod.yml up -d
   ```
   `backend-migrate` applies the migrations before the API starts.
3. **Create an admin user** (once), on the VPS:
   ```bash
   cd /opt/b2b
   export IMAGE_TAG=<deployed-sha>   # or: latest
   docker compose --env-file .env -f compose.prod.yml run --rm backend \
     node dist/cli.js admin_users create
   ```

   There is **no data-seeding step**. A deployment starts empty on purpose; the catalogue is
   the client's. The developer demo seed is not part of a deployment — see *Populating a demo
   host* below, which is not a step of this procedure.

4. **For a real client deployment, work through
   `docs/docs/deployment/first-deployment-checklist.md`.** This file gets the stack running;
   that one covers what the code cannot decide for the operator — permission grants, module
   activation, seller identity, gateway environments, backups, and the one environment value
   these templates still do not carry (`SMTP_URL`).

## Subsequent deploys

The same two `docker compose` commands with the new `IMAGE_TAG`. Migrations run before
the API starts every time; rollback is the same commands with
an older tag. This repository's pipeline performs none of it.

---

## The documentation site — `docs.commerce.endora.software`

The Docusaurus site is **not part of the application stack**: no image, no container, no
entry in `compose.prod.yml`, no loopback port. CI builds it, ships the files, and the **same
host nginx** serves them straight off disk from a static document root.

```
 Internet ──▶ host nginx (:80/:443, Let's Encrypt)
                └─ docs.commerce.endora.software → root $DOCS_DEPLOY_PATH/current → releases/<sha>/
```

### What CI does — and where its share ends

On the default branch, `build:docs` builds the site and `verify:docs-build` judges the emitted
tree; `publish:docs` then consumes **that artefact** — it never rebuilds — and does three
things over SSH:

```bash
ssh "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '$DOCS_DEPLOY_PATH/releases'"
scp deploy/publish-docs.sh "$DEPLOY_USER@$DEPLOY_HOST:$DOCS_DEPLOY_PATH/publish-docs.sh"
rsync -a --delete --link-dest=../../current docs/build/ \
  "$DEPLOY_USER@$DEPLOY_HOST:$DOCS_DEPLOY_PATH/releases/$CI_COMMIT_SHA/"
# then on the host: publish-docs.sh flips `current`, writes `.published`, prunes to 5 releases
```

`--link-dest` is **`../../current`, not `../current`**: rsync resolves a relative `--link-dest`
against the *destination* directory (`releases/<sha>/`), and `current` sits one level above
`releases/`. A `--link-dest` naming a directory that does not exist is **not an error** — it
hard-links nothing and silently re-transfers the whole 40 MB tree on every publication.

**Everything below this point is a devops act on the VPS, performed outside this repository.**
This repository commits the template (`nginx.docs.example.conf`), the publication script and
this procedure. Nothing in CI creates a DNS record, installs a vhost, reloads nginx or issues a
certificate, and no task in the feature that wrote this section may claim it did: **CI's share
ends at the `rsync` plus `publish-docs.sh`.** The steps below are read and performed by an
operator.

### 1. DNS

Point `A`/`AAAA` records for `docs.commerce.endora.software` at the same VPS IP the three
application domains resolve to. Let's Encrypt issuance fails until DNS resolves.

### 2. Document root

```bash
sudo mkdir -p /var/www/docs.commerce.endora.software/releases
sudo chown -R "$DEPLOY_USER" /var/www/docs.commerce.endora.software
sudo chmod 755 /var/www /var/www/docs.commerce.endora.software
```

The deploy user owns it (CI writes into it over SSH); nginx's worker only needs to traverse and
read. The layout `publish-docs.sh` maintains is:

```
$DOCS_DEPLOY_PATH/                    # /var/www/docs.commerce.endora.software
├── releases/<CI_COMMIT_SHA>/         # one build, one commit — the last 5 are kept
├── current -> releases/<sha>         # the symlink nginx serves as `root`
├── .published                        # the CI_COMMIT_TIMESTAMP currently live
└── publish-docs.sh                   # shipped by the job, from deploy/publish-docs.sh
```

`current` does not exist until the first successful `publish:docs`; nginx answers 404 until
then, which is the correct state for a document root with nothing published in it.

### 3. The vhost

`deploy/nginx.docs.example.conf` is a ready template — a **static root**, no `proxy_pass`:

```bash
sudo cp /path/to/nginx.docs.example.conf /etc/nginx/sites-available/docs
# replace the `$DOCS_DEPLOY_PATH` placeholder in `root` with the literal path from step 2 —
# nginx expands no environment variables, and `nginx -t` refuses the placeholder
sudo ln -s /etc/nginx/sites-available/docs /etc/nginx/sites-enabled/docs
sudo nginx -t && sudo systemctl reload nginx
```

The template carries `index index.html`, `error_page 404 /404.html` (the site's own 404 page,
not nginx's), a year of `immutable` caching for the content-hashed `/assets/` bundle, and
`no-cache` for the HTML, `robots.txt` and both sitemaps. It also carries the one thing the
plan for it got wrong: the two search indexes (`/search-index.json`, `/pl/search-index.json`)
are **not** under `/assets/` and are **not** content-hashed by filename — the search plugin's
`hashed: true` hashes the query string — so they revalidate rather than being pinned for a
year. The reasoning is written in the template beside the rule.

### 4. TLS

```bash
sudo certbot --nginx -d docs.commerce.endora.software
```

certbot rewrites the `:80` block in place — adds `listen 443 ssl`, the certificate paths and an
HTTP→HTTPS redirect — and sets up auto-renewal. The block ships as plain `:80` precisely so
certbot has something to attach to; its HTTP-01 challenge does not need anything published yet.

### 5. GitLab CI/CD variables

| Variable | Type | Value |
|----------|------|-------|
| `DOCS_DEPLOY_PATH` | Variable (protected) | the documentation root from step 2, e.g. `/var/www/docs.commerce.endora.software` |
| `SSH_PRIVATE_KEY` | **File** | created for the application `deploy` job D-274 retired |
| `SSH_KNOWN_HOSTS` | **File** | created for the application `deploy` job D-274 retired |
| `DEPLOY_USER` | Variable (protected) | created for the application `deploy` job D-274 retired |
| `DEPLOY_HOST` | Variable (protected) | created for the application `deploy` job D-274 retired |

Only `DOCS_DEPLOY_PATH` is new; the other four were created for the application deploy, which
D-274 retired, and `publish:docs` is now the one job that reads them. `SSH_PRIVATE_KEY` and `SSH_KNOWN_HOSTS` must be type **`File`** — masked
variables cannot hold the newlines an SSH key and a `known_hosts` contain — and the key needs
its **trailing newline** or `ssh-add` rejects it.

**`DOCS_DEPLOY_PATH` is not `DEPLOY_PATH`.** `DEPLOY_PATH` is the application stack's directory
(`/opt/b2b`: `compose.prod.yml` and `.env`). The publication rsyncs with `--delete` into
`$DOCS_DEPLOY_PATH/releases/<sha>/`, and `publish-docs.sh` refuses to start when
`DOCS_DEPLOY_PATH` is unset rather than guessing. Give the documentation its own directory.

### Rolling back a publication

A rollback is the same flip pointed at an older release. **No rebuild, no pipeline, no nginx
reload** — nginx resolves `current` per request.

```bash
cd /var/www/docs.commerce.endora.software      # $DOCS_DEPLOY_PATH
ls -1dt releases/*/                            # newest first — pick the release to go back to
ln -sfn releases/<older-sha> current.tmp && mv -Tf current.tmp current
```

**Type it in that two-step form; never abbreviate it to a bare `ln -sfn releases/<older-sha>
current`.** `ln -sfn` onto a name that already resolves to a *directory* — which is what a
symlink to a release directory is — creates the link **inside** that directory instead of
replacing it: you get `current/releases/<older-sha>` and a document root still serving the
broken build. `mv -Tf` is a single `rename(2)` over the symlink itself, so a reader sees the old
release or the new one and never a missing document root. `deploy/publish-docs.sh` flips the
same way, for the same reason.

The five most recent releases are kept, and the live one is never pruned even when it falls
outside that window — so a release you have rolled back onto stays there until you roll forward.
The next publication from the default branch flips `current` onto the new build as usual; a
rollback holds only until then.

### A neighbouring file that will mislead you

`deploy/compose.prod.yml`'s header comment describes a `central-nginx-proxy` container on an
external `public_proxy` Docker network as the live TLS terminator. **That is not what runs.**
The owner ruled on 2026-09-22 that the topology is the one this file and
`deploy/nginx.example.conf` describe: a host-level nginx with certbot, in front of loopback
ports. The compose header is a documentation defect owned by devops and is deliberately not
fixed here — `compose.prod.yml` is a separate unit with its own owner. It is recorded because a
reader who reaches for that file to add a vhost will be misled exactly the way the specification
for this documentation site was: there is no container to attach the docs to, no `public_proxy`
network to join, and nothing about publishing documentation belongs in that file.

---

## Populating a demo host — **never a client deployment**

> The developer demo seed **truncates the public catalog and business tables**. It exists to
> fill a demo or sales host with example data, and it is correct for that and for nothing
> else. Run it on a host whose data you are willing to lose, and on no other.

`compose.prod.yml` used to ship a `seed` service with `ALLOW_DEV_SEED_IN_PRODUCTION=true`
already set — the flag whose whole purpose is that an accidental run cannot wipe real data —
and this file listed it as a deployment step. It no longer exists (issue #218). To populate a
demo host, **both** overrides are typed at the moment they are meant:

```bash
cd /opt/b2b
export IMAGE_TAG=<deployed-sha>
docker compose --env-file .env -f compose.prod.yml run --rm \
  -e ALLOW_DEV_SEED_IN_PRODUCTION=true \
  -e ALLOW_DEV_SEED_ON_NON_LOCAL_DATABASE=true \
  backend node dist/cli.js demo seed
```

The guard (`packages/platform/src/demo/guard.ts`) asks two separate questions, and each
override answers one. `ALLOW_DEV_SEED_IN_PRODUCTION` is the answer to *"this is
`NODE_ENV=production`"*. `ALLOW_DEV_SEED_ON_NON_LOCAL_DATABASE` is the answer to *"the
database is neither on loopback nor named as a test database"* — and in this stack it is
not: the host is `postgres`, the compose service, and the name is `POSTGRES_DB` (`b2b` by
default). With only the
first, the command refuses on the second and says so.
`node dist/cli.js demo reset` withdraws exactly what it created.

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
  node dist/db/migrate.js up
```

### Notes & caveats

- **RAM**: building happens in CI, but the running stack (2 Node processes +
  Postgres + Redis + Meilisearch) wants **≥ 4 GB** (8 GB comfortable).
- **Backups**: Postgres data lives in the `postgres-data` volume. Add a cron job
  running the `pg_dump` above off-box (e.g. to object storage) — a stray
  `docker compose down -v` wipes the volume.
- **Build path is validated locally**: all three images have been built and
  smoke-tested (`docker build -f <app>/Dockerfile .` from the repo root) — backend
  boots its full module graph from `dist/` (fails only on an absent DB), admin
  serves the SPA, storefront's standalone server starts and listens. `docker compose
  -f deploy/compose.prod.yml config` also validates. The CI runner uses BuildKit
  (`docker:dind`); a local legacy builder works too. Since feature 080 (D-165) the
  backend image is not smoke-tested by hand: `scripts/boot-gate.sh` builds it,
  migrates a throwaway database, boots it and asserts that translations installed
  for every module the platform composes and that the deployment's overlay modules
  are still there — the two things that were reproduced silently broken on the
  half-built compiled path.
- **Client IP**: the backend trusts `X-Forwarded-For` only from the hop named by
  `TRUSTED_PROXY_HOPS` (or `TRUSTED_PROXY_ADDRESSES`). `.env.prod.example` ships
  `TRUSTED_PROXY_HOPS=1`, which is right for this stack — one host nginx in front
  of the backend. Leave it unset and every request looks like it came from the
  proxy: the per-IP rate limit becomes a single shared bucket and the security
  audit rows record the proxy's address instead of the actor's. Raise it by one
  per extra proxy (a CDN in front of nginx makes it 2); the backend refuses to
  boot on a value it cannot make sense of, and has no "trust every hop" setting.
- **Single environment**: this setup targets one test/staging host. For
  staging+prod, parameterise domains/volumes per environment (or use a second VPS).
