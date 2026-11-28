---
'@endora-commerce/mod-newsletter': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the newsletter subscribers attributed to the loser move to the survivor, in batches of the new audited, irreversible Command `newsletter_subscriber.merge_reassign`. Subscription status and consent are unchanged.
