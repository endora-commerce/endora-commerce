# Feature Specification: Side-table entity extensions as a platform mechanism (data ladder D1)

**Feature Branch**: `spec/187-side-table-extensions`
**Created**: 2026-11-23
**Status**: Draft — owner rulings of 2026-11-23 recorded as **D-294** (OR-1 – OR-10); no question
open (*Open questions* below records how the two were closed)
**Input**: Umbrella issue #1837 with #1834 (declaration and checks), #1835 (extension attributes on
aggregate read ports, OD-19) and #1836 (convention and guide). The worked example is the reference
overlay module of #1856, owned by `specs/190-overlay-full-modules/` (D-297).

**Related**: `specs/178-extensible-columns/` (D-291: the D2 machinery this sits beside — extensible
hosts, verifier, foreign-schema guard, `module:schema-extensions`),
`specs/176-command-hooks-outbox/` (D-289: `beforeCommit` hooks, used for atomic creation),
`specs/186-aggregate-ports/` (D-293: the aggregate ports the read-side lands with, host by host),
`specs/188-policy-points/` (D-295), `specs/189-command-middleware/` (D-296),
`specs/190-overlay-full-modules/` (D-297: overlay schema discovery #1850, overlay `x_*` columns
#1853, reference overlay #1856), `specs/191-membership-join-requests/` (D-298). The siblings are
being written in parallel; they are cited by slug and none of them is a prerequisite of this
document.

## Context

Measured on `origin/master` at `ff7efc3e8` (2026-11-23):

- Rung **D1** of the data ladder — "a side table your module owns, keyed by the core row's id" —
  is one row of a table in `docs/docs/architecture/customisation-ladder.md`. Nothing in the
  platform knows a table extends anything. The D2 machinery (`defineColumnExtension`,
  `packages/platform/src/db/schema-extension-verifier.ts`, `foreign-schema-guard.ts`,
  `schema-extension-projection.ts`) covers declared `x_*` columns only.
- The core tree already holds **two** D1 side tables, both in `quote_requests`
  (`packages/modules/quote_requests/src/migrations/20261014T115053_quote_requests_negotiation_policies.ts`):
  `quote_request_org_policies` (PK `organization_id` → `organizations.id`, cascade, entity
  `@OrgScoped()`) and `quote_request_account_policies` (PK `customer_account_id` →
  `customer_accounts.id`, cascade, entity `@TransitivelyScoped('CustomerAccount', 'customerAccountId')`).
  They are the only single-column-PK entities whose key names an extensible host (entity scan of
  `packages/modules/*/src/backend/entities`; a physical catalog scan is task T003).
- The nine extensible hosts are the custom-field host tables (`CUSTOM_FIELD_HOST_BINDINGS`,
  `packages/contracts/src/custom-fields.ts`). Their classifications differ: `organizations`,
  `products`, `categories` are `@GlobalEntity`; `orders`, `customer_accounts`, `quote_requests`,
  `crm_opportunities` are `@OrgScoped`; `projects`, `tasks` are `@RuleScoped`. Every host's primary
  key is one `uuid` column `id`.
- A host's tenant key can move: `customer_accounts.organization_id` is reassigned by
  `customer_account.attach_organization`
  (`packages/modules/customer_accounts/src/backend/services/customer-account-ports.ts`). A side
  table that copied it would go stale, which is exactly why feature 146 classified
  `QuoteRequestAccountPolicy` transitively (its entity comment, research R10 of that feature).
- Each of the nine aggregates has a published read port in `packages/contracts`
  (`OrganizationDetailsPort`, `CustomerAccountReadPort`, `OrderReadPort`, `QuoteRequestReadPort`,
  `CatalogProductReadPort`, `CatalogCategoryReadPort`, `OpportunityReadPort`, `ProjectReadPort`,
  `TaskReadPort`). None can return data another module keeps about the record.

The customer need: an instance keeps an external ERP key for each organization in a table its own
module owns, creates that row in the same transaction as the organization, and lets an export
worker read organizations together with the key — without N+1 calls, without a core edit, and
safe across platform upgrades.

## Owner rulings *(binding; D-294, recorded 2026-11-23, not reopened here)*

- **OR-1 (S1/E3)** — The side table becomes a declared platform mechanism, beside declared columns
  (D2). Injecting properties into core entity classes, subclassing or replacing them, and decorator
  patching are rejected.
- **OR-2 (OD-19)** — Extension attributes on aggregate read ports: opt-in
  `include: ['extensions.<moduleId>']`, one bulk loader per read, skipped when the module is off.
- **OR-3** — Hosts are the custom-field host tables (the same derived list D2 uses).
- **OR-4** — Writes go only through the extension module's own Commands; creating the side row
  atomically with the host row uses `beforeCommit` command hooks (spec 176). No change to core
  entities or core migrations.
- **OR-5** — Origin-agnostic from the start: core modules, installed packages and overlay modules
  (manifest `origin`) declare and are checked on identical terms; no second rule set for overlays.
- **OR-6** — Delivery in release 0.113.0, which begins with the MikroORM 7 move (#1073, #1866:
  7.2.11, legacy decorators from `@mikro-orm/decorators/legacy`, `MetadataStorage.getAll()` a
  `Map`, `getMetadataFromDecorator` removed, knex → kysely). Implementation of #1834/#1835 starts
  after #1866 merges; this design is written against v7.
- **OR-7** — Overlays become full modules with schema and an instance build (#1858, spec 190).
  Overlay side tables exist once overlay schema discovery (#1850) lands; the checks do not differ by
  origin.
- **OR-8** — An undeclared side table is a warning first and a refusal after one deprecation
  release (the OD-4 rule).
- **OR-9 (OQ-187-1 = A, 2026-11-23)** — A side table of an `@OrgScoped` host is
  `@TransitivelyScoped('<HostClass>', '<pkProperty>')` to its host instead of carrying its own copy of
  `organization_id`; the admitted classifications are research R-6's table. A platform default-on
  filter on such side entities (option B) is not part of this feature and stays a possible follow-up.
- **OR-10 (OQ-187-2 = defer, 2026-11-23)** — Side-table attributes are not offered on admin HTTP
  responses (the D2 `?extensions=` wire) in this feature; FR-080 stands. They can be added later as a
  non-breaking extension. Research R-17 records the cost of doing it now.

## Clarifications

### Session 2026-11-23 (architect; rulings below are D-294 architect rulings, research.md R-1 – R-16; R-17 records owner ruling OR-10)

- Q: Where is a side table declared? → A: In the module **manifest**, `extends: [{ entity, table }]`,
  not as a code export like D2's `schemaExtensions`: the declaration is pure data, so the lifecycle,
  `module:schema-extensions list` and `audit-packages` can read it without loading backend code
  (R-1).
- Q: How is the host named? → A: `'<ownerModuleId>.<EntityClassName>'`, as #1834 writes it,
  validated against the binding registry, which gains the host's entity class name (R-2).
- Q: Which hosts are open? → A: All nine from the first release. D2 rolled out `organizations` alone
  because it writes DDL on the host; a side table touches nothing on the host but a foreign key
  pointing at it (R-3).
- Q: What tenancy must a side table carry? → A: The **host-following** classification (R-6): the
  side row is reachable exactly when its host row is, and never carries a copy of a tenant key that
  could go stale. The owner confirmed this against the issue's literal wording ("the host's tenancy
  decorator") on 2026-11-23: OQ-187-1 = A, recorded as OR-9.
- Q: Is "no loader registered" observably different from "module off"? → A: Yes, and that does not
  breach XVII: 422 answers a fact about the **build** (no composed module registered a loader for
  that key — a typo or a missing dependency), never either presence axis. An installed-but-off or
  platform-unavailable module's key is absent (R-10).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A module author declares a side table and the platform verifies it (Priority: P1)

A module author (core, package or overlay) writes a module `acme_erp` that depends on
`organizations`, owns the entity `AcmeErpOrganizationLink` on table `acme_erp_organization_links`
(primary key `organization_id`, a foreign key to `organizations.id` with `on delete cascade`), and
declares in its manifest `extends: [{ entity: 'organizations.Organization', table:
'acme_erp_organization_links' }]`. `migrate` succeeds, the backend boots, and
`module:schema-extensions list` shows an `entity-extension` row beside the `x_*` column rows.

**Why this priority**: It is the mechanism; every other story builds on the declaration.

**Independent Test**: A new installed-package fixture `mod-acme-links` (the D2 fixture `mod-acme-erp` stays as it is, because the D2 page quotes it); `migrate up`
on a fresh database, then `module:schema-extensions list --json`; and the two core side tables of
`quote_requests`, declared by this feature, pass the same checks in this repository's own suite.

**Acceptance Scenarios**:

1. **Given** the declaration above and a fresh database, **When** `migrate up` runs, **Then** it
   commits, and the side-table verification ran inside the migration transaction after every
   migration of the run.
2. **Given** the migrated database, **When** the backend boots, **Then** it boots, and the boot
   verification issued one catalog query for all declared side tables together.
3. **Given** the migrated database, **When** the operator runs `module:schema-extensions list`,
   **Then** the output has a row of kind `entity-extension` naming `acme_erp`, its origin, the host
   `organizations.Organization` (`organizations`), the table `acme_erp_organization_links`, the
   foreign-key constraint and status `verified`.
4. **Given** the same module shipped as a core module, an installed package or an overlay module,
   **When** the three are checked, **Then** the rules, errors and list rows are identical except for
   the `origin` column.
5. **Given** `quote_requests` declares its two existing side tables, **When** this repository's
   suite runs, **Then** no `undeclared-entity-extension` warning is emitted for the core composition.

### User Story 2 — A broken side table cannot reach production (Priority: P1)

A side table that is keyed wrongly, does not cascade, belongs to a module that does not depend on
the host, or is tenant-scoped differently from its host is refused at `migrate` and at boot with a
named error, before any request can read across organizations or leave orphan rows.

**Why this priority**: Principle XI is non-negotiable and the cascade is what keeps a side table
from holding rows for deleted hosts; this is the part review alone has been enforcing.

**Independent Test**: Unit tests over discovered metadata (no database) for each metadata rule;
integration tests on a throwaway database for each physical rule, each asserting the error code,
the module, the table and that the `migrate` run rolled back.

**Acceptance Scenarios**:

1. **Given** the side table's primary key has two columns, **When** `migrate up` runs, **Then** it
   fails with `EntityExtensionInvalidError` rule `primary-key-not-single`, naming the module and
   the table, and the run rolls back.
2. **Given** the foreign key is `on delete restrict` (or there is no foreign key, or it references a
   column other than the host's primary key), **When** `migrate up` runs, **Then** it fails with rule
   `foreign-key-missing` or `foreign-key-not-cascade` and rolls back; **when** the backend boots on
   such a database, **then** boot fails with the same rule.
3. **Given** the declaring module's dependency closure does not contain `organizations`, **When**
   the manifests are composed, **Then** composition is refused with rule `host-not-a-dependency`.
4. **Given** `entity: 'invoices.Invoice'`, **When** the manifest is loaded, **Then** it is refused
   with rule `host-not-extensible`, listing the nine extensible hosts.
5. **Given** a side table of `customer_accounts` whose entity is `@OrgScoped()` with its own
   `organization_id` column, **When** the entities are discovered, **Then** discovery is refused with
   rule `tenancy-mismatch`, naming the classification the host requires.
6. **Given** a side table of `organizations` whose entity is `@GlobalEntity()` or `@OrgScoped()`
   keyed by its primary key, **When** discovered, **Then** both are accepted.
7. **Given** the declared table is mapped by no entity of the declaring module (another module's
   entity maps it, or none does), **When** discovered, **Then** it is refused with rule
   `table-not-owned`.

### User Story 3 — Undeclared side tables are reported, then refused (Priority: P2)

A module that already keeps a side table without declaring it is told so — at `migrate`, at boot
and by `module:schema-extensions list` — for one release, and refused the release after.

**Why this priority**: It turns the convention into a mechanism for tables written before this
feature, without breaking an instance on the upgrade that introduces it.

**Independent Test**: An integration test with a fixture module whose table has a primary-key
foreign key to `orders` and no declaration: a `warn` line and an `undeclared-entity-extension` row in
0.113.0's policy; the same database refused with the policy flipped.

**Acceptance Scenarios**:

1. **Given** a table whose whole primary key is a foreign key to an extensible host, mapped by an
   entity of a composed module, and not declared, **When** `migrate up` or boot runs under the
   `warn` policy, **Then** both succeed and log one `warn` line naming the module, the table and the
   declaration to add.
2. **Given** the same database under the `refuse` policy (the release after), **When** `migrate up`
   runs, **Then** it fails with `undeclared-entity-extension` and rolls back.
3. **Given** such a table that no composed module's entity maps (residue of a package removed
   without `uninstall --hard`), **When** checked under either policy, **Then** it is reported as
   `unowned-entity-extension` at `warn` and never refused.
4. **Given** either case, **When** `module:schema-extensions list` runs, **Then** the table appears
   with status `undeclared` or `unowned`.

### User Story 4 — A consumer reads an aggregate together with its extensions (Priority: P1)

An export worker in another module calls `organizationDetailsPort.findByIds(ids, { include:
['extensions.acme_erp'] })` and receives each organization with `extensions: { acme_erp: { erpKey:
'ERP-42' } }` (or `{ acme_erp: null }` where no side row exists), in one extra query for the whole
page.

**Why this priority**: It is what makes a side table usable by anyone but its owner, and the
reason OD-19 was accepted.

**Independent Test**: A contract test per host read port: byte-identical result without `include`;
one loader call per included module per port call (spied); one SQL statement per loader for 50
records (query logger).

**Acceptance Scenarios**:

1. **Given** `acme_erp` registered a loader on `organizations.Organization`, **When** a read port
   method is called without `include`, **Then** the records are byte-identical to today's and the
   loader is not called.
2. **Given** the same, **When** `findByIds` of 50 ids is called with `include:
   ['extensions.acme_erp']`, **Then** the loader is called once with the 50 ids of the records the
   port returned, each record carries `extensions.acme_erp` (`T` or `null`), and one SQL statement
   was issued for it.
3. **Given** `acme_erp` is switched off by the operator (or platform-unavailable), **When** the same
   call runs, **Then** the records carry no `acme_erp` key (absent, not `null`), the loader is not
   called, and no error is raised.
4. **Given** no composed module registered a loader for `extensions.acme_crm` on this host, **When**
   it is included, **Then** the call is refused with `422 ENTITY_EXTENSION_UNCLAIMED`, `details`
   naming `extensions.acme_crm`, before any loader runs.
5. **Given** an actor scoped to organization A and a host that is `@OrgScoped` (`orders`), **When**
   `findByIds([orderOfA, orderOfB])` is called with an include, **Then** the loader receives only
   `orderOfA`, because it is called with the ids of the records the port already authorised.
6. **Given** a loader returns a value its declared schema refuses, **When** the read runs, **Then**
   it fails with `EntityExtensionLoaderOutputError` (500) naming the module and host; nothing is
   silently dropped.

### User Story 5 — Off, uninstall and host deletion behave predictably (Priority: P2)

An operator switches `acme_erp` off and on, uninstalls it, and deletes an organization; the side
rows follow rules the operator can predict.

**Independent Test**: Off-state integration test over the fixture: host writes, host responses and
host audit rows byte-identical with the module on, off and absent.

**Acceptance Scenarios**:

1. **Given** `acme_erp` is off, **When** an organization is created, **Then** its `beforeCommit`
   hook does not run (spec 176), the organization is created, no side row is written, and existing
   side rows are kept.
2. **Given** `acme_erp` is switched back on, **Then** its rows, loader and hook are back unchanged.
3. **Given** an organization with a side row, **When** it is hard-deleted, **Then** its side row is
   removed by the cascade.
4. **Given** `module:uninstall acme_erp --hard`, **Then** the module's own `down()` drops its own
   side table and nothing on `organizations` changes; **given** `module:uninstall organizations`
   while `acme_erp` is installed, **then** it is refused with `dependents-block`.

### User Story 6 — An instance author builds a side-table extension from one guide (Priority: P3)

An instance author reads one published page and one convention section and builds a declared side
table, an atomic hook, a loader and the off-state and uninstall tests, following the reference
overlay module of #1856.

**Independent Test**: The page's code blocks are `verbatim-from` the reference module's sources
(`check:doc-snippets`), so the page cannot drift from what compiles.

**Acceptance Scenarios**:

1. **Given** the guide, **Then** it covers the declaration and what `migrate` checks, writes through
   the module's own Commands and a `beforeCommit` hook, the loader and `include`, off state and
   uninstall, and when to choose D1 over D2 and over custom fields — in English and Polish.
2. **Given** `specs/conventions/module-migrations.md`, **Then** it states the side-table rule once,
   and the guide and the ladder cite it rather than restating it.

### Edge Cases

- **Two modules extend one host**: independent declarations, tables, loaders and `extensions` keys;
  ordering between them is irrelevant (each loader is called once).
- **One module declares two side tables on one host**: allowed; it registers **one** loader for
  that host, which reads both tables (one `extensions.<moduleId>` key per module per host).
- **A side table of a side table** (a table keyed by `acme_erp_organization_links`): not an
  extension — the parent is not an extensible host — and not reported.
- **A composite-key table that contains a host key** (`blog_post_related_products`): not a side
  table (its primary key is not exactly the foreign key) and not reported.
- **A host row is soft-deleted** (`deleted_at`): the side row stays; only a hard delete cascades.
  The read port returns what it returns today for soft-deleted rows, and the loader runs for the
  ids it returns.
- **`include` repeats a module**: deduplicated; one loader call.
- **`include` on an empty result**: no loader call.
- **The loader throws**: the read fails with the loader's error (no `catch`, `module-composition.md`
  item 7); a `ModuleDisabledError` cannot arise, because a loader of an absent module is never
  called.
- **The declaring module is platform-unavailable but its table exists**: the table is still owned by
  a composed module's entity (entities register whether or not the module is on), so it is checked
  as declared; its loader is skipped.
- **`db:fresh`**: ordering by `dependencies` puts the host's migrations first, so the foreign key
  can always be created.
- **A core migration that rebuilds a host table** (`drop table … cascade`) would drop every side
  table's foreign key: the D2 preservation test gains one sample side table per host and catches it
  in core CI; `check:extensible-tables` already refuses the rebuild on the merge request.

## Requirements *(mandatory)*

### Declaration

- **FR-001**: `ModuleManifestSchema` (`packages/contracts/src/modules.ts`) MUST accept an optional
  `extends` array of `{ entity, table }` entries (`contracts/entity-extension-declaration.md`):
  `entity` matches `<moduleId>.<EntityClassName>`, `table` is a lower-case SQL identifier of at most
  63 bytes; at most 16 entries; no table twice in one manifest.
- **FR-002**: `entity` MUST name an extensible host: its module and class name equal one binding's
  `ownerModuleId` and `entityClassName` in `CUSTOM_FIELD_HOST_BINDINGS`; otherwise refused as
  `host-not-extensible`, listing the hosts.
- **FR-003**: `CUSTOM_FIELD_HOST_BINDINGS` MUST gain `entityClassName` per binding; at ORM discovery
  the platform MUST refuse, as `host-binding-mismatch`, a binding whose table is mapped by an entity
  of another class name (a runtime self-check, so an instance is held to it too and no `check-*`
  script changes).
- **FR-004**: The host's owning module MUST be in the declaring module's dependency closure
  (`dependencies`, transitively, as `module-migrations.md` item 4 and D2's V10 read it); otherwise the
  composition is refused as `host-not-a-dependency`.
- **FR-005**: The declaration rules MUST be identical for manifest origins `core`, `package` and
  `overlay`; the origin appears in diagnostics and list rows only.

### Metadata checks (discovered entities, no database)

- **FR-010**: At ORM discovery (the `afterDiscovered` hook, used at `migrate` and at boot) the
  platform MUST, for each declaration, find the entity mapping `table` and refuse as
  `table-not-owned` when none does or when it belongs to a module other than the declaring one.
- **FR-011**: The entity's primary key MUST be exactly one property, of the host primary key's type
  (`uuid`); otherwise `primary-key-not-single` or `primary-key-type-mismatch`.
- **FR-012**: The entity's tenancy classification MUST be one the host's classification admits
  (`contracts/verification-rules.md` §3); otherwise `tenancy-mismatch`, naming the admitted forms.
- **FR-013**: Metadata MUST be read from what MikroORM discovered (v7 `MetadataStorage`, iterated as a
  `Map`) and from the tenancy registry, never from entity decorators directly.

### Physical checks (catalog)

- **FR-020**: The platform MUST verify, for each declared table: it exists; its primary-key
  constraint's columns equal a foreign-key constraint's columns; that foreign key references the
  host table's primary key; its delete action is `cascade`. Rules: `table-missing`,
  `foreign-key-missing`, `foreign-key-not-cascade`.
- **FR-021**: `migrate up`, `migrate fresh` and lifecycle `install` MUST run this verification inside
  the migration transaction, after the run's migrations and beside the D2 verifier; a violation rolls
  the whole run back.
- **FR-022**: Boot (`composeApp`, right after the ORM opens, beside the D2 verifier) MUST run it
  read-only; a violation of a declared table fails boot.
- **FR-023**: Declared and undeclared tables together MUST cost **one** catalog query per
  verification, whatever their number.

### Undeclared side tables

- **FR-030**: A table whose whole primary key is a foreign key to an extensible host's primary key and
  which is not declared MUST be reported: `undeclared-entity-extension` when an entity of a composed
  module maps it (naming that module and the manifest entry to add), `unowned-entity-extension` when
  none does. A table owned by the host's own module is not an extension and is not reported (it may
  not be declared either: rule `self-extension`).
- **FR-031**: The platform MUST carry one policy constant: `warn` in the release that ships US1,
  `refuse` from the release after (OR-8). Under `refuse`, `undeclared-entity-extension` fails
  `migrate` and boot like FR-021/FR-022. `unowned-entity-extension` is a `warn` under both, because a
  table no composed module owns is residue no author can fix by declaring.
- **FR-032**: `quote_requests` MUST declare its two existing side tables in the release that ships
  US1, and this repository's suite MUST assert zero undeclared findings for the core composition.

### Operator visibility

- **FR-040**: `module:schema-extensions list` MUST print, beside the ledger's `column` and `index`
  rows, one row per declared or found side table: kind `entity-extension`, module, origin, host
  entity, host table, side table, constraint name, status (`verified` | `violation:<rule>` |
  `undeclared` | `unowned`); `--json` and `--module` apply (`contracts/schema-extensions-cli.md`).
- **FR-041**: `module:schema-extensions audit-packages` MUST list each installed package's `extends`
  declarations with the verdict of the static rules (FR-001 – FR-004), without a database.
- **FR-042**: Side tables MUST NOT be written to the `schema_extensions` ledger; their rows are
  derived on each run (research R-8).

### Extension attributes on read ports

- **FR-050**: `@endora-commerce/contracts` MUST publish `EntityExtensionIncludeSchema`
  (`extensions.<moduleId>`, at most 8, deduplicated), the `EntityExtensionReadOptions` type
  (`{ include?: readonly EntityExtensionInclude[] }`) and `WithEntityExtensions<R>`
  (`R & { extensions?: Readonly<Record<string, unknown>> }`).
- **FR-051**: A module that declared a side table on a host MAY register exactly one loader for that
  host with `ctx.entityExtensionLoaders([{ host, schema, load }])`, where `load(ids, { em })` resolves
  a `ReadonlyMap<id, T>` and `schema` is the Zod schema of `T`. A loader on a host the module did not
  declare is refused at composition (`loader-without-extension`); a second loader for one
  (module, host) is refused (`duplicate-loader`).
- **FR-052**: The platform MUST provide the kernel-registered service `entityExtensionReads` whose
  `attach(host, records, include, em)` the host read ports call.
- **FR-053**: Without `include` (or with an empty one), a read port's result MUST be byte-identical
  to today's and no loader may run.
- **FR-054**: With `include`, the service MUST call each included module's loader **once** per port
  call with the ids of the records the port is about to return, under the caller's tenant context and
  on the port's entity manager; each record gains `extensions.<moduleId>`: the loader's value, or
  `null` when it returned none for that id. Ids the loader returns that were not asked for are
  dropped.
- **FR-055**: An included module whose loader is registered but whose module is not effectively
  present MUST be skipped: no call, key absent, no error.
- **FR-056**: An included key no composed module registered a loader for on that host MUST be refused
  with `422 ENTITY_EXTENSION_UNCLAIMED` (`details: [{ path: 'extensions.<moduleId>', issue }]`)
  before any loader runs; the code is declared by `_lifecycle` and translated (pl + en).
- **FR-057**: Every value MUST be parsed with the loader's schema; a refusal fails the read with
  `EntityExtensionLoaderOutputError` (500) naming the module and host.
- **FR-058**: The record-returning methods of the nine read ports MUST accept
  `options?: EntityExtensionReadOptions` as an optional last parameter and return
  `WithEntityExtensions<Record>`; non-record methods (counts, id searches, resolutions) do not. Host
  by host, in step with `specs/186-aggregate-ports/`; `organizations` first.

### Writes, off state, uninstall

- **FR-060**: The platform MUST NOT offer any write path into a side table: writes are the extension
  module's own Commands, or a `beforeCommit` hook on a hookable host action (spec 176) that writes the
  module's own rows on the hook's `em` and reports changed field **names** with `noteAuditChanges`.
- **FR-061**: Switching the extension module off MUST keep its rows; its hooks are skipped (176), its
  loader is skipped (FR-055), its routes are off. Host writes, responses and audit rows MUST be
  byte-identical whether the module is on, off or absent.
- **FR-062**: Hard uninstall of the extension module runs its own migrations' `down()`, which drops
  its own table; hard uninstall of the host is refused by `dependents-block` while a declaring module
  is installed. No new uninstall behaviour.

### Preservation, governance, documentation

- **FR-070**: The D2 preservation test MUST create one sample side table per extensible host,
  immediately after the migration that creates the host, and assert its cascading foreign key
  survives the full migration order.
- **FR-071**: Constitution I MUST state that a side table keyed 1:1 by an extensible host's primary
  key is declared and platform-verified, and XI that its tenancy follows its host; MINOR version bump,
  chained per spec 178's R-A3 rule (no version reserved in advance).
- **FR-072**: `specs/conventions/module-migrations.md` MUST carry the side-table rule once (item 4b);
  `customisation-ladder.md` (D1 row), `schema-extensions.md`, `migrations.md` and their Polish twins
  MUST cite it; a published page `docs/docs/architecture/side-table-extensions.md` (+ PL) MUST
  carry the guide, its code `verbatim-from` the reference overlay module of #1856.

### Deferred, explicitly

- **FR-080**: Extension attributes on admin **HTTP** responses for side tables (the D2
  `?extensions=` wire) are not offered in this feature (owner ruling OR-10; research R-17). Adding them
  later is a non-breaking extension.
- **FR-081**: Filtering or sorting a host list by side-table values, search indexing, exports, PDFs,
  storefront responses and events carry no side-table data.
- **FR-082**: Generating a side table from a declaration is not offered; the module writes its own
  migration and the platform verifies it (#1834 alternatives).

## Key Entities

- **Entity-extension declaration** — a manifest entry naming an extensible host and a table the
  declaring module owns; it carries no columns, because the table and its entity are the module's.
- **Side table** — the declaring module's own table, whose single-column primary key is a cascading
  foreign key to the host's primary key, mapped by the module's own entity.
- **Extension loader** — a module's bulk reader for one host, with the schema of the value it
  returns per host id.
- **Extension attribute** — `extensions.<moduleId>` on a record a host read port returns, present only
  when included.

## Success Criteria *(mandatory)*

- **SC-001**: A module declares, verifies, fills (through a hook) and exposes (through a read port) a
  side table on `organizations` with zero edits to core entity classes or core migrations.
- **SC-002**: Every refusal rule of `contracts/verification-rules.md` has a red test that names its
  rule, and each physical refusal rolls a `migrate` run back.
- **SC-003**: A read of 50 records with one include costs exactly one additional SQL statement; without
  `include` it costs none and is byte-identical.
- **SC-004**: Side-table verification adds one catalog query to `migrate` and to boot, and ≤ 20 ms on a
  database with 16 declared side tables.
- **SC-005**: The core composition reports zero undeclared side tables.
- **SC-006**: The rules, errors and list output for a declaration are identical across origins
  `core`, `package` and `overlay`.

## Assumptions

- #1866 (MikroORM 7.2.11) has merged before implementation starts; `discovery.afterDiscovered` and a
  raw `execute` on the connection behave in v7 as they do in 6.6 (verified by the #1862 spike, task
  T001).
- Spec 176 (`beforeCommit` hooks, `noteAuditChanges`) and spec 178 (extensible hosts, verifier,
  `module:schema-extensions`) are on `master` (both are).
- `specs/190-overlay-full-modules/` delivers overlay schema discovery (#1850) and the reference overlay
  (#1856); only US1 scenario 4's overlay leg and US6 wait for them.
- `specs/186-aggregate-ports/` may reshape a read port; FR-058 then applies to the port 186 publishes
  for that aggregate.

## Open questions *(closed 2026-11-23; kept for provenance)*

- **OQ-187-1 — Tenancy of a side table whose host is `@OrgScoped`.** **Closed 2026-11-23: A**, owner
  ruling OR-9 (D-294). The side entity is `@TransitivelyScoped('<HostClass>', '<pkProperty>')`, so its
  tenant is derived from the host and never goes stale. This is the `QuoteRequestAccountPolicy`
  precedent, and research R-6's table is the admitted set. B, which adds a platform default-on filter
  on the side entity, stays a possible follow-up outside this feature. C, a copied `organization_id`,
  is rejected.
- **OQ-187-2 — Side-table attributes on admin HTTP reads.** **Closed 2026-11-23: defer**, owner
  ruling OR-10 (D-294). FR-080 stands. The owner asked for an explanation first and then took the
  recommendation. The reasons and the measured cost of the rejected alternative are recorded in
  research R-17: `schemaExtensionReads` consulting side-table loaders on `?extensions=` for
  `organizations`.

## Decisions *(D-294)*

- **D-294 (owner, 2026-11-23)** — OR-1 – OR-8 above.
- **D-294 (owner, 2026-11-23, answer to OQ-187-1)** — OR-9: recommendation A. The side table of an
  `@OrgScoped` host is `@TransitivelyScoped` to the host and carries no `organization_id` of its own.
  B (a platform default-on filter) is a possible follow-up, not this feature's. OQ-187-1 is closed.
- **D-294 (owner, 2026-11-23, answer to OQ-187-2)** — OR-10: defer. Admin HTTP `?extensions=` for
  side tables is out of scope, and FR-080 stands. It can be added later as a non-breaking extension.
  OQ-187-2 is closed. The cost of the alternative is in research R-17.
- **D-294 architect rulings (2026-11-23)** — research.md R-1 – R-16, none of which reopens an owner
  ruling.
