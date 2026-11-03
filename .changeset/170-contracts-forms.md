---
'@endora-commerce/contracts': minor
---

Forms contracts (`specs/170-forms-module/`), all additive:

- `forms.ts`: the form definition (`formDefinitionSchema`, `FormDefinition`, `FormDefinitionInput`), the admin request and response shapes (`formDetailSchema`, `formListResponseSchema`, `formEntryListResponseSchema`, `formEntryDetailSchema`, `formRetentionBodySchema`, `formEntryExportQuerySchema` and their siblings), the public read (`publicFormDefinitionSchema`, `PublicFormDefinition`) and submit shapes (`formSubmitBodySchema`, `formSubmitResponseSchema`, `formSubmissionInvalidDetailsSchema`), `FormFieldErrorCode`, `FORMS_EVENTS` and `FormEntrySubmittedEventV1Schema` (`forms.entry.submitted.v1`).
- `forms-logic.ts`: the one evaluator of field visibility and validation that the backend, the storefront renderer and the admin preview share.
- `FORMS_STOREFRONT_CACHE_TAGS` (`form(formId)` → `forms:form:<id>`, `maxLength`).
- `ERROR_CODES`: `FORM_NOT_FOUND`, `FORM_KEY_TAKEN`, `FORM_DEFINITION_INVALID`, `FORM_REVISION_CONFLICT`, `FORM_HAS_ENTRIES`, `FORM_NOT_ACCEPTING`, `FORM_SUBMISSION_TOO_LARGE`, `FORM_SUBMISSION_INVALID`, `FORM_ENTRY_NOT_FOUND`, `FORM_ENTRY_STATUS_CONFLICT`, `FORM_SCOPE_REQUIRED`, `FORM_CAPTCHA_FAILED`, `FORM_CAPTCHA_UNAVAILABLE`.
