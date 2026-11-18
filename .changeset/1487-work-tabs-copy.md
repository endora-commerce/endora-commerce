---
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
---

The Notes, Messages, Attachments and Change history tabs of an opportunity and a project no longer explain how they work (issue #1487). Notes and Messages say one line, "Internal. Customers never see this.", and the message composer says "Cannot be edited after sending." under the field. The Attachments and Change history tabs open straight on their content. English and Polish both change.

Removed bundle keys: `attachments.hint` and `history.hint` in CRM, `attachments.hint` and `changeHistory.hint` in Projects. New key in both: `comments.messages.composerHint`.

In the admin kit, `CommentThreadCopy` takes an optional `composerHint`, a line under the composer that describes the field (`aria-describedby`). `CommentComposer` takes the matching `hint`. `RecordHistoryCopy.hint` is now optional, and no paragraph is drawn without it.
