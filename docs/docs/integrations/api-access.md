---
sidebar_position: 2
title: Partner API access
---

# Partner API access (`/api/v1/external/*`)

This page documents the platform's partner-facing HTTP surface: the dedicated
`/api/v1/external/*` namespace. It is the **only** namespace intended for
external partners (distributors, resellers, procurement systems) and the
partner-documentable scope of the live OpenAPI document
(`GET /api/v1/_openapi.json`). Public storefront endpoints
(`/api/v1/catalog/…`) and customer-session endpoints (`/api/v1/orders…`) are
not partner surfaces — they ignore API-key credentials entirely.

## Authentication

Every `/api/v1/external/*` request must carry an API-key bearer token:

```http
GET /api/v1/external/catalog/products?limit=50 HTTP/1.1
Host: api.example.com
Authorization: Bearer sk_live_REDACTED
```

- Anonymous requests receive `401 UNAUTHORIZED`.
- Revoked and **expired** keys receive `401 UNAUTHORIZED` everywhere.
- A key missing the required scope receives `403 API_KEY_OUT_OF_SCOPE`
  (audited).

Keys are issued in **Admin Panel → API Keys**. The token is shown once at
creation; only its SHA-256 hash is stored.

## The two key modes

| | Unbound key | Bound key |
|---|---|---|
| Identity | Platform credential (system context) | Acts **for one Organization** on one pinned Sales Channel via a designated service Customer Account |
| Typical use | PIM sync, feed generation | Distributor integration: org-priced catalog, ordering |
| Catalog reads | Channel-default prices; channel resolved from the `X-Sales-Channel` header / host / default | The Organization's effective prices, availability, and quantity price tiers; channel always the bound one |
| Bulk pricing / orders | Refused (`403 API_KEY_NOT_BOUND`) | Allowed with the matching scope |
| Allowed scopes | `catalog:read`, `catalog:write` | `catalog:read`, `orders:read`, `orders:write` (`catalog:write` is forbidden on bound keys) |
| Expiry | Optional `expiresAt` | Optional `expiresAt` |

The binding (Organization + Sales Channel + service Customer Account) is
**immutable** after creation — to rebind, revoke the key and issue a new one.
See [`api_keys` module docs](../modules/api_keys.md) for the creation rules.

### Scope catalog

| Scope | Unbound key | Bound key |
|---|---|---|
| `catalog:read` | External catalog reads (channel-default prices) + PIM attribute-set reads | External catalog reads (org prices) + bulk pricing |
| `catalog:write` | PIM by-SKU product upsert | Not grantable (creation rule) |
| `orders:read` | Not grantable without a binding | External order list/detail |
| `orders:write` | Not grantable without a binding | External order placement |

### Channel pinning (bound keys)

A bound key always operates on its bound sales channel. Sending an
`X-Sales-Channel` header naming a **different** channel is refused with
`403 API_KEY_CHANNEL_MISMATCH` (and audited). If the bound channel is
inactive, requests fail closed with the standard inactive-channel error — no
fallback.

## Caching rule (normative)

Every `/api/v1/external/*` response carries:

```http
Cache-Control: private, no-store
```

Responses are per-credential (org-specific prices, order data) and must never
enter a shared or persistent cache. Do not cache them on your side beyond the
lifetime of the request that produced them; re-fetch instead.

## Catalog reads

Gate: `catalog:read`.

- `GET /api/v1/external/catalog/products` — paginated list (`limit` 1–100,
  `cursor`), filters `categorySlug`, `q`, and `changedSince` (ISO 8601).
  Served from PostgreSQL deterministically (`x-search-backend: postgres`).
- `GET /api/v1/external/catalog/products/:idOrSlug` — detail; for bound keys
  includes `priceTiers` (the Organization's quantity-bracket ladder).
- `GET /api/v1/external/catalog/categories` — the resolved channel's category
  tree.

Bound callers see the bound channel's published assortment exactly as the
storefront does; products excluded from that channel are absent and their
detail URLs return `404` — indistinguishable from non-existence. Bound-caller
items additionally carry:

- `price` — the Organization's effective unit price at quantity 1, computed by
  the same pricing engine as the cart (`null` when unresolvable);
- `priceUnavailable: true` — marker when the org price could not be resolved;
- `availability` — `{ band, inStock }`.

### Incremental sync with `changedSince`

For a full export, paginate with `cursor` until exhaustion. For incremental
sync, poll with `changedSince=<last successful sync start>`. Always overlap
the windows: record the timestamp **before** a sync run starts and pass that
value on the next run, so updates that land while a run is in flight are never
skipped. Deduplicate on product id.

## Bulk pricing

Gate: `catalog:read`, **bound keys only**.

```http
POST /api/v1/external/catalog/prices
{ "lines": [ { "sku": "SKU-1", "quantity": 10 }, … ] }   // 1–200 lines
```

The response preserves line order. Each line resolves to either a priced entry
(`amount`, `currency`, `isSale`, `bracketStartQuantity`, `priceListId`) or
`price: null` with a `reason` of `sku_not_in_assortment` or
`price_unavailable`. Per-line misses are data, not errors — a basket always
gets a total answer. More than 200 lines is a `422 VALIDATION_FAILED`.

Guarantee: for any `(sku, quantity)` the returned amount equals what the cart
and order placement would charge the bound Organization on the bound channel
at that quantity, to the cent.

## Idempotent ordering

Gate: `orders:write`, bound keys only.

```http
POST /api/v1/external/orders
Idempotency-Key: acme-order-1001
{
  "lines": [ { "sku": "SKU-1", "quantity": 10 } ],
  "deliveryMethodId": "…", "paymentMethodId": "…",
  "deliveryAddressId": "…", "billingAddressId": "…",
  "customerReference": "PO-2026-0042"
}
```

- The `Idempotency-Key` header (1–128 chars) is **required**; missing ⇒
  `422 IDEMPOTENCY_KEY_REQUIRED`.
- Replaying the same key with the same payload — including concurrent
  replays — returns the **same order** (`200`); exactly one order is ever
  created.
- Reusing a key with a **different** payload ⇒ `409 IDEMPOTENCY_KEY_REUSED`.
- Addresses: pass existing organization address ids, or inline
  `deliveryAddress` / `billingAddress` objects.
- Per-line refusals are whole-order `422`s with per-line issues
  (`SKU_NOT_IN_ASSORTMENT`, `PRICE_UNAVAILABLE`); nothing is persisted.
- The success response (`201`) is the standard order envelope — the same shape
  customer sessions receive. Track orders with
  `GET /api/v1/external/orders` and `GET /api/v1/external/orders/:id`
  (`orders:read`); ids outside your visibility return `404`.

### The organization capability envelope

A bound key can never do more than the Organization's own buyers. The same
domain code path places the order, so every entitlement applies identically:
suspended organization ⇒ `423`; payment or delivery method outside the
organization's allow-list ⇒ the same refusal as customer checkout; credit
limit exceeded ⇒ the same credit-guard error; minimum order value, assortment,
warehouse strategy, and automatic promotions all behave exactly as in the
storefront. There is no override or bypass parameter.

## Webhooks (organization-scoped)

Order events are delivered to webhook subscriptions (see the
[Integrations overview](./README.md) for transport, HMAC verification, and
retry semantics). Two facts matter for partners:

- A subscription may be **scoped to one Organization** (set the optional
  Organization on the webhook form). Org-scoped subscriptions receive only
  that Organization's `order.created.v1` / `order.status_changed.v1` events;
  platform-wide subscriptions (no organization) receive all of them. An event
  without an organization attribution is never delivered to an org-scoped
  subscription (fail closed).
- **Delivery is now active.** Webhook subscriptions registered before this
  feature existed were accepted but order events were not dispatched. Since
  feature 062 the delivery pipeline is live: any pre-existing subscription
  matching `order.created.v1` or `order.status_changed.v1` starts receiving
  deliveries. Verify your receivers are idempotent before upgrading.

## Error vocabulary (partner surface)

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing, invalid, revoked, or expired key |
| `API_KEY_OUT_OF_SCOPE` | 403 | Key lacks the required scope (audited) |
| `API_KEY_NOT_BOUND` | 403 | Bound-only endpoint called with an unbound key |
| `API_KEY_CHANNEL_MISMATCH` | 403 | Bound key named a foreign sales channel |
| `IDEMPOTENCY_KEY_REQUIRED` | 422 | Missing `Idempotency-Key` on order placement |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same idempotency key, different payload |
| `SKU_NOT_IN_ASSORTMENT` | 422 (per line) | SKU absent from the bound channel's assortment |
| `PRICE_UNAVAILABLE` | 422 (per line) | No resolvable organization price |
| `STOCK_UNAVAILABLE` | 409 | Insufficient stock at placement |
| `FORBIDDEN` (`organization_cannot_transact`) | 423 | Organization suspended / cannot transact |
