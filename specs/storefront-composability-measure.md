# Storefront composability — a measurement

**Measured**: 2026-08-29, against `origin/master` at `404a46831`.
**Status**: measurement only. This note designs nothing and proposes nothing.

`specs/005-sales-channels/` gave a sales channel a `theme_code` and ruled theme
rendering "owned by the storefront app". The merge request this note ships with
makes that field true **at the token tier**: a channel selects a set of Tier-1
design tokens, and the root layout stamps it onto `<html data-theme>`
server-side. That delivers restyling — colour, typography, spacing, radius,
elevation.

The owner's sentence was *"a different page **template**"*, and the token tier
does not deliver that. A different template means different layout and different
components, which the token tier cannot be stretched to reach. This note
measures what reaching it would cost, so the decision can be made on numbers
rather than on an impression. **Everything below is a count of the tree as it
stands.** The three questions are the ones that were asked; the answers stop
where the measurement stops.

---

## 1. How much of the storefront would have to become swappable?

### The population

| Thing | Count | How it was counted |
| --- | --- | --- |
| Components (`storefront/components/**`) | **111** | every file; all 111 are `.tsx` |
| Route files (`storefront/app/**`) | **67** | 57 `page.tsx` + 5 `layout.tsx` + 5 `route.ts` |
| Other files under `app/` | 22 | 4 payment forms, 11 `blog/_components/`, 1 `actions.ts`, 3 `loading.tsx`, `error.tsx`, `not-found.tsx`, `globals.css` |
| Files under `lib/` | **92** | of which 46 are `lib/api/*` data fetchers |
| `app/globals.css` | **1282 lines** | |
| Total lines: components / pages / `lib` | 12 663 / 9 354 / 10 306 | |

### What is already swappable

Two seams exist today and both are real:

* **The token tier**, as of this merge request. Per sales channel, server-side,
  no fork. It reaches every Tailwind utility on the page because `@theme inline`
  maps them onto the Tier-1 variables by reference.
* **CMS hooks** — `<Hook code="…" />`, **30 call sites over 24 distinct codes**
  in 9 route files (`header.top`, `page.bottom`, `product.buttons.after`, …).
  Each resolves CMS blocks for the request's channel, so an operator can already
  put per-channel content into 24 named positions with no code change at all.

The gap between those and "a different template" is precise: **hooks insert,
they do not replace.** There is no position at which a channel can say "render
*this* product grid instead of that one".

### What would have to change, and where the boundary falls

The boundary does **not** fall at `components/` — the place `THEMING.md` puts
it. Three measurements say so:

1. **Pages are not thin.** 49 of the 57 `page.tsx` files fetch their own data
   (they import `lib/api/*`), and 28 call `getServerContext()`. Across the 52
   pages with a single `return (`, **2 444 lines sit above it and 6 722 below**
   — so a page is roughly one quarter data orchestration and three quarters
   markup, in **one file**. Swapping the markup means either re-implementing the
   fetch or extracting it first. Today the split does not exist anywhere.
2. **Nothing is addressed indirectly.** `app/**` contains **400 relative
   imports** (`from '../../components/…'`) and **zero** alias or package
   imports. There is no registry, no slot table, no dependency direction a
   channel could be injected into. A per-channel component choice has 400 hard
   edges to unpick, of which **112 are `components/` imports across 34 files**.
3. **Components fetch too.** 22 of the 111 components import `lib/api/*`
   themselves, so they are not view functions with a prop contract — replacing
   one means reproducing its reads as well as its markup.

There is a **fourth** measurement, and it is the one that decides how much of
this is mechanical: **only 14 of the 111 components export a `Props` interface**
(31 declare a `Props` type of any kind, exported or not). `THEMING.md` says "the
component prop contracts are documented inline; keep them stable and a theme can
ship its own markup". For 80 of the 111 there is no named prop type to keep
stable. A replacement contract does not exist to be honoured — it would have to
be written, per component, before anything could be swapped against it.

**Where a boundary would fall naturally, on this evidence**, is one layer above
`components/`: at the point where a page has finished fetching and begins
arranging. That point is currently a `return (` in the middle of a page file.
The three seams the tree already has — `getServerContext()` (per-request
resolution), `lib/api/*` (46 typed fetchers, genuinely stable and genuinely
reused), and `<Hook>` (24 named positions) — all sit *above* it and all work.
Nothing sits below it.

Restating that as counts, for whoever costs the work:

| If per-channel swapping is wanted at… | Files that must become swappable |
| --- | --- |
| document shell (theme tokens) | **1** — already done by this merge request |
| named insertion points | **0** — 24 already exist, via CMS hooks |
| page arrangement | **57** `page.tsx`, each needing its fetch and its markup separated first |
| layout chrome | **5** `layout.tsx` |
| individual components | **111**, of which **97** export no prop contract (80 have no named prop type at all) for a replacement to be written against |

### What this note does not measure

Whether a per-channel template is worth it; which of the 111 components a real
second client would actually replace; whether the answer is component swapping
at all rather than, say, a wider hook vocabulary. Those are F7/F8 questions.
They are not answered here and nothing above should be read as leaning on one.

---

## 2. Is `storefront/THEMING.md` true?

**Both reported defects hold, and both are more interesting than "stale".**

### The component list: 10 named, 111 present

`THEMING.md` names ten components under `components/` — `Header`, `Footer`,
`ProductCard`, `ProductGrid`, `FilterPanel`, `Breadcrumbs`, `ProductGallery`,
`PriceTag`, `StockBadge`, `Pagination` — under the heading **"REPLACE these to
retheme"**, followed by "**Replace freely**: every file under `components/`".

All ten still exist. There are now **111**.

The document was written in `0441bee0b`, 2026-04-25. **At that commit the tree
held exactly 10 components** — so the list was not a curated sample that has
since fallen behind. It was an *exhaustive inventory*, correct on the day, and
it has been read as an inventory ever since. The same commit's tree held **7
route files (now 67), 7 files under `lib/` (now 92) and a 302-line
`globals.css` (now 1282)**. Every number in the document is off by roughly an
order of magnitude, in the same direction, for the same reason.

`THEMING.md` has been touched once since: `11fc9f34c`, 2026-08-22, a
one-line `@b2b/` → `@endora-commerce/` rename. Nothing has re-read it in four
months.

A second claim in the same paragraph fails with it: **"Class names are
namespaced under `.b2b-*` so a CSS-only retheme works."** The stylesheet's own
header says the opposite — `.industria-*` is the bespoke chrome and `.b2b-*` is
"legacy/utility classes still referenced from pages that haven't been re-themed
yet". Measured: **48 distinct `.industria-*` classes against 25 `.b2b-*`**. A
theme following the document would restyle the minority.

### The constitution citation: `v1.1.1`, against `4.0.1`

The document cites *"Constitution Principle VIII v1.1.1"*. The constitution is
at **4.0.1** (ratified 2026-04-23, last amended 2026-08-17) — three major
versions on. Verified in both directions: at `0441bee0b` the constitution read
`**Version**: 1.1.1 | **Ratified**: 2026-04-23 | **Last Amended**: 2026-04-25`,
so the citation was exact when written and has simply never been revisited.

A third claim rides on it and is **wrong in mechanism though right in effect**:
*"a real theme moves them to `storefront/messages/<locale>.json`, which the
language gate exempts as end-customer content."* There is no `storefront/messages`
directory, and `scripts/check-language.sh` contains no exemption for one. Its
population is `*.ts` / `*.tsx` / `*.cts` / `*.mts` comments plus
`docs/docs/**/*.md(x)`; a JSON catalogue is outside it **by file type**, not by a
carve-out anybody wrote. Same outcome today, a different rule, and the
difference matters the day the gate learns to read JSON.

The claims that **do** hold, checked: `lib/api/*`, `lib/i18n/*` and
`lib/server-context.ts` are genuinely the stable seam (46 fetchers, all threading
`X-Sales-Channel` through one wrapper); SSR-by-default holds (`export const
dynamic = 'force-dynamic'` in the root layout); `getServerContext()` is genuinely
the single per-request resolution point; and all ten named components still exist
under their given names.

*(The two defects above are corrected in `storefront/THEMING.md` in this same
merge request — a false claim standing beside a new true one is worse than
either alone. The measurement stays here.)*

---

## 3. What would "composed, not forked" require?

**Day one for a client instance is: copy `storefront/`.** There is no other
door. The measurement of that door:

| Property | Value |
| --- | --- |
| Package name | `storefront` — unscoped, `"private": true` |
| `exports` map | **none** |
| `files` field | **none** |
| Build output a consumer could resolve | **none** — `next build` produces an application, not a library |
| Path alias for its own tree | **none**; `admin` has `@/*`, this does not |
| Imports into `app/` | **400 relative, 0 by specifier** |
| Workspace glob that reaches it | `storefront` as a literal, i.e. one deployable, not a family |

Every one of those is a precondition another package in this repository already
satisfies and this one does not. `packages/modules/*` publishes a `dist` behind
an `exports` map with a `types` condition per subpath; `packages/platform`
publishes five enumerated subpaths. `storefront` publishes nothing, so nothing
can name any part of it, so the only way to get "most of this storefront plus my
differences" is to take a copy of all of it and diverge.

What a copy costs, per client, measured on today's tree: **111 components, 67
route files, 92 `lib` files, a 1282-line stylesheet — 32 323 lines across the
three trees.** And every upstream fix after the copy is a manual port, because
there is no dependency edge along which one could arrive.

The list of things that would have to become true — again, **only** the list; how
to get there is not this note's question:

1. **A package identity.** A scope, a name, an `exports` map, and a build that
   emits something resolvable. Feature `080-f4-real-scope` did exactly this for
   66 module packages and the platform; the shape is known and the storefront is
   not in it.
2. **A published surface to name.** Today the honest published surface would be
   `lib/api/*` (46 fetchers), `lib/i18n/*`, `lib/server-context.ts` and
   `lib/theme/*` — the parts `THEMING.md` already calls stable and that this
   measurement agrees are stable. `components/` cannot be published as it stands:
   **97 of 111 have no named prop type**, so there is nothing to declare.
3. **An addressing layer.** 400 relative imports would have to resolve through a
   specifier or a registry before a consumer could substitute anything at any of
   them.
4. **Somewhere for a client's own routes to live.** Next's App Router takes its
   route table from the filesystem, so "my `/p/[slug]` plus your everything else"
   is a filesystem question before it is an API question. Nothing in this tree
   addresses it and this note does not either.
5. **A theme catalogue a fork can extend.** Concretely and immediately: this
   merge request puts `STOREFRONT_THEME_CODES` in `packages/contracts`, because
   the admin has to offer a list and the admin cannot read the storefront. A
   deployment that forks `storefront/` and ships its own token sets therefore
   **cannot make them offerable** without editing the platform. That is a
   consequence of item 1, and it is the smallest concrete case of the whole
   problem: the storefront cannot tell the platform what it implements, because
   it is not a thing the platform can ask.

---

## Provenance

Every number above is a count of the working tree at `404a46831`, reproducible
with `find`, `grep` and `git cat-file`. Where a number is historical it names the
commit it was taken at (`0441bee0b`, 2026-04-25). No number in this note is
carried over from an earlier report; the four claims relayed into the task that
produced it were each re-measured before being used, and one of them — "67 route
files" — needed its definition stated (57 `page.tsx` + 5 `layout.tsx` + 5
`route.ts`) before it could be confirmed.
