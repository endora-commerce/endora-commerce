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
→ Cart), an approval gate judged by the members' organization roles, an
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
        │                                            ├──(approver      │
        │                                            │   approve)──▶   │
        │                                            │  [ active /     │
        │                                            │   approved ]    │
        │                                            │     │           │
        │                                            ▼     ▼           │
        │  (approver reject)                   [ rejected / rejected_by_org_admin ]
        │
        ▼
[ abandoned ] ◀──(sweep: last_activity_at < threshold)── [ active / * ]
        │                                                      ▲
        │                                                      │
        └────────────────(any buyer activity)──────────────────┘

[ active / approved ]    ──(checkout success)──▶ [ completed / approved ]
[ active / * ]           ──(Cart→QR conversion)─▶ [ completed / *; converted_to_quote_request_id set ]

[ working ]              ──(order placed)───────▶ [ completed; completed_order_id set ]
[ working ]              ──(placement refused)──▶ (deleted)
```

**Working baskets.** Admin order creation, one-click buy and the external order
API place an order from the lines of the request, not from what the buyer has
collected. They write those lines into a separate basket in status `working`
and place the order from it; the customer's active basket — including one
filled from an accepted quote request — is not read, emptied or closed. A
working basket ends `completed` with `completed_order_id` naming its order, or
is deleted when the placement is refused. It never appears in a cart list, in
the customer's carts panel or in the abandonment sweep.

Re-arm rule: any buyer-driven content change (a line added or removed, a
quantity changed, a coupon applied or removed) on a cart that is in approval
moves it back one step, in the same transaction as the change and with an
`approval_resubmission_required` audit entry:

- an `approved` cart drops back to `pending`, so the changed basket is approved
  again before it is ordered;
- a `pending` cart returns to `not_required` — the state it was submitted from —
  so the approver never approves contents other than those submitted. It
  leaves the approvers' pending list, approving or rejecting it answers
  `CART_APPROVAL_NOT_PENDING`, and the buyer is offered **Submit for approval**
  (`primaryCta: 'submit_for_approval'`) again.

A rejected cart is closed (`status: 'rejected'`) and cannot be submitted again,
so a `pending` cart was always submitted from `not_required`.

### Approval by role

Whether a basket must be approved, who approves it and who may fill one at all
are three permissions of the member's organization role (the Organization's
administrator edits the roles on the storefront; *Administrator* holds every
permission):

| Permission | Code | Default for *Member* | What it decides |
| --- | --- | --- | --- |
| Create and edit carts | `carts.create` | yes | Adding, changing and removing lines, applying and removing a coupon, building a basket from a quote request, a shopping list or quick order, and merging a guest basket at sign-in |
| Approve and reject colleagues' carts | `carts.approve` | no | Listing and reading the Organization's carts, and approving or rejecting the ones sent for approval |
| Place orders without approval | `carts.order_without_approval` | yes | Ordering a basket directly; a member whose role lacks it sends the basket for approval first |

These replace the Organization's *Cart approval* switch: an Organization that had
it on keeps the same behaviour after the upgrade, because its *Member* role does
not receive *Place orders without approval* (nor *One-click ordering*). To
require approval for some members only, give them a role without
*Place orders without approval*.

- A member without *Create and edit carts* is refused every basket change with
  `403 ORGANIZATION_PERMISSION_REQUIRED`, naming the permission; reading the
  basket (`GET /api/v1/cart`) still works, so page headers keep their basket
  count. A visitor who is not signed in keeps the guest basket exactly as
  before. When such a member signs in, their guest basket is **not** merged —
  it stays as it was, with its lines — and the sign-in itself succeeds.
- A member without *Place orders without approval* reads
  `primaryCta: 'submit_for_approval'` on a basket not yet sent,
  `awaiting_approval` on a sent one and `checkout` on an approved one; everyone
  else reads `checkout`. Sending a basket for approval when the role holds the
  permission is refused with `422 CART_APPROVAL_NOT_REQUIRED` (an administrator
  included).
- A holder of *Approve and reject colleagues' carts* lists, reads, approves and
  rejects the baskets of every member of their own Organization, as an
  administrator did before; the member who owns an approved basket places the
  order from it. A basket of another Organization answers `404`, as an unknown
  one does; a member without the permission is refused with
  `403 ORGANIZATION_PERMISSION_REQUIRED`. A basket that is not awaiting approval
  is `422 CART_APPROVAL_NOT_PENDING` whoever owns it, and nobody approves or
  rejects their own pending basket: `422 CART_APPROVAL_SELF_APPROVE`.
- When a role gains *Place orders without approval*, or a member moves to a role
  that holds it, the member's baskets awaiting approval return to
  `not_required` (audited as `approval_policy_reset`). A role losing it leaves
  an approved basket approved.

What the buyer sees on the storefront follows the same three permissions. A
signed-in member without *Create and edit carts* is offered no add-to-cart on
the product page, the product cards or the comparison page; their cart page
shows the lines without quantity controls, remove buttons or coupon field, and
says why in one line: *"Your role does not allow changing the cart. You can
still view it and order it."* A signed-out visitor is offered all of it, as
before. *Save to list* on a cart line follows `shopping_lists.create`, and
*Convert to quote request* `quote_requests.create`. A member without *Place
orders without approval* sees *"Your role requires approval of this cart before
checkout."* and a **Submit for approval** button in place of checkout; once the basket is sent the cart says it is
awaiting approval in the organization, and after a rejection it names *an
approver in your organization*.

The approver works under **Carts to approve** in the account navigation (shown
to holders of *Approve and reject colleagues' carts*, with the number of carts
waiting; never in a personal Organization), which opens
`/organization/carts` on the carts awaiting approval. The list can be narrowed to the carts awaiting
approval, and each cart opens on its own page (`/organization/carts/<id>`) with
its owner, lines, total and the time it was sent. A pending cart offers
**Approve cart**, and **Reject cart** behind a disclosure, which needs a reason
of up to 2000 characters. The page confirms the answer, or names the refusal —
for example a cart that was answered meanwhile (`CART_APPROVAL_NOT_PENDING`).

What the buyer is told after a rejection: a rejection closes the basket
(`status = 'rejected'`), so the buyer's next read is a new, empty basket whose
own `approvalStatus` cannot say it was rejected. The cart answer therefore
carries `previousRejection` — `{ cartId, rejectedAt, reason }` of the buyer's
most recent rejected basket on that sales channel — and the storefront's cart
page shows it, with the reason. It is answered while the current basket has not
been sent for approval and no basket of the buyer's on the channel has been
ordered (or converted to a quote request) since the rejection; otherwise, and
for an anonymous basket, it is `null`.

The new basket starts with the rejected basket's lines (issue #755): product,
variant, packaging unit and quantity, each added as the member would add it now
— checked for availability on the channel and priced afresh. A line that can no
longer be bought is skipped. `previousRejection` says what happened:
`restoredLineCount` lines were restored, and `skippedLines` names the skipped
ones with their reason; the storefront's notice says the items were restored and
lists the skipped ones. The restore happens once, into the basket opened after
the rejection, and is audited on it (`lines_restored_from_rejection`, beside the
usual `line_added` rows). It never touches a basket that already exists, it does
not re-run after the member empties the restored basket, and it does not carry
the coupon over — the member applies it again. A member whose role no longer
holds *Create and edit carts* (`carts.create`) gets nothing restored, and is
still told about the rejection. The rejected basket itself is left as it was.

Placement enforces the approval: a member's basket that is not `approved` —
never sent, awaiting an approver, or rejected — is refused when the order is
placed, with `409 ORDER_CART_APPROVAL_REQUIRED`, before anything is reserved or
written; the basket is kept as it was. The rule is the one submission applies,
read when the order is placed: the basket's owner lacks *Place orders without
approval*. This holds whatever the storefront shows, for
`POST /api/v1/orders` and the checkout page alike. The Orders module page,
under *Cart approval at placement*, lists the sentences.

### Approval e-mails

Each approval step sends an e-mail, after the step has been saved:

| E-mail (template code) | Sent when | To |
| --- | --- | --- |
| Cart sent for approval (`cart_approval_requested`) | A member sends a basket for approval | Every member of the Organization whose role holds *Approve and reject colleagues' carts* (administrators included) — one message each, never the sender. A blocked, deleted or anonymised member is not told. |
| Cart approved (`cart_approved`) | An approver approves the basket | The member who owns the basket, naming who approved it |
| Cart rejected (`cart_rejected`) | An approver rejects the basket | The member who owns the basket, with the reason the approver gave |

- The messages are written in the default language of the store (sales channel)
  the basket belongs to, and in English when the store has none. A customer
  account does not record a language of its own, so the store's language is
  the one the platform knows for its reader.
- The subject and body of each message ship in English and Polish and can be
  edited per language and per store, or switched off, on the e-mail templates
  screen (group *carts*). The messages carry no link: the reader signs in to
  their account to act — an approver under **Carts to approve**
  (`/organization/carts`), a buyer on their cart page.
- A message that cannot be sent — no mail server, the template switched off,
  the recipient's mail server refusing it — never undoes or fails the approval
  step. It is written to the server log as *"the cart approval e-mail was not
  sent"*, with the cart, the template code and the reason.

## Public surface

### Storefront (buyer)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/cart` | The active cart of the request's sales channel (lazy-create); the payload includes `status`, `approvalStatus`, `salesChannelId`, `grandTotal`, `discount`, `primaryCta`, `droppedLines`, `couponDroppedThisRead`, `lastActivityAt`, `previousRejection`. Not gated by any permission |
| `POST /api/v1/cart/items` | Add line item (200-line cap enforced) — `carts.create` for a signed-in member; a guest is not judged |
| `PATCH /api/v1/cart/items/:itemId` | Update quantity (accepts `0` to delete) — as above |
| `DELETE /api/v1/cart/items/:itemId` | Remove line — as above |
| `POST /api/v1/cart/items/:itemId/save-to-shopping-list` | Push line to a Purchase List — `shopping_lists.create` |
| `POST /api/v1/cart/touch` | Explicit page-open ping; bumps `last_activity_at` and reactivates an abandoned cart |
| `GET /api/v1/cart/upsells?limit=N` | Up-sell strip from Catalog `product_links` (kind = `up_sell`) |
| `POST /api/v1/cart/coupon` | Apply (or replace, or clear) the active coupon code; 422 `CART_COUPON_REJECTED` with reason on rejection — `carts.create` for a signed-in member; a guest is not judged |
| `DELETE /api/v1/cart/coupon` | Alias for `POST {code: null}` — as above |
| `POST /api/v1/cart/convert-to-quote-request` | Cart → Quote Request; source cart becomes `completed` with `converted_to_quote_request_id` set — `quote_requests.create` |
| `POST /api/v1/cart/from-quote-request/:qrId` | Quote Request → Cart; lines re-priced at the customer's current prices — `carts.create` |
| `POST /api/v1/cart/from-shopping-list/:listId` | Shopping List → Cart; lines re-priced — `shopping_lists.convert`, judged first, and `carts.create` |
| `POST /api/v1/cart/submit-for-approval` | Buyer submits cart for approval. Refused with `422 CART_APPROVAL_NOT_REQUIRED` when the buyer's role holds `carts.order_without_approval`, `422 CART_APPROVAL_ALREADY_SUBMITTED` for a cart already sent, and for a basket below a minimum — see *Order minimums* |

A refusal for a missing permission is `403 ORGANIZATION_PERMISSION_REQUIRED`,
naming the permission in `details.permission` and its translated name in
`details.permissionLabel`.

### Storefront (approvers)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/organization/carts` | List every cart in the caller's Organization |
| `GET /api/v1/organization/carts/:id` | Detail of a member's cart, with its lines (`items`: name, SKU, quantity, unit price and line total as stored) |
| `POST /api/v1/organization/carts/:id/approve` | Approve a pending cart; a cart not awaiting approval is `422 CART_APPROVAL_NOT_PENDING`, one's own pending cart `422 CART_APPROVAL_SELF_APPROVE` |
| `POST /api/v1/organization/carts/:id/reject` | Reject a pending cart with a required reason; refused as approve is |

Gate: the organization permission `carts.approve` on every `organization/*`
route. Foreign-organization carts return 404 (anti-enumeration symmetry). The
Organization's *Cart approval* switch (`PATCH /api/v1/organization/policies/cart-approval`)
and its operator proxy (`GET`/`PATCH /api/v1/admin/organizations/:id/cart-approval-policy`,
with the panel on the admin's organization detail) are removed: approval is
decided by the roles.

### Admin

| Verb + Path | Capability | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/carts` | `carts:read` | Paginated platform-wide list (status / approvalStatus / org / customer / channel / date filters) |
| `GET /api/v1/admin/carts/:id` | `carts:read` | Read-only cart detail |
| `GET /api/v1/admin/carts/:id/audit` | `carts:read` | Cart-detail audit feed |
| `POST /api/v1/admin/carts/:id/reject` | `carts:reject` | Emergency terminal reject (requires reason); a completed or rejected cart is `422 CART_ALREADY_TERMINAL` |

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
- The unit price is stored **at four decimal places, unrounded** (`numeric(14,4)`, as the price
  book holds it): a screw at 0.0125 is carried as 0.0125, not 0.01. Only the line's value — the unit
  price × the quantity — is rounded to two places, half-up, once: 10 000 of them are 125.00. A line
  added before release 0.108.0 carries a two-place price and is repriced before placement when the
  current price has more places.
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

A member whose role lacks *Create and edit carts* (`carts.create`) is not
merged: the outcome is `skipped_permission`, no line moves, nothing is audited,
and the guest basket stays `active` with its token and its lines. The sign-in
succeeds and reports no merge.

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
  another source (a reorder), clears the mark. An order an administrator
  creates for the customer leaves the basket and its mark alone (see *Working
  baskets*). The Orders module reads it at placement and decides whether the order
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
  `unavailable: true` with `unavailableReason: 'not_purchasable'`. So is a line
  whose product is no longer available at the basket's sales channel and
  language (switched off there, outside its publication window or outside the
  channel's audience); such a line keeps its `productName` and `productSku`, so
  the buyer can tell which line it is, and has `productSlug: null` — the
  storefront shows it without a link, because its product page answers
  `404` there. Placing the order still refuses it. **If the
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
  the batch to go into a new working basket instead of the active one (see
  *Working baskets*), which is created only once the batch has passed and
  deleted again if writing a line fails: that is how admin order creation,
  one-click buy and the external order API place an order without touching the
  customer's basket. Before the working basket is created, the batch also
  prices every line it is about to write, so a product with no price or one
  sold on request only refuses the request with nothing written. At most 200
  lines per call.
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
- **Email dispatch** — the submit-for-approval / approve / reject e-mails go
  out through `transactional_emails` (see *Approval e-mails*). The abandonment
  e-mail is the `cartAbandonmentNotifier` contribution point, which a
  deployment supplies; without one the sweep flips the status and sends
  nothing.
- **Abandonment scheduler** — the worker is constructed in production
  composition but not yet wired to a cron / BullMQ schedule. The ops CLI
  `pnpm run cli carts abandonment-sweep`, run in the root of an instance, runs
  one tick by hand; in a checkout of the Endora Commerce repository it is
  `pnpm --filter backend run cart:abandonment-sweep`.
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
