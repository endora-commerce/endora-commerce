---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-shopping-lists': minor
---

**A shopping list's name and line quantities are written in one request** (issue #1251).

`@endora-commerce/contracts`: new `updateShoppingListRequestSchema` and its type `UpdateShoppingListRequest`, `{ name?, items?: [{ id, quantity }] }`. At least one of the two is required; each line appears at most once, at most `REQUEST_LINE_ITEMS_MAX` of them, and each quantity is a `lineQuantitySchema`. Every body `renameShoppingListRequestSchema` accepts is accepted by it, and that schema is unchanged.

`@endora-commerce/mod-shopping-lists`: `PATCH /api/v1/shopping-lists/:id` now takes that body, still behind `shopping_lists.create`. A body with only `name` renames, as before. With `items` it sets those lines' quantities together with the name, in one write: a line that is not on the list refuses the whole request with `404 NOT_FOUND` and changes nothing. `ShoppingListService.rename(ctx, listId, name)` is replaced by `ShoppingListService.update(ctx, listId, { name?, items? })`; a caller passing a name writes `update(ctx, listId, { name })`.

On the storefront a list's page has one *Save changes* for the list's name and every quantity, instead of a rename form and a *Save* per row. The conversions to the cart and to a quote request save what the buyer typed first and then convert those quantities. *Remove* and *Clear list* stay immediate.
