---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-catalog': patch
---

The product editor's tabs are sections of the editor card, not cards inside it (issue #1488, UX audit CAT-06).

`@endora-commerce/admin-kit/field-protection`: `FieldProtectionSummary` is now an `EditorSection` and no longer draws its own bordered box. It takes `chrome` (`'section'` by default, or `'card'`) and `titleAs`, like `CustomFieldValuesPanel`. The heading names the source, so two integrations on one record render as two labelled sections. **Breaking visual change for integration modules (0.x, so released as a minor):** a summary mounted on its own, outside a card, must pass `chrome="card"` to keep a frame: `<FieldProtectionSummary source={…} chrome="card" />`.

`@endora-commerce/admin-kit` theme: the `.b2b-hr` class is removed. The product editor's Details tab was the last thing that rendered it; a rule between sections is now drawn by `EditorSection` itself. A module that still uses it can write a `<Separator />` from `./ui` instead.

`@endora-commerce/mod-catalog`: on Variants, Related products, Grouped items, Bundle slots, Inventory (stock management, low-stock threshold, fulfilment strategy, stock by warehouse, order rules, packaging units), Details, Media, Attachments, Pricing and Channels, each group is an `EditorSection` with an `h2` heading and a rule between sections. Bundle slots, gallery images and attachments are listed as rows divided by a rule instead of one bordered box per item. The Inventory summary (cumulative on hand, active warehouses) is now a stat line under the *Stock by warehouse* heading, and the Inventory tab no longer has the extra "Stock" heading above its sections. The catalog's `SectionHeading` is gone. Its badge logic remains in the editor as `SectionBadge`.
