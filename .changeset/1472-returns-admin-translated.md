---
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-i18n': patch
---

The returns admin screens are translated in full and show names instead of codes (issue #1472). On the case detail, the authorize action, the status transition buttons (now named after the target status, "Move to Received" rather than "→ received"), the items table, the return shipments card (direction and status translated) and the load and action errors have English and Polish text; the order is a link to the order, named by its order number; amounts are formatted in the case currency.

The return reasons, return statuses and return delivery methods screens use the admin kit's labelled form fields, switches and empty states. A reason's label and what it applies to, a status's name and a return delivery method's name are shown in the operator's language, and a return delivery method is chosen by name instead of by pasting its ID (the ID field stays as a fallback when the delivery methods cannot be read). A return cost of 0 is shown as free.

The `returns.methods.description` key is removed from the shared bundle: the "0 = free" note is now the return cost field's hint, `methods.field.costHint` in the `returns` bundle. A deployment that overrides the old key must move its text there.
