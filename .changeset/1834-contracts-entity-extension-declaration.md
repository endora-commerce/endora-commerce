---
'@endora-commerce/contracts': minor
---

**Side-table entity extensions: the manifest declaration** (issue #1834, `specs/187-side-table-extensions/`). `ModuleManifestSchema` accepts an optional `extends: EntityExtensionDeclaration[]` — at most 16 entries of `{ entity: '<ownerModuleId>.<EntityClassName>', table: '<own table>' }` (`EntityExtensionDeclarationSchema`; `table` is a lower-case identifier of at most 63 bytes, no extra keys). A module declares each table it owns whose single-column primary key is a cascading foreign key to an extensible host's primary key, for example `extends: [{ entity: 'organizations.Organization', table: 'acme_erp_organization_links' }]`; the platform verifies it at `migrate` and at boot. `defineModuleManifest` refuses one table listed twice (`duplicate-table`). Absent means the module extends no host, and nothing changes for it.

`CustomFieldHostBinding` gains `entityClassName`, the class name of the entity mapping each host table (`Organization`, `CustomerAccount`, `Order`, `QuoteRequest`, `Product`, `Category`, `CrmOpportunity`, `Project`, `Task`); every entry of `CUSTOM_FIELD_HOST_BINDINGS` carries it. Code that builds a `CustomFieldHostBinding` by hand must add the field.
