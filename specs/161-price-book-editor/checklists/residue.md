# Residue of the temporary landing and the old screens (T003, consumed by T086)

Recorded 2026-10-22 on `feat/161-price-book-editor` at `903016f92`, before any 161 code. Each line is
a place that still names the temporary landing or a removed screen; T086 removes or rewrites it and
ticks it. Lines marked **keep** are not residue and are listed so T086 does not chase them.

## The temporary landing (`/price-lists/display-modes` as the module's index)

- [x] `packages/modules/price_lists/src/admin/index.ts:31` — `ROUTE_PATH = '/price-lists/display-modes'` (the nav entry and the index route)
- [x] `packages/modules/price_lists/src/manifest.ts:125-131` — palette action `open-price-lists` with `targetRoute: '/price-lists/display-modes'`
- [x] `packages/modules/price_lists/i18n/en.json` — `actions.openPriceLists.description`: "Price display modes"
- [x] `packages/modules/price_lists/i18n/pl.json` — `actions.openPriceLists.description`: "Tryby wyświetlania cen"
- [x] `packages/admin-shell/src/components/AppShell.tsx:915-924` — the comment on the `/price-lists` row's move into `open-price-lists` (re-read once the target is `/price-lists` again; rewrite only if it names the display-mode landing)
- [x] `admin/test/modules/price_lists/price-lists-zones.test.tsx:122` — "declares exactly the two display-mode members, with no match on any" (T028 adds `product.editor.pricing.after`)

## Old screen and route names (grep of `price-lists-engine`, `rule-targets`, `LinkedPriceLists`, `PriceMatrix`, `BracketGrid`)

- [x] `packages/modules/price_lists/docs/price_lists.md` — 30 lines naming `/api/v1/admin/price-lists-engine/…` (documentation rebuild is feature 160 Phase 13; hand over, do not rewrite here)
- [x] `admin/test/modules/price_lists/price-lists-zones.test.tsx:19` — header comment naming `LinkedPriceListsPanel` (history; rewrite with the zone test in T028)
- **keep** `backend/test/contract/price_lists/removed-routes.test.ts` — asserts the removed engine routes answer 404 (FR-037 of 160)
- **keep** `admin/test/modules/catalog/ProductEditor.channels-tab.test.tsx:208` — asserts `LinkedPriceListsPanel` is absent
- **keep** `packages/modules/price_lists/src/backend/routes.price-books.ts:42`, `routes.ts:13-14` — provenance comments naming what the price-book API replaced
- **keep** `packages/modules/price_lists/src/migrations/20261016T131148_price_lists_price_matrix_entries.ts`, `migrations/index.ts` — migrations are history
- **keep** `promotions` (`/api/v1/admin/promotions/rule-targets/…`: contracts, routes, client, docs, tests, OpenAPI baseline) and `pwa` (`/api/v1/admin/pwa/rule-targets/…`) — other modules' own pickers, unrelated to price lists

## Ledgers to re-derive when the above moves

- `backend/test/unit/kernel/module-removal.test.ts` — `price_lists` carries no residue entry (line 655 comment); re-check after T086

## Verified 2026-10-23 (T101)

Every line above is resolved: the index is `/price-lists`, `open-price-lists` targets it, both
descriptions say "Find, create and edit price books", the AppShell comment names no display-mode
landing, and the zone test declares the base-price member. A grep of `backend/test`, `admin/test`,
`storefront/test`, `admin/src`, `storefront/{app,components,lib}` and `packages/*/src` for the old
names (`price-lists-engine`, `rule-targets`, `LinkedPriceLists`, `PriceMatrix`, `BracketGrid`) and for
every file this feature deleted or moved (`page-product-ids-by-name`, `permission-requires.test`,
`manifest.permissions.test`) finds only the **keep** lines, history comments in two admin tests'
headers, CHANGELOGs, and one comment in `pwa`'s `PushAudienceRuleBuilder.tsx` naming the removed
`ApplicationRuleBuilder` it was modelled on — another module's provenance, left as it is.

