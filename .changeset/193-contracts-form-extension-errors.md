---
'@endora-commerce/contracts': minor
---

Admin form extensions, the platform's answers (`specs/193-admin-form-extensions/` WP-B). Additive: `ERROR_CODES` gains `FIELD_RULE_VIOLATION`, `FIELD_WRITE_FORBIDDEN` and `FIELD_SLOT_INPUT_INVALID`; `admin-forms.ts` gains `FieldWriteForbiddenDetailSchema` with `FIELD_WRITE_FORBIDDEN_REASONS` (`missing-permission`, `api-key-scopes-unresolved` — an API key bound to an organization cannot yet have its scopes resolved inside a Command, so its write to a field with a `writePermission` is refused) and `FieldSlotInputInvalidDetailSchema`. `ModuleManifestSchema` gains the optional `buyerSelfServiceActions` (issue #2027): the actions a module may run as a buyer's own storefront write, with `buyerSelfService` on the Command; `defineModuleManifest` refuses one action listed twice.
