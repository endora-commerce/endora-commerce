---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-shopping-lists': patch
---

The Organization cart surfaces name a cart's owner and the order a completed cart produced; the auto-created default shopping list gets a published marker (issue #751).

- `orgCartSummarySchema` — and with it `orgCartDetailViewSchema` and `orgCartsListResponseSchema` — gains two required fields: `ownerEmail: string | null`, the owner's e-mail (`null` when the account can no longer be read), and `orderId: string | null`, the order a completed cart produced (`null` for any other cart). A consumer that builds these shapes by hand must now supply both.
- `ownerDisplayName` on `GET /api/v1/organization/carts` and `GET /api/v1/organization/carts/:id` is now the owner's first and last name; it falls back to the e-mail for an owner with no name, then to the account id. It was the e-mail alone — read `ownerEmail` where the e-mail is what you need.
- New `SHOPPING_LIST_AUTO_DEFAULT_NAME` (`'Default'`, the name `shopping_lists` stores on the default list it creates) and `isAutoDefaultShoppingList({ name, isDefault })`: whether a list is that default and still carries that name, so a storefront can name it in the shop language. `shopping_lists` creates the list with the constant; what it stores is unchanged.
