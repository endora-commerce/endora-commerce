---
'@endora-commerce/mod-newsletter': minor
---

`newsletter` declares three hookable actions on the subscriber, both phases each (issue #1843):
`newsletter.subscriber.subscribe`, `newsletter.subscriber.resubscribe` and
`newsletter.subscriber.confirm`. A module that lists `newsletter` in its `dependencies` can veto or
enrich a subscription inside its transaction, or react after it commits through the outbox.

**Behaviour change: the audit actions of these three writes are renamed.** The hook mechanism only
accepts dotted action names, so new entries are recorded as `newsletter.subscriber.subscribe`
(was `newsletter_subscribe`), `newsletter.subscriber.resubscribe` (was `newsletter_resubscribe`)
and `newsletter.subscriber.confirm` (was `newsletter_confirm`). Entries recorded before the upgrade
keep the old names. A report, an export or an integration that filters the audit log by these
action names must ask for both. The other newsletter audit actions are unchanged.

`NewsletterSubscriberService.confirm` now answers an unknown, malformed or already confirmed link
before it runs the Command, with the same results as before (`{ ok: false }`, `{ ok: true }`).
