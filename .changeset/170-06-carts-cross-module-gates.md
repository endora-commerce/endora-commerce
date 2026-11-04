---
'@endora-commerce/mod-carts': minor
---

Three cart routes are judged by the organization permissions other modules declare (`specs/170-organization-roles/` T137). Breaking for a storefront or an integration whose member's role lacks the code: the route now answers `403 ORGANIZATION_PERMISSION_REQUIRED`, naming the permission, where it reached the handler before.

- `POST /api/v1/cart/items/:itemId/save-to-shopping-list` needs `shopping_lists.create`.
- `POST /api/v1/cart/convert-to-quote-request` needs `quote_requests.create`.
- `POST /api/v1/cart/from-shopping-list/:shoppingListId` needs `shopping_lists.convert`, judged before `carts.create`.

All three codes are member defaults, so a migrated *Member* role is unaffected.
