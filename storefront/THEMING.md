# Theming the storefront

This package is a **reference theme** for the B2B Platform storefront. It
exists to demonstrate the shape of every API call and component a real
theme needs, and to make forking trivial. The directory layout below is
load-bearing — themes that keep it stay drop-in compatible with future
upgrades.

There are two ways to change how this storefront looks, and they are not the
same size:

1. **Per sales channel, at the token tier** — no fork, no rebuild, an operator
   setting. This is what `sales_channels.theme_code` selects; see *Per-channel
   token themes* below.
2. **A fork of this directory** — everything else. What that costs today is
   measured in `specs/storefront-composability-measure.md`, and the number that
   matters is that it is a fork rather than a composition: this directory is not
   a package, has no `exports` map, and is copied whole.

## Per-channel token themes

`app/globals.css` declares its design tokens in two tiers: Tier-1 primitives
(`--brand-700`, `--ink-900`, `--font-sans`, `--r-md`, the shadows) in `:root`,
and a Tier-2 `@theme inline` block that maps every Tailwind utility onto them
**by reference**. Because the mapping is by reference, re-scoping the Tier-1
variables re-themes every utility on the page with no rebuild.

A **theme** is one such re-scoping:

```css
:root[data-theme='nordic'] {
  --brand-700: #0e7490;
  --font-sans: system-ui, …;
  --r-md: 14px;
  /* … */
}
```

The root layout stamps `<html data-theme="…">` **server-side**, from the theme
the request's sales channel names. That is the whole mechanism, and being
server-side is not an optimisation: a theme applied after hydration is a flash
of the wrong brand.

The chain, end to end:

| Where | What |
| --- | --- |
| `sales_channels.theme_code` | the operator's choice, per channel, edited on the channel's identity form |
| `GET /api/v1/storefront/sales-channel` | the public read of the **resolved** channel |
| `lib/api/sales-channel.ts` | fetches it, threading `X-Sales-Channel`; answers `null` rather than throwing |
| `lib/theme/instance-themes.ts` | this instance's default and its membership predicate |
| `lib/theme/themes.generated.ts` | **generated** — the codes this instance provides |
| `lib/theme/theme.ts` | maps `themeCode` → a token set, and decides the unknown case |
| `lib/server-context.ts` | resolves it once per request, beside the locale |
| `lib/theme/StorefrontDocument.tsx` | the `<html>` element that carries `data-theme` and `data-theme-requested` |
| `app/globals.css` | this instance's own token blocks |
| `app/themes.generated.css` | **generated** — one `@import` per installed theme package |

**The platform does not hold a list of themes** (owner ruling D-199,
`specs/102-storefront-theme-discovery/`). `@endora-commerce/contracts` used to
export `STOREFRONT_THEME_CODES` and four symbols around it; they are gone. A
theme is a token set a third party may publish as an ordinary npm package, so
no set the platform can compile is the whole set. **This instance** answers the
question instead, from two sources it can read without a network:

1. the `endora: { themes: [...] }` block of every theme package it has
   installed, and
2. the `:root[data-theme='<code>']` blocks its own `app/globals.css` declares.

**Adding one of this storefront's own themes is one edit.** Write the
`:root[data-theme='<code>']` block in `app/globals.css` above `:root.is-dark`,
then run:

```bash
pnpm --filter storefront run themes:generate
```

**Installing someone else's theme is `npm install` and nothing else.** The
generator finds the package, adds its codes to the registry and its `@import`
to `app/themes.generated.css`. Never edit either artefact, and never add an
`@import` by hand — `check:themes` refuses one as `unregistered-theme`.

Both artefacts are committed, and the generator runs at the front of `dev` and
`build`. It is chained explicitly rather than through `predev` / `prebuild`
because pnpm does not run `pre` / `post` scripts by default, and a wiring that
silently does nothing is worse than no wiring.

**The build checks itself, over the emitted stylesheet.**
`pnpm --filter storefront run check:themes` runs at the end of `build` and
refuses six disagreements: `undefined-theme`, `partial-theme`,
`unregistered-theme`, `dark-scope-shadowed`, `duplicate-theme` and
`unresolvable-theme-css`. It reads `.next/static/css`, not `app/globals.css` as
source text — a third-party theme's block exists only after the CSS build, so a
source scan cannot see a bad `exports` map, a dropped `@source` glob or a purge.
It exits **2** rather than 0 when there is nothing to read (an empty registry,
no emitted stylesheet, a stylesheet with no `[data-theme]` block, no instance
default), because a green must not be able to mean "not looking".

What a third-party theme author has to do is one page and names no file in this
repository:
`specs/102-storefront-theme-discovery/contracts/theme-package.md`.

**An unknown theme falls back and reports; it never guesses.** A channel that
names a code this storefront does not have renders in the default theme, logs
the requested code once per process, and stamps
`data-theme-requested="<code>"` on `<html>` — present only when the request fell
back, so a correct render carries nothing. That attribute exists because the
mistake is made in the **admin** and the log line lands in the **storefront's**
container: a different deployment, read by a different person. Nothing is
reported back to the platform, in either direction. The page a buyer asked for is not
the operator's configuration mistake to pay for — but nothing matches a prefix,
folds a separator or picks the "nearest" theme either, so a misconfigured
channel is visibly the reference brand rather than some third brand nobody
chose. The reasoning is written out in `lib/theme/theme.ts`.

**What a token theme does not do.** It restyles: colour, typography, spacing,
radius, elevation, and (through `logoAssetId`) the mark. It does **not** give a
channel a different layout or different components — that is a much larger
question, and it is measured rather than answered in
`specs/storefront-composability-measure.md`.

## Theme override boundary

```text
storefront/
├── lib/
│   ├── api/                       ← stable. data fetchers + types.
│   │   ├── client.ts              ← fetch wrapper; threads X-Sales-Channel + Accept-Language.
│   │   ├── catalog.ts             ← listProducts, getProductBySlug, getCategoryTree, getFilters
│   │   ├── i18n.ts                ← getI18nConfig
│   │   └── cms.ts                 ← getCmsPageBySlug, getCmsBlockByCode, getCmsHookByCode
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

> **The tree above is a sketch, not an inventory, and it has not been one since
> the week it was written.** It named every component and every route file this
> storefront had on 2026-04-25: 10 components, 7 route files, 7 files under
> `lib/`, a 302-line stylesheet. Measured on 2026-08-29 the same tree holds
> **111 components, 67 route files, 92 files under `lib/`** and a stylesheet
> over 1300 lines. Read the listing as "these are the shapes a theme replaces",
> never as "these are the files a theme replaces" — the second reading
> understates the job by an order of magnitude, and
> `specs/storefront-composability-measure.md` is where the current numbers live.

**Restyle without rewriting**: for a *per-channel* restyle, use the token tier
above — no fork at all. For a fork-wide one, replace `app/globals.css`. Note
that the class prefix in this file is `.industria-*` for the chrome it ships;
`.b2b-*` survives as a legacy alias layer for screens that predate it, so a
CSS-only retheme has to cover both.

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
([Constitution Principle VIII](../.specify/memory/constitution.md) — this
paragraph cited `v1.1.1`, which was current on the day it was written and is
three major versions behind the constitution as it stands).

A real theme can move them to `storefront/messages/<locale>.json`. Two
corrections to what this paragraph used to promise about that: the directory
does **not** exist in this tree, and the language gate does not "exempt" it. The
gate's population is source-code comments (`*.ts`, `*.tsx`) and `docs/docs/**`
pages, so a JSON catalogue is outside it by file type rather than by a carve-out
somebody wrote — which is the same outcome and a different rule, and the
difference matters the day the gate learns to read JSON.

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
