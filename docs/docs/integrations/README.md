---
sidebar_position: 1
title: Integrations
---

# Integrations

This page is for developers connecting an external system to the B2B Platform.
The platform exposes three integration mechanisms, each owned by an independent
backend module under `backend/src/modules/`:

- **API keys** — bearer-token authentication for outbound machine-to-machine
  calls into the platform's HTTP API. All key-authenticated capability is
  mounted on the dedicated **partner namespace `/api/v1/external/*`** — see
  [Partner API access](./api-access.md) for the full surface (catalog reads,
  bulk pricing, idempotent ordering).
- **Webhooks** — outbound HTTP POST notifications driven by the in-process
  event bus, signed with HMAC-SHA-256; subscriptions may be scoped to a
  single Organization.
- **External integration configurations** — encrypted vendor credentials
  (e.g. payment gateway secrets, shipping carrier tokens) managed in the
  Admin Panel and consumed by per-vendor adapters.

The live OpenAPI document at `GET /api/v1/_openapi.json` is the source of
truth for every endpoint described here. Schemas are generated from the Zod
contracts in `@b2b/contracts`.

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
  `order.created.v1`, `rfq.accepted.v1`, `product.updated.v1`).
- `organizationId` — optional Organization scope. When set, the subscription
  receives only events attributed to that Organization (e.g. its orders);
  when omitted, the subscription is platform-wide and receives all matching
  events. Events without an Organization attribution are delivered to
  platform-wide subscriptions only (fail closed).

> **Delivery is now active for order events.** Subscriptions created before
> feature 062 were accepted but `order.created.v1` / `order.status_changed.v1`
> deliveries were not dispatched. The delivery pipeline is now wired: any
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

The body is the event payload as defined in `@b2b/contracts`. A `2xx`
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

The catalogue of stable events is the exhaustive list of strings emitted by
the in-process event bus and bridged to webhooks (`backend/src/events/`).
US-relevant examples:

- `product.created.v1`, `product.updated.v1`, `product.archived.v1`
- `rfq.created.v1`, `rfq.quoted.v1`, `rfq.accepted.v1`, `rfq.expired.v1`
- `order.created.v1`, `order.status_changed.v1`, `order.cancelled.v1`
- `payment.settled.v1`
- `credit_limit.adjusted.v1`, `credit_limit.reservation_released.v1`

Refer to `packages/contracts/src/*.ts` for the exact payload shape per
event.

## External integration configurations

When a Supplier hooks up a payment gateway, courier, or third-party CRM, its
credentials live in `external_integrations`. The configuration is encrypted
at rest and only readable through the per-vendor adapter that needs it.
Configure them at **Admin Panel → Integrations**.

Each integration has:

- `kind` — adapter family (`payment_gateway`, `shipping_carrier`,
  `analytics`, `crm`, …).
- `vendor` — concrete vendor identifier (e.g. `stripe`, `inpost`).
- `encryptedConfig` — opaque blob; decryption is encapsulated by the
  adapter, never returned over the API.
- `status` — `active` once the platform has run a successful test call;
  otherwise `inactive` with the last error message preserved.

Calling `POST /api/v1/admin/integrations` runs the adapter's `testConnection`
hook synchronously; the response surfaces success or the error envelope.

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
