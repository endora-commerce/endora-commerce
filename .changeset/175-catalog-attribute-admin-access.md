---
'@endora-commerce/mod-catalog': minor
---

Product attributes carry an admin access (`specs/175-buyer-input-custom-fields/`, FR-036). `POST` and `PATCH /api/v1/admin/catalog/attributes` accept an optional `adminAccess` (`edit`, `read` or `hidden`), passed to the backing custom-field definition through the apply seam, and every attribute response answers it (`edit` by default). A required attribute that is not `edit` is refused with `400 VALIDATION_FAILED`. The attributes screen offers the selector on create and edit, with the sentence that it only changes the admin panel, and keeps read-only and hidden unavailable while the attribute is required.
