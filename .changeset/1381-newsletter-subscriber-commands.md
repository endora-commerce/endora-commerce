---
'@endora-commerce/mod-newsletter': patch
---

Issue #1381: every newsletter subscriber write now runs as a Command on the Command Bus, so each write and its audit entry commit together. Before, the entry was written by hand after the change was saved (and, for a delete, before it), so a failure in between left a change with no entry, or an entry with no change.

- This covers subscribing and re-subscribing (storefront, account and admin), confirming, unsubscribing (link, account and admin), a bounce or complaint suppression, and deactivating and deleting a subscriber in the admin.
- The audit action names are unchanged: `newsletter_subscribe`, `newsletter_resubscribe`, `newsletter_confirm`, `newsletter_unsubscribe`, `newsletter_bounce`, `newsletter_complaint`, `newsletter_deactivate` and `newsletter_delete`. So is what an entry holds: the subscriber by id, the status, the source, a suppression's reason code and whether an unsubscribe gave a reason, never the e-mail address or the reason's text.
- An entry for a write made in the admin now names the operator who made it. A write made by a signed-in customer names that customer's account.
- HTTP responses and status codes are unchanged. One rare case is new: a write that races another request creating or deleting the same subscriber is refused with `409 VERSION_CONFLICT`, so its entry never names the wrong row.
