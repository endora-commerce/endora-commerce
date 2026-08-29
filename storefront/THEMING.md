# Theming the storefront

This package is a **reference theme** for the B2B Platform storefront. It
exists to demonstrate the shape of every API call and component a real
theme needs, and to make forking trivial. The directory layout below is
load-bearing — themes that keep it stay drop-in compatible with future
upgrades.

## Theme override boundary

```text
storefront/
├── lib/
│   ├── api/                       ← stable. data fetchers + types.
│   │   ├── client.ts              ← fetch wrapper; threads X-Sales-Channel + Accept-Language.
│   │   ├── catalog.ts             ← listProducts, getProductBySlug, getCategoryTree, getFilters
│   │   ├── i18n.ts                ← getI18nConfig
│   │   └── cms.ts                 ← getCmsPage
│   ├── i18n/
│   │   ├── locale.ts              ← resolveLocale, pickLocalizedString
│   │   └── messages.ts            ← chrome strings (nav, button captions)
│   └── server-context.ts          ← per-request locale + sales channel resolution
├── components/                    ← REPLACE these to retheme.
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── ProductCard.tsx
│   ├── ProductGrid.tsx
│   ├── FilterPanel.tsx
│   ├── Breadcrumbs.tsx
│   ├── ProductGallery.tsx
│   ├── PriceTag.tsx
│   ├── StockBadge.tsx
│   └── Pagination.tsx
└── app/
    ├── layout.tsx                 ← shell + locale stamping. Themes usually keep this.
    ├── globals.css                ← REPLACE for visual restyling.
    ├── page.tsx                   ← landing
    ├── (catalog)/
    │   ├── catalog/page.tsx       ← listing (also serves /search)
    │   ├── search/page.tsx        ← thin wrapper around catalog
    │   ├── c/[slug]/page.tsx      ← category landing
    │   └── p/[slug]/page.tsx      ← PDP
    └── (content)/[...slug]/page.tsx ← CMS catch-all
```

**Stable**: `lib/api/*`, `lib/i18n/*`, `lib/server-context.ts`, the route
layout under `app/`. Pages call typed adapters whose signatures are
shared with the `@endora-commerce/contracts` types — themes inherit them.

**Replace freely**: every file under `components/`. The component prop
contracts are documented inline; keep them stable and a theme can ship
its own markup, CSS, and behaviour without touching `app/` or `lib/`.

**Restyle without rewriting**: replace `app/globals.css`. Class names are
namespaced under `.b2b-*` so a CSS-only retheme works.

## Architectural decisions a theme inherits

1. **SSR by default.** Catalog, category, and product pages are
   server-rendered so search engines and LLM crawlers see fully
   populated HTML without JavaScript (Constitution Principle VII /
   FR-103). Don't add `'use client'` to data-loading components.
2. **Sales-channel + locale on every request.** `getServerContext()` is
   the single source of truth. Pass the result's `ctx` into every
   `lib/api/*` call.
3. **Multilingual content via `pickLocalizedString`.** Product names,
   descriptions, CMS titles arrive as `Record<localeCode, string>`. Use
   the helper — it follows the FR-105 fallback chain (requested →
   default → first present).
4. **JSON-LD comes from the backend.** PDP and breadcrumb structured
   data is server-rendered into `<script type="application/ld+json">`.
   Themes consume `product.structuredDataJsonLd` directly.

## Customising chrome strings

`lib/i18n/messages.ts` is the in-tree catalogue for navigation and
button captions. The reference theme keeps its Polish strings in ASCII
so the engineering-language gate stays clean
([Constitution Principle VIII v1.1.1](../.specify/memory/constitution.md));
a real theme moves them to `storefront/messages/<locale>.json`, which
the language gate exempts as end-customer content.

## Backend dependency

The storefront is a thin client of the backend API. Required environment
variables:

```bash
BACKEND_BASE_URL=http://localhost:3001          # the Fastify backend
NEXT_PUBLIC_DEFAULT_LOCALE=en-US                 # fallback if i18n/config 4xx's
```

A multi-tenant deployment can stamp `X-Sales-Channel` per host via the
reverse proxy; `lib/server-context.ts` reads it on every request so
each storefront sees only its own catalog.
