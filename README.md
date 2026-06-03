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
- `admin/` — React admin panel (Vite). Usable on smartphone viewports from feature **029** (drawer navigation below 1024px; see [`docs/docs/admin/mobile-responsive.md`](./docs/docs/admin/mobile-responsive.md)).
- `packages/contracts/` — Zod schemas shared across applications (source of truth for API types per Principle V).
- `packages/api-client/` — typed HTTP client used by storefront and admin.
- `packages/cms-components/` — Page Builder React components shared between admin (Puck editor) and storefront (`<Render>` server component); built around the new `cms` module's component-extension SPI. Styled with a self-contained, `cmsc:`-prefixed Tailwind stylesheet (`dist/cms-components.css`) so it renders identically in either host without restyling host chrome (feature 041).
- `docs/` — Docusaurus documentation site for developers and Product Owners.

## Capability status

Foundation feature 001 is complete; feature 002 (catalog module extension) ships Attribute Sets, Gallery with Base/Small/Thumbnail labels, Product Attachments, Product Links (related / up-sell / cross-sell), and three new product types (`grouped`, `bundle`, `virtual`). Feature 006 (search module) closes the loop on the foundation's Meilisearch scaffolding: typeahead popup feed, fire-and-forget analytics ingest into `search_phrase_records`, and an opt-in LLM-augmented hybrid lexical + semantic mode driven by six settings registered through the Settings module. Each capability below is exercised by contract / integration tests in `backend/test/` and surfaced through the storefront (Next.js) and admin panel (Vite + React).

**Customer-facing (storefront)**

- Catalog browsing with multi-locale name/description, category tree, faceted filters, Meilisearch-backed full-text search, and a server-rendered PDP with stock badge + structured-data JSON-LD. Five product types: `simple`, `configurable` (with variant picker), `grouped` (fixed children + Add-bundle CTA), `bundle` (configurable slots with min/max + per-slot validation), `virtual` (digital delivery CTA).
- Product Gallery with curated Base / Small / Thumbnail label invariants (atomic swap on conflict), product Attachments grouped by type (Certificate, Tech spec, …), and Related / Up-sell / Cross-sell sections rendered on the PDP and cart.
- Account flows — register, email verification, login (with optional 2FA challenge field), password reset, profile, change password, two-factor enrolment.
- Organization settings — members list with role change / remove, pending-invitation list with revoke, addresses CRUD.
- Cart that supports anonymous → logged-in merge, full checkout (address → delivery → payment → review → submit), order confirmation with the bank-transfer next-action panel, and an orders history view. Feature 027 layers a full lifecycle (active / abandoned / completed / rejected), per-Organization "requires cart approval" gate with submit-for-approval → approve / reject (with reason), Promotions-driven coupon application with reason-specific rejection and auto-drop-on-read, Cart ↔ Quote Request and Shopping List → Cart conversions with re-pricing from the customer's current price list, up-sell strip from the Catalog's `up_sell` link kind, re-pricing-on-read (30 s Redis cache), 200-line per-cart cap, abandonment sweep with optional notification e-mail, and per-cart audit feed.
- Quote Requests — "Request a quote" widget on the PDP, list grouped by status, detail page with mode-aware editing, accept / reject with reason, and deep-linking from converters.
- Shopping lists — per-customer named bundles with item editing and one-click bulk **convert-to-cart** / **convert-to-RFQ** (archived rows are skipped + reported, never blocking).
- Quick order — paste a `sku,quantity` CSV, server-renders a recognised + rejected partition with line numbers, then bulk-adds to cart.
- Credit-limit-aware checkout — granted/available/reservation widget on Account, an inline panel during checkout, and automatic filtering of `credit_limit`-kind payment methods when no limit exists or the cart exceeds the available credit.
- Impersonation banner appears on every authenticated page when a Supplier admin is acting as the buyer.

**Supplier-operated (admin panel)**

- Catalog admin: Products list + editor (per-locale fields, category multi-select, default price, archive), Categories tree editor with cycle guard + non-empty-delete refusal, Attributes manager with hot-toggle searchable / filterable / variant-axis checkboxes, Attribute Sets manager with assign/unassign and system-Default protection, Attachment Types dictionary, plus per-product inline sections for Variants, Gallery (with replace-conflict toggle), Attachments, Product Links, Grouped children and Bundle slots.
- Inventory: read with hydrated SKU / name, absolute on-hand set form (reserved counters are read-only — driven by orders).
- Customer organizations: list with status / VAT / search filters, detail with status + VAT-status patches and members table.
- Customers (Klienci) module (feature 040): customer-account lifecycle on top of `customer_accounts`. Storefront self-service — standalone (org-less) registration gated by a Setting, a personal address book (billing/delivery, one default per kind, plus selectable org-shared addresses), default payment/delivery method, change-password, and order/quote-request history. Admin oversight — a customer list + detail with the five info fields (created, group, organization, blocked, last login); block/unblock and soft-delete/restore with role-based authority (platform admin, or the salesperson inherited from the customer's organization; org-less customers are open to any salesperson) + an org-owner depletion guard; impersonation (org-optional); admin password reset (emails a set-password link); NIP/VAT validation; organization assign/unassign; direct customer-group assignment (overrides the org's group in pricing); read-only orders/RFQ/abandoned-carts panels; and an "online customers" view. Soft-deleted accounts are restorable within a configurable window (`customers.deletion_retention_days`, default 365), after which an anonymization sweep permanently scrubs PII. Migrations `060_customer_accounts_lifecycle` (block/deletion/group columns) and `061_customer_addresses_init`.
- Orders: an admin-configurable lifecycle (statuses + transitions managed in the UI, with templated `order.status.*` business events and veto-capable guards); a server-side orders list with filter/sort/search, per-status counts, bulk status change + bulk invoice print, private/shared saved views, and CSV export; create-an-order-on-behalf-of-a-customer (built by a sales rep, the customer is emailed to pay it); order comments (customer-visible/internal + notify); reorder and clone-to-quote-request; order-confirmation emails CC'd to per-organization and per-scope recipient lists; and Settings for minimum order value and reorder-enabled (global or per sales channel). Feature 038 adds the `order_statuses`, `order_status_transitions`, `order_comments`, `order_list_saved_views` tables and the `organizations.order_confirmation_emails` column.
- Carts (feature 027): platform-wide carts list with status + approval filters and badge variants, read-only cart detail with line items, applied coupon, conversion lineage, full audit feed, and an emergency reject action (terminal, with required reason). Per-Organization `requires_cart_approval` policy can also be toggled by a platform admin from the Organization detail page.
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
- CMS module (feature 014): replaces the legacy `cms_pages` minimal surface with a full editorial system — Pages, Blocks, Templates, and Hooks authored through a Page Builder (drag-and-drop with Puck + a Tiptap-based `Text` rich-text component). Backend modules contribute components through an in-process SPI; the storefront resolves a `(channel, language, slug | block-code | hook-code)` tuple into a fully-inlined render payload, cached in Redis with a 5-minute TTL. The 23 base storefront Hook codes (header.top, homepage.top, footer.*, product.*, cms.page.*, login/register, etc.) are seeded idempotently at boot.
- Megamenu module (feature 015): authors the storefront's primary navigation as a multi-level tree of menu items (Category links, CMS-page links, External links, Buttons, Assets, embedded CMS Blocks). Configurations are scoped to `(sales channel × language)` pairs with a Postgres partial unique index enforcing "exactly one active megamenu per scope" (atomic swap on activation). Items support optional left/right icons; CMS-block embeds inline through the same Puck render pipeline as the CMS module. The storefront renders a hover-revealed full-width drop-down panel on desktop (3-column grid per the Industria design) and a stacked drill-down drawer on mobile. Reference protection plugs into the Assets Library (icons + assets) and the CMS module (pages + blocks) deletion chains. Zero new runtime dependencies.
- Blog module (feature 016): editorial blog surface with Posts, Categories (tree-structured), and Tags. Posts inherit the CMS Page's field shape (slug, draft → published → archived lifecycle, per-language Page Builder content, SEO meta) and add per-Post ordered Related Posts (detach-on-delete contract) and Related Products (soft-delete + storefront filter). Categories carry Page Builder descriptions, optional main images, and form an adjacency-list tree with cycle prevention; the seeded `Default` category is system-protected. Tags are globally unique by `code` with block-on-delete. Configurable per Sales Channel through Settings: `blog.enabled`, `blog.url_prefix` (default `blog`), `blog.latest_count` (default 5), `blog.posts_per_page` (default 12); a settings change wipes the storefront cache via the EventBus. Storefront serves three endpoints (`by-channel`, `by-slug`, `tag-by-code`). Two seeded admin roles — `Blog Manager` (blog only) and `Content Manager` (blog + CMS) — with platform-wide deletion-protection. Zero new runtime dependencies.
- Dictionary (Słownik) module (feature 017): one operator registry for Countries, Currencies, and Languages, including active/storefront-visible flags, localized labels, country-language associations, storefront registry cache, reusable admin/storefront pickers, and a shared backend validator port that rejects unknown or newly inactive codes across addresses, taxes, warehouses, organizations, sales channels, promotions, megamenu bindings, and blog language scopes. Legacy Languages and Currencies endpoints remain available for compatibility. Zero new infrastructure requirements.
- Product Scope Editor (feature 022): adds a four-scope attribute-value model (`global`, `language`, `channel`, `channel+language`) on top of the existing per-language `products.name` / `products.description` JSONB and the global `products.attribute_values` baseline. Introduces two scope-flag columns on `product_attributes` (`channel_scoped`, `language_scoped`), a `product_value_overrides` table (channel-aware slots with two partial UNIQUE indexes), and a `product_editor_preferences` table (per-(admin user, product) remembered switcher state). System attributes Name + Description are pinned channel+language-scoped via a backend constant — their channel overrides land in `product_value_overrides` under reserved keys `name` / `description`. A pure resolver in `@b2b/contracts` (shared between backend and admin SPA) implements the deterministic fallback chain `(channel+language) → (channel) → (global+language) → (global)`; the search indexer threads the same resolver per-channel so per-(channel, language) overrides are visible in storefront search. The admin product edit page gains a `<ProductScopeEditor>` panel at the top of the Details tab — Sales Channel + Language switchers, a resolved-value preview with a source badge, and inline "Add / Edit override" + "Reset to Global" affordances driven by `PATCH /admin/catalog/products/:id/value-overrides` with a six-rule server-side validator (attribute_unknown, attribute_not_channel_scoped, attribute_missing_language, channel_not_assigned_to_product, language_not_in_channel, value_invalid). Zero new runtime dependencies.
- Quick Order module (feature 039): buyer-acceleration toolkit reusing the existing ordering stack. (1) CSV **and** Excel (`.xlsx`) import that builds a Cart or a Quote Request, including variant resolution from extra attribute columns, duplicate-SKU merge, and an `quick_order.import_max_rows` cap; available in storefront (`/quick-order`) and admin (on-behalf of a customer). (2) Quick product search by SKU, name, and the values of attributes flagged with the new `product_attributes.quick_searchable` column. (3) Customer- and Organization-level **default ordering preferences** (payment method, delivery method, billing + shipping address) in a new `quick_order_default_preferences` table, resolved customer-over-org with a use-time eligibility re-check, role-scoped editing (Customer / Org Admin / Salesperson / Platform Admin), audited, and auto-applied at checkout. (4) "Order again" → new Cart or Quote Request (reuses the orders reorder + clone-to-quote endpoints). (5) **One-click buy** gated by the `quick_order.one_click_buy_enabled` setting (global or per Sales Channel) plus the presence of all four eligible defaults — skips Cart/Checkout and places the order via the existing `placeOrder` path, routing by the payment `nextAction`. **One new runtime dependency: `exceljs`** (backend-only, isolated to the Excel-import adapter) for `.xlsx` parsing.

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

`@b2b/cms-components` ships a pre-built, self-contained Tailwind stylesheet
(`dist/cms-components.css`, committed) that both the storefront CMS render path and the admin
Page Builder import. Regenerate it after changing those components' utility classes:

```bash
pnpm --filter @b2b/cms-components build   # uses @tailwindcss/cli (build-time devDep)
```

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

## Module lifecycle

Feature 018 introduces a CLI-driven module lifecycle: each backend module declares a `manifest.ts` (id, name, version, dependencies, optional settings + install/uninstall hooks) and the platform persists installed/enabled state in a `module_registrations` table. Operators run:

```bash
pnpm --filter backend run module:install <id>          # install (runs migrations + settings + install hook)
pnpm --filter backend run module:uninstall <id>        # soft uninstall (data preserved)
pnpm --filter backend run module:uninstall <id> --hard --force  # hard (drops tables + data)
pnpm --filter backend run module:enable <id>           # toggle on at runtime
pnpm --filter backend run module:disable <id> [--cascade]  # toggle off (cascade walks dependents)
pnpm --filter backend run module:status [<id>] [--json] [--filter=<state>]
```

The legacy `modules:install` / `modules:uninstall` aliases (plural form) still work but print a deprecation notice and forward to the new singular commands; they are scheduled for removal in the next minor release. The admin app can render a read-only "Modules" panel from `GET /api/v1/admin/modules` (permission `platform.modules.read`).

## Admin UI languages

Feature 019 adds a per-user Admin UI language preference (Polish + English at launch; English is the platform-wide fallback) and a module-scoped translation pipeline so every backend module ships its own bundle of translated strings under `backend/src/modules/<id>/i18n/<lang>.json`. Each Admin UI user picks their language from the **Profile** page; the entire Admin UI re-renders without sign-out and the choice follows the user across devices. Modules opt in by adding `i18n: { bundlesDir: 'i18n' }` to their `manifest.ts` and shipping JSON files alongside; the boot-time reconciler picks them up. Migration `040_admin_i18n_init.ts` introduces the `translation_bundles` table and `admin_users.preferred_language` column. See `docs/docs/modules/admin-i18n.md` for the full guide.

Feature 021 completes the Admin UI bilingual rollout (PL/EN). Switch language via the top-right language picker or the Profile page. New Admin UI strings must be added to both bundles; see `docs/docs/contributing/translations.md` for the glossary, workflow, and CI gates.

## Repository layout

```text
b2b-platform/
├── backend/          # Fastify + TypeScript API server (every business module lives here)
├── storefront/       # Next.js customer-facing site
├── admin/            # React admin panel
├── packages/
│   ├── contracts/      # shared Zod schemas + inferred types
│   ├── api-client/     # typed HTTP client
│   └── cms-components/ # Page Builder React components shared by admin + storefront
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
9. **UI Reuse & Design-System Consistency** — new frontend work reuses existing Admin UI / Storefront UI components and layouts by default; a net-new component or layout is introduced only with a stated UX justification (the missing pattern, the primitives evaluated, why composition failed).
10. **Scalable Queue Consumers** — any asynchronous, queue-backed operation runs in a separate consumer process that scales independently of the API server; the API process only enqueues. Jobs are claimed atomically and handlers are idempotent so N≥2 consumer instances never double-process. In-process sweepers/`setInterval` drains are not a production processing path.

Pull-request quality gates (from the constitution's Development Workflow section): Constitution Check, tests passing, `tsc --noEmit` + lint clean, naming conventions honored (`pnpm run check:naming`), working-language respected (`pnpm run check:language`), docs synchronized, dependency justifications present, UI reuse honored, async queue work processed by separate scalable consumers. The PR template at [`.github/pull_request_template.md`](./.github/pull_request_template.md) checks these for you.
