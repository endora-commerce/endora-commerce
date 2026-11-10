---
'@endora-commerce/mod-orders': minor
---

The admin order create accepts custom-field values (`specs/175-buyer-input-custom-fields/`).

- `POST /api/v1/admin/orders` validates `customFieldValues` with the administrator's rules before the working basket or any inline address is written; a refusal answers the existing `422 CUSTOM_FIELD_VALUE_INVALID` (`details` entries `{ path, issue }`) and creates no order. The validated bag is stored on the new order by the placement, in its transaction, and the `order.place_on_behalf` audit after-state names its keys, sorted, as `changedCustomFields` — never the values (`specs/conventions/audit-state.md`). The admin create now enforces `required` order definitions, **also when the request sends no values**. Storefront checkout, one-click and API intake placements are unchanged.
- `OrderService.placeOrder` gains the option `customFieldValues` (an already-validated bag, this module's own admin create path only), written over values carried from a quote request.
- *New order* embeds the custom-field panel (shown with `custom_fields:read`), sends its bag as `customFieldValues` and shows a refusal at the field it names (read through `@endora-commerce/admin-kit`'s `customFieldErrorsOf`).
- The manifest exports `customFieldWrites`: the order create and the values patch `PATCH /api/v1/admin/orders/:id/custom-fields`.
