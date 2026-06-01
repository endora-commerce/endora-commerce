---
title: carts
---

# `carts`

Anonymous and customer-bound shopping carts. An anonymous cart is identified
by a long-lived cookie token; on login it merges into the Customer's cart
deterministically.

Feature 027 (Carts consolidation, May 2026) extended the foundation cart
module with a full lifecycle (`active` / `abandoned` / `completed` /
`rejected`), an orthogonal approval sub-state, sales-channel scoping,
last-activity bookkeeping, coupon application against the Promotions module,
up-sell suggestions, three conversions (Cart ↔ Quote Request, Shopping List
→ Cart), Organization-Administrator visibility + approval gate, an
abandonment sweep, and a platform-admin observability surface.

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
`approved` cart silently drops `approval_status` back to `pending` — see the
security invariant in `specs/027-carts/research.md` §R11.

Self-approval exemption: a cart created by an Organization Administrator
is born with `approval_status='not_required'` regardless of the per-Org
policy flag.

## Public surface

### Storefront (buyer)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/cart` | Active cart (lazy-create); feature-027 payload includes `status`, `approvalStatus`, `salesChannelId`, `grandTotal`, `discount`, `primaryCta`, `droppedLines`, `couponDroppedThisRead`, `lastActivityAt` |
| `POST /api/v1/cart/items` | Add line item (200-line cap enforced) |
| `PATCH /api/v1/cart/items/:itemId` | Update quantity (accepts `0` to delete) |
| `DELETE /api/v1/cart/items/:itemId` | Remove line |
| `POST /api/v1/cart/items/:itemId/save-to-shopping-list` | Push line to a Purchase List |
| `POST /api/v1/cart/touch` | Explicit page-open ping; bumps `last_activity_at` and reactivates an abandoned cart |
| `GET /api/v1/cart/upsells?limit=N` | Up-sell strip from Catalog `product_links` (kind = `up_sell`) |
| `POST /api/v1/cart/coupon` | Apply (or replace, or clear) the active coupon code; 422 `CART_COUPON_REJECTED` with reason on rejection |
| `DELETE /api/v1/cart/coupon` | Alias for `POST {code: null}` |
| `POST /api/v1/cart/convert-to-quote-request` | Cart → Quote Request; source cart becomes `completed` with `converted_to_quote_request_id` set |
| `POST /api/v1/cart/from-quote-request/:qrId` | Quote Request → Cart; lines re-priced from the customer's current price list |
| `POST /api/v1/cart/from-shopping-list/:listId` | Shopping List → Cart; lines re-priced |

### Storefront (Organization Administrator)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/organization/carts` | List every cart in the caller's Organization |
| `GET /api/v1/organization/carts/:id` | Detail (member-owned cart) |
| `PATCH /api/v1/organization/policies/cart-approval` | Toggle `requires_cart_approval` for the Organization |
| `POST /api/v1/cart/submit-for-approval` | Buyer submits cart for Org-Admin approval (no-op when policy off; refused for Org-Admins themselves) |
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
- `CartItem` (per-line with `unit_price` snapshot at add + cached
  `recomputed_*` columns).
- `CartAuditEntry` (typed per-cart feed; indexed on `(cart_id, occurred_at
  DESC)`). Every state transition also lands a row in the existing
  `audit_log_entries` table via `AuditLogService` for the platform-wide
  audit timeline.

## Settings (feature 027)

| Key | Default | Description |
| --- | --- | --- |
| `carts.abandonment.inactivity_minutes` | `10080` (7 days) | Minutes of inactivity before an `active` cart is considered `abandoned`. `0` disables the sweep. |
| `carts.abandonment.notification_recipient` | `""` (empty) | Single e-mail address to notify on abandonment. Empty = no notification e-mail (the status flip still occurs). |

Seeded by the module-lifecycle ManifestReconciler on backend boot (see
`backend/src/modules/carts/manifest.ts`).

## Merge-on-login

`cart-service.ts#mergeAnonymousIntoCustomer()` is invoked by the
`organizations` module's `onLogin` hook. Conflicting line items combine
quantities; the anonymous cart cookie is invalidated atomically. The source
anonymous cart's `status` flips to `'completed'` (not `'abandoned'`) so the
sweep does not later fire a stray abandonment notification for it.

## Abandonment sweep

`cart-abandonment-worker.ts` exposes a plain async `sweep(now?)` mirroring
the `RfqExpiryWorker` pattern from feature 008. The sweep:

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
  cart's buyer-snapshotted unit prices are carried over as
  `desired_unit_price` so sales sees the cart's reference price. The source
  cart's items are deleted and the cart flips to `'completed'` with
  `converted_to_quote_request_id` set.
- **Quote Request → Cart**: iterates the QR's items through
  `CartService.addItem`, which already routes through `PricingService` for
  re-pricing. The QR's `desired_unit_price` is intentionally dropped — the
  buyer's current contractual prices are the source of truth. Unavailable /
  no-price / not-purchasable lines are skipped and returned in
  `droppedLines[]` with typed reasons.
- **Shopping List → Cart**: delegated to the existing
  `ShoppingListService.convertToCart` (feature 010); the carts module
  exposes a port that composition wires to it.

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

- **Re-pricing-on-read** — `CartPricingRecompute` + `CartRecomputeCache`
  (30 s Redis TTL) exist and are tested but not yet wired into `GET
  /api/v1/cart`; the snapshotted `unit_price` is returned today.
- **Email dispatch** — submit-for-approval / approve / reject / abandonment
  e-mails are scaffolded in the service surfaces; dedicated templates are a
  follow-up.
- **Abandonment scheduler** — the worker is constructed in production
  composition but not yet wired to a cron / BullMQ schedule. The ops CLI
  `pnpm --filter backend run cart:abandonment-sweep` runs one tick by hand;
  see `backend/src/modules/carts/scripts/abandonment-sweep.ts`.

## Audit retention

`cart_audit_entries` is the **per-cart action log** (line added/removed,
quantity changed, coupon applied/cleared/dropped, approval submitted /
approved / rejected, sweep marked the cart abandoned, conversion to /
from a Quote Request, conversion from a Shopping List). Every row also
lands in the platform-wide `audit_log_entries` table via
`CartAuditService.record`, so the carts table is the canonical
denormalised view used by the Org-Admin and platform-admin "Cart history"
panel.

Retention policy (feature 027):

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
  `backend/src/modules/audit_logs/retention-policy.ts` when that policy
  is introduced.
- **The platform-wide `audit_log_entries` table follows the audit_logs
  module's retention policy** (controlled outside this feature). The
  carts-side mirror in `cart_audit_entries` is the source of truth for
  the carts UI even when the platform-wide table has aged out.
