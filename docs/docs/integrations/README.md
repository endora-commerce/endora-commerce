---
sidebar_position: 1
title: Integrations
---

# Integrations

This page is for developers connecting an external system to the B2B Platform.
The platform exposes three integration mechanisms, each owned by an independent
backend module under `packages/modules/`:

- **API keys** — bearer-token authentication for outbound machine-to-machine
  calls into the platform's HTTP API. All key-authenticated capability is
  mounted on the dedicated **partner namespace `/api/v1/external/*`** — see
  [Partner API access](./api-access.md) for the full surface (catalog reads,
  bulk pricing, idempotent ordering).
- **Webhooks** — outbound HTTP POST notifications driven by the in-process
  event bus, signed with HMAC-SHA-256; subscriptions may be scoped to a
  single Organization.
- **Credentials** — encrypted vendor credentials (e.g. LLM API keys, mail
  provider secrets) managed in the Admin Panel and referenced by Settings —
  see [Credentials](../modules/credentials.md).

The live OpenAPI document at `GET /api/v1/_openapi.json` is the source of
truth for every endpoint described here. Schemas are generated from the Zod
contracts in `@endora-commerce/contracts`.

## Authenticating with an API key

Issue a key from **Admin Panel → API Keys → New Key**, choosing the scopes the
key is allowed to use and, optionally, an **Organization binding** (see
below). The full bearer token (`sk_live_…`) is shown **once**; only the last
four characters are stored after that. The platform stores the SHA-256 hash
of the token, never the token itself.

Every subsequent request authenticates with the standard `Authorization`
header:

```http
GET /api/v1/external/catalog/products?changedSince=2026-04-25T00:00:00Z HTTP/1.1
Host: api.example.com
Authorization: Bearer sk_live_REDACTED
```

Key-authenticated endpoints live on the `/api/v1/external/*` namespace. The
public storefront endpoints (`/api/v1/catalog/…`) and customer-session
endpoints (`/api/v1/orders…`) ignore bearer credentials entirely — a key
never changes their behaviour. Every `/api/v1/external/*` response carries
`Cache-Control: private, no-store` and must not be cached.

### Bound and unbound keys

A key is either **unbound** (a platform credential: PIM sync, channel-default
catalog reads) or **bound** to exactly one Organization + Sales Channel +
service Customer Account (with an optional expiry). A bound key acts on the
Organization's behalf: it sees the Organization's effective prices, is pinned
to its sales channel, and operates strictly within the Organization's
capability envelope — the same restrictions its own buyers have (payment and
delivery allow-lists, credit limit, suspension). The full per-surface matrix,
catalog-sync guidance, bulk pricing, and idempotent ordering are documented in
[Partner API access](./api-access.md).

### Scopes

A key is granted one or more scopes from the typed catalog: `catalog:read`,
`catalog:write` (unbound keys only), `orders:read`, `orders:write` (bound
keys only). When a request hits a route gated by
`requireApiKey('catalog:write')`, the platform:

1. Resolves the bearer token to its `ApiKey` row by SHA-256 hash.
2. Rejects revoked, expired, or unknown tokens with `401 UNAUTHORIZED`.
3. Compares the requested scope against the key's granted scopes.
4. If the scope is missing, responds with `403 API_KEY_OUT_OF_SCOPE` **and**
   writes an `audit_log_entries` row tagging the key (audit action
   `api_key.out_of_scope`).

Use the smallest scope set that lets the integration work; rotate keys when
team membership changes; revoke immediately on compromise.

### Errors

All API errors use the standard envelope:

```json
{
  "error": {
    "code": "API_KEY_OUT_OF_SCOPE",
    "message": "API key lacks the required scope: catalog:write.",
    "requestId": "req_…"
  }
}
```

The `requestId` corresponds to the `X-Request-Id` response header — quote it
in support tickets to make logs traceable.

## Subscribing to webhooks

Create a webhook subscription from **Admin Panel → Webhooks → New Webhook**
(or `POST /api/v1/admin/webhooks` with `integrations:manage` admin
permission). The platform generates a 64-character hex `secret` per
subscription; you receive it in the create response and **only then** — store
it in your secrets manager.

A webhook subscription declares:

- `url` — the receiver endpoint that will accept `POST` deliveries.
- `eventTypes[]` — versioned event names the receiver wants (e.g.
  `order.created.v1`, `order.status_changed.v1`). Only the names listed under
  *Available events* below are accepted; any other is refused with
  `422 WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`.
- `organizationId` — optional Organization scope. When set, the subscription
  receives only events attributed to that Organization (its orders, quote
  requests and credit limit); when omitted, the subscription is platform-wide
  and receives all matching events. Events without an Organization attribution
  — product events, for instance — are delivered to platform-wide
  subscriptions only (fail closed).

> **Delivery is now active for order events.** Subscriptions created before the
> delivery pipeline existed were accepted but `order.created.v1` /
> `order.status_changed.v1` deliveries were not dispatched. The delivery pipeline is now wired: any
> pre-existing subscription matching those event types starts receiving
> deliveries. Make sure your receiver is idempotent before upgrading.

### Delivery contract

Every delivery is a `POST` to the configured `url` with these headers:

| Header | Purpose |
| --- | --- |
| `Content-Type: application/json` | Body encoding. |
| `X-Webhook-Event-Id` | Stable UUID for the event (use it to deduplicate). |
| `X-Webhook-Event-Type` | The event name, e.g. `order.created.v1`. |
| `X-Webhook-Signature-256` | Lower-case hex HMAC-SHA-256 of the raw body, keyed with the subscription secret. |
| `X-Webhook-Attempt` | 1-based attempt counter for this delivery. |

The body is the event payload as defined in `@endora-commerce/contracts`. A `2xx`
response confirms receipt. Anything else (or a timeout > 10 s) is treated as
a failure and triggers a retry.

### Verifying the HMAC signature

Always verify the signature **before** parsing the body, using the raw bytes
exactly as received:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function isValidSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHeader, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

Use `timingSafeEqual` (or the equivalent in your language) to defeat timing
oracles. Never short-circuit on the first mismatched byte.

### Retry & dead-letter semantics

Outbound deliveries are processed by a BullMQ queue with exponential backoff:

- Up to **8 attempts** per delivery.
- Backoff starts at **1 s** and doubles each retry (1 s, 2 s, 4 s, …).
- Each attempt has a **10 s** timeout.
- After the final attempt, the delivery is marked `dead_lettered` in
  `webhook_deliveries`. The admin panel's "Failed Deliveries" view replays
  these on demand.

Receivers must be **idempotent**: deduplicate on `X-Webhook-Event-Id` so a
replayed delivery does not double-apply state changes. Webhook ordering is
not guaranteed across event types.

### Available events

An event is delivered to webhooks only when it is **bridged** to the delivery
queue. Being emitted on the in-process event bus is not enough: most events on
the bus are internal and are not delivered.

Two events are bridged by the `webhooks` module itself:

- `order.created.v1` — an order was placed.
- `order.status_changed.v1` — an order moved from one status to another. A
  cancellation is announced this way, with the new status in the payload; there
  is no separate cancellation event.

A module can contribute further event types of its own, which are delivered
while that module is switched on. The modules that do:

| Event | Contributed by | Announces | Payload, beside `eventId` and `occurredAt` |
| --- | --- | --- | --- |
| `product.created.v1` | `catalog` | A product was created, also by duplicating another. | `productId`, `sku` |
| `product.updated.v1` | `catalog` | A product was written, or one of its variants was created, changed or deleted. | `productId`, `changedFields` |
| `product.archived.v1` | `catalog` | A product's status moved to `inactive`. Sent after the `product.updated.v1` of the same write. | `productId` |
| `rfq.created.v1` | `quote_requests` | A customer submitted a quote request. | `rfqId`, `organizationId` |
| `rfq.expired.v1` | `quote_requests` | The expiry job moved a quote request to `Expired`. | `rfqId`, `organizationId` |
| `credit_limit.adjusted.v1` | `credit_limits` | An Organization's granted credit limit changed. | `organizationId`, `amount` |
| `crm.opportunity.status_changed.v1`, `crm.opportunity.created.v1`, `crm.opportunity.closed.v1` | `crm` | A sales opportunity changed status, was created, was won or lost. | See `packages/contracts/src/crm.ts`. |

What holds for all of them:

- **They carry identifiers, not content.** A product event names the product
  and, for an update, the *names* of the fields the write addressed — never a
  value, a price or a description. A quote-request event names the request and
  its Organization — no line, price, note or person. To act on one, read the
  object through the API with your own key's permissions.
  `credit_limit.adjusted.v1` is the one that carries a figure: `amount` is the
  granted limit **after** the change, as a number in the limit's own currency
  (the currency is not in the payload).
- **Who receives them.** A product belongs to the catalogue and not to an
  Organization, so product events reach platform-wide subscriptions only — a
  subscription bound to an Organization never receives one. Quote-request and
  credit-limit events belong to one Organization: they reach platform-wide
  subscriptions and the subscriptions bound to that Organization, and no
  subscription bound to another.
- **They follow the commit.** Each is sent for a write that was committed. A
  write that is refused, or fails while it is being saved, sends nothing.
- **One delivery per event per subscription, with no batching.** A bulk edit,
  an import or a PIM synchronisation writes products one by one, so a
  subscriber to `product.updated.v1` receives one delivery per product written
  and should expect bursts of thousands. An event type no subscription names
  enqueues nothing.

What is **not** delivered, and how to find it out today:

- **A product being deleted.** `product.deleted.v1` exists on the in-process
  event bus and is not offered to webhooks, and a deletion sends no
  `product.archived.v1`. The product simply stops being returned by the API;
  reconcile against a full listing if deletions matter to you.
- **A product being reactivated.** There is no un-archive event. A product
  leaving `inactive` sends `product.updated.v1` with `status` in
  `changedFields`, like any other status change; read the product to see which
  status it has now.
- **A quote request an administrator creates.** `rfq.created.v1` announces a
  customer's own submission only.
- **The first grant of a credit limit.** `credit_limit.adjusted.v1` is sent
  when an administrator adjusts a limit and when a settled return is credited
  to it.

`rfq.expired.v1` is sent by the quote-request expiry sweep and by nothing
else: it occurs only on an instance where that sweep runs.

The list for a running instance is what the subscription form offers:
the two built-in events plus the answer of
`GET /api/v1/admin/webhooks/event-types`. The built-in list is exported from
`@endora-commerce/contracts` as `WEBHOOK_BUILT_IN_EVENT_TYPES`, and it is the
same constant the backend bridges from, so the form cannot offer an event that
is not delivered.

A subscription may name only these events. `POST` and `PATCH` on
`/api/v1/admin/webhooks` refuse any other name with
`422 WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`, and `error.details.eventTypes` carries
the refused names. A subscription saved before this rule keeps the names it was
saved with: it is still listed and can still be edited, the Admin UI marks the
names that are not delivered, and it receives nothing for them.

The event's payload is sent whole. Every contributed event has a strict schema
in `@endora-commerce/contracts` — `CATALOG_WEBHOOK_EVENT_SCHEMAS`,
`QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS`, `CREDIT_LIMIT_WEBHOOK_EVENT_SCHEMAS` and
`CRM_WEBHOOK_EVENT_SCHEMAS` — which is the published shape. A field may be
added to a `.v1` payload; a field is never removed or renamed without a new
event version offered beside the old one.

## Vendor credentials

Third-party vendor credentials are owned by the **Credentials** module, not by
this surface. A credential configuration is an instance of a code-registered
configuration type; secret fields are encrypted at rest, write-only at the API
boundary, and referenced from Settings through the `credential_ref` value type.
Configure them at **Admin Panel → Credentials**. See
[Credentials](../modules/credentials.md).

Vendor-specific integrations (Stripe, TPay, PayU, Autopay, Google Analytics, newsletter
providers, VIES / Biała lista lookups) each ship as their own module with their
own settings and admin surface — there is no generic vendor-adapter registry.

## Operational checklist

Before enabling a new integration in production:

1. **Use scoped API keys.** Provision one key per integration; rotate on
   personnel change.
2. **Verify HMAC.** Reject any inbound webhook delivery that fails the
   signature check, even from a "trusted" sender.
3. **Be idempotent.** Persist `X-Webhook-Event-Id` and short-circuit
   replays.
4. **Monitor dead-letter.** Subscribe to the admin panel's failed-deliveries
   view; investigate every dead-lettered delivery before replaying.
5. **Stamp `requestId`.** When raising an issue, include the `X-Request-Id`
   header from the failing call.
