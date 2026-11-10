---
'@endora-commerce/contracts': minor
---

Custom-field writes: buyer input, admin access and admin-create values (`specs/175-buyer-input-custom-fields/`). Everything is additive.

- New `custom-fields` exports: `customFieldInputSurfaceSchema` / `CustomFieldInputSurface` (`organization.register`), `customFieldAdminAccessSchema` / `CustomFieldAdminAccess` (`edit`, `read`, `hidden` — an admin-panel convenience, not access control), `inputSurfaceFieldSchema` / `InputSurfaceField` and `inputSurfaceFieldsResponseSchema` / `InputSurfaceFieldsResponse` (the public `GET /api/v1/custom-fields/input-surfaces/:surface` read), and the type `CustomFieldWriteDeclaration` a host's `customFieldWrites` manifest export satisfies.
- `customFieldDefinitionSchema` and `CustomFieldDefinitionRecord` gain `customerInput` and `adminAccess`; `createCustomFieldDefinitionSchema` defaults them to `[]` and `'edit'`; `updateCustomFieldDefinitionSchema` takes both as optional (absent = unchanged). A served definition without them no longer parses under `customFieldDefinitionSchema`.
- `customFieldEntityTypeInfoSchema` gains `customerInputSurfaces` (default `[]`).
- `customFieldValidationErrorSchema.code` gains `not_open_for_input` and `too_many_keys`; `CUSTOM_FIELD_DEFINITION_ERROR_CODES` gains `customer_input_unsupported`, `customer_input_audience`, `customer_input_value_type` and `admin_access_required`. A consumer switching exhaustively over either union has new cases.
- `CustomFieldValuePort` gains `validateForCustomerInput(entityType, values, surface, language?)`; an implementation of the port must add it. Each refusal's `message` is a sentence a buyer can read beside the field (never the key or the typed value), worded in `language` when given.
- Optional `customFieldValues` on `registerOrganizationRequestSchema`'s `organization` and `firstUser` (and so on `AdminOrganizationCreateBodySchema`), `adminDirectMemberToRoleRequestSchema`, `createCategoryRequestSchema`, `adminCreateOrderRequestSchema` and `adminCreateQuoteRequestSchema`; `CustomerAccountCreateInput` gains an optional, already-validated `customFieldValues`.
- The catalogue attribute API carries the backing definition's admin access: optional `adminAccess` on `createAttributeRequestSchema`, `updateAttributeRequestSchema` and `adminAttributeResponseSchema`, and an optional `adminAccess` on `CatalogAttributeView`.
