---
'@endora-commerce/mod-crm': minor
---

CRM takes part in an Organization merge (issue #1907): the duplicate's opportunities follow the
organization that stays, through the audited, irreversible Command
`crm.opportunity.merge_reassign`. While `crm` is switched off its step waits and runs when it is
back.
