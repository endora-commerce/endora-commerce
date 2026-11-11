---
'@endora-commerce/contracts': minor
---

Declared extension columns (`specs/178-extensible-columns/`): `CUSTOM_FIELD_HOST_BINDINGS` — the one custom-field host binding registry (`table`, `valueColumn`, `ownerModuleId` per `SupportedEntityType`), moved here from `custom_fields` so the platform can derive its extensible host tables from it — plus `ExtensibleHostTable`, `EXTENSIBLE_HOST_TABLES`, `ExtensionsQuerySchema` (`?extensions=`, comma-separated module ids, at most eight) and `ExtensionAttributesSchema`. Additive; no existing schema changes.
