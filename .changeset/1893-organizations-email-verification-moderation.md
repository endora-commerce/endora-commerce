---
'@endora-commerce/mod-organizations': patch
---

Verifying the first user's e-mail address no longer activates the Organization (issue #1893). It used to set the status to `active` whatever `organizations.moderation.mode` said and whatever the current status was, so under `manual` moderation a self-registered organization could trade before an operator approved it, and a click within the token's 48 hours revived an organization the operator had rejected or blocked. The verification now stamps the account and consumes the token only; moderation is the status's one writer, so `auto` still approves on registration and `manual` waits for the operator. The `organization.email_verified` audit entry no longer records a status change: its `stateAfter` carries the `customerAccountId` alone.
