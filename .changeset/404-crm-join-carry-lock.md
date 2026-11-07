---
'@endora-commerce/mod-crm': patch
---

An Order that joins the Opportunity of its Quote Request now locks the Opportunity before it carries custom-field values into it, and bumps the Opportunity's version when it carries any. A concurrent edit of the Opportunity's custom fields is no longer overwritten, and a client holding the previous version is told it is stale.
