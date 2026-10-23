---
'@endora-commerce/mod-price-lists': minor
---

*Pricing settings* (feature 161, US6 and US7; FR-025, FR-026). `/price-lists/display-modes` keeps its address and its display-mode sections and gains two:

- **Storefront prices** — *Show list price beside the buyer's price* reads and writes `GET`/`PUT /api/v1/admin/price-books/settings/show-list-price` (`{ value }`, audited), off by default. The switch is offered only with `price_lists:write`; a reader sees *On* or *Off* with no control. The save is announced in a live region and cannot be sent twice; a refused save keeps the stored value.
- **Price precedence** (`#precedence`), read-only from `GET …/precedence`: the active preset by name (or *Custom order*), the version, the twelve buyer cells in the order in force with an example each, which of a category line and an attribute value line wins, the nearest-organization-first depth when it is in force, and that changing it arrives later. The grid's *See the price precedence* link lands on this section, scrolled to and focused.

New strings under `settings.*` in the module's bundle, English and Polish.
