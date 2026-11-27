# Contract: extension attributes on aggregate read ports (FR-050 – FR-058, OD-19)

## 1. `@endora-commerce/contracts` — `packages/contracts/src/entity-extensions.ts` (new)

```ts
/** `extensions.<moduleId>` — the one include family offered in this feature. */
export const EntityExtensionIncludeSchema = z
  .string()
  .regex(/^extensions\.(_?[a-z][a-z0-9_]*)$/);
export type EntityExtensionInclude = `extensions.${string}`;

export interface EntityExtensionReadOptions {
  /** At most 8, deduplicated by the platform. Absent or empty: nothing is loaded. */
  readonly include?: readonly EntityExtensionInclude[];
}

/** A host record as a read port returns it when `include` was given. */
export type WithEntityExtensions<R> = R & {
  /** Present only when `include` named at least one present module. Values per module: T | null. */
  readonly extensions?: Readonly<Record<string, unknown>>;
};
```

`ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED` (422) is added to `packages/contracts/src/errors.ts`,
declared by `_lifecycle`, translated under `errors.ENTITY_EXTENSION_UNCLAIMED` in
`packages/modules/_i18n/i18n/{en,pl}.json`:

- en: "No installed module provides “{path}” for this record type."
- pl: "Żaden zainstalowany moduł nie udostępnia „{path}” dla tego typu rekordu."

The value type `T` of a module's extension is that module's contract: a core module publishes its Zod
schema and type in `packages/contracts`; an installed package or overlay publishes them from its own
package (its `./ports` type subpath and a runtime export), and a consumer narrows with that schema.
No core contract names a third-party extension.

## 2. Registration — `ModuleContext.entityExtensionLoaders`

`packages/platform/src/kernel/module-context.ts`, beside `commandHooks`:

```ts
export interface EntityExtensionLoaderEntry<T> {
  /** `<ownerModuleId>.<EntityClassName>`, one the module declared in `extends`. */
  readonly host: string;
  readonly schema: z.ZodType<T>;
  /** One call per read. Resolve only ids that have a value; missing ids become `null`. */
  load(ids: readonly string[], ctx: { readonly em: EntityManager }): Promise<ReadonlyMap<string, T>>;
}
entityExtensionLoaders(entries: readonly EntityExtensionLoaderEntry<unknown>[]): void;
```

Attributed to `module.id` by the context (an entry cannot name another module). Refused at
registration, as `EntityExtensionInvalidError`:

| Rule | Refused when | `rule` |
| --- | --- | --- |
| L1 | the module's manifest has no `extends` entry on `host` | `loader-without-extension` |
| L2 | a second loader for the same (module, host) | `duplicate-loader` |
| L3 | registration after the composition is sealed | `registration-after-seal` |

Registration resolves nothing and reads no presence state.

## 3. The reads service — container name `entityExtensionReads`

Kernel-registered in `composeApp`, like `schemaExtensionReads`
(`packages/platform/src/composition/compose-app.ts`):

```ts
export interface EntityExtensionReads {
  attach<R extends { readonly id: string }>(
    host: string,                                   // 'organizations.Organization'
    records: readonly R[],
    options: EntityExtensionReadOptions | undefined,
    em: EntityManager,
  ): Promise<readonly WithEntityExtensions<R>[]>;
}
```

Semantics, in order (normative):

1. `options?.include` absent or empty → return `records` **as given** (same array identity is not
   promised; element identity and shape are — no `extensions` key). No loader runs.
2. Deduplicate; more than 8 → `422 VALIDATION_ERROR`. Parse each with `EntityExtensionIncludeSchema`.
3. For each `moduleId`: no loader registered for (`moduleId`, `host`) in the composition →
   collect; if any collected → `422 ENTITY_EXTENSION_UNCLAIMED`, `details: [{ path:
   'extensions.<moduleId>', issue: 'unclaimed' }, …]`, before any loader runs.
4. `records` empty → return.
5. For each included `moduleId` whose module `effectiveState.isPresent(moduleId)` is false → skip
   (key absent; no call; no error).
6. For each remaining, sequentially, in `include` order: `load(ids, { em })` with `ids` = the
   records' ids in record order; parse each returned value with `schema` — a failure throws
   `EntityExtensionLoaderOutputError` (500, `{ moduleId, host, id, issues }`); drop ids not asked
   for.
7. Each record gains `extensions: { [moduleId]: value ?? null, … }` for the present modules only. If
   no included module was present, records carry no `extensions` key at all.

No `catch` around a loader (`module-composition.md` item 7): its error is the read's error.
Sequential rather than parallel: one entity manager, and `include` is ≤ 8.

## 4. The host ports (FR-058)

Each method below gains `options?: EntityExtensionReadOptions` as its last parameter and returns
`WithEntityExtensions<…>`; its implementation calls `entityExtensionReads.attach(host, records,
options, em)` on the records it is about to return, after its own scope and authorisation. Every other
method is unchanged.

| Host | Port (container name) | Methods that gain `options` | Phase |
| --- | --- | --- | --- |
| `organizations.Organization` | `OrganizationDetailsPort` (`organizationDetailsPort`) | `findById`, `findByIds`, `searchByName`, `findByTaxId` | B1 |
| `customer_accounts.CustomerAccount` | `CustomerAccountReadPort` (`customerAccountReadPort`) | `findById`, `findByIds`, `searchByEmail`, `listAll` | B2 |
| `orders.Order` | `OrderReadPort` (`orderReadPort`) | `findById`, `findByIdForCustomer`, `findByIds`, `listAll` | B2 |
| `quote_requests.QuoteRequest` | `QuoteRequestReadPort` | `findById`, `findByBusinessId`, `findByIds` | B2 |
| `catalog.Product` | `CatalogProductReadPort` | `findById`, `findByIds`, `findBySku`, `findBySkus`, `listAll` | B2 |
| `catalog.Category` | `CatalogCategoryReadPort` | `findById`, `findByIds`, `findBySlug`, `listAll`, `ancestorsOf` | B2 |
| `crm.CrmOpportunity` | `OpportunityReadPort` | `findById`, `findByDocument`, `listOpenForOrganization`, `findByIds`, `search` | B2 |
| `projects.Project` | `ProjectReadPort` | `findById`, `findByRecord`, `findByIds`, `search` | B2 |
| `tasks.Task` | `TaskReadPort` | `findById`, `findByIds`, `search`, `listInContext`, `listOpenInContext` | B2 |

Method lists were read from the contracts on `ff7efc3e8`; the `customer_accounts` row was updated
with B2 (#1835): `findById` and `findByIds` (whose `options` already carried
`CustomerAccountLookupOptions`, now intersected with `EntityExtensionReadOptions`) were on the port
before that commit, so the note below about a missing by-id method no longer holds for it. The two
`catalog` rows were updated with B2 (#1835, T042/T043) to the ports as published: `findById`,
`findByIds`, `findBySku` and `findBySkus` were on `CatalogProductReadPort` at `ff7efc3e8` already (the
note below does not hold for it either), and `findByIds` on `CatalogCategoryReadPort`; where a method
already took lookup options (`CatalogProductLookupOptions`, `{ liveOnly }`) they are intersected with
`EntityExtensionReadOptions`. `listWithInventoryThresholds` stays unchanged.
`ERROR_CODES` has no `VALIDATION_ERROR`; semantics 2 answers `422 VALIDATION_FAILED`. **Coordination with
`specs/186-aggregate-ports/`**: `CustomerAccountReadPort` and `CatalogProductReadPort` have no by-id
record method today; adding one is the aggregate port's business, not this feature's. If 186 adds,
renames or replaces a read port for an aggregate, the `options` parameter goes on the port 186
publishes, on its record-returning methods, and the row above is updated in the same merge request.
Each B2 row lands after 186's task for that aggregate and before or with that aggregate's release.

## 5. Tenancy and transactions

The loader runs inside the caller's async context (the tenant context is the caller's) and on the
port's `em` (a read inside a Command's transaction sees a side row a `beforeCommit` hook wrote in the
same transaction). It receives only the ids of records the port already authorised; it MUST NOT widen
scope (`withSystemScope`) — the guide says so, and a unit test of the reference module asserts its
loader issues one statement with no scope change.

## 6. Not offered here

Admin HTTP `?extensions=` for side tables (FR-080, owner ruling OR-10; research R-17), filtering or sorting by extension values,
nested includes, includes other than `extensions.*`.
