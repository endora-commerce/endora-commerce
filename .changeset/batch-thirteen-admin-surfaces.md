---
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/mod-inventory': minor
'@endora-commerce/mod-pim-ergonode': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-i18n': minor
---

`price_lists`, `quick_order`, `inventory` and `pim_ergonode` ship their admin screens, and
four icon names join the allowlist.

**Four packages' `./admin` subpath gains `routes` and `nav`.** All four already exported
`contributions` from `@endora-commerce/mod-<id>/admin` with a `zones` array and nothing else;
each now declares its screens there too, at the paths and codes the hand-written host
registrations carried. Sixteen routes and nine sidebar entries between them. The exported
symbol is unchanged — `contributions`, an `AdminContributions` object, and nothing else — so a
consumer already reading the zones needs no edit; what is new is that the same object now
answers for the screens.

- `@endora-commerce/mod-price-lists` — `/price-lists` (the landing route),
  `/price-lists/display-modes` and `/price-lists/:id`, all on `price_lists:read`, which is the
  code the module's single `readGate` enforces on every `GET` behind them; each screen keeps
  gating its own saves on `price_lists:write` inside itself. One sidebar row, in the `pricing`
  section at weight 100. The display-mode screen is reached from a button on the roster and the
  detail screen from the roster itself, so neither has a row of its own.
- `@endora-commerce/mod-quick-order` — `/orders/quick-order` on `orders:write`, the code both
  `POST`s behind the screen enforce; there is no `quick_order:*` permission in the platform at
  all. **No sidebar row**, which is the host table's own decision kept: quick order is the
  other way of getting lines into one order, reached from the `order.entry.tabs` strip this
  package already contributes into.
- `@endora-commerce/mod-inventory` — seven routes: `/inventory` (the landing route),
  `/inventory/low-stock`, `/inventory/notifications`, `/warehouses`, `/warehouses/new` and
  `/warehouses/:id` on `inventory:read`, and `/inventory/import` on `inventory:write`, the
  code its `POST` enforces. Five sidebar rows in the `inventory` section at weights 100 to 500,
  the order the host table had. Both of this module's admin surface directories moved: the
  warehouse screens and their client are here too, the sidebar having always attributed
  `/warehouses` to this module.
- `@endora-commerce/mod-pim-ergonode` — `/pim-ergonode` (the landing route),
  `/pim-ergonode/attribute-mappings`, `/pim-ergonode/category-mappings`, `/pim-ergonode/runs`
  and `/pim-ergonode/runs/:runId`, all on `pim_ergonode:read`. One sidebar row, `catalog`,
  weight 250 — between `@endora-commerce/mod-assets-library`'s 200 and
  `@endora-commerce/mod-pim-pimcore`'s 300, which is the placement both of those packages'
  declarations already describe. Its admin client moved with the screens and is now
  `src/admin/api/ergonode-client.ts` beside the protections client P4b split out.

Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

**`@endora-commerce/contracts` gains four `KnownIconNameSchema` members** — `Warehouse`,
`TrendingDown`, `Bell` and `PackageOpen`. Additive: no existing member changes, and
`KnownIconName` widens rather than narrowing, so no consumer that names an icon today stops
compiling. They are the four glyphs `inventory`'s sidebar rows carried, which the host imported
from `lucide-react` by hand; a contribution names its icon rather than importing it, so without
them four rows would have had to degrade to names already on the allowlist.

**`@endora-commerce/admin-kit` maps the same four names** in `resolveIcon`. A caller passing one
of them now gets the matching `lucide-react` component instead of the `Sparkles` fallback.

**`@endora-commerce/mod-price-lists` declares its first palette action**, `open-price-lists`,
targeting `/price-lists` on `price_lists:read`. It replaces a hand-written row in the admin
shell and carries that row's destination, code and keywords, so an operator's ⌘K answer is
unchanged; what changes is that the advertisement is now resolved from the manifest against the
effective enabled-set. `@endora-commerce/mod-inventory` declares no new action: its
hand-written row was a second copy of `open-inventory` and is simply gone.

**`@endora-commerce/mod-i18n` loses thirteen keys** — the eight `appShell.nav.*` labels the
four modules' sidebar rows rendered, two `appShell.palette.sub.*` subtitles, and
`appShell.crumb.importRun` — in both shipped languages. Each moved into the owning module's own
bundle under a module-relative key (`nav.priceLists.label`, `nav.stockOverview.label`,
`nav.warehouses.label`, `nav.lowStock.label`, `nav.notifyWhenAvailable.label`,
`nav.importStock.label`, `nav.pimErgonode.label`), or was retired with the hand-written
breadcrumb rule that was its only reader. A consumer resolving one of those keys out of the
shared bundle gets nothing; resolve it in the owning module's namespace instead.
