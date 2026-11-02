---
'@endora-commerce/contracts': minor
---

The cart-view schemas describe what the cart routes answer (issue #128).

Parsing real replies of `GET /api/v1/cart`, `GET /api/v1/cart?view=mini` and the line mutations (`POST`/`PATCH`/`DELETE /api/v1/cart/items…`) with the published schemas failed on every one of them. Nothing on the wire changed; the schemas were widened to it, and no schema was narrowed — every value that parsed before parses now.

- **`cartFullPayloadSchema`** — `createdAt`, `updatedAt` and `lastActivityAt` are `string | null`: the empty basket (no basket yet, `id: null`) answers `null` for all three.
- **`cartViewLineSchema`** — `productName` is `string | null`: the line-mutation replies do not resolve product names and answer `null`. `productThumbnailUrl` is optional: no cart route has ever answered it.
- **`cartMiniPayloadSchema`** — `status`, `approvalStatus`, `grandTotal` and `primaryCta` are optional: the mini view has never answered them (it skips the coupon and promotion work on purpose). It now declares the **`subtotal`** it does answer (optional, so older values still parse).
- **`cartMiniLineSchema`** — declares the **`variantId`** every mini line carries; `productName` and `productThumbnailUrl` are optional, because the mini view does not answer them.

Upgrading: the inferred types `CartFullPayload`, `CartViewLine`, `CartMiniPayload` and `CartMiniLine` change accordingly. Code that read one of the fields above as always present was reading `null` or `undefined` at run time already; the compiler now says so. Read `grandTotal`, `status` or `primaryCta` from the full view, not the mini one.
