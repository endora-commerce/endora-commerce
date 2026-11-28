---
'@endora-commerce/contracts': minor
---

`ExtensionAttributesSchema` admits any JSON value per module, not only a key → value record (`specs/193-admin-form-extensions/` FR-015): a side-table loader served on the admin `?extensions=` read answers its own value there, `null` on a record without one. A D2 module's value is unchanged. `ExtensionAttributes` (and `AdminOrganization['extensions']`) widens accordingly; code that indexes into a module's value narrows it first.
