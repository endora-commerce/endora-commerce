---
'@endora-commerce/mod-crm': minor
---

CRM takes part in a Project merge (issue #1907, `specs/192-organization-merge/` US6): a new
participant (`project-references`, `records` phase) re-points the Opportunity references naming the
merged-away Project at the survivor through the new audited Command
`crm.opportunity_reference.merge_reassign`. A mention of a merged Project in an Opportunity's text
now renders as, and links to, the survivor.
