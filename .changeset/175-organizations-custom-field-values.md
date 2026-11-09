---
'@endora-commerce/mod-organizations': minor
---

Custom-field values at registration and on the admin creates (`specs/175-buyer-input-custom-fields/`).

- `POST /api/v1/organizations/register` passes the request's language to the value port, so each refusal's `message` is worded for the buyer in it (the code stays on the wire beside it).
- `POST /api/v1/organizations/register` accepts `organization.customFieldValues` (stored on the Organization) and `firstUser.customFieldValues` (stored on the first account). Both groups are validated on the `organization.register` surface through custom_fields' `validateForCustomerInput` **before the first write**; every refusal of both is answered in one `422 CUSTOM_FIELD_VALUE_INVALID` whose `details` entries carry `field` (prefixed `organization.` / `firstUser.`; the group alone for `too_many_keys`), `code` and `message`, plus `path` / `issue` repeating them. Without a composed value port every supplied key is refused `not_open_for_input`; a registration that sends no values behaves as before. The `organization.register` audit entry gains `customFieldKeys: { organization, customer }` — keys, never values.
- `POST /api/v1/admin/organizations` validates `customFieldValues` with the administrator's rules inside the `organization.create` Command (a refusal creates nothing; the audit after-state carries the stored values), and `POST /api/v1/admin/organizations/:id/members` validates the member's `customFieldValues` before the account is written and records them in the `customer_account.admin_create` audit row. Both now enforce `required` definitions at creation.
- *New organization* and the member direct-create form embed the custom-field panel (shown with `custom_fields:read`), send its bag as `customFieldValues` and show a refusal at the field it names.
- The manifest exports `customFieldWrites`: the Organization create and update, the member direct-create, the member profile update (`PATCH /api/v1/admin/organizations/:id/members/:customerAccountId`, a customer update whose values are `customers`' values patch), the invitation exemption and the two buyer-input entries of `organization.register`.
- The create screens read a refusal through `@endora-commerce/admin-kit`'s `customFieldErrorsOf` instead of a copy of their own.
