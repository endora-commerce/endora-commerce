---
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-forms': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-returns': patch
---

On the Settings screen a boolean setting is a switch instead of a `true` / `false` list, and an enum setting's options read as labels in English and Polish instead of machine codes (issue #1479). The switch changes the draft like every other field; the page's one Save still writes it. The default and global values under a field read as "On" / "Off" and as option labels too.

A module labels its enum setting's options in its own bundle, under `settingLabels.<setting code>.options.<option value>`; an option without a label is shown as its value. Every enum setting shipped in the platform now has those labels, except `seo.default_robots`, whose directive pairs are the vocabulary.
