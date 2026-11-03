---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-orders': minor
---

**Breaking:** order placement now enforces cart approval (issue #648). In an Organization that requires cart approval (`requiresCartApproval`), a member's basket that is not `approved` — never sent for approval, awaiting the Organization administrator, or rejected — is refused by `POST /api/v1/orders` (and so by the storefront checkout page, which calls it) with `409 ORDER_CART_APPROVAL_REQUIRED`, before anything is reserved or written; the basket is kept as it was. Such baskets were placed until now: only the storefront's call to action stood in the way. An Organization administrator's own basket and every basket of an Organization without the policy are placed as before, and so are orders placed from a working basket (admin order creation, one-click buy, the external order API).

- `@endora-commerce/contracts`: `ERROR_CODES.ORDER_CART_APPROVAL_REQUIRED`. Its `details` are `{ code, cartId, approvalStatus }`, with `code` one of `cart_approval_not_submitted`, `cart_approval_pending`, `cart_approval_rejected`; `orders` declares the code with English and Polish sentences per token.
- `@endora-commerce/mod-carts`: `CartPlacementApplyPort` (`@endora-commerce/mod-carts/ports`) gains a required `awaitsApproval({ cart, organizationId })`, answering whether the basket still awaits its Organization's approval. A hand-written implementation of the port must add it; `CartPlacementApplyService` takes the reads it is judged from (`{ organizations, customerAccounts }`) as a new fourth constructor argument.
- `@endora-commerce/mod-orders`: `OrderService.placeOrder` asks it for the customer's active basket and refuses as above.

An instance whose members order without sending baskets for approval will see those orders refused once it upgrades: such a member now sends the basket for approval and the administrator approves it, or the Organization switches the policy off (`PATCH /api/v1/organization/policies/cart-approval`).
