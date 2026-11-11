# Contract: ORM projection and the duplicate-table rule

## 1. Builder

`projectionSchemaOf(decl, host: HostEntityFacts): EntitySchema` in
`packages/platform/src/db/schema-extension-projection.ts`; memoised by declaration identity.
`HostEntityFacts` (table, PK property/column, classification) is read from the merged entity set
before `MikroORM.init`: the entity class whose `@Entity({ tableName })` equals the host and its
`tenantClassifications()` row.

- Entity name `__x_<module>__<host>`; `tableName = host`.
- Properties: `id` (`uuid`, primary); `organizationId` (`uuid`, `fieldName: 'organization_id'`)
  iff host scope is `org`; one per declared key, `fieldName` = physical name, MikroORM type from
  `data-model.md` §3, `nullable`, `default` mirrored.
- Classification: register the generated class in the tenant registry with the host's scope
  (`GlobalEntity` / `OrgScoped` / `RuleScoped`) **and** set `filters.org` on the schema for `org`
  (research R-2 — the decorator alone does not reach an `EntitySchema`).
- Hooks: `beforeCreate` and `beforeDelete` throw `ExtensionProjectionWriteError`.

## 2. Configuration

`mikroOrmConfigFrom` (`packages/platform/src/db/mikro-orm.config.ts`) takes a new input
`schemaExtensions` (from `PackageSchemaContribution.schemaExtensions`), validates them (V2, V9–V11),
appends the projections to `entities`, and sets:

```ts
discovery: {
  checkDuplicateTableNames: false,
  afterDiscovered: (storage) => assertTableMappings(storage, allowedProjections),
}
```

`assertTableMappings` groups non-embeddable, non-virtual metadata by `tableName`. A table mapped
more than once passes only if exactly one mapping is not in `allowedProjections` and every
projection's properties ⊆ {`id`, `organizationId`, declared keys}. Otherwise
`DuplicateTableMappingError` names the table and every class. This is the only place the MikroORM
check is turned off; a unit test asserts both options are always set together.

## 3. What core sees

Nothing: core entity metadata, hydration, INSERT … RETURNING and serialisation are unchanged
(research R-1). Off-state test (SC-002) asserts byte-identical core responses and audit rows.

## 4. Never

No `onMetadata` injection into a core entity (E1), no decorator on a core class (E5), no projection
in an ORM that runs the SchemaGenerator (research R-4).
