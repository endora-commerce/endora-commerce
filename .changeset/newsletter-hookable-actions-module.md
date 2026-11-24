---
'@endora-commerce/mod-newsletter': minor
---

`newsletter` declares three hookable actions on the subscriber, both phases each (issue #1843):
`newsletter_subscriber.subscribe`, `newsletter_subscriber.resubscribe` and
`newsletter_subscriber.confirm`. A module that lists `newsletter` in its `dependencies` can veto or
enrich a subscription inside its transaction, or react after it commits through the outbox. Hook
only `subscribe` to act on a first-time sign-up; `resubscribe` is a known address signing up again.

**Breaking change: every newsletter subscriber and suppression audit action is renamed.** The hook
mechanism only accepts dotted action names, so all eight now follow the module's
`<objectType>.<verb>` shape (as `newsletter_campaign.create` already does). This supersedes the
0.112.0 entry for issue #1381 that said "the audit action names are unchanged".

| Before | After |
| --- | --- |
| `newsletter_subscribe` | `newsletter_subscriber.subscribe` |
| `newsletter_resubscribe` | `newsletter_subscriber.resubscribe` |
| `newsletter_confirm` | `newsletter_subscriber.confirm` |
| `newsletter_unsubscribe` | `newsletter_subscriber.unsubscribe` |
| `newsletter_deactivate` | `newsletter_subscriber.deactivate` |
| `newsletter_delete` | `newsletter_subscriber.delete` |
| `newsletter_bounce` | `newsletter_suppression.bounce` |
| `newsletter_complaint` | `newsletter_suppression.complaint` |

Entries recorded before the upgrade keep the old names: the audit log is not rewritten and there is
no alias. A report, an export, a saved filter or an integration that selects audit entries by these
action names must ask for both the old and the new name. A bounce or complaint is recorded as
`newsletter_suppression.*` whether the entry names the subscriber or the suppression row.

`NewsletterSubscriberService.confirm` now answers an unknown, malformed or already confirmed link
before it runs the Command, with the same results as before (`{ ok: false }`, `{ ok: true }`).
