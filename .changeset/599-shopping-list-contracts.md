---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-shopping-lists': patch
---

Shopping-list replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `shoppingListListResponseSchema` / `ShoppingListListResponse` for `GET /api/v1/shopping-lists`, a `data` array of `shoppingListSchema` rows. The rows were already described, but the list envelope was not.
- `mod-shopping-lists` builds every list reply as the contract's `ShoppingList` instead of `Record<string, unknown>`. The handlers declare `ShoppingListListResponse`, `{ data: ShoppingList }`, `{ data: DefaultShoppingListSummary }` and `{ data: ConvertToCartResponse }`. The storefront's shopping-list API module re-exports the contract types instead of hand-written copies. Nothing on the wire changes.
