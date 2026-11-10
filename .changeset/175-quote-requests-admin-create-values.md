---
'@endora-commerce/mod-quote-requests': minor
---

The admin create on behalf accepts custom-field values (`specs/175-buyer-input-custom-fields/`).

- `POST /api/v1/admin/quote-requests` validates `customFieldValues` with the administrator's rules before the request is numbered or anything is written, and stores them on the new quote request; a refusal answers the existing `422 CUSTOM_FIELD_VALUE_INVALID` (`details` entries `{ path, issue }`) and creates nothing, and the `quote_request.create_on_behalf` audit after-state names the stored keys, sorted, as `changedCustomFields` — never their values. The create on behalf now enforces `required` quote-request definitions, **also when the request sends no values**. A buyer's own submission is unchanged. With the module switched off the route answers as absent, as before.
- The create-quote-request screen embeds the custom-field panel (shown with `custom_fields:read`), sends its bag as `customFieldValues` and shows a refusal at the field it names (read through `@endora-commerce/admin-kit`'s `customFieldErrorsOf`).
- The manifest exports `customFieldWrites`: the create on behalf and the update `PATCH /api/v1/admin/quote-requests/:id`.
