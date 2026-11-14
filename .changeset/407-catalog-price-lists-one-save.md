---
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-price-lists': minor
---

The product editor's one Save now covers the panels contributed to its zones (issue #407, `specs/180-one-save-zone-editors/`).

**mod-catalog:**
- The editor runs a save session keyed on the scope it opened, and passes the session to every product-editor zone except SEO.
- Save counts the product's staged changes plus every panel's.
- Save writes the product's own changes first and the panels after, each through its own module.
- If a panel's write fails after the product saved, the editor reports what was saved and what was not, and the next Save writes only what is left.
- One guard covers every unsaved change on the page, including a scope switch. The browser's leave prompt covers panel changes too.
- Save is shown to an operator who may write the product or any panel.
- The Pricing tab heading no longer says "Applies immediately".
- The editor context carries `saveSession`.

**mod-price-lists:**
- The product's base-price panel saves with the product editor's Save. It no longer has a *Save prices* button or a leave prompt of its own.
- `PUT /api/v1/admin/price-books/base-prices/:productId?dryRun=true` runs every rule of the write and writes nothing (no Command, no audit entry). The editor's Save calls it before anything is written.
- The admin client gains `checkBasePrices(productId, body)`.
- The `basePrices.save`, `basePrices.saving` and `basePrices.status.*` strings are removed; `basePrices.partLabel` is added.
