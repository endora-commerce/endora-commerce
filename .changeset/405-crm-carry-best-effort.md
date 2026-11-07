---
'@endora-commerce/mod-crm': patch
---

A custom-field carry into a Sales Opportunity that fails no longer stops the Opportunity from being created for a placed Order or Quote Request, or an Order from joining the Opportunity of its Quote Request. The Opportunity is created or joined without the carried values, and the operator's log names the document that did not carry, as the carry into a document created from an Opportunity already did.
