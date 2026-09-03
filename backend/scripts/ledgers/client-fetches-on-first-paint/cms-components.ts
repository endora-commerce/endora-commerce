import type { ClientFetchLedgerEntry } from '../../check-rsc-discipline.js';

/**
 * `@endora-commerce/cms-components`' client components that fetch their own
 * first-paint content (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-020;
 * `contracts/rsc-discipline-check.md` §5).
 *
 * **This shard is the reason the check's population is derived rather than
 * spelled.** Every entry here is a page-builder block a shop composes onto its
 * own indexable pages — a category page, a landing page, the home page — and
 * not one of them lives under `storefront/`. The roadmap's population,
 * `storefront/components`, reaches none of it: a check scoped to the
 * application would have reported zero and been wrong on the day it landed
 * (§2).
 *
 * Keyed `(file, state name)` and never a line, so an insertion above a site
 * does not red an entry that still describes it.
 *
 * Every entry is `firstPaint: true` — real debt, and the same debt eleven
 * times: the block renders a skeleton or an empty-state to a crawler and fills
 * itself in from an effect that never runs on the server. All eleven retire
 * together on `specs/096-page-builder-block-ownership/`'s D-31 `load` seam,
 * which is what moves the read to the server and hands the block its data as a
 * prop. Five of them are also `BLOCKS_RENDERING_A_LOADING_STATE`'s subject in
 * Phase 1's behavioural floor; the two nets overlap here deliberately
 * (contract §6) and neither subsumes the other.
 */
const D31 =
  'specs/096-page-builder-block-ownership/ — D-31’s `load` seam, which moves the read to the ' +
  'server and hands the block its data as a prop.';

export const entries: Readonly<Record<string, ClientFetchLedgerEntry>> = {
  'packages/cms-components/src/components/CategoryGrid.tsx#isLoading': {
    firstPaint: true,
    reason:
      'FR-020 — `CategoryGridBody` renders `CategoryGridSkeleton` while `isLoading`, which is ' +
      'the whole of what a crawler receives for a category grid placed on a landing page.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/CategoryGrid.tsx#items': {
    firstPaint: true,
    reason:
      'FR-020 — the category names and links themselves. The empty-state branch is served ' +
      'while the effect that fills `items` waits for a browser that a crawler does not have.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/CategoryList.tsx#isLoading': {
    firstPaint: true,
    reason:
      'FR-020 — `CategoryListRender` branches to `CategoryListSkeleton` inside its returned ' +
      'JSX. The gate is a conditional expression rather than an early return, which is the ' +
      'second spelling of clause 2 and the one a predicate reading only `if … return` misses.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/CategoryList.tsx#items': {
    firstPaint: true,
    reason:
      'FR-020 — the list’s `<a href="/c/…">` links. They are internal links a crawler would ' +
      'otherwise follow, so this one costs discovery as well as content.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/CmsProductCard.tsx#error': {
    firstPaint: true,
    reason:
      'FR-020 — `CmsProductCardLoader` returns the "Product unavailable" placeholder on ' +
      '`error`. Its fetch arrives through a dynamic `await import("../utils/catalog-fetch.js")` ' +
      'inside the effect, so the helper is in no static import list — the shape that made this ' +
      'file invisible to a first draft of the predicate.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/CmsProductCard.tsx#loading': {
    firstPaint: true,
    reason:
      'FR-020 — the "Loading product…" placeholder. `specs/098-…/tasks.md` T102 records that ' +
      'Phase 1’s behavioural floor cannot see this one at all: the block that renders it is ' +
      '`ProductCard`, whose `defaultProps` carry `productSlug: \'\'`, so on defaults `loading` ' +
      'initialises false and the block renders its placeholder instead. It is contract §6’s ' +
      'worked case for why the static net exists beside the behavioural one.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/CmsProductCard.tsx#product': {
    firstPaint: true,
    reason:
      'FR-020 — the product’s own name, price and image: the content the card exists to show.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/ProductGrid.tsx#isLoading': {
    firstPaint: true,
    reason:
      'FR-020 — contract §3’s worked example. `ProductGridBody` returns `ProductGridSkeleton` ' +
      'while `isLoading`, and `setIsLoading(false)` is called from the effect that awaits ' +
      '`fetchProductsBySlugs` / `fetchProductsList`.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/ProductGrid.tsx#products': {
    firstPaint: true,
    reason:
      'FR-020 — the products themselves, and their `/p/<slug>` links. A grid placed on the ' +
      'home page is one of the primary discovery paths into the catalogue.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/ProductSlider.tsx#isLoading': {
    firstPaint: true,
    reason:
      'FR-020 — `ProductSliderBody` returns `ProductSliderSkeleton` while `isLoading`, the ' +
      'same shape as `ProductGrid` in a carousel.',
    retiredBy: D31,
  },
  'packages/cms-components/src/components/ProductSlider.tsx#products': {
    firstPaint: true,
    reason: 'FR-020 — the slides’ own products and their links.',
    retiredBy: D31,
  },
};
