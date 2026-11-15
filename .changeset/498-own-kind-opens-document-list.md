---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
---

`@@` in an Opportunity's or a Project's text now opens the document list for a role that holds only the module's own codes (issue #498). `useCrmReferences` offers the `document` trigger to a `crm:write` holder whose role includes `crm:read`, and `useProjectReferences` to a `projects:write` holder whose role includes `projects:read`, because `GET /crm/lookups/documents` and `GET /projects/lookups/documents` already answer the module's own group (Opportunities, Projects) to every writer. Before, such a role kept `@@` as the characters it typed and was shown no *Insert document* button, although the server had a group to offer it. A Projects group with nothing in it is an empty list, not a reason to hide `@@`. No API change.
