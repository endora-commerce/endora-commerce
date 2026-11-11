---
'@endora-commerce/mod-catalog': minor
---

The admin category create accepts custom-field values (`specs/175-buyer-input-custom-fields/`).

- `POST /api/v1/admin/catalog/categories` validates `customFieldValues` with the administrator's rules inside the `category.create` Command and stores them on the new category; a refusal answers the existing `422 CUSTOM_FIELD_VALUE_INVALID` (`details` entries `{ path, issue }`) and creates nothing, and the audit after-state carries the stored values. The create now enforces `required` category definitions, **also when the request sends no values** — a deployment with a required category field must supply it on every category create through this route or `catalogCategoryWritePort.create`.
- The category tree's create and edit forms embed the custom-field panel (shown with `custom_fields:read`): the create sends its bag in the `POST`, the edit in the same `PATCH /api/v1/admin/catalog/categories/:id` as the rest of the form, and a refusal is shown at the field it names (read through `@endora-commerce/admin-kit`'s `customFieldErrorsOf`).
- The manifest exports `customFieldWrites`: the category create and update, and the `product` create and update exemption (a product's values are catalog attribute values, written by the attribute surfaces).
