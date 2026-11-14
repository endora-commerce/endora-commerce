---
'@endora-commerce/mod-quote-requests': minor
---

Quote request changes now push to the buyer's devices (issue #238, `specs/179-rfq-and-customer-notifications/` WP-10). A new delivery channel, `customer_push`, goes through `pwa`'s published `customerPushPort`. It is the last channel of the notification matrix to get a delivery, so every channel is now recorded.

- **Who gets a push.** The requester and every member of the request's Organization who may open it, at every change except completion. These are the same people the customer e-mail and the notification centre reach. The buyer whose own action caused the change (submitting, re-submitting, accepting or rejecting an offer) gets the e-mail but no push.
- **What it says.** The title is the new bundle key `customerPush.title` ("Quote request update", en and pl). The body is the notification centre's sentence, `customerNotifications.<change>.title`, which names the request by number only. Both are rendered in the request's sales channel default language, or the system default channel's for a request raised with none (Polish or English; English for any other language). The push opens `/quote-requests/<id>`.
- **Delivery.** The worker re-checks the recipient as it does for the centre. It then hands `pwa` the push with the delivery record's id as the idempotency key, so a retry after a crash writes no second push. `pwa`'s answer closes the record: `sent`; `skipped_preference` (quote updates turned off); `skipped_no_subscription` (no device on the channel); `skipped_no_recipient` (account gone); `skipped_deactivated` (push or quote pushes switched off for the channel). The 24-hour freshness window and the retry ladder are the same as for the other channels. The History shows each push's outcome.
- **Module off.** A new `degrades-without` edge on `pwa`. While `pwa` is switched off, quote requests keep working and the record closes as `skipped_module_off`. No push is sent then or later, after `pwa` is back.
