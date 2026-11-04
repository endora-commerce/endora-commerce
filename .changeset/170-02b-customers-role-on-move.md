---
'@endora-commerce/mod-customers': patch
---

Assigning a customer to another organization, or detaching them to their own personal organization, writes the role they hold there with the move (`specs/170-organization-roles/`, WP-02b): a company's *Administrator* stays *Administrator* in the target, anyone else becomes its *Member*, and a detached customer is their personal organization's *Administrator*.
