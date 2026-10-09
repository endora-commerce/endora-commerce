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
| `POST /api/v1/admin/webhooks` | Create — secret returned once. `eventTypes` must be deliverable |
| `PATCH /api/v1/admin/webhooks/:id` | Update (status, eventTypes, url). Event types it adds must be deliverable |
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

## Which events are delivered

An event is delivered only when it is bridged to the delivery queue. This
module bridges two event types of its own accord, `order.created.v1` and
`order.status_changed.v1`; every other deliverable type is contributed by the
module that emits it (next section). An event that is merely emitted on the
in-process event bus is not delivered.

The two built-in names are one constant, `WEBHOOK_BUILT_IN_EVENT_TYPES` in
`@endora-commerce/contracts`. The backend subscribes its bridge from it and the
subscription form offers from it, so the form cannot offer an event that is not
delivered.

**A subscription may name only deliverable event types.** Creating a
subscription, or adding an event type to one, with a name that is neither
built in nor contributed by a module that is switched on is refused with
`422 WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`; `error.details.eventTypes` carries the
refused names.

**Subscriptions saved before this rule are kept as they are.** The rule is
applied when a subscription is written and only to the names that write adds:

- nothing is migrated or deleted, and listing never fails on a stored name;
- such a subscription can still be paused, renamed, re-pointed and deleted, and
  an `eventTypes` update may keep a name it already carries;
- a name that has been removed cannot be added back;
- the Webhooks screen shows every stored name and marks the ones that are not
  delivered;
- delivery is unaffected — a name nothing bridges receives nothing, as before.

## Event types contributed by other modules

Any other module can offer event types of its own through the
**`webhookEventRegistry`** — this module names no other module's event.

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
- **It is offered on the subscription form** — after the built-in types —
  and accepted by the API while its owner is switched on. `GET /api/v1/admin/webhooks/event-types`
  answers `{ "data": [{ "ownerModuleId", "eventType" }] }`.
- **While the owner is switched off** the type is not offered and a new
  subscription to it is refused. Subscriptions that name it are kept and
  receive nothing until the owner is back.
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
- **Subscription scope policy** — `webhook-service.ts` accepts any
  deliverable event type; layer authorization (e.g. only certain integrations
  may subscribe to one module's events) by injecting a policy callback.
