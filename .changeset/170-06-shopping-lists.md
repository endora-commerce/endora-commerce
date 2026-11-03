---
'@endora-commerce/mod-shopping-lists': minor
---

Shopping lists by organization permission (`specs/170-organization-roles/`, WP-06).

- Declares `shopping_lists.create` (*Create and edit shopping lists*) and `shopping_lists.convert` (*Convert shopping lists into quote requests and carts*), both member-default.
- Creating, renaming, deleting a list, adding, changing and removing its items, emptying it, adding to the default list and setting the default need `shopping_lists.create`; `POST /api/v1/shopping-lists/:id/convert-to-cart` needs `shopping_lists.convert` and `carts.create`, `…/convert-to-rfq` needs `shopping_lists.convert` and `quote_requests.create`. A refusal is `403 ORGANIZATION_PERMISSION_REQUIRED` naming the first missing code. Reading one's own lists stays open, and the default list is still provisioned for every new member.
