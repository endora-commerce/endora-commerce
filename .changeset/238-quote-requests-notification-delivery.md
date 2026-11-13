---
'@endora-commerce/mod-quote-requests': minor
---

Quote request notifications are delivered (issue #238,
`specs/179-rfq-and-customer-notifications/` WP-05). Until now the records were written and
nothing read them. A new worker delivers them through the admin bell and e-mail, and every
outcome is stored on the record and shown on the request's *History*.

- **Worker.** It runs on the BullMQ queue `quote_requests.notifications.deliver`, on a schedule
  every minute and whenever a transition kicks it after committing. Each tick delivers up to 200
  due records. Each record is delivered in its own transaction, locked
  `for update skip locked`, so several worker processes can share the table. A tick with nothing
  due opens no system scope. The consumer is registered through `ctx.worker`, so while
  `quote_requests` is off nothing is delivered and the records stay `pending`.
- **Outcomes.** A record whose change is more than 24 hours old closes as `skipped_stale` and
  nothing is sent. A record whose channel's module is off closes as `skipped_module_off`. A
  recipient who no longer qualifies closes as `skipped_no_recipient`: an inactive administrator
  or one without `rfqs:handle`, or a deleted, blocked or anonymised account, one that left the
  Organization, or one that may no longer open the request. A failed attempt is retried after
  1 minute, 5 minutes, 30 minutes and 2 hours. The fifth failure closes the record as `failed`
  with its last error.
- **Admin bell.** Operators get a bell entry when a buyer submits or re-submits a request,
  accepts or rejects an offer, and when a request expires. The entry names the request by number
  only and links to its admin screen. It is written in the record's transaction, so it is
  recorded exactly once. The entry's title uses the new keys `notifications.<change>.title` (en,
  pl) of this module's bundle. A new `degrades-without` edge on `admin_notifications`: with the
  bell off, quote requests keep working and nobody gets a bell entry.
- **E-mail.** Eleven new operator-editable e-mails, in English and Polish, in the
  *Quote requests* group. The buyer side gets one at every change except completion:
  `quote_request_customer_submitted`, `_resubmitted`, `_offer_accepted`, `_offer_rejected`,
  `_expired`, `_prepared`, `_revised`, `_approved` and `_canceled`. These are written in the
  default language of the request's sales channel and link to the request on that channel's
  storefront address (`sales_channels.storefront_url`). Without a storefront address there is no
  link. The approval e-mail carries no PDF. Operators get `quote_request_operator_submitted` and
  `quote_request_operator_resubmitted`, in their preferred admin language, with no link for now.
  Each message uses the record's id as its message id, so a retry after a crash is refused by the
  transport as a duplicate. An e-mail switched off on the templates screen closes its records as
  `skipped_deactivated`. A platform with no mail server closes them as `skipped_no_transport` or
  `skipped_logged`.

**Behaviour change on upgrade.** All eleven e-mails are switched on by default. From this release
on, buyers and the operators who handle their requests are e-mailed about quote request changes.
Switch off any e-mail you do not want on the e-mail templates screen before upgrading. The
customer notification centre and push notifications follow in later releases.
