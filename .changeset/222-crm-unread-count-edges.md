---
'@endora-commerce/mod-crm': patch
---

The unread-message count of a Sales Opportunity now counts exactly the messages the *Messages* tab lists: a message row marked deleted is no longer counted, and a read marker older than the instant unread messages started being counted no longer makes the messages before that instant unread again, so marking messages read only ever lowers the number (issue #222).
