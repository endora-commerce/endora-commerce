---
'@endora-commerce/mod-webhooks': minor
'@endora-commerce/contracts': minor
---

The Webhooks screen offers only event types that are delivered, and the API refuses the rest.

The subscription form offered thirteen event types while the backend delivered two of them,
`order.created.v1` and `order.status_changed.v1`. A subscription to any of the other eleven was
saved without complaint and never received anything, and the API accepted any non-empty string, a
misspelled name included.

**Breaking for API clients.** `POST /api/v1/admin/webhooks` and
`PATCH /api/v1/admin/webhooks/:id` now answer `422` with the new error code
`WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE` when `eventTypes` names an event type that is neither built in
nor contributed by a module that is switched on; `error.details.eventTypes` carries the refused
names. A client that sent other strings must send only the names the screen offers: the two above,
plus the answer of `GET /api/v1/admin/webhooks/event-types`. The request schema's shape is
unchanged.

**Subscriptions that already exist are untouched.** There is no migration. A stored subscription
that carries a name nothing delivers is still listed, can still be paused, renamed, re-pointed and
deleted, and may keep that name through an `eventTypes` update — only a name a write *adds* is
checked. The screen marks such names as not delivered. They receive nothing, as they did before.

`@endora-commerce/contracts` exports the list both sides now read:
`WEBHOOK_BUILT_IN_EVENT_TYPES`, the `WebhookBuiltInEventType` type,
`deliverableWebhookEventTypes(contributed)` and `ERROR_CODES.WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`.
The backend subscribes its delivery bridge from the constant and the form offers from it, so the
two cannot drift apart again. A module that wants its events delivered contributes them through
`webhookEventRegistry`, as before.

No event type is delivered that was not delivered before, and none stopped being delivered.
