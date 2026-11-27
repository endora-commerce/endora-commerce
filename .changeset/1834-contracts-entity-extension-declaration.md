---
'@endora-commerce/contracts': minor
---

**Breaking change** (issue #1983): `CustomFieldHostBinding.entityClassName` is a new **required**
field on a published type (owner ruling on #1983, option B).

**Side-table entity extensions: the manifest declaration** (issue #1834, `specs/187-side-table-extensions/`). `ModuleManifestSchema` accepts an optional `extends: EntityExtensionDeclaration[]` — at most 16 entries of `{ entity: '<ownerModuleId>.<EntityClassName>', table: '<own table>' }` (`EntityExtensionDeclarationSchema`; `table` is a lower-case identifier of at most 63 bytes, no extra keys). A module declares each table it owns whose single-column primary key is a cascading foreign key to an extensible host's primary key, for example `extends: [{ entity: 'organizations.Organization', table: 'acme_erp_organization_links' }]`; the platform verifies it at `migrate` and at boot. `defineModuleManifest` refuses one table listed twice (`duplicate-table`). Absent means the module extends no host, and nothing changes for it.

`CustomFieldHostBinding` gains `entityClassName`, the class name of the entity mapping each host table (`Organization`, `CustomerAccount`, `Order`, `QuoteRequest`, `Product`, `Category`, `CrmOpportunity`, `Project`, `Task`); every entry of `CUSTOM_FIELD_HOST_BINDINGS` carries it. Code that builds a `CustomFieldHostBinding` by hand must add the field.

**Upgrading to 0.113.0:** an instance or package that only reads `CUSTOM_FIELD_HOST_BINDINGS`
needs no change. One that constructs or spreads a `CustomFieldHostBinding` object of its own (a
test double, a custom host table) fails to type-check until each such object gains
`entityClassName`, the class name of the MikroORM entity that maps its `table`. Nothing changes
at run time for code that already type-checks.
