---
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-webhooks': minor
'@endora-commerce/contracts': minor
---

More of the CRM backend, all under `/api/v1/admin/crm`.

**Quote requests and a computed value.**

- `POST /opportunities/:id/links` now takes `"documentKind": "quote_request"`. The quote
  request must belong to the opportunity's organization and to no other opportunity; it is
  listed with its number, status and value. An order placed from a linked quote request is
  linked to the same opportunity by itself (`linkSource: "quote_conversion"`).
- An opportunity in `valueMode: "computed"` carries the sum of its linked orders (at the
  order's gross total) and quote requests (at the net sum of quantity × unit price) whose
  status is a counting status. A document in another currency is left out and listed in
  `excludedDocuments` with `reason: "currency_mismatch"`.
- `PUT /value-counting-statuses` (`crm:configure`) sets which order statuses and quote request
  statuses count, answers **202**, and has every computed opportunity recalculated through the
  new `crm-value-recalculation` queue. Nothing counts until it is set.

**What an instance has to do:** nothing to keep working. A deployment that runs queue workers
gains one consumer, on `crm-value-recalculation`; the package now names `bullmq` and `ioredis`
as peers, which every instance already installs.

**The Quote Requests module is optional for CRM.** It is declared as an edge CRM degrades
without, so an operator can switch the quote desk off while CRM is on: linked quote requests
then show as unavailable and count for nothing, and linking one answers `503 MODULE_DISABLED`.

**Opportunities created automatically.** `crm.auto_create_from_orders` and
`crm.auto_create_from_quote_requests` now do what they say (both stay off by default): a
placed order, or a quote request a customer submits, gets an opportunity of its own — the
document's organization, the order's sales channel, the start status, the default assignee,
`source: "order" | "quote_request"`, a computed value — linked to it with
`linkSource: "auto"`. Never a second opportunity for one document, and an order placed from a
linked quote request joins that opportunity instead. `crm.opportunity.created.v1` now carries
the real `source`. The package names `zod` as a peer, which every instance already installs.

**Change history.** `GET /opportunities/:id/history` (`crm:read`; `limit`, `cursor`) answers
what was done to an opportunity, newest first — `{ id, actedAt, action, actor { kind, id,
name }, before, after }` — read from the platform's audit trail of that opportunity. It needs
no `audit_log:read`, is refused with 404 for an opportunity the caller may not see, and reaches
back 500 entries. `action` is the Command's own code; the label is `auditLog.<action>` in this
package's bundle.

**References to products and orders.** `[[product:<uuid>]]` and `[[order:<uuid>]]` in an
opportunity's `description` and in a note's or message's `body` are now resolved:
`references` beside each text — until now always `[]` — lists every product and order
mentioned, `{ type, id, available, label, url }`, with the product's current name or the
order's number. A target that is gone, or an order the reader may not see, is
`available: false` with no label and no URL. The text itself is stored and returned unchanged.

**Outbound webhooks for opportunity events, and a contribution seam in `mod-webhooks`.**

- **`@endora-commerce/mod-webhooks`** gains `webhookEventRegistry`
  (`WebhookEventRegistryPort`): a module pushes the event types it offers from a boot hook,
  each is bridged to the delivery queue through the webhooks module's own gated subscription,
  and `GET /api/v1/admin/webhooks/event-types` (`integrations:manage`) lists the contributed
  types whose owner is switched on. The subscription form offers them after its own list.
  Nothing changes for an instance in which nobody contributes: the two built-in event types
  and the form's own list are as they were.
- **`@endora-commerce/mod-crm`** contributes `crm.opportunity.created.v1`,
  `crm.opportunity.status_changed.v1` and `crm.opportunity.closed.v1`. The webhook payload is
  the event payload; no title, description, note or message is in any of the three.
- **`@endora-commerce/contracts`** gains `WebhookEventDescriptor` and
  `WebhookEventRegistryPort`, the strict schemas `OpportunityCreatedEventV1Schema`,
  `OpportunityStatusChangedEventV1Schema` and `OpportunityClosedEventV1Schema`, and
  `CRM_WEBHOOK_EVENT_TYPES` / `CRM_WEBHOOK_EVENT_SCHEMAS`. The three payload types
  (`OpportunityCreatedEvent`, `OpportunityStatusChangedEvent`, `OpportunityClosedEvent`) are
  now inferred from those schemas; their shape is unchanged.

**What an integrator has to do:** nothing unless they want the events — then subscribe to
them on the Webhooks screen. A `.v1` event keeps its fields; a removal or a rename would be a
`.v2` event offered beside it.
