---
'@endora-commerce/admin-kit': minor
---

`CustomFieldValuesPanel` honours a definition's admin access (`specs/175-buyer-input-custom-fields/`).

- A `read` definition renders as its label and stored value (a dash when there is none) with no input; a `hidden` one is not rendered. A panel whose every definition is `hidden` renders nothing, as for an entity type with no definitions.
- **The bag handed to `save` and to `onChange` now carries the keys of `edit` definitions only.** A stored `read` or `hidden` value, and a key with no definition, are no longer in it; every in-tree host sends the bag as a patch to a merging endpoint, which keeps an absent key, so a panel save no longer overwrites a value it did not let the operator edit — including one an integration wrote after the page loaded.
- A refusal for a non-`edit` field — passed in `fieldErrors`, or answered by the host's `save` in a `CUSTOM_FIELD_VALUE_INVALID` envelope — is shown at the top of the panel with the field's label and level and a pointer to the Custom fields screen. New `core` keys: `customFields.adminAccess.read`, `customFields.adminAccess.hidden`, `customFields.nonEditableRefusal`, `customFields.value.yes`, `customFields.value.no`.
- Admin access is a panel convenience, not access control: no API endpoint reads it.
- New export `customFieldErrorsOf(error)` from `./components`, beside the panel: a `422 CUSTOM_FIELD_VALUE_INVALID` `ApiError` as the panel's `fieldErrors` (definition key → sentence), `null` for any other failure. Every host create screen reads a refusal through it.
