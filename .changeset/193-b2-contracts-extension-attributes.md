---
'@endora-commerce/contracts': minor
---

`ExtensionAttributesSchema`'s per-module value is now `record<string, json> | null` (`specs/193-admin-form-extensions/` FR-015, rulings D-300.24, D-300.25): a side-table loader served on the admin `?extensions=` read answers an object keyed by field, as D2 columns do, and a served module with no value for the record answers `null`. An absent key still means the module is not served there. A D2 module's value is unchanged. `ExtensionAttributes` (and `AdminOrganization['extensions']`) widens by `null` only; code that indexes into a module's value checks for `null` first.
