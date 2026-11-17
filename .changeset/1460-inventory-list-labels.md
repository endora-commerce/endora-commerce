---
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-i18n': patch
---

The inventory list (`/inventory`) now shows each product's stock band as a translated label ("Out of stock", "Low stock", …) instead of the raw value such as `out_of_stock`, and `low` no longer shares `medium`'s colour (issue #1460). A row's **Edit stock** opens the product editor on its Inventory tab rather than Details. The search input has an accessible name, and the Low stock / Out of stock filter chips report their state with `aria-pressed`.
