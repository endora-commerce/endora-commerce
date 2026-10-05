---
title: webhooks
description: Outbound HMAC-signed event subscriptions
---

# `webhooks`

Outbound HMAC-signed event subscriptions. Domain events on the in-process
event bus are bridged to a BullMQ queue; the worker signs and POSTs each
delivery to the subscriber URL.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/webhooks` | List subscriptions |
| `POST /api/v1/admin/webhooks` | Create — secret returned once |
| `PATCH /api/v1/admin/webhooks/:id` | Update (status, eventTypes, url) |
| `DELETE /api/v1/admin/webhooks/:id` | Remove |
| `GET /api/v1/admin/webhooks/deliveries` | Recent deliveries (filterable by status) |
| `POST /api/v1/admin/webhooks/deliveries/:id/replay` | Replay a `failed` / `dead_lettered` delivery |
| `GET /api/v1/admin/webhooks/event-types` | The event types other modules contribute, whose owner is switched on |

## Delivery contract

Headers: `Content-Type: application/json`,
`X-Webhook-Event-Id`, `X-Webhook-Event-Type`,
`X-Webhook-Signature-256`, `X-Webhook-Attempt`. Receivers MUST verify the
signature with `timingSafeEqual` and dedupe on the event id.
The *Subscribing to webhooks* section of Endora's Integrations guide carries the
verification example.

## Retry model

Up to 8 attempts per delivery, exponential backoff starting at 1 s, 10 s
per-attempt timeout. Final attempt → `dead_lettered`. The replay endpoint
copies a failed/dead-lettered row into a fresh `pending` delivery.

## Event types contributed by other modules

This module bridges two event types of its own accord, `order.created.v1` and
`order.status_changed.v1`. Any other module can offer event types of its own
through the **`webhookEventRegistry`** — this module names no other module's
event.

A contributing module pushes its event names from a boot hook that does nothing
else:

```ts
ctx.onBoot(() => {
  const registry = lazyPort<WebhookEventRegistryPort>(ctx, 'webhookEventRegistry');
  registry.register({ ownerModuleId: 'acme_loyalty', eventType: 'acme_loyalty.points_granted.v1' });
});
```

and declares the edge in its manifest:
`nonBindingDependencies: [{ moduleId: 'webhooks', name: 'webhookEventRegistry', kind: 'contributes-to' }]`.

What follows from a push:

- **The event type is bridged** to the delivery queue exactly as the built-in
  ones are — through this module's own subscription, so it stops when this
  module is switched off. **The event's payload is sent whole**, so an event a
  module offers is a public contract of that module.
- **It is offered on the subscription form** — after the form's own list —
  while its owner is switched on. `GET /api/v1/admin/webhooks/event-types`
  answers `{ "data": [{ "ownerModuleId", "eventType" }] }`.
- **While the owner is switched off** the type is not offered. Subscriptions
  that name it are kept and receive nothing until the owner is back.
- A subscription bound to one organization receives a contributed event only
  when its payload carries that `organizationId`.
- Pushing the same type twice, or a type this module already bridges, delivers
  once.

## Entities

`Webhook` (name, url, eventTypes, secret, status), `WebhookDelivery`
(per-attempt audit row).

## Extension points

- **Custom signing scheme** — `webhook-delivery-worker.ts#process` is the
  single place HMAC headers are set; replace with a different signature
  format or add a JWS variant here.
- **Subscription scope policy** — `webhook-service.ts#create` accepts any
  event type today; layer authorization (e.g. only certain integrations
  may subscribe to `payment.*`) by injecting a policy callback.
