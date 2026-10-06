---
'@endora-commerce/mod-custom-fields': minor
---

A custom-field host type may name the module it belongs to, and `opportunity` is the first
that does.

`SupportedEntityMeta` gains an optional `ownerModuleId`. While that module is not effectively
present, `GET /api/v1/admin/custom-fields/entity-types` omits the type and the definition and
option mutation routes answer `409 CUSTOM_FIELD_HOST_MANAGED` for it; definitions and stored
values are kept, and are back when the owner is. Types that declare no owner — every type that
existed before — answer exactly as they did.

The registry gains the host type `opportunity`, owned by the `crm` module.
