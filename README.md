# B2B Platform

A Supplier-operated B2B commerce platform supporting both **Quote Request (RFQ)** and **direct-purchase** workflows on one codebase, with Customer Organizations, multi-user Roles, Credit Limit settlement, a permissioned Admin Panel, and an open API + webhook layer built for ERP / PIM / WMS / CRM integrations.

- **Constitution** (governance source of truth): [`.specify/memory/constitution.md`](./.specify/memory/constitution.md)
- **Feature 001 — Foundation spec, plan, tasks**: [`specs/001-b2b-platform-foundation/`](./specs/001-b2b-platform-foundation/)
- **Runtime guidance and module docs**: the docs site in [`docs/`](./docs/)

## Table of contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Environment variables](#environment-variables)
- [Running the stack](#running-the-stack)
- [Running the test suite](#running-the-test-suite)
- [Running migrations](#running-migrations)
- [Repository layout](#repository-layout)
- [Hardware & system requirements](#hardware--system-requirements)
- [Constitution quick reference](#constitution-quick-reference)

## Overview

The repository is a **pnpm monorepo** with three independently buildable applications plus shared packages and a documentation site:

- `backend/` — Node.js + TypeScript API server (Fastify + MikroORM + Zod).
- `storefront/` — Next.js customer-facing website (SSR-first for catalog/category/product pages).
- `admin/` — React admin panel (Vite).
- `packages/contracts/` — Zod schemas shared across applications (source of truth for API types per Principle V).
- `packages/api-client/` — typed HTTP client used by storefront and admin.
- `docs/` — Docusaurus documentation site for developers and Product Owners.

## Prerequisites

- **Node.js** ≥ 22.17 (LTS). Use `nvm use` or Volta; `.nvmrc` is pinned to `22`. Node 20 reached end-of-life in April 2026 and cannot run MikroORM 7.
- **pnpm** ≥ 9. Enable via `corepack enable && corepack prepare pnpm@latest --activate`.
- **Docker** + **Docker Compose v2** (for PostgreSQL, Redis, Meilisearch, Mailhog).
- **Git**.

## Install

```bash
git clone <repo>
cd b2b-platform
pnpm install
```

The install pulls all workspaces (`backend`, `storefront`, `admin`, `packages/*`, `docs`).

## Environment variables

Every application reads its configuration from a workspace-local `.env` file. Copy the examples after `pnpm install`:

```bash
cp backend/.env.example       backend/.env
cp storefront/.env.example    storefront/.env
cp admin/.env.example         admin/.env
```

Values in the examples are safe defaults for local development against the Docker Compose stack. Production configuration is described in the [docs site](./docs/docs/deployment/production.md).

## Running the stack

```bash
# 1. Start infrastructure (PostgreSQL + Redis + Meilisearch + Mailhog).
pnpm run dev:infra
docker compose ps           # verify all four services are healthy

# 2. Run all three apps in parallel with hot reload.
pnpm run dev
#   backend     → http://localhost:3001
#   storefront  → http://localhost:3000
#   admin       → http://localhost:3002
#   mailhog UI  → http://localhost:8025
```

Or run individually:

```bash
pnpm --filter backend    run dev
pnpm --filter storefront run dev
pnpm --filter admin      run dev
pnpm --filter docs       run dev   # http://localhost:3003 — Docusaurus
```

## Running the test suite

TDD is non-negotiable per the constitution (Principle III). Every backend module ships with:

- Unit tests for domain logic.
- Contract tests for its public HTTP surface.
- Integration tests against a real PostgreSQL (no DB mocking).

```bash
pnpm test                                   # every workspace
pnpm --filter backend run test              # backend only
pnpm --filter backend run test:contract     # contract tests only
pnpm --filter backend run test:integration  # integration tests (needs Postgres up)
pnpm --filter backend exec vitest --watch   # TDD watch mode
```

Infrastructure services must be running for integration tests:

```bash
pnpm run dev:infra
```

## Running migrations

The backend uses MikroORM migrations. Each module owns its own migrations under `backend/src/modules/<module>/migrations/`.

```bash
pnpm --filter backend run migration:up        # apply all pending
pnpm --filter backend run migration:down      # roll back the most recent
pnpm --filter backend run migration:create    # scaffold a new migration
pnpm --filter backend run db:reset            # drop + recreate + migrate (dev only)
pnpm --filter backend run seed:dev            # load the synthetic dev catalog
```

After `seed:dev` a demo Platform Administrator and a demo Customer Organization are available — credentials are printed by the seed script.

## Repository layout

```text
b2b-platform/
├── backend/          # Fastify + TypeScript API server (every business module lives here)
├── storefront/       # Next.js customer-facing site
├── admin/            # React admin panel
├── packages/
│   ├── contracts/    # shared Zod schemas + inferred types
│   └── api-client/   # typed HTTP client
├── docs/             # Docusaurus documentation site
├── docker-compose.yml
├── tsconfig.base.json
├── eslint.config.js
├── .prettierrc
├── .specify/         # Spec-Kit governance: constitution, feature specs, templates
├── specs/            # Per-feature specs, plans, tasks, contracts
└── scripts/          # Shell scripts for CI and local checks
```

Backend module folders follow the naming rule from Principle VI: **plural `snake_case`** (e.g. `orders/`, `quote_requests/`, `credit_limits/`, `sales_channels/`). The only permitted singular exceptions are `auth` and `example`.

## Hardware & system requirements

The platform is sized to run on a **single VPS** that meets the combined minimum requirements of all mandated technologies. This section is the authoritative list — it MUST be updated in the same pull request as any change that introduces a new runtime dependency or alters baseline resource expectations (per the Infrastructure Constraints section of the constitution).

### Development environment

| Resource | Minimum | Recommended |
| --- | --- | --- |
| CPU | 4 vCPU (x86_64 or ARM64) | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB free (SSD strongly preferred) | 40 GB free (NVMe SSD) |
| OS | Linux (Ubuntu 22.04+ / Debian 12+ / Arch / Fedora), macOS 13+, Windows 11 + WSL2 | Linux |
| Docker | Docker Engine 24+ with Docker Compose v2 | — |
| Node.js | 22.x LTS (see `.nvmrc`) — minimum **22.17** (required by MikroORM 7) | — |
| pnpm | 9.x | — |

Approximate resident usage with everything running (`pnpm run dev` + Docker stack + Vitest in watch mode):

- PostgreSQL 16 (Alpine): ~150 MB RAM.
- Redis 7 (Alpine): ~50 MB RAM.
- Meilisearch 1.11: ~300 MB RAM (catalog-dependent; larger indexes require more).
- Mailhog: ~20 MB RAM.
- Three Node.js processes under watch mode: ~500–800 MB RAM each.

### Production environment (single VPS, no container orchestration)

Target workload: a single Supplier with a catalog of hundreds of thousands of products, hundreds of RFQs and hundreds of orders per month (spec FR-130; constitution Performance & Scale Targets).

| Resource | Minimum | Recommended |
| --- | --- | --- |
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Disk | 40 GB SSD | 100 GB NVMe SSD (with daily backups of `b2b-postgres-data`) |
| OS | Linux LTS (Ubuntu 22.04+ / Debian 12+) | — |
| Network | Static public IPv4, HTTPS terminator (nginx / Caddy / Cloudflare) | — |
| PostgreSQL | 16.x | — |
| Redis | 7.x | — |
| Meilisearch | 1.11.x | — |
| Node.js | 22.x LTS (minimum 22.17) | — |

Container orchestration (Kubernetes, Docker Swarm, Nomad) is an operational choice, **not** a constitutional one. Running each service directly on the VPS via systemd + Postgres/Redis/Meilisearch from distro packages is an equally valid target.

### Scaling notes

- The "hundreds of products / month" scale fits comfortably inside the Minimum tier.
- Catalogs above 300k SKUs or sustained > 1 order per minute should use the Recommended tier or split `meilisearch` onto a dedicated node (reserved-fallback path per R-08).
- The `queue` workload uses Redis (BullMQ-class). RabbitMQ is a documented fallback (constitution Technology Stack) only if Redis is demonstrably insufficient.

## Constitution quick reference

These are the non-negotiable rules; see [`.specify/memory/constitution.md`](./.specify/memory/constitution.md) for the full text.

1. **Modular Architecture** — every backend module owns its domain logic, entities, migrations, routes, and tests. No cross-module internals imports.
2. **API-First Design** — storefront and admin consume documented HTTP APIs; no shared DB, no in-process imports across apps.
3. **Test-Driven Development** — tests first, must fail for the right reason; unit + contract + integration per module; no DB mocking.
4. **YAGNI & Minimal Dependencies** — new runtime dependencies require a written justification in the PR description.
5. **TypeScript Everywhere** — strict mode; Zod at every boundary; `any` requires a justifying comment.
6. **Naming Conventions** — plural `snake_case` backend module folders and DB tables; `camelCase` TS and JSON; `PascalCase` types/classes; `kebab-case` URLs.
7. **SEO, Performance & Discoverability** — storefront SSR/SSG with Core Web Vitals in "Good" at the 75th percentile on mid-range mobile.
8. **Working Language — English** — every engineering artifact (specs, plans, code, comments, commit messages, PR descriptions) is authored in English. Localized end-customer content and foreign proper nouns are the only exceptions.

Pull-request quality gates (from the constitution's Development Workflow section): Constitution Check, tests passing, `tsc --noEmit` + lint clean, naming conventions honored, working-language respected, docs synchronized, dependency justifications present.
