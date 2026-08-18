---
title: Local development with Warden
description: Run Endora Commerce infrastructure through Warden (Traefik, *.test HTTPS) while apps stay on the host via pnpm.
---

# Local development with Warden

This repository is a **pnpm monorepo**. Backend, storefront and admin share one
API and one set of data stores — so there is **one** Warden environment
(`WARDEN_ENV_TYPE=local`), not separate projects per app.

| Layer | What runs where |
| --- | --- |
| Infrastructure | Warden: PostgreSQL 16, Redis 7, Meilisearch, Mailhog |
| Apps | Host: `pnpm run dev` (backend :3001, storefront :3000, admin :3002) |
| HTTPS front door (optional) | Traefik → nginx proxies in `.warden/` → host ports |

Plain Docker Compose (`pnpm run dev:infra`) remains supported and is equivalent
for day-to-day work without `*.test` HTTPS. **Do not run Compose and Warden at
the same time** — they publish the same default host ports.

## Prerequisites

- [Warden](https://docs.warden.dev/) ≥ 0.15 (`brew install wardenenv/warden/warden`)
- Docker Engine running
- Node.js ≥ 22.17 and pnpm ≥ 9 (see root `README.md`)
- On first use: `warden svc up` (Traefik, dnsmasq, Mailpit UI, Portainer)

## One-time setup

```bash
# From the monorepo root
cp .env.warden.example .env
warden sign-certificate endora.test   # trust *.endora.test in the browser
warden env up -d

pnpm install
cp backend/.env.example    backend/.env
cp storefront/.env.example storefront/.env
cp admin/.env.example      admin/.env
```

Alternatively: `warden env-init endora local`, then merge the values from
`.env.warden.example` into the generated `.env` (especially the
`WARDEN_ELASTICHQ=0` and related flags — without them Warden starts an unused
ElasticHQ container even for `local` environments).

Verify infra:

```bash
warden env ps
# postgres / redis / meilisearch / mailhog / nginx_* should be healthy
```

### Database + seed

```bash
pnpm --filter backend run migration:up   # or: db:fresh  (destructive)
pnpm --filter backend run seed:dev
```

Demo credentials are printed by the seed script.

## Daily loop

```bash
warden svc up          # once per machine boot if globals are down
warden env up -d       # project infra
pnpm run dev           # backend + storefront + admin
```

| Surface | localhost | HTTPS via Traefik |
| --- | --- | --- |
| Storefront | http://localhost:3000 | https://www.endora.test / https://endora.test |
| Backend API | http://localhost:3001 | https://api.endora.test |
| Admin | http://localhost:3002 | https://admin.endora.test |
| Mailhog UI | http://localhost:8025 | https://mail.endora.test |
| Meilisearch | http://localhost:7700 | https://meilisearch.endora.test |
| Warden Traefik | — | https://traefik.warden.test |
| Warden webmail (global) | — | https://webmail.warden.test |

`localhost` URLs work with the default app `.env` examples. Traefik URLs need
the CORS / public-URL overrides in the next section.

Stop:

```bash
# Ctrl+C stops pnpm run dev
warden env down          # keep volumes
warden env down -v       # also wipe postgres / redis / meilisearch data
```

## Using `*.endora.test` (HTTPS)

Point the apps at the Traefik hostnames so cookies, CORS and absolute links
match what the browser sees.

Browser-facing URLs use the Traefik hostnames; **server-to-server URLs stay on
`http://localhost:<port>`**. Node does not read the system trust store, so a
server-side `fetch` at `https://…​.test` fails with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` unless the Warden CA is exported (see below).

**`backend/.env`** (diff against the example):

```bash
CORS_ALLOWED_ORIGINS=https://www.endora.test,https://endora.test,https://admin.endora.test,http://localhost:3000,http://localhost:3002
BACKEND_PUBLIC_URL=https://api.endora.test
ADMIN_BASE_URL=https://admin.endora.test
STOREFRONT_BASE_URL=http://localhost:3000   # backend fetches this server-side
SMTP_URL=smtp://localhost:1025
```

**`storefront/.env`**:

```bash
BACKEND_BASE_URL=http://localhost:3001              # server components / server actions
NEXT_PUBLIC_API_BASE_URL=https://api.endora.test    # browser
```

### Keeping every URL on `*.test`

Export the Warden root CA **in the shell** before `pnpm run dev` — putting it in
a `.env` does not work, because Node reads `NODE_EXTRA_CA_CERTS` at startup,
before `--env-file` is parsed:

```bash
export NODE_EXTRA_CA_CERTS="$HOME/.warden/ssl/rootca/certs/ca.cert.pem"
pnpm run dev
```

With that exported, `BACKEND_BASE_URL` and `STOREFRONT_BASE_URL` can point at the
`https://…​.test` hostnames too.

**`admin/.env`**:

```bash
# Keep API on localhost — session cookies are SameSite=Lax and Secure=false
# in development; a cross-site hop to https://api.…​.test yields login 200
# followed by /admin/me 401. Open the admin at http://localhost:3002.
VITE_API_BASE_URL=http://localhost:3001
VITE_STOREFRONT_BASE_URL=http://localhost:3000
```

To drive the admin through Traefik (`https://admin.…​.test` → `https://api.…​.test`)
you also need `Secure` session cookies (and preferably `SameSite=None` only if
the two hosts ever count as cross-site). That is not wired as an env toggle
today — use localhost for the admin SPA until it is.

Infrastructure connection strings stay on **localhost** (published ports) —

```bash
DATABASE_URL=postgresql://b2b:b2b@localhost:5432/b2b
REDIS_URL=redis://localhost:6379
MEILISEARCH_URL=http://localhost:7700
```

— because the Node processes run on the host, not inside the Compose network.

If Vite or Next.js HMR misbehaves behind Traefik, use the `localhost` URLs for
the app you are actively editing; API CORS already allows both.

## Build

Same commands as without Warden — infra is only needed when a step hits the
database or Redis:

```bash
pnpm -r run typecheck
pnpm -r run lint
pnpm -r run build

pnpm --filter @b2b/cms-components build   # after CMS component class changes
pnpm --filter backend run test            # needs postgres (+ redis for some suites)
```

Production images and deploy compose live under `deploy/` — Warden is
**local development only**.

## Why not two Warden environments?

| Idea | Why it is a poor fit here |
| --- | --- |
| Separate `backend` + `storefront` Warden projects | One Postgres/Redis/Meilisearch; splitting doubles ports and env drift |
| Containerised Node per app | Possible, but slower hot reload on WSL and fights the existing `scripts/dev.mjs` orchestrator |

Treat **backend / storefront / admin** as processes, and **Warden** as the shared
data plane + HTTPS edge.

## Port clashes / second checkout

Edit the `*_PORT` values in the root `.env` (from `.env.warden.example`), keep
`WARDEN_ENV_NAME` unique, and re-sign if you change `TRAEFIK_DOMAIN`:

```bash
warden sign-certificate other-endora.test
warden env up -d
```

Align `backend/.env` / `storefront/.env` / `admin/.env` with the new ports.

## Switching back to Compose-only

```bash
warden env down
cp .env.example .env          # optional — only if you need non-default ports
pnpm run dev:infra
pnpm run dev
```

## Troubleshooting

- **`Docker does not appear to be running`** — start Docker Desktop / the Engine, then `warden svc up`.
- **502 from `https://api.endora.test`** — `pnpm run dev` is not up, or backend is not on port 3001.
- **Certificate warnings** — re-run `warden sign-certificate endora.test` and install/trust the Warden CA (see [Warden installing](https://docs.warden.dev/installing.html)).
- **`UNABLE_TO_VERIFY_LEAF_SIGNATURE` in a Node process** — a server-side `fetch` hit an `https://…​.test` URL. Use the `localhost` URL for that hop, or export `NODE_EXTRA_CA_CERTS` as shown above.
- **`ENOTFOUND api.endora.test` in a Node process** — the app started before `warden svc up` brought dnsmasq up. Verify with `getent hosts api.endora.test`, then restart `pnpm run dev`.
- **DNS for `*.test` fails** — `warden svc up` must be running (dnsmasq); on some Linux setups check that `/etc/resolv.conf` still points at Warden’s resolver.
- **Port already allocated** — stop the other stack (`pnpm run dev:infra:down` or `warden env down`) or change `*_PORT` in `.env`.
