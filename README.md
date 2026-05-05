# B2B Platform

A Supplier-operated B2B commerce platform supporting both **Quote Request (RFQ)** and **direct-purchase** workflows on one codebase, with Customer Organizations, multi-user Roles, Credit Limit settlement, a permissioned Admin Panel, and an open API + webhook layer built for ERP / PIM / WMS / CRM integrations.

- **Constitution** (governance source of truth): [`.specify/memory/constitution.md`](./.specify/memory/constitution.md)
- **Feature 001 — Foundation spec, plan, tasks**: [`specs/001-b2b-platform-foundation/`](./specs/001-b2b-platform-foundation/) — **complete**, every checkbox in `tasks.md` is ticked across User Stories 1–7.
- **Runtime guidance and module docs**: the docs site in [`docs/`](./docs/)

## Table of contents

- [Overview](#overview)
- [Capability status](#capability-status)
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

## Capability status

Foundation feature 001 is complete; feature 002 (catalog module extension) ships Attribute Sets, Gallery with Base/Small/Thumbnail labels, Product Attachments, Product Links (related / up-sell / cross-sell), and three new product types (`grouped`, `bundle`, `virtual`). Feature 006 (search module) closes the loop on the foundation's Meilisearch scaffolding: typeahead popup feed, fire-and-forget analytics ingest into `search_phrase_records`, and an opt-in LLM-augmented hybrid lexical + semantic mode driven by six settings registered through the Settings module. Each capability below is exercised by contract / integration tests in `backend/test/` and surfaced through the storefront (Next.js) and admin panel (Vite + React).

**Customer-facing (storefront)**

- Catalog browsing with multi-locale name/description, category tree, faceted filters, Meilisearch-backed full-text search, and a server-rendered PDP with stock badge + structured-data JSON-LD. Five product types: `simple`, `configurable` (with variant picker), `grouped` (fixed children + Add-bundle CTA), `bundle` (configurable slots with min/max + per-slot validation), `virtual` (digital delivery CTA).
- Product Gallery with curated Base / Small / Thumbnail label invariants (atomic swap on conflict), product Attachments grouped by type (Certificate, Tech spec, …), and Related / Up-sell / Cross-sell sections rendered on the PDP and cart.
- Account flows — register, email verification, login (with optional 2FA challenge field), password reset, profile, change password, two-factor enrolment.
- Organization settings — members list with role change / remove, pending-invitation list with revoke, addresses CRUD.
- Cart that supports anonymous → logged-in merge, full checkout (address → delivery → payment → review → submit), order confirmation with the bank-transfer next-action panel, and an orders history view.
- Quote Requests — "Request a quote" widget on the PDP, list grouped by status, detail page with mode-aware editing, accept / reject with reason, and deep-linking from converters.
- Shopping lists — per-customer named bundles with item editing and one-click bulk **convert-to-cart** / **convert-to-RFQ** (archived rows are skipped + reported, never blocking).
- Quick order — paste a `sku,quantity` CSV, server-renders a recognised + rejected partition with line numbers, then bulk-adds to cart.
- Credit-limit-aware checkout — granted/available/reservation widget on Account, an inline panel during checkout, and automatic filtering of `credit_limit`-kind payment methods when no limit exists or the cart exceeds the available credit.
- Impersonation banner appears on every authenticated page when a Supplier admin is acting as the buyer.

**Supplier-operated (admin panel)**

- Catalog admin: Products list + editor (per-locale fields, category multi-select, default price, archive), Categories tree editor with cycle guard + non-empty-delete refusal, Attributes manager with hot-toggle searchable / filterable / variant-axis checkboxes, Attribute Sets manager with assign/unassign and system-Default protection, Attachment Types dictionary, plus per-product inline sections for Variants, Gallery (with replace-conflict toggle), Attachments, Product Links, Grouped children and Bundle slots.
- Inventory: read with hydrated SKU / name, absolute on-hand set form (reserved counters are read-only — driven by orders).
- Customer organizations: list with status / VAT / search filters, detail with status + VAT-status patches and members table.
- Orders: list with status filter, detail with order/payment-status transitions, addresses, methods, and a PDF link.
- Invoices: filterable list with per-order PDF re-download buttons.
- Quote Requests: triage list with status + assignee filters, claim, send-quote with per-item pricing + lead-time / validity terms, decline with a free-text message.
- Pricing engine (feature 011): named price lists with a Draft / Scheduled / Active / Expired lifecycle (auto-transitioned by a 5-min sweeper), Base + Sale `type` partitioning, multi-bracket per-currency pricing per product, an Application Rule AST (Sales Channel / Customer Group / Organization / Category / Currency, AND/OR, depth-5) edited via a recursive rule builder, and a four-level price-display chain (Settings → Organization → Category → Product) with a `none` mode that hides every price element and routes purchase intent into Quote Requests. Migration 031 seeds a protected `Default` list from the legacy `attributeValues.defaultPrice` and writes a per-currency report to `backend/var/migration-reports/011_price_lists_seed.json`. Linked-price-lists panel on the catalog product editor surfaces every list a product is part of with a deep link to the editor pre-focused on that product.
- Taxes / Promotions: per-rule taxes with country / product-type / VAT-status narrowing + default fallback, percentage / amount / free-delivery promotions. Promotions support a `criteria[]` discriminated union (feature 012 / US8) — today the `attribute` variant is meaningful, letting an operator build rules like `material in [steel]` or `gear_ratio range [20, 50]` against any attribute carrying `isPromoRule = true`. Skip-on-toggle (FR-039) silently ignores criteria pointing at attributes whose `isPromoRule` was flipped off, with an audit log entry on every skip.
- Attributes (feature 012): SKU is now editable on every Product (the internal canonical reference is the immutable `Product.id` UUID); ProductAttribute carries four new behavioural flags (`isPromoRule`, `isVisibleOnProductPage`, `isRequired`, `filterPosition`) plus a per-locale `labelDefault` fallback; Attribute Sets re-render the product editor when swapped (values for hidden attributes are retained server-side per FR-012); option-list editor for `select` / `enum` / `multiselect` types replaces the legacy `enum_values: string[]` JSONB column (decommissioned by migration 032); storefront filter sidebar honours `filterPosition` and the PDP carries a "Parametry produktu" tab listing every attribute flagged `isVisibleOnProductPage` that has a value, with select-style values rendered as the per-locale option label.
- Delivery + Payment Methods CRUD with per-locale labels and kind selector for payment drivers.
- Credit Limits: roster of every granted limit + per-organization grant / adjust editor with `allowOverAllocation` override.
- Users & Roles: admin-user CRUD with role assignment, role editor with a permission-matrix grouped by module, plus a canonical permissions catalogue.
- Audit Log viewer: filtered query with stateBefore / stateAfter side-by-side JSON expansion.
- Integrations: API keys (bearer-token credentials), Webhooks (HMAC-signed outbound subscriptions), External Integrations.
- Phase-10 surfaces: Analytics, SEO meta-tag overrides, Languages & Currencies, CMS pages, Import / Export.

For an authoritative endpoint list, see the live OpenAPI document at `GET /api/v1/_openapi.json` and the per-module pages under [`docs/docs/modules/`](./docs/docs/modules/).

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

**Transactional email (backend)** — Verification and invitation emails use the shared `Mailer` abstraction. Set **`SMTP_URL`** (for example `smtp://localhost:1025` against Mailhog, or your provider’s SMTP relay URL) so `composeApp` wires `SmtpMailer`; when unset, development uses `ConsoleMailer`. Optional: **`SMTP_FROM`** / **`MAIL_FROM`** for the visible sender address.

**Sales Channels (backend)** — Both env vars are optional. **`DEFAULT_SALES_CHANNEL_CODE`** sets which channel the backend boot reconciles as the platform's system-default (FR-002 of feature 005); when unset, defaults to `default`. **`SALES_CHANNEL_HOST_MAP`** maps incoming HTTP `Host` headers to channel codes when no explicit `X-Sales-Channel` header is provided — comma-separated list of `host=channelCode` pairs (e.g. `serwisA.com=channel-a,serwisB.com=channel-b`); empty disables host resolution. Storefront and integration paths fall back to the system-default when no resolution succeeds; admin paths refuse with `missing_sales_channel_context`.

**Assets Library (backend, feature 013)** — **`ASSETS_LIBRARY_HMAC_KEY`** signs short-lived URLs for `private`-visibility assets served from the local-FS adapter via `/assets/file/:assetId?token=&exp=`. Generate per environment with `openssl rand -hex 32`; rotating invalidates every outstanding private URL. Cloud adapters (S3, GCS) use their own native signed URLs and ignore this key. The local-FS adapter writes uploaded files under the platform-relative directory configured by the `assets.local.base_dir` setting (default `var/assets`); make sure the backend process can read and write that location. Active adapter selection (`local | s3 | gcs`) and per-adapter configuration (bucket, region, credentials, prefix, public-base URL) live in the Settings module under the `storage` group.

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
8. **Working Language — English** — only two artifacts MUST be authored in English: **inline comments and docstrings inside source files** and **every page authored under the `/docs/` Docusaurus site**. Identifiers, file/folder names, DB tables and columns, API field names, URL path segments, string literals (logs, error codes, route definitions, migration SQL, end-customer copy), specs, plans, tasks, the root README's body, module READMEs, ADRs, governance docs, commit messages, PR descriptions, and code-review prose MAY all be in any language the team chooses. Identifier *case* is still governed by Principle VI; localized customer content remains free per Principle VII.

Pull-request quality gates (from the constitution's Development Workflow section): Constitution Check, tests passing, `tsc --noEmit` + lint clean, naming conventions honored (`pnpm run check:naming`), working-language respected (`pnpm run check:language`), docs synchronized, dependency justifications present. The PR template at [`.github/pull_request_template.md`](./.github/pull_request_template.md) checks these for you.
