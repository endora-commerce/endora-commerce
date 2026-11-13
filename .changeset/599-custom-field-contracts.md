---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-custom-fields': patch
---

Custom-field definition replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `customFieldDefinitionListResponseSchema` / `CustomFieldDefinitionListResponse` for `GET /api/v1/admin/custom-fields/definitions` and `customFieldEntityTypeListResponseSchema` / `CustomFieldEntityTypeListResponse` for `GET /api/v1/admin/custom-fields/entity-types`, each a `data` array of the rows that were already described. The list envelopes were not.
- `mod-custom-fields` builds every definition reply as the contract's `CustomFieldDefinitionDto` instead of `Record<string, unknown>`, and the list, detail, create, update and entity-types handlers declare their reply types. Nothing on the wire changes.
