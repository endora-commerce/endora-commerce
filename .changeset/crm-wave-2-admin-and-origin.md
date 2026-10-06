---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-audit-logs': patch
---

The second wave of CRM's Admin UI, and what it needed from its neighbours.

- **The audit log labels CRM's actions.** On the platform-wide audit log screen an entry
  written by the CRM module (`crm.opportunity.transition`, `crm.tag.create`, …) now reads as
  the sentence the Opportunity's own change history shows, instead of its action code.
- **Quote requests and the value on the Opportunity screen.** *Linked quote requests* lists,
  links and unlinks them — searched through a new CRM lookup,
  `GET /api/v1/admin/crm/lookups/quote-requests` (`crm:write`), so linking needs no code of
  the quote desk. *Value* shows whether the figure is entered by hand or computed, switches
  between the two, and names every document left out with the reason. *CRM → Workflow* gains
  the statuses that count towards a computed value; saving says that the figures follow in the
  background. With the Quote Requests module off the quote affordances are withdrawn and the
  reason is said.
- **Change history.** A new tab on the Opportunity reads its history a page at a time: each
  entry as a sentence, a status change in the statuses' names with the order that caused it,
  an edit field by field.
- **References.** The description, note and message fields insert `[[product:…]]` and
  `[[order:…]]` tokens from a search, and the saved text shows each as a link — or as
  unavailable. `@endora-commerce/contracts` gains `splitOpportunityReferenceText`, the
  quote-request lookup schemas and the exported `QUOTE_REQUEST_STATUS_VALUES`.
