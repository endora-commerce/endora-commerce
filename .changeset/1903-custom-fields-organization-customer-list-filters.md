---
'@endora-commerce/mod-custom-fields': minor
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-organizations': minor
---

Organization and Customer custom fields can now be list filters (issue #1903), as order, quote
request, opportunity, project and task fields already could.

- `custom_fields`: the `organization` and `customer` entity types offer the *Use as list filter*
  option (`listFilter: true` in `GET /api/v1/admin/custom-fields/entity-types`); a definition of
  either type may set `listFilter`, which was refused with `422 list_filter_unsupported` before.
- `organizations`: `GET /api/v1/admin/organizations` takes `customFieldFilters` (the JSON shape
  of `customFieldFiltersQueryParamSchema`), and the new
  `GET /api/v1/admin/organizations/custom-field-filters` (`customers:read` or `customers:manage`)
  answers the offered fields. The Organizations list screen shows them behind *More filters* to
  an administrator holding `custom_fields:read`.
- `customers`: `GET /api/v1/admin/customers` takes `customFieldFilters`, and the new
  `GET /api/v1/admin/customers/custom-field-filters` (`customers:read`) answers the offered
  fields. The Customers list screen shows them the same way.
- `customer_accounts`: `customerAccountAdminSearchPort.search()` applies the new
  `customFieldCondition` criterion.

A filter narrows the list within the caller's reach — a sales representative still sees only the
Organizations and customers of their book — and the total and the pages are those of the narrowed
set. A field the list does not offer answers `400 CUSTOM_FIELD_FILTER_UNAVAILABLE`, naming it.
`organizationsModule()` and `customersModule()` take an optional `customFieldListFilter` option;
a composition that leaves it out offers no fields and refuses any filter it is sent.
