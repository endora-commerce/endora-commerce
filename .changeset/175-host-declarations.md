---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-customers': patch
---

Each manifest exports `customFieldWrites` (`specs/175-buyer-input-custom-fields/`), the `CustomFieldWriteDeclaration[]` naming the admin routes that write its custom-field host's values: opportunity, project and task create (`POST`) and update (`PATCH …/:id`), and the customer values patch (`PATCH /api/v1/admin/customers/:id/custom-fields`). A type-only declaration read by `check:custom-field-writes`; no runtime behaviour changes.
