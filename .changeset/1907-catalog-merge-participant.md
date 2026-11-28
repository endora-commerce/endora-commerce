---
'@endora-commerce/mod-catalog': minor
---

The catalogue takes part in an Organization merge (issue #1907): in every product audience
allow-list, global and per sales channel, the duplicate is replaced by the organization that stays
(never listed twice), through the audited, irreversible Command `catalog.product.merge_reassign`.
The changed products' storefront pages are revalidated and, with `search` on, their search documents
re-read.

Copying a product's channel scopes asks the merge freeze first: an audience naming an Organization
being merged or merged away refuses the copy.
