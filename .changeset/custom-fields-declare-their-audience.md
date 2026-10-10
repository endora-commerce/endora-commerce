---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-custom-fields': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-catalog': patch
---

A custom field declares who reads its values, and an order reply stops naming the administrator
who placed it. **Two breaking changes**, both described below.

**Every custom-field definition has an `audience`: `customer` or `internal`.** Until now a
definition had none, and whatever an administrator stored on an order or a quote request was
answered to the customer (`GET /api/v1/orders`, `GET /api/v1/orders/:id`, the replies to placing
and cancelling an order, `GET /api/v1/quote-requests/:id`) and to integrations
(`/api/v1/external/orders`) as `customFieldValues`. An operator who modelled an internal note, a
credit assessment or a risk flag as an order custom field was showing it to the buyer.

- `internal` values are answered on admin routes only. `customer` values are also answered on
  the non-admin replies above. A stored value whose definition no longer exists is treated as
  internal. Admin replies are unchanged and carry every stored value.
- **Existing definitions keep today's behaviour.** The migration
  `Migration20261010T090000CustomFieldsDefinitionAudience` adds
  `custom_field_definitions.audience` and sets every existing row to `customer`, so upgrading
  hides nothing. Review your definitions after upgrading and move to `internal` whatever was
  never meant to be shown.
- **Breaking: a new definition is `internal` unless it says otherwise.**
  `POST /api/v1/admin/custom-fields/definitions` without `audience` used to create a field whose
  values the customer could read; it now creates one they cannot. Send `"audience": "customer"`
  to keep the old behaviour. `PATCH …/definitions/:id` accepts `audience` and leaves it alone
  when the key is absent. The same patch no longer resets a definition's `config` to `{}` when
  the body does not name it (`updateCustomFieldDefinitionSchema` carried the create default).
- The definition screen (Custom Fields) shows the choice with an explanation, defaulting to
  internal, and lets the audience of an existing field be changed. Six keys join the module's
  `en` and `pl` bundles under `customFields.audience.*`.

In `@endora-commerce/contracts`: new `customFieldAudienceSchema` / `CustomFieldAudience`;
`customFieldDefinitionSchema` and `CustomFieldDefinitionRecord` gain a required `audience`;
`createCustomFieldDefinitionSchema` defaults it to `internal`, so the inferred
`CreateCustomFieldDefinitionRequest` — the input of `CustomFieldDefinitionApplyApi.applyCreate` —
now requires it; and `CustomFieldValuePort` gains
`projectForCustomer(entityType, bag)`, which returns only the keys a non-administrator may read.
An implementation of that port must add the method. A host module that answers custom-field
values to a non-administrator calls it in its serialiser; `mod-orders` and `mod-quote-requests`
do. `mod-catalog` creates product attributes with `audience: 'customer'`; the audience is not
consulted for product attributes, whose storefront visibility stays with the catalog's own flags.

**Breaking: buyer-facing and external order replies no longer carry
`placedOnBehalfByAdminUserId`.** It was the UUID of the administrator who placed the order for
the customer, answered to the customer and to API-key callers. Those replies now carry
`placedOnBehalf: boolean` instead. Admin order replies carry both. In `orderSchema`,
`placedOnBehalf` is a new required key and `placedOnBehalfByAdminUserId` becomes optional
(present on admin replies only). Replace `order.placedOnBehalfByAdminUserId !== null` with
`order.placedOnBehalf` in a storefront or an integration; the reference storefront did not read
the field.

In `mod-orders`, `serializeOrder` is replaced by `serializeOrderForAdmin` and
`serializeOrderForCustomer` (internal to the module).
