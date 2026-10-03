---
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-languages': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-pwa': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-settings': patch
---

Documentation: migrations are now named by the file that actually ships. The pages cited
migrations by a retired numbering (`024_settings_init.ts`, "migration 102", `080_returns_init.ts`
and others), which matches no file in any package. Each reference now gives the real
timestamped filename, such as `20260611T140346_catalog_product_value_overrides_init.ts`, and
says which module owns it where that is a different module. The organizations page also no
longer claims that the `suspended` → `blocked` migration writes an audit-log entry: it writes
an explanatory `blocked_reason` on each remapped row.
