---
title: carts
description: Customer shopping cart with anonymous→logged-in merge
---

# `carts`

Anonymous and customer-bound shopping carts. An anonymous cart is identified
by a long-lived cookie token; on login it merges into the Customer's cart
deterministically.

The carts consolidation of May 2026 extended the foundation cart
module with a full lifecycle (`active` / `abandoned` / `completed` /
`rejected`), an orthogonal approval sub-state, sales-channel scoping,
last-activity bookkeeping, coupon application against the Promotions module,
up-sell suggestions, three conversions (Cart ↔ Quote Request, Shopping List
→ Cart), Organization-Administrator visibility + approval gate, an
abandonment sweep, and a platform-admin observability surface.

## One basket per store

A basket belongs to the sales channel — the store — it is used on:

- It is created on the channel of the request that creates it and records that channel (`salesChannelId`). Every basket read and write addresses the basket of the request's channel, so a customer who shops on two stores has a basket on each; an anonymous visitor's basket token names a basket on one store only, and filling a basket on another store starts a new one.
- Line prices, promotions and coupons, and whether a product is sold on request only, are resolved for the basket's channel — the price a buyer sees in a store's basket is that store's price.
- Merging at sign-in only merges an anonymous basket of the store the customer signs in on; a basket filled on another store is left as it is.
- Placing an order uses the basket of the order's channel. A basket of another channel is refused with `422 ORDER_SALES_CHANNEL_MISMATCH` — *"Your basket belongs to a different store. Open the basket in this store and place the order again."* — before anything is reserved or written; the basket is kept and nothing is repriced.

When baskets started recording their channel, every basket that had none was recorded on the system-default channel.

The channel-access rule applies to baskets like to every storefront call: an anonymous visitor has no basket on a store closed to anonymous visitors, and a customer has none on a store their Organization is not assigned to.

## Lifecycle

```text
                ┌──────────────────────────────────────────────────────┐
                │                                                      │
[ active / not_required ] ──(qty/add/remove/coupon)──┐                 │
        │                                            ▼                 │
        │                                  [ active / pending ]        │
        │                                            │                 │
        │                                            ├──(org-admin     │
        │                                            │   approve)──▶   │
        │                                            │  [ active /     │
        │                                            │   approved ]    │
        │                                            │     │           │
        │                                            ▼     ▼           │
        │  (org-admin reject)                  [ rejected / rejected_by_org_admin ]
        │
        ▼
[ abandoned ] ◀──(sweep: last_activity_at < threshold)── [ active / * ]
        │                                                      ▲
        │                                                      │
        └────────────────(any buyer activity)──────────────────┘

[ active / approved ]    ──(checkout success)──▶ [ completed / approved ]
[ active / * ]           ──(Cart→QR conversion)─▶ [ completed / *; converted_to_quote_request_id set ]
```

Re-arm rule: any buyer-driven mutation (add/remove/quantity/coupon) on an
`approved` cart silently drops `approval_status` back to `pending`.

Self-approval exemption: a cart created by an Organization Administrator
is born with `approval_status='not_required'` regardless of the per-Org
policy flag.

## Public surface

### Storefront (buyer)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/cart` | The active cart of the request's sales channel (lazy-create); the payload includes `status`, `approvalStatus`, `salesChannelId`, `grandTotal`, `discount`, `primaryCta`, `droppedLines`, `couponDroppedThisRead`, `lastActivityAt` |
| `POST /api/v1/cart/items` | Add line item (200-line cap enforced) |
| `PATCH /api/v1/cart/items/:itemId` | Update quantity (accepts `0` to delete) |
| `DELETE /api/v1/cart/items/:itemId` | Remove line |
| `POST /api/v1/cart/items/:itemId/save-to-shopping-list` | Push line to a Purchase List |
| `POST /api/v1/cart/touch` | Explicit page-open ping; bumps `last_activity_at` and reactivates an abandoned cart |
| `GET /api/v1/cart/upsells?limit=N` | Up-sell strip from Catalog `product_links` (kind = `up_sell`) |
| `POST /api/v1/cart/coupon` | Apply (or replace, or clear) the active coupon code; 422 `CART_COUPON_REJECTED` with reason on rejection |
| `DELETE /api/v1/cart/coupon` | Alias for `POST {code: null}` |
| `POST /api/v1/cart/convert-to-quote-request` | Cart → Quote Request; source cart becomes `completed` with `converted_to_quote_request_id` set |
| `POST /api/v1/cart/from-quote-request/:qrId` | Quote Request → Cart; lines re-priced at the customer's current prices |
| `POST /api/v1/cart/from-shopping-list/:listId` | Shopping List → Cart; lines re-priced |

### Storefront (Organization Administrator)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/organization/carts` | List every cart in the caller's Organization |
| `GET /api/v1/organization/carts/:id` | Detail (member-owned cart) |
| `PATCH /api/v1/organization/policies/cart-approval` | Toggle `requires_cart_approval` for the Organization |
| `POST /api/v1/cart/submit-for-approval` | Buyer submits cart for Org-Admin approval (no-op when policy off; refused for Org-Admins themselves, and for a basket below a minimum — see *Order minimums*) |
| `POST /api/v1/organization/carts/:id/approve` | Approve a pending cart |
| `POST /api/v1/organization/carts/:id/reject` | Reject a pending cart with a required reason |

Role gate: `CustomerAccount.role === 'organization_admin'` for every
`organization/*` route. Foreign-organization carts return 404
(anti-enumeration symmetry).

### Admin

| Verb + Path | Capability | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/carts` | `carts:read` | Paginated platform-wide list (status / approvalStatus / org / customer / channel / date filters) |
| `GET /api/v1/admin/carts/:id` | `carts:read` | Read-only cart detail |
| `GET /api/v1/admin/carts/:id/audit` | `carts:read` | Cart-detail audit feed |
| `POST /api/v1/admin/carts/:id/reject` | `carts:reject` | Emergency terminal reject (requires reason) |

## Entities

- `Cart` (one active per `(customer_account_id, sales_channel_id)`; partial
  unique index enforces this in PostgreSQL).
- `CartItem` (per-line `unit_price` — the price the line is ordered at —
  cached `recomputed_*` columns, and the `agreed_*` columns of a line seeded
  from an accepted quote).
- `CartAuditEntry` (typed per-cart feed; indexed on `(cart_id, occurred_at
  DESC)`). Every state transition also lands a row in the existing
  `audit_log_entries` table via `AuditPort` for the platform-wide
  audit timeline.

## Line prices

A cart line is ordered at its stored `unit_price`, so that price is always the
price for the line's **current** quantity:

- Adding a product, adding more of a product already in the cart, changing a
  line's quantity, merging an anonymous cart at login and seeding a basket from
  a past order (a reorder) all store the price for the resulting quantity — a
  quantity tier of a price book applies to the quantity actually ordered.
- The price comes from the price books (the `price_lists` module), for the
  line's product **and variant**, on the basket's sales channel, for the
  basket's buyer: the base price, a catalogue price for everyone on the channel,
  the buyer's organization or customer-group price, and a sale when it is lower.
  There is no other source: a line no price book prices is not orderable and is
  refused with `422 CART_PRODUCT_UNPRICED` — the buyer can ask for a quote
  instead. A product sold on request only is refused with
  `400 CART_PRODUCT_QUOTE_ONLY`.
- A line seeded from an accepted quote keeps the agreed price only while it
  holds the agreed quantity. At any other quantity it is priced from the price
  books, and it gets the agreed price back at the agreed quantity.
- Each line records **where its price came from** in `price_source`: `agreed`
  (a quote's agreed price), `base`, `catalogue`, `buyer` or `sale` (the price-book
  step that priced it); it is `null` on a line priced before price books existed.
  Order placement copies it onto the order line.
- `GET /api/v1/cart` shows every line at the price placement would charge now,
  through the same chain, and shows a line placement would refuse as
  unavailable.
- At order placement the Orders module asks this module whether every stored
  price is still current. If one is not — typically a price book changed after
  the line was added — the placement is refused with
  `409 CART_PRICE_CHANGED` (`details.lines` names each line with its previous
  and current unit price), the cart is brought up to date, and the buyer
  reviews it before placing the order again.

**For developers.** The whole chain is one function,
`CartLinePricing.orderablePrices`
(`src/backend/services/cart-line-pricing.ts` in this module): the agreed
price at the agreed quantity, else the price books through one batched
`resolveLinePrices` call for every line of the basket (with each line's
`variantId`), else nothing. Adding, merging, changing a quantity, reading the
cart (`CartPricingRecompute`) and the placement check all call it, so the price
a buyer sees in the basket is the price placement charges —
`backend/test/integration/carts/cart-read-equals-placement.test.ts` holds that.

## Settings

| Key | Default | Description |
| --- | --- | --- |
| `carts.abandonment.inactivity_minutes` | `10080` (7 days) | Minutes of inactivity before an `active` cart is considered `abandoned`. `0` disables the sweep. |
| `carts.abandonment.notification_recipient` | `""` (empty) | Single e-mail address to notify on abandonment. Empty = no notification e-mail (the status flip still occurs). |

Seeded by the module-lifecycle ManifestReconciler on backend boot (see
`packages/modules/carts/src/manifest.ts`).

## Merge-on-login

`cart-service.ts#mergeAnonymousIntoCustomer()` is invoked by the
`organizations` module's `onLogin` hook. Conflicting line items combine
quantities, and merged and moved lines take the price the customer may order
them at; the anonymous cart cookie is invalidated atomically. The source
anonymous cart's `status` flips to `'completed'` (not `'abandoned'`) so the
sweep does not later fire a stray abandonment notification for it.

## Abandonment sweep

`cart-abandonment-worker.ts` exposes a plain async `sweep(now?)` mirroring
the `RfqExpiryWorker` pattern. The sweep:

1. Reads `carts.abandonment.inactivity_minutes` (≤ 0 disables).
2. Selects `active` carts whose `last_activity_at < now - threshold` AND
   `abandonment_notified_at IS NULL` (idempotency).
3. Flips status to `abandoned`, stamps `abandonment_notified_at = now`.
4. Writes one `cart_audit_entries.abandonment_swept` row per affected cart.
5. Dispatches an e-mail to the configured recipient **only** for non-empty
   carts (empty carts flip status but suppress the notification per the
   spec edge case).
6. Notification dispatch failures do not roll back the status flip.

Reactivation: any buyer activity (touch, add/remove/qty/coupon) on an
`abandoned` cart returns it to `active` and clears
`abandonment_notified_at` so the next abandonment cycle can re-notify.

## Conversions

- **Cart → Quote Request**: `RfqService.createForCustomer` is reused; the
  cart's buyer-snapshotted unit prices are passed as each line's **reference
  price** (`options.lineReferencePrices`, stored in the quote line's
  `reference_unit_price` / `reference_currency`), not as a customer proposal:
  the resulting lines carry `desired_unit_price = null`, so the conversion also
  works for a customer who may not propose prices. Sales sees the cart price as
  the line's *price at request* on the admin quote-request screen. The source
  cart's items are deleted and the cart flips to `'completed'` with
  `converted_to_quote_request_id` set. A line in a packaging unit is sent with
  its `packagingUnitId`; a line whose unit has since been deleted is sent as
  plain pieces, with its piece quantity unchanged.
- **Quote Request → Cart**: adds the QR's items as one batch
  (`CartService.addItems`, see *Order minimums* below), priced from the price
  books like any other line. The QR's `desired_unit_price` is intentionally dropped — the
  buyer's current contractual prices are the source of truth. Unavailable /
  no-price / not-purchasable lines are skipped and returned in
  `droppedLines[]` with typed reasons; a line below a product's minimum is
  dropped with `below_minimum` and its `minimum` (it used to be reported as
  `no_price_in_customer_list`), and a product the buyer may no longer see with
  `not_purchasable`.
- **Accepted Quote Request → Cart** (`POST
  /api/v1/quote-requests/:id/convert-to-order`, owned by the Quote Requests
  module): the cart is cleared and seeded with the quote's lines at the
  **agreed** unit prices through `CartWritePort.replaceItemsForCustomer`, and
  remembers the quote it was seeded from in `source_quote_request_id`. Each
  line remembers the quantity its price was agreed for, and keeps the agreed
  price only at that quantity (see *Line prices*). Adding a line, removing one
  or changing a quantity keeps the mark; removing the last line, or seeding the cart again from
  another source (a reorder), clears the mark, and an order an administrator
  creates for the customer starts a new cart without it. The Orders module reads it at placement and decides whether the order
  may record the quote. The re-priced copy above sets no mark.
- **Shopping List → Cart**: delegated to the existing
  `ShoppingListService.convertToCart`; the carts module
  exposes a port that composition wires to it.

## Order minimums

The cart applies the catalogue's minimum order quantities — the product's
minimum in pieces and each packaging unit's minimum in units, counted over every
line of the product in the cart (the Catalog module's page defines both).

- **Add and edit** (`POST /api/v1/cart/items`, `PATCH /api/v1/cart/items/:itemId`)
  judge the cart as the change would leave it, after the existing quantity,
  product, channel and packaging-unit checks and before pricing. A change that
  leaves the line below a minimum is refused with
  `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or
  `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`; the message names the product and
  the minimum in the language the response is answered in (the request's
  `Accept-Language`, q-weights honoured, otherwise the channel's default
  language), and nothing is written. An edit to `0`
  and `DELETE` always remove the line. Editing a line whose product no longer
  exists answers `404 PRODUCT_NOT_FOUND`.
- **The cart view** (`GET /api/v1/cart`) gives each line `minOrderQuantity`
  (the product's minimum in pieces, `null` for none) and `belowMinimum`
  (`{ kind, minimum, packagingUnitName? }` when the line is below a minimum and
  not exempt, else `null`); the storefront flags such a line and blocks
  checkout. A line whose product record is gone is reported
  `unavailable: true` with `unavailableReason: 'not_purchasable'`. **If the
  catalogue cannot be read the view fails with a `5xx`** instead of answering
  a cart without these flags. The mini view (`?view=mini`) is unchanged.
- **Batch adds** — quote request → cart, shopping list → cart, quick order and
  the admin's and the external API's order creation — go through
  `CartWritePort.addItems`. It resolves every line first with the single add's
  checks: a line whose product is unknown, hidden from the buyer or not in the
  channel gets the unknown-product answer, with no name and no minimum. It then
  judges the resolved lines together with the cart — a product's lines in the
  batch are summed, so `A-red × 5 + A-blue × 5` meets a minimum of 10 — and adds
  only the lines that pass, reporting the rest. Lines already in the cart are
  never rejected. A caller asking for `throw` now fails **before anything is
  added** when a line cannot be resolved; one asking for `report` receives every
  failure as an outcome. A caller may also ask for a line below a minimum to
  refuse the whole batch before anything is written, and — for a customer — for
  the batch to replace the basket, which is then cleared only once the batch has
  passed: that is how admin order creation and the external order API leave a
  customer's basket untouched when they refuse a request. Before that clear, a
  batch that throws on a failed line also prices every line it is about to
  write, so a product with no price or one sold on request only refuses the
  request with the basket still intact. At most 200 lines per call.
- **A basket filled from an accepted quote request** keeps the quote's
  negotiated quantities: each line seeded from the quote is exempt from the
  minimums **while its quantity equals the quote's quantity** for that line
  — the quantity its agreed price holds at (`cart_items.agreed_quantity`).
  Changing it makes the line an ordinary
  line until it is set back to the quote's quantity, which is allowed even
  below the minimum. Lines added afterwards are checked as usual, and an exempt
  line's pieces still count toward the product's total when another line of
  that product is checked. The cart takes the basket's quote mark at face
  value; checkout and placement confirm the quote is still valid (the Orders
  module's page). Seeding the basket again — from another quote or a reorder
  — replaces it, and with it every earlier exemption.
- **Submit for approval** (`POST /api/v1/cart/submit-for-approval`) refuses a
  basket that could not be ordered, after the endpoint's existing refusals: a
  line whose product record is gone answers `404 PRODUCT_NOT_FOUND` with every
  such line's `cartItemIds`; a line below a minimum answers
  `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or
  `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, every offending line in
  `details.lines` with its `cartItemId`, in the language the response is answered
  in. Nothing is written and the cart stays `not_required`. Unlike the cart view,
  submit does not take the quote mark at face value: a quote-seeded line is
  exempt only once the Orders module confirms the quote is still valid — the
  buyer's organization's, `Approved`, not expired, not yet ordered, an agreed line
  still in the basket — the check the checkout preview makes. While the Quote
  Requests module is off nothing is exempt. A basket whose quote has lapsed is
  therefore refused at submit although the view does not flag it; the storefront
  shows the refusal's message.

## Coupon application

The carts module never owns promotion logic — it plumbs the buyer's coupon
code through `PromotionService.applyToCart(snapshot)`. The
`CartCouponService.apply(cart, code)` method:

1. Looks up the named `Promotion` row.
2. Runs the local pre-checks (existence, validity window, org match, min
   cart subtotal) and emits a typed `CouponDropReason` on the first failure.
3. If pre-checks pass, calls `applyToCart` and verifies the named promotion
   is in the returned `appliedPromotions[]`.
4. On success: writes `cart.applied_promotion_code = code`, audits
   `coupon_applied`, re-arms approval if needed.
5. On any failure: returns `{outcome: 'dropped', reason, shortfall?}` and
   does not change the cart.

`reevaluateOnRead(cart, items)` is intended to be called from the GET-cart
read path so a previously-applied code that no longer fits (e.g. cart fell
below min spend after a line removal) is silently dropped and the response
surfaces `couponDroppedThisRead`. Wiring into the read path is a follow-up.

## Extension points

- **Re-pricing-on-read** — `GET /api/v1/cart` prices every line through
  `CartPricingRecompute`, which runs `CartLinePricing.orderablePrices`; the
  result is kept in `CartRecomputeCache` (30 s Redis TTL), which every cart write
  invalidates. The mutation answers return the stored `unitPrice`.
- **Email dispatch** — submit-for-approval / approve / reject / abandonment
  e-mails are scaffolded in the service surfaces; dedicated templates are a
  follow-up.
- **Abandonment scheduler** — the worker is constructed in production
  composition but not yet wired to a cron / BullMQ schedule. The ops CLI
  `pnpm --filter backend run cart:abandonment-sweep` runs one tick by hand.
  It is a manifest-declared command the host runs, so it sweeps through the
  composition's own `cartAbandonmentWorker` — see
  `packages/modules/carts/src/backend/cli/abandonment-sweep.ts` for the body and
  the `cliCommands` export in `packages/modules/carts/src/manifest.ts` for the
  declaration.

## Audit retention

`cart_audit_entries` is the **per-cart action log** (line added/removed,
quantity changed, coupon applied/cleared/dropped, approval submitted /
approved / rejected, sweep marked the cart abandoned, conversion to /
from a Quote Request, conversion from a Shopping List). Every row also
lands in the platform-wide `audit_log_entries` table via
`CartAuditService.record`, so the carts table is the canonical
denormalised view used by the Org-Admin and platform-admin "Cart history"
panel.

Retention policy:

- **Never auto-purge `cart_audit_entries`.** Org admins and the platform
  admin rely on a complete history to defend approval decisions and
  reproduce buyer disputes. The table is append-only — services never
  `UPDATE` or `DELETE` rows.
- **Cart deletion cascade.** `cart_audit_entries.cart_id` is `ON DELETE
  CASCADE`. We do not currently delete carts in production; if a future
  GDPR / right-to-erasure workflow ever does, the audit trail follows.
  When that workflow lands, mirror the carts row plus its audit entries
  into a long-term audit-only archive table *before* the cascade fires —
  do not silently lose history.
- **Production data-purges must exclude `cart_audit_entries`.** Any
  scheduled job that prunes carts, customer accounts, or organizations
  for storage hygiene MUST either skip `cart_audit_entries` or archive
  it first. Reviewers: add this table to the exclusion list in
  `packages/modules/audit_logs/src/backend/retention-policy.ts` when that policy
  is introduced.
- **The platform-wide `audit_log_entries` table follows the audit_logs
  module's retention policy** (controlled outside this feature). The
  carts-side mirror in `cart_audit_entries` is the source of truth for
  the carts UI even when the platform-wide table has aged out.
