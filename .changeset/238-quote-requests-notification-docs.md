---
'@endora-commerce/mod-quote-requests': patch
---

The module page's *Notifications* section now documents what is delivered, to whom and when
(issue #238, `specs/179-rfq-and-customer-notifications/` WP-11), in English and Polish: the two
recipient sides, the change-by-channel table, what each channel carries, the eleven e-mails and
their variables, the 24-hour freshness limit, retries, switched-off e-mails and modules, the
deliveries on the request's *History*, and the recording and delivery worker for developers. The
*Background jobs*, *Data model*, *History* and *Conversion to order* sections are brought in line:
a completed request notifies nobody, and `quote_request_notifications` replaces
`quote_request_notification_events`.

**Upgrading to the release that ships quote request notification delivery** (the changes of
#238 taken together):

- The migration `20261113T081826_quote_requests_notifications_redesign.ts` drops
  `quote_request_notification_events` and **discards its rows**. Nothing ever delivered them, and
  none would still be sent under the 24-hour limit. Its `down()` re-creates the old table, empty.
- **Eleven new e-mails are switched on by default** — nine to the buyer side
  (`quote_request_customer_submitted`, `_resubmitted`, `_offer_accepted`, `_offer_rejected`,
  `_expired`, `_prepared`, `_revised`, `_approved`, `_canceled`) and two to operators
  (`quote_request_operator_submitted`, `_resubmitted`). From the first change after the upgrade,
  buyers and the operators who handle their requests are e-mailed. Switch off any you do not want
  on the e-mail templates screen. Bell entries, storefront notification centre entries and quote
  pushes start at the same time, each subject to its own module being on.
- The other #238 entries in these release notes were written one work package at a time; where
  one says that delivery, the notification centre or push "follows in a later release", read it as
  the order the work landed in. They all ship in this release.
- The buyer side's links point at `sales_channels.storefront_url`; set it per channel, or the
  e-mails go out without a link.

**Follow-up, not in this release:** the two operator e-mails, `quote_request_operator_submitted`
and `quote_request_operator_resubmitted`, carry no link to the request in the Admin UI. They name
the request number, and the bell entry carries the link. The platform now offers the Admin UI's
address (`ADMIN_BASE_URL`, read through `configuredAdminBaseUrl()`, issue #185), and the `crm` and
`tasks` e-mails already use it. Adding the same link (`quote.adminUrl`) to these two e-mails is the
next step.
