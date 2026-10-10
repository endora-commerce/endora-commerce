---
'@endora-commerce/cms-components': patch
'@endora-commerce/cli': patch
---

Catalogue blocks on a CMS page are part of the server-rendered HTML. `ProductGrid`,
`ProductSlider`, `ProductCard`, `CategoryList` and `CategoryGrid` used to fetch their own data
from an effect, so the document a crawler, a link preview or a browser without JavaScript received
held a skeleton and no product or category at all.

Each block now declares the data it needs, and the application rendering the page resolves it on
the server:

- `@endora-commerce/cms-components/utils/catalog-block-data` (new, importable from a Server
  Component) exports `collectCatalogBlockDataRequests(documents)`, `resolveCatalogBlockData(requests,
  source)` and `catalogBlockDataKey(request)`. The resolver reads each distinct product, listing
  and the category tree once, in parallel with a bound of six, and leaves a failed read out so
  that only its block degrades.
- `CatalogPreviewProvider` takes a new optional `data` prop — the resolved answers — and its
  `api` prop is now optional. With `data` present a block renders from it during the server
  render and during hydration: it does not fetch on mount and never shows its loading state. A
  request with no answer renders the block's existing empty state.
- Without `data` nothing changes: the admin page builder still passes `api`, and a block with
  neither still fetches from an effect and shows its skeleton meanwhile.

All of it is additive; no existing prop or export changed meaning.

The storefront `endora new` writes does the resolving: `components/CatalogBlockData.tsx` is a
Server Component that `CmsPageRenderer` and `Hook` mount around their Page Builder trees, and
`lib/page-builder/catalog-block-data.ts` reads through `lib/api/catalog` with the request's
context, so a block shows the sales channel's catalogue in the request's language and, for a
signed-in buyer, that buyer's prices — fetched `no-store`, as the product listing's are.
`CmsPageRenderer` now requires a `ctx` prop for that reason.

A storefront that already exists keeps the source it was created with. Upgrading
`@endora-commerce/cms-components` alone changes nothing there — its blocks keep fetching in the
browser as before — until it mounts the provider with `data`: copy the two files above and wrap
the `PageBuilderRender` call sites as the reference storefront does. Other render sites of the
reference storefront (blog post bodies, category page content, the megamenu and the consent
messages) are not wrapped yet and behave as before.
