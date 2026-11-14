---
'@endora-commerce/mod-quote-requests': minor
---

Quote request changes now reach the buyer's storefront notification centre (issue #238,
`specs/179-rfq-and-customer-notifications/` WP-08). A new delivery channel, `customer_in_app`,
writes one entry per recipient into the `customer_notifications` module through its published
`customerNotificationRecordPort`.

- **Who gets an entry.** The requester and every member of the request's Organization who may
  open it, at every change except completion. The buyer whose own action caused the change
  (submitting, re-submitting, accepting or rejecting an offer) gets the e-mail but no entry.
- **What it says.** One sentence that names the request by number only, with a link to the
  request's storefront page (`/quote-requests/<id>`). The sentence is stored in English and as
  the key `customerNotifications.<change>.title` of this module's bundle (new keys, en and pl),
  and the centre translates it into the language the buyer reads in.
- **Where it shows.** On the request's own sales channel only, or on every channel when the
  request has none. The entry belongs to the request's Organization.
- **Delivery.** The worker writes the entry in the delivery record's own transaction, so it is
  recorded exactly once. The 24-hour freshness window and the retry ladder are the same as for
  the other channels. A recipient who has been deleted, blocked or anonymised, has left the
  Organization or may no longer open the request is skipped (`skipped_no_recipient`).
- **Module off.** A new `degrades-without` edge on `customer_notifications`. While the centre is
  switched off, quote requests keep working and the record closes as `skipped_module_off`. No
  entry is written then or later, after the centre is switched back on.
