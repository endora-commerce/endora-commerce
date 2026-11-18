---
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-i18n': patch
---

The inventory list (`/inventory`) uses the kit's list toolbar and `FilterChip` (issue #1460). The toolbar is a named search landmark. The Low stock and Out of stock chips report their state with `aria-pressed` and stay exclusive, so pressing one releases the other. A load error is shown as an alert.
