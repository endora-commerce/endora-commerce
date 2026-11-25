---
'@endora-commerce/mod-quote-requests': minor
---

Quote requests take part in an Organization merge (issue #1907): the duplicate's quote requests and
their notification rows follow the organization that stays, and its negotiation policy fills the
survivor's only when the survivor has none, through the audited, irreversible Command
`quote_request.merge_reassign`.
