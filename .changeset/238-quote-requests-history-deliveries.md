---
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-i18n': minor
---

The admin *History* of a quote request lists the notifications each entry sent (issue #238,
`specs/179-rfq-and-customer-notifications/` WP-06).

- **API.** `GET /api/v1/admin/quote-requests/:id/history` now returns a `deliveries` array on
  every entry that has notification records. It still requires `rfqs:handle`. Each delivery has
  the recipient (kind, id, and a display name read when the History is loaded, or `''` once the
  person is gone), the channel, the status, the number of attempts, the last error and when it
  closed. An entry with no records has no `deliveries` key. The buyer's
  `GET /api/v1/quote-requests/:id` never returns any of this.
- **Admin screen.** Under such an entry, the History tab shows who was told, through which
  channel, and the outcome: sent, pending, failed, or skipped with the reason. A failed delivery
  shows its last error behind *Show error*.
- **Labels.** `rfq.detail.history.delivery.*` keys are added to the `core` bundle in English and
  Polish.

Until the delivery worker ships in a later release, every new record shows as *Pending*.
