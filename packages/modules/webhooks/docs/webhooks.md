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

## Delivery contract

Headers: `Content-Type: application/json`,
`X-Webhook-Event-Id`, `X-Webhook-Event-Type`,
`X-Webhook-Signature-256`, `X-Webhook-Attempt`. Receivers MUST verify the
signature with `timingSafeEqual` and dedupe on the event id.
See [Integrations → Subscribing to webhooks](../integrations/) for the
verification example.

## Retry model

Up to 8 attempts per delivery, exponential backoff starting at 1 s, 10 s
per-attempt timeout. Final attempt → `dead_lettered`. The replay endpoint
copies a failed/dead-lettered row into a fresh `pending` delivery.

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
