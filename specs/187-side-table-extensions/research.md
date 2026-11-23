# Research: Side-table entity extensions (D-294)

Each entry is a decision → rationale → alternatives rejected. Measurements cite `origin/master` at
`ff7efc3e8`. No spike code was written for this document; the two assumptions that need one are
named in R-4 and folded into the #1862 MikroORM 7 spike (task T001).

## R-1 — The declaration lives in the manifest, not in a code export

**Decision**: `ModuleManifestSchema.extends: [{ entity, table }]`.

**Rationale**: The declaration is pure data — a host reference and a table name. A manifest field is
readable by every manifest reader without importing backend code: the lifecycle orchestrator (for the
dependency rule), `module:schema-extensions list`, and `audit-packages`, which must judge an installed
package before it is ever booted. It is also where `dependencies` sits, which FR-004 checks against.
The manifest schema is shared by core, packages and overlays, so OR-5's origin-agnosticism is free.

**Rejected**: A `./backend` code export like D2's `schemaExtensions` (spec 178 R-7). D2 needed code —
Zod value schemas, inferred TypeScript types, column specs feeding generated DDL. A side table has none
of that: its schema is the module's own entity and migration. A decorator on the side entity
(`@ExtendsEntity('organizations.Organization')`) — a second decorator idiom in the release that moves
every decorator import for v7, invisible to manifest readers, and it would let a module claim an
extension in code that its manifest's dependencies do not support.

## R-2 — Hosts are named `<ownerModuleId>.<EntityClassName>`; the bindings gain the class name

**Decision**: `entity: 'organizations.Organization'`, validated against `CUSTOM_FIELD_HOST_BINDINGS`,
which gains `entityClassName` per binding, held at every ORM initialisation by metadata rule M0
(the entity mapping the binding's table carries that class name).

**Rationale**: #1834 writes the reference in this form, and it is readable. The class name is already
a platform-wide unique key that MikroORM enforces (`org-scoped.decorator.ts`, D-169) and the key
`@TransitivelyScoped` uses, which R-6 needs. Putting it in the binding keeps the derived-not-listed
rule (OD-15): one registry, one more field, held at run time — so an instance is held too, and
`check:extensible-tables` (and its check-estate obligations) need not change — and the manifest rule
(FR-002) is checkable statically — no ORM needed — which `audit-packages` depends on.

**Rejected**: Naming the host by table (`host: 'organizations'`), as D2 does. Simpler, but a table
name says nothing about the class `@TransitivelyScoped` must name, so the tenancy rule would need a
table → class lookup at discovery anyway. Naming by `SupportedEntityType` (`'organization'`) — a
custom-field vocabulary leaking into module manifests.

## R-3 — All nine hosts are open from the first release

**Decision**: No rollout constant for D1. Every binding's host is extensible by a side table as soon
as US1 ships.

**Rationale**: D2 rolled out `organizations` alone (OD-178-4) because it writes DDL **on** the host
and core CI had to learn to preserve those columns host by host. A side table writes nothing on the
host; the host is touched only by a foreign key pointing at it, which the preservation test (FR-070)
covers for all nine in one change, and which `check:extensible-tables` already guards against (a
rebuild of an extensible table). The read-port half (FR-058) still lands host by host, because it
edits each host's port.

**Rejected**: Reusing `SCHEMA_EXTENSION_ROLLOUT` — it would close eight hosts for no risk the
mechanism carries, and couple D1's rollout to a constant D2 deletes in its Phase D.

## R-4 — Metadata facts come from MikroORM discovery, under v7

**Decision**: The metadata rules (FR-010 – FR-013) run in the `discovery.afterDiscovered` callback
that `mikroOrmConfigFrom` already installs for D2's table-mapping rule
(`packages/platform/src/db/table-mapping-rule.ts`), over the discovered `MetadataStorage`, iterated as
v7's `Map` (`storage.getAll().values()`), plus `tenantClassifications()` matched by entity class.
Facts read: `tableName`, `primaryKeys`, the PK property's `fieldNames` and `type`, the entity class.
Module ownership of an entity comes from the same source `buildTableOwners` uses.

**Rationale**: OR-6 — `MetadataStorage.getMetadataFromDecorator` (used today by
`schema-extension-projection.ts` `decoratedTableOf`) is gone in v7, and the decorator idiom moves to
`@mikro-orm/decorators/legacy`. Discovered metadata is the one source that is the same for legacy
decorators, a future ES-decorator codemod and `defineEntity`, so the rule does not have to change with
the idiom. `afterDiscovered` runs in every ORM initialisation the platform performs — `migrate`, boot,
lifecycle install — so one call site covers FR-021 and FR-022's metadata half.

**Rejected**: Reading decorator metadata (removed in v7). A source-text walk like
`check-entity-tenant-classification` — an installed package has no sources, only `dist`.

**To verify in the #1862 spike (T001)**: `discovery.afterDiscovered` keeps its 6.6 signature in 7.2.11,
and `getAll()` yields entries for every registered entity including `EntitySchema` projections.

## R-5 — The physical check is one catalog query, run where the D2 verifier runs

**Decision**: One `pg_catalog` query returns, for every table in the schema whose primary-key
constraint columns equal a foreign-key constraint's columns and whose foreign key references one of the
nine host tables: table, PK columns, FK constraint name, referenced table and columns, `confdeltype`.
The declared tables are judged from the same rows (a declared table absent from them is
`table-missing` or `foreign-key-missing`, disambiguated by one `to_regclass` per missing table — only on
the failure path). It runs through D2's `SchemaExtensionExec` abstraction inside `migrateUpVerified`'s
transaction and, read-only, in `composeApp` right after the ORM opens.

**Rationale**: FR-023's budget, and the same reaction model D2 established and the owner accepted
(drift inside the run rolls it back; at boot it stops the platform). `SchemaExtensionExec` is a plain
`(sql, params) => rows` function, so it is unaffected by the knex → kysely move. The undeclared scan
(R-7) is the same query, so it costs nothing extra.

**Rejected**: `information_schema.table_constraints` + `key_column_usage` +
`referential_constraints` — three joins over views that are slow on large schemas and do not expose
column order as cleanly as `conkey`/`confkey`. Checking only at `migrate` — a database altered by hand
after `migrate` (a dropped constraint) would boot and silently lose the cascade.

## R-6 — Tenancy: the side table follows its host and never copies a tenant key

**Decision** (confirmed by the owner on 2026-11-23 as OR-9, OQ-187-1 = A): the admitted classifications of the side entity,
by host classification:

| Host scope | Hosts today | Admitted side classification |
| --- | --- | --- |
| `global`, host is the tenant root (`organizations`) | `organizations` | `@GlobalEntity()`, or `@OrgScoped()` whose tenant key **is** the primary key |
| `global`, other | `products`, `categories` | `@GlobalEntity()` |
| `org` | `orders`, `customer_accounts`, `quote_requests`, `crm_opportunities` | `@TransitivelyScoped('<HostClass>', '<pkProperty>')` |
| `rule` | `projects`, `tasks` | `@RuleScoped()` |
| `customer`, `transitive` | none | refused as `host-scope-not-offered` until a host of that scope exists |

**Rationale**: The question Principle XI asks is "can a row be read outside its tenant". A side row's
tenant **is** its host row's tenant. A copied `organization_id` answers the question only while the
host never moves, and `customer_accounts` moves (`attach_organization`); feature 146 classified
`QuoteRequestAccountPolicy` transitively for exactly that reason, and its entity comment records the
read discipline that makes it safe. `organizations` is the tenant itself, so a side row keyed by
`organization_id` with `@OrgScoped()` is exact and never stale — that is `QuoteRequestOrgPolicy`, which
must keep passing. A transitive chain to a `rule` or `global` terminus is refused by D-170, so a rule
host's side table is `@RuleScoped()`, read under the same rule as its host. The two readers a side table
has are safe without a new filter: the loader receives only ids the host already authorised (R-12), and
the module's own routes authorise through the host's port first (the 146 precedent, written into the
guide).

**Rejected**: (B) A plus a platform-built default-on filter on the side entity — fail-closed for the
module's own ad-hoc queries, but new filter machinery inside `tenancy/` in the release whose first change
rewrites `tenancy/excluded-predicate.ts` for kysely under an entity freeze; the owner keeps it as a
possible follow-up (OR-9). (C) The same decorator as the host, literally — stale on a host move, and the only database
guarantee (a composite foreign key on `(id, organization_id)`) needs a unique constraint on the core
table, which OR-4 forbids.

## R-7 — Undeclared side tables: physical detection, ownership decides the reaction

**Decision**: A table found by R-5's query and not declared is `undeclared-entity-extension` when an
entity of a composed module other than the host's owner maps it, else `unowned-entity-extension`; a
table the host's own module maps is ordinary ownership and is not reported (it may not be declared
either, E4). A policy constant
(`ENTITY_EXTENSION_UNDECLARED_POLICY`, platform `db/`) is `'warn'` in 0.113.0 and becomes `'refuse'` in
the following release (OR-8), with a changeset saying so in 0.113.0. `unowned` is always `warn`.

**Rationale**: #1834's definition is physical ("a table that has a primary-key foreign key to an
extensible host"), and only the catalog sees tables no entity maps. Ownership decides who can act: a
composed module's author can add one manifest line; nobody can declare for a package that is gone (the
D2 analogue is R-A5's orphan handling), so refusing residue would let a removed package's leftovers stop
`migrate` — the failure spec 081 refused to allow for cycles.

**Rejected**: Detection from entity metadata (an entity whose PK property is named like a host key) —
names prove nothing, and the catalog is authoritative. Refusing immediately — breaks every instance
with a pre-existing side table on the upgrade that introduces the rule, which OD-4's deprecation rule
exists to prevent.

## R-8 — Side tables are not written to the `schema_extensions` ledger

**Decision**: `entity-extension` rows in `module:schema-extensions list` are derived on each run from
the declarations and R-5's query. The ledger keeps its D2 meaning.

**Rationale**: The ledger records DDL **the platform generated** on a table the declaring module does
not own, so that an upgrade can tell what must survive and an orphan can be dropped by an audited
command. A side table is the module's own table, created and dropped by the module's own migrations;
there is nothing for the platform to orphan, re-attach or drop, and a second record of a fact the
catalog already holds would be a second thing to drift (D-100).

**Rejected**: Ledger rows of kind `entity-extension` with `applied`/`dropped` status — new write paths
into the ledger during `migrate` and uninstall for no reader that needs history.

## R-9 — Loaders register on the module context, one per (module, host)

**Decision**: `ctx.entityExtensionLoaders([{ host: 'organizations.Organization', schema, load }])`, a
contribution sink beside `ctx.commandHooks`, sealed with the composition. The kernel refuses a loader on
a host the module did not declare in `extends` (`loader-without-extension`) and a second loader for the
same (module, host) (`duplicate-loader`). The record key is `extensions.<moduleId>`.

**Rationale**: It mirrors the command-hook registry (`module-context.ts` `commandHooks`), which
attributes entries to `module.id` itself so a module cannot register on another's behalf. One loader
per (module, host) gives one key per module, so a module with two side tables on one host composes them
in its own loader — the consumer sees the module's view, not its storage.

**Rejected**: A loader per side table (`extensions.<moduleId>.<table>`) — exposes storage layout as
API. A port the extension publishes and the host resolves — the host would have to know its extenders,
inverting the dependency.

## R-10 — "Unclaimed" answers 422; "off" answers absent; XVII holds

**Decision**: OD-19 as accepted, made precise: the 422 `ENTITY_EXTENSION_UNCLAIMED` is decided from the
**composition** (did any composed module register a loader for this key on this host); presence is
decided per call from `effectiveState.isPresent`, and an absent module's key is omitted.

**Rationale**: XVII says a module that is off behaves as if never installed — on **both** presence axes.
Neither axis is observable here: a platform-unavailable module and an operator-switched-off module both
yield an absent key. What 422 reveals is that the build contains no such loader — a typo or a consumer
naming a module it does not depend on — which is a programming error, the same class as 176's unclaimed
command extension. Failing a read because an operator switched an extension off would make one module's
read availability depend on another's activation, which XVII forbids from the other side.

**Rejected**: Absent for both (D2's `?extensions=` behaviour) — a typo returns silently incomplete data
to an export worker. 422 for both — couples reads to another module's activation.

## R-11 — `include` is an optional last parameter of record-returning read methods

**Decision**: Each record-returning method of the nine read ports gains `options?:
EntityExtensionReadOptions` and returns `WithEntityExtensions<Record>`. Count, id-search and resolution
methods do not. The change is `minor` in `@endora-commerce/contracts` and each host module.

**Rationale**: OD-4 permits a compatible change without deprecation; an optional trailing parameter and
an optional result key are compatible for every existing caller. The rule against optional **methods** on
published ports (the resolution proxy answers every property) does not apply to parameters.

**Rejected**: New methods (`findByIdWithExtensions`) — doubles every port surface. A separate extension
read port the consumer joins itself — today's N+1 state (#1835 alternatives).

## R-12 — The loader runs on authorised ids, on the port's entity manager, under the caller's context

**Decision**: `entityExtensionReads.attach(host, records, include, em)` is called by the host port after
its own query and authorisation; it passes `records.map(r => r.id)` and the port's `em` to each loader,
inside the caller's async context (so the tenant context is the caller's). Values are parsed with the
loader's schema (FR-057).

**Rationale**: The host is the only authority on which host rows the caller may see; giving the loader
exactly those ids makes the side table's own classification a second line, not the first. Passing the
port's `em` means a read inside a Command's transaction sees the side row a `beforeCommit` hook just
wrote. Schema parsing turns a loader bug into a loud error at the boundary rather than an unvalidated
shape travelling to every consumer.

**Rejected**: The loader querying by host predicate (it would have to restate the host's scope rules).
Skipping validation in production — the cost is a Zod parse per returned row, small beside the query.

## R-13 — No platform write API for side tables

**Decision**: Writes stay with the extension module: its own Commands, or a `beforeCommit` hook on a
hookable host action that persists the module's own entity on the hook's `em` and calls
`noteAuditChanges(['erpKey'])`.

**Rationale**: OR-4. Spec 176 already gives the atomic path and the single audit entry with names only
(D-288). D2 needed an accessor because its columns sit on a table the module does not own; a side table
is owned, so the module's own entity is the accessor.

**Rejected**: A platform `sideTable(decl).upsert(...)` helper — a second write idiom that would bypass
the module's own Command and audit shape.

## R-14 — Where the rule is written down

**Decision**: The rule's one statement is a new item 4b of `specs/conventions/module-migrations.md`
(already routed for "adding an `@Entity()` class"); the published guide
`docs/docs/architecture/side-table-extensions.md` (+ PL) and the ladder's D1 row cite it. Constitution I
gains one sentence (declared, verified side tables) and XI one (tenancy follows the host), as a MINOR
bump chained per spec 178's R-A3: whichever of 187 and 190 merges second re-bases and takes the next
MINOR.

**Rationale**: A new `specs/conventions/` document needs a new row in the `AGENTS.md` router and moves
its body ceiling (`backend/test/unit/docs/agents-router.test.ts`), which five parallel specs would collide
on; the existing routed document already owns "a module's own table referencing another module's".

**Rejected**: Docusaurus only (#1836 alternatives: agents and reviewers read the conventions first). A
new conventions file (router collision, see above).

## R-15 — The foreign-schema guard needs no change

**Decision**: None. `create table "<own>" (… references "organizations" ("id") on delete cascade)` is a
`create` of the module's own table; `sql-statement-targets.ts` reports `create table` as declaring and
does not report `references` as a write. An overlay migration faces the full guard (#1858 ruling,
spec 190); the side table is its own, so nothing is refused.

**Rationale and check**: T012 adds a guard unit case asserting exactly this, so a future guard change
that started treating `references` as a foreign write fails a test named for side tables.

## R-16 — Preservation covers side tables in core CI

**Decision**: The D2 preservation test (spec 178 FR-080) also creates
`preservation_<host>_links (host_id uuid primary key references <host>(id) on delete cascade)` right after
each host's creating migration and asserts the constraint exists with `confdeltype = 'c'` at the end.

**Rationale**: The upgrade promise D1 makes ("core is obliged, and checked, not to break it") is about
the foreign key; a host rebuild with `drop table … cascade` silently drops it.

## R-17 — Admin HTTP reads for side tables: deferred (owner ruling OR-10)

**Decision** (owner, 2026-11-23, OQ-187-2): side-table attributes are not offered on admin HTTP
responses in this feature (FR-080). The read ports (FR-050 – FR-058) are the only read surface.
Adding the wire later is a non-breaking extension, because it would be an opt-in on the loader and an
optional query parameter.

**Rationale**: The reference module shows its data in its own admin zone, through its own route. No
admin screen requests `?extensions=` today (`admin/src`, `packages/admin-shell/src`,
`packages/admin-kit/src`, `packages/modules/*/src/admin`). Every consumer this feature names reads
through a port. D2 has the wire on `organizations` alone
(`packages/modules/organizations/src/backend/routes.admin.ts`, through
`packages/platform/src/kernel/schema-extensions/reads.ts`).

**Rejected**: letting `schemaExtensionReads` also consult side-table loaders on `?extensions=` for
`organizations`, with `adminReads: true` on the loader registration. The owner asked for its cost
before ruling, and it is recorded here.

Cost of the rejected alternative, measured against `master` at `babfae111`:
- *Contract changes, one host.* `EntityExtensionLoaderEntry` gains `adminReads?: boolean`. In
  `packages/contracts/src/schema-extensions.ts`, `ExtensionAttributesSchema`'s per-module value is
  widened from `record<string, json>` to admit a loader's `T | null`. Every typed reader of
  `extensions` on the `organizations` admin record schema sees that widening. The organizations query
  and record schemas already carry `extensions`, so they do not change. Two wire rules have to be
  written:
  1. A module that declares both D2 columns and a side table on `organizations` would put two values
     under one `extensions.<moduleId>` key. This is either refused at registration or merged.
  2. The HTTP wire omits a key it cannot serve, as D2 does. It does not answer the port's 422
     `ENTITY_EXTENSION_UNCLAIMED`.
- *Tasks: five, which would have gone into Phase B1 after T038, at about one developer-day.*
  1. Failing `reads.test.ts` cases: loader consulted, `adminReads` absent leads to omission, module
     off leads to omission, one statement per module, and the collision rule.
  2. The change in `reads.ts`, plus passing the loader registry to `createSchemaExtensionReads` in
     `packages/platform/src/composition/compose-app.ts`.
  3. The registration rule for `adminReads` on a loader, plus the collision rule, with tests.
  4. A contract test of `GET /api/v1/admin/organizations` and `/:id?extensions=` covering a
     side-table module, the off state and the byte-identical response without the parameter.
  5. A section in `schema-extensions.md` and `side-table-extensions.md`, each with its Polish twin.

  `routes.admin.ts` and the admin UI do not change.
- *All nine hosts (not proposed).* The other eight would each first need D2's wire, which spec 178
  never gave them. That means `ExtensionsQuerySchema` merged into their admin list and detail query
  schemas, and `extensions` added to their admin record schema, in eight `packages/contracts` files
  (additive). It also means the `attach` call and its wiring in eight modules, plus a contract test
  and an off-state test each. That is about three tasks per host, roughly 24 tasks, and it opens D2's
  `?extensions=` on those hosts as well.
