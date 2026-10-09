---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-credit-limits': minor
'@endora-commerce/mod-webhooks': minor
---

Six more events are delivered to webhooks: three product events, two quote-request events and the
credit-limit adjustment.

They were emitted on the in-process event bus and delivered to nobody. Each is now offered on the
Webhooks screen, accepted by the API and delivered, while the module that owns it is present:

| Event | Owner | Payload, beside `eventId` and `occurredAt` |
| --- | --- | --- |
| `product.created.v1` | `catalog` | `productId`, `sku` |
| `product.updated.v1` | `catalog` | `productId`, `changedFields` (field names only) |
| `product.archived.v1` | `catalog` | `productId` |
| `rfq.created.v1` | `quote_requests` | `rfqId`, `organizationId` |
| `rfq.expired.v1` | `quote_requests` | `rfqId`, `organizationId` |
| `credit_limit.adjusted.v1` | `credit_limits` | `organizationId`, `amount` (the granted limit after the change) |

**The owning module offers its own events.** `catalog`, `quote_requests` and `credit_limits` push
their event names into `webhooks`' `webhookEventRegistry` from a boot hook and declare the edge as
`contributes-to` — the mechanism `crm` already uses. `webhooks` names none of them, and its two
built-in types are unchanged. With `quote_requests` or `credit_limits` switched off, their types are
not offered and a new subscription to them is refused; stored subscriptions are kept and receive
nothing until the module is back.

**Who receives them.** Product events carry no `organizationId`, so they reach platform-wide
subscriptions only. Quote-request and credit-limit events reach platform-wide subscriptions and the
subscriptions bound to that Organization, never one bound to another.

**The payloads are published contracts.** `@endora-commerce/contracts` exports a strict schema for
each — `CATALOG_WEBHOOK_EVENT_SCHEMAS`, `QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS`,
`CREDIT_LIMIT_WEBHOOK_EVENT_SCHEMAS` — with the matching `*_WEBHOOK_EVENT_TYPES` and
`*_WEBHOOK_EVENTS` constants and one `…EventV1Schema` and type per event.

Three changes of behaviour in the owning modules:

- **`catalog` now emits `product.archived.v1` when a product's status moves to `inactive`.** The
  event was emitted only by a deprecated method nothing called, so no path an administrator, an
  import or a PIM synchronisation takes ever announced it. It is emitted once per transition, after
  the `product.updated.v1` of the same write. A subscriber on the in-process bus — the search
  indexer removes the product from the index on it — now receives it.
- **`rfq.expired.v1` carries `organizationId`.** Without it the event could reach no subscription
  bound to an Organization. An additive field.
- **`CreditLimitService` constructed without a Command Bus emits `credit_limit.adjusted.v1` after
  its transaction has committed**, not from inside it, so an adjustment whose commit fails is not
  announced. The composed module always has a Command Bus and was not affected.

**Volume.** Nothing is batched: a bulk edit, an import or a PIM synchronisation writes products one
by one, so a subscription to `product.updated.v1` receives one delivery per product written. An
event type no subscription names enqueues nothing.
