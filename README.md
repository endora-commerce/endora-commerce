# Endora Commerce

**Open-source commerce for B2B and B2C** — quote requests and direct purchase on one codebase,
customer organisations with roles and credit limits, a permissioned admin panel, a server-rendered
storefront, and an API and webhook layer built for ERP, PIM and WMS integrations. A Fastify +
MikroORM backend on PostgreSQL, a React admin, a Next.js storefront, and every business capability
a module you install, switch off or replace.

[Documentation](https://docs.commerce.endora.software) ·
[Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md) ·
[Code of Conduct](CODE_OF_CONDUCT.md) ·
[Licence: MIT](LICENSE)

## Overview

**A free Endora Commerce runs a complete B2B storefront and its back office.** It includes a
catalogue with variants, custom fields and organisation pricing; customer organisations, roles,
addresses and credit limits; carts, RFQs, quick order and shopping lists; orders, invoice records,
returns, inventory, shipment tracking, and payment by bank transfer, on pickup or against a credit
limit. It also includes the page and e-mail builders, search, promotions, SEO, product feeds,
import/export, the mega-menu and PWA across multiple tenants, channels and currencies. A new
instance installs all of it; anything you do not use can be switched off in the admin.

**It ships no online payment gateway and no courier integration.** Card, BLIK and wallet payments,
courier labels and parcel-locker selection, accounting and ERP synchronisation, PIM
synchronisation, and Polish KSeF submission are commercial modules. The free tier carries the
vendor-neutral `payments`, `payment_methods`, `delivery_methods`, `shipments`, `credit_limits` and
`invoice_ledger` abstractions, plus the free `erp_connector` and `pim_connector` layers, so third
parties can build their own adapters. Sell here and invoice where you already invoice; an operator
who wants Endora itself to issue Polish invoices needs the commercial KSeF module.

## Quick start

You need **Node.js ≥ 22.18**, **pnpm** (`corepack enable` provides it) and **Docker** with
Compose v2. Then two commands:

```bash
npx create-endora-commerce@latest my-shop
cd my-shop && pnpm run dev:all
```

The first asks a few questions before it writes anything: which parts to write, whether to start
the development services in Docker, whether to load demo data, and the e-mail, password and name
of your administrator. Enter accepts the recommendation where there is one — every part, services
started. Demo data has none, because a shop you are evaluating wants it and one you will sell from
does not. It then writes an instance into `my-shop/`, starts PostgreSQL, Redis, Meilisearch and
Mailpit, installs every module of the open-source set — each capability described above, switched
on; turn any of them off later under **Modules** in the admin, and switch it back without losing
its data — creates your administrator and prints what to run next. Each step prints the command it
runs, so a failure names the command to finish by hand. Leave out `my-shop` and it asks for the
directory too.

The second is the one development command. It starts the API on `http://localhost:3001`, the
admin, and the storefront when there is one beside the instance, in one terminal with every line
labelled by its layer; Ctrl-C stops them all. Each layer keeps its own command — the end of the
first command prints them — and builds and deploys on its own.

What a first run gives you, today:

- **No storefront outside a checkout of this repository.** The storefront is copied from the
  reference in this repository, so run anywhere else the parts question shows it unchecked and
  cannot change it, and the instance is written without one.

With no terminal — in CI, or with `--non-interactive` — it asks nothing and every answer is a
flag. A missing one is a single refusal naming every flag still owed:

```bash
npx create-endora-commerce@latest my-shop --non-interactive --no-storefront --no-demo \
  --admin-email you@example.com --admin-password "$ADMIN_PASSWORD" \
  --admin-first-name Ada --admin-last-name Lovelace
```

`create-endora-commerce` is only a front door: it passes its arguments unchanged to
`endora install` from [`@endora-commerce/cli`](packages/cli/), which you can also call directly
as `npx @endora-commerce/cli install my-shop`; `--help` lists every flag. Everything it writes is
an ordinary pnpm workspace you own — the API, the admin and the storefront build and deploy
independently.

> **Before the first public release** the packages are not on the public npm registry yet, so
> the commands above do not resolve. To run Endora Commerce from a clone of this repository,
> follow [Developing Endora Commerce](#developing-endora-commerce) below.

## Documentation

Everything past the first run is on the documentation site,
**[docs.commerce.endora.software](https://docs.commerce.endora.software)** — built from
[`docs/`](docs/) and from each module package's own `docs/` directory:

- **Modules** — what each one does, its settings, permissions and admin screens:
  [module reference](docs/docs/module-reference/README.md).
- **Going to production** — the [first deployment checklist](docs/docs/deployment/first-deployment-checklist.md)
  and [`deploy/`](deploy/README.md) (topology, secrets, TLS).
- **Extending it** — the [kernel](docs/docs/architecture/kernel.md), the
  [customisation ladder](docs/docs/architecture/customisation-ladder.md) and
  [per-deployment overlay modules](docs/docs/architecture/overlay-pattern.md).
- **The API** — a running backend serves its OpenAPI document at `GET /api/v1/_openapi.json`.

## Hardware & system requirements

Endora Commerce is sized to run on a **single VPS** meeting the combined minimum requirements of
the technologies it uses. These tables are the authoritative list: a change that adds a runtime
dependency or alters baseline resource use updates them in the same pull request.

### Development

| Resource | Minimum | Recommended |
| --- | --- | --- |
| CPU | 4 vCPU (x86_64 or ARM64) | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB free (SSD strongly preferred) | 40 GB free (NVMe SSD) |
| OS | Linux (Ubuntu 22.04+ / Debian 12+ / Arch / Fedora), macOS 13+, Windows 11 + WSL2 | Linux |
| Docker | Docker Engine 24+ with Docker Compose v2 | — |
| Node.js | 22.x LTS (see `.nvmrc`) — minimum **22.18** (MikroORM 7 needs 22.17; unflagged type stripping needs 22.18) | — |
| pnpm | 9.x | — |

Approximate resident usage with everything running (`pnpm run dev` + Docker stack + Vitest in
watch mode): PostgreSQL 16 ~150 MB, Redis 7 ~50 MB, Meilisearch 1.11 ~300 MB (larger with the
catalogue), Mailpit ~20 MB, and ~500–800 MB for each of the three Node.js processes in watch mode.

### Production (single VPS, no container orchestration)

Target workload: a single supplier with a catalogue of hundreds of thousands of products, and
hundreds of quote requests and hundreds of orders per month.

| Resource | Minimum | Recommended |
| --- | --- | --- |
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Disk | 40 GB SSD | 100 GB NVMe SSD (with daily database backups) |
| OS | Linux LTS (Ubuntu 22.04+ / Debian 12+) | — |
| Network | Static public IPv4, HTTPS terminator (nginx / Caddy / Cloudflare) | — |
| PostgreSQL | 16.x | — |
| Redis | 7.x | — |
| Meilisearch | 1.11.x | — |
| Node.js | 22.x LTS (minimum 22.18) | — |

Container orchestration (Kubernetes, Docker Swarm, Nomad) is an operational choice, not a
requirement; running each service directly on the VPS under systemd, with PostgreSQL, Redis and
Meilisearch from distribution packages, is an equally valid target. Catalogues above 300k SKUs or
sustained traffic above one order per minute should use the Recommended tier or move Meilisearch
to its own node. Queues run on Redis (BullMQ).

## Developing Endora Commerce

This section is for working on Endora Commerce itself, in this repository. It is a pnpm
monorepo:

| Path | What it is |
| --- | --- |
| `backend/` | The API server's composition roots, the static-check estate and the backend test suites |
| `admin/` | The React admin application (Vite) |
| `storefront/` | The reference Next.js storefront, server-rendered |
| `packages/platform/` | The kernel: HTTP layer, event bus, command bus, tenancy, module lifecycle |
| `packages/contracts/` | Zod schemas — the source of truth for every API shape |
| `packages/modules/<id>/` | One package per domain module: entities, services, routes, migrations, translations, admin screens, docs and tests |
| `packages/cli/` | The `endora` command |
| `docs/` | The Docusaurus documentation site |

### Set up

```bash
git clone https://github.com/endora-commerce/endora-commerce.git
cd endora-commerce
pnpm install
pnpm run build:packages          # every package resolves through its built ./dist

cp backend/.env.example    backend/.env
cp storefront/.env.example storefront/.env
cp admin/.env.example      admin/.env

pnpm run dev:infra               # PostgreSQL, Redis, Meilisearch and Mailpit in Docker
pnpm run setup                   # recreate the development database, install every module
```

`pnpm run build:packages` is a precondition rather than an optimisation: re-run it after editing
anything under `packages/`. `pnpm run setup` **drops and recreates the development database**
named in `backend/.env` — run it for a fresh start, not over data you want to keep.

### Environment variables

Each application reads a `.env` in its own directory, and the `.env.example` beside it holds
safe defaults for the Docker stack. The variables you are most likely to set:

| Variable | Application | What it does |
| --- | --- | --- |
| `DATABASE_URL`, `REDIS_URL`, `MEILISEARCH_URL`, `MEILISEARCH_API_KEY` | backend | The three services. |
| `SMTP_URL`, `MAIL_FROM` | backend | Outgoing e-mail (`smtp://localhost:1025` is Mailpit). Unset in development, e-mail is written to the console. |
| `SETTINGS_SECRET_ENCRYPTION_KEY` | backend | Base64 32-byte key (`openssl rand -base64 32`) encrypting secret settings and stored credentials at rest. Writing a secret without it fails; rotating it invalidates stored secrets. |
| `ASSETS_LIBRARY_HMAC_KEY` | backend | Signs short-lived URLs for private assets on local storage (`openssl rand -hex 32`). |
| `DEFAULT_SALES_CHANNEL_CODE`, `SALES_CHANNEL_HOST_MAP` | backend | Which sales channel is the default, and which request host maps to which channel (`shop-a.example=channel-a,…`). |
| `PWA_VAPID_SUBJECT` | backend | The `mailto:` contact sent with Web Push messages. |
| `BACKEND_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL` | storefront | **Required.** The storefront refuses to build or start without them rather than pointing every visitor at `localhost`. |
| `NEXT_PUBLIC_BUILD_ID` / `VITE_BUILD_ID` | storefront / admin | Set per deployment so the service-worker cache is invalidated on a new release. |
| `VITE_API_BASE_URL` | admin | Where the admin reaches the API. |

A module's own settings — payment and delivery methods, storage adapters, analytics, feeds —
live in the Settings module and are described on that module's documentation page, not in
`.env`. Production configuration is in the
[first deployment checklist](docs/docs/deployment/first-deployment-checklist.md).

### Run it

```bash
pnpm run dev                     # backend, storefront and admin, with hot reload
#   backend     → http://localhost:3001
#   storefront  → http://localhost:3000
#   admin       → http://localhost:3002
#   mailpit     → http://localhost:8025

pnpm --filter backend    run dev # or one application at a time
pnpm --filter storefront run dev
pnpm --filter admin      run dev
pnpm --filter docs       run dev # the documentation site, http://localhost:3003
```

[Warden](https://docs.warden.dev/) is an optional alternative to `dev:infra` that adds
`*.endora.test` HTTPS hosts; see [`docs/docs/operations/warden.md`](docs/docs/operations/warden.md),
and do not run both at once.

### Test it

Tests come first — a failing test before the implementation — and a module's tests sit beside
its code as `*.test.ts`.

```bash
pnpm --filter backend run test:unit:fast       # no PostgreSQL, Redis or Meilisearch needed
pnpm --filter backend exec vitest run <path>   # one file while you iterate
pnpm --filter backend run test                 # unit + contract + integration; needs dev:infra
pnpm --filter '!backend' run test              # every other workspace member
pnpm -r run typecheck && pnpm -r run lint
```

### Migrations

Each module owns its migrations under `packages/modules/<id>/src/migrations/`, named
`<YYYYMMDDTHHmmss>_<module>_<slug>.ts`; execution order comes from the timestamps and the module
dependency graph.

```bash
pnpm --filter backend run migration:up         # apply every pending migration
pnpm --filter backend run migration:pending    # list what is not applied yet
pnpm --filter backend run migration:new -- --module <id> --name <slug>
pnpm --filter backend run module:status        # installed and enabled modules
```

`migration:new` prints the two lines that register the new file; an unregistered migration does
not run. [`docs/docs/architecture/migrations.md`](docs/docs/architecture/migrations.md) has the
rules and the failure modes. Demo data is optional: `pnpm --filter backend run cli demo seed`
loads a synthetic shop and prints its credentials, and `cli demo reset` withdraws it.

### Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) is the place to start: how a change is specified, tested,
checked and signed off, and how the project is governed. The binding principles every change is
reviewed against are in [the constitution](.specify/memory/constitution.md), and
[`AGENTS.md`](AGENTS.md) maps the repository and routes to the convention for whatever you are
about to do. Report a suspected vulnerability privately, as [SECURITY.md](SECURITY.md) describes.

## Licence

Endora Commerce is released under the [MIT licence](LICENSE). The project's names are covered
by the [trademark policy](TRADEMARKS.md).
