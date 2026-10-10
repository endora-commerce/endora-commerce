---
'@endora-commerce/mod-carts': minor
'@endora-commerce/contracts': patch
'@endora-commerce/mod-price-lists': patch
---

Two refusals of a cart line have an error code of their own instead of `VALIDATION_FAILED`, and a
sentence in English and Polish. **A client that matches on `VALIDATION_FAILED` for these two cases
now sees the specific code**; the HTTP status of each is unchanged.

- `CART_PRODUCT_QUOTE_ONLY` (`400`) — the product's price is withheld from this buyer (the resolved
  price display mode is `none`), so it is quoted rather than added to a cart. It was
  `400 VALIDATION_FAILED` with the identifier `product_quote_only` as its message, which is what
  the buyer read, in every language. `details.productId` names the product. Besides
  `POST /api/v1/cart/items`, every flow that fills a cart line by line can answer it: quick order,
  one-click buy, a shopping list added to the cart, an order created in the admin and an order
  taken in through the API.
- `CART_QUANTITY_INVALID` (`422`) — the quantity is below the minimum a cart line may hold. It was
  `422 VALIDATION_FAILED` with the English message `Quantity must be > 0.`, held by no bundle.
  `details.minimum` and `details.quantity` carry the values, and both sentences name the minimum.
  No HTTP route reaches it — every request schema in front of the cart already refuses such a
  quantity as a malformed request, which is still `400 VALIDATION_FAILED` — so it is what a module
  calling the cart write port (`CartWritePort.addItem`) in-process is answered.

`@endora-commerce/contracts` gains the two members of `ERROR_CODES`. The `price_lists` documentation
page, which names the first refusal, names the new code. No setting or permission changes.
