# Research: Tax-ID scope, personal organizations without a tax ID, personal → company conversion

Every code claim below was re-verified on `origin/master` at `2cc56ea9b` (2026-11-10). Line numbers
are that commit's. Each decision reads *decision → rationale → alternatives rejected*.

## R-1 Where the scope is enforced: the database, by two constraint shapes swapped at runtime

**Decision.** `global` keeps today's unique constraint `organizations_tax_id_unique (tax_id)`
(`organizations/src/migrations/20260424T205317_organizations_init.ts` l. 24). `per-tree-root`
replaces it with

```sql
alter table "organizations" add constraint "organizations_tax_id_one_tree"
  exclude using gist ("tax_id" with =, "root_id" with <>)
  deferrable initially deferred;
```

over a generated column `root_id` (R-2). Exactly one of the two exists at any time; which one is a
runtime fact recorded in the policy row (R-4) and changed only by `organization.tax_id_scope.set`
(R-5).

**Rationale.** Owner requirement (enforced in the database, so no concurrent or future path can
break it). An exclusion constraint is the only declarative way to say "equal tax IDs must have equal
roots". `btree_gist` is already a dependency of the schema: `catalog`'s
`20261030T113904_catalog_scope_model_url_keys.ts` l. 29 creates it and l. 49 uses the same
`=` / `<>` shape, recorded in `specs/174-product-editor-scope-switcher/plan.md` Complexity Tracking.
This feature's migration runs `create extension if not exists btree_gist` itself, because
`organizations` cannot depend on `catalog` for ordering (it is below it in the graph).

**Deferrable initially deferred** (owner text), and why it matters: a subtree move rewrites every
descendant's `path` in one `UPDATE` (`organization-tree-service.ts` `applyReparentPaths`), so the
check must not run per row mid-statement — a non-deferrable exclusion constraint does, and would
refuse a valid move of a subtree whose members share a tax ID. *Deferred to commit* additionally lets a
single transaction create a node and attach it. The cost is that the violation surfaces at
**COMMIT**, outside the Command's `run` (R-6).

**Alternatives rejected.**
- *A trigger computing the rule* — code instead of a declaration, needs explicit locking to be
  race-free, no less dependency (it still needs a lock per tax ID).
- *Both constraints always present, the unique one partial on a mode flag* — a partial index cannot
  read another table; a per-row mode column is a second source of truth.
- *A `none` scope* — refused by the owner on the architect's advice: registration would have no single
  target and nothing would protect the provisioning idempotency.
- *Application-level checks only* — the owner ruled the database must enforce it.

## R-2 `root_id`: a stored generated column, not mapped by the entity

**Decision.**
`alter table organizations add column root_id uuid generated always as (nullif(split_part(path, '/', 2), '')::uuid) stored;`
plus `create index organizations_root_id_idx on organizations (root_id)`. The MikroORM entity does
**not** map it; the two queries that need it (R-7, R-8) are SQL in the tree / lookup services, as
`path` queries already are.

**Rationale.** `path` is `'/<rootId>/…/<thisId>/'` (`organization.entity.ts` l. 177–193; never
empty on a stored row, repaired by `20261003T184802_organizations_repair_empty_paths.ts`). Every
function in the expression is immutable (`split_part`, `nullif`, the `text → uuid` input cast), as a
generated column requires. Stored, so the exclusion constraint can index it. Postgres recomputes it on
every `path` update, so the tree Commands need no change to keep it right. `nullif` keeps an empty path
(only on an unsaved row) from failing the cast.

Not mapped: MikroORM 6.6.16 can declare `generated` properties, but mapping adds a column every
`em.create` must not write and every fixture must not set, for no reader that cannot use SQL. The dev
MAY map it read-only later if a reader appears.

**Alternatives rejected.** *A real `root_id` column maintained by the tree Commands* — a second copy of
`path` that every writer (and every test fixture) must keep in step; the empty-path incident
(`organization.entity.ts` l. 178–193) is what that costs. *An expression in the constraint itself* —
exclusion constraints accept expressions, but `findByTaxId` and the duplicate report also need the
root, and three spellings of one expression drift.

Adding a stored generated column rewrites the table under an `ACCESS EXCLUSIVE` lock. `organizations`
is small relative to orders; the migration header says so and the upgrade note repeats it.

## R-3 Personal organizations: `tax_id` nullable, a `personal_account_id` link, and a check

**Decision.**
1. `tax_id` becomes nullable; every personal row's `tax_id` is set to `null`.
2. New `personal_account_id uuid null`, backfilled for personal rows whose old `tax_id` matches
   `^[0-9a-f]{32}$` by re-inserting the dashes (the placeholder **is** the account id without dashes —
   `personal-organization-service.ts` l. 458–460, and the 051 backfill
   `20260717T151403_organizations_personal_organizations.ts` l. 38). Partial unique index
   `where personal_account_id is not null`.
3. Two checks: `organizations_tax_id_presence check (is_personal = (tax_id is null))` and
   `organizations_personal_account_link check (personal_account_id is null or is_personal)`.
4. The unique constraint `organizations_tax_id_unique` is **kept as is**: PostgreSQL treats NULLs as
   distinct, so the personal rows' NULLs never collide, and "uniqueness only for company orgs" holds
   without a partial index. The exclusion constraint of R-1 likewise ignores NULL tax IDs.

**Rationale.** The placeholder did two jobs (`research` of the owner's working doc, reader row 1):
satisfying `NOT NULL` + unique, and keying the provisioning's idempotency
(`provisionFor`, l. 195–203; `provisionPersonalOrganizationFor`, l. 285–295, which must find the
account's **own** personal organization even while the account belongs to a company — so the
membership column cannot replace it). `personal_account_id` takes over the second job explicitly.
Keeping the constraint name avoids touching anything that names it and keeps the migration minimal.
The presence check turns FR-001 into a database rule.

**Not a foreign key** to `customer_accounts(id)`: `customer_accounts` depends on `organizations`, so a
reverse FK would make the dependency graph cyclic (`module-migrations.md` item 4) and the migration
cannot read that table (item 4a). The column is a correlation id; the provisioning writes it from the
id the caller is about to insert (D-178's ordering, `customer-account-lifecycle-ports.ts` l. 158–170).

**Alternatives rejected.** *A partial unique index `where not is_personal`* — equivalent under the
presence check, a new name for no gain. *Find the personal organization by its single member* — wrong
for the unassign destination (the account currently belongs to a company) and racy at provisioning
(the account row is not written yet). *Keep the placeholder and only hide it* — what #767 already did
(`organizationCompanyTaxId`); the owner ruled it removed.

## R-4 Where the scope lives: an `organization_tax_id_policy` row, not a Setting

**Decision.** A single-row table owned by `organizations`:
`organization_tax_id_policy (id boolean primary key default true check (id), scope text not null check (scope in ('global','per-tree-root')), updated_at timestamptz, updated_by_admin_user_id uuid null)`,
seeded `global` by the migration. Entity `OrganizationTaxIdPolicy`, `@GlobalEntity()`.

**Rationale.** The Settings write path is generic (`settings.value_changed`) and cannot run DDL in the
same transaction, so a Setting would let the stored value and the constraint disagree. A row in this
module's own table changes in the same transaction as the DDL (PostgreSQL DDL is transactional). It is
platform-global by nature (one scope per installation), like the module's other settings.

**No cache.** Every write path reads the row inside its own transaction (FR-026); the read is one
primary-key lookup on a one-row table, on paths that are rare writes (registration, create, tree
moves, conversion). No Redis value, therefore no lifecycle pub/sub invalidation to design.

**Boot consistency probe.** At boot the module compares the row with `pg_constraint` (which of the two
constraint names exists) and logs `error` naming both when they disagree; it does not fail boot,
because the repair (re-run the command for the intended mode, FR-016) needs a running admin.

**Alternatives rejected.** *A Setting plus a settings-changed subscriber that runs the DDL* — two
transactions, the failure in between leaves them disagreeing. *Derive the scope from `pg_constraint`
alone* — works, but audit, "set by whom" and the admin screen want a row, and a catalog query per
write is heavier than a PK lookup.

## R-5 The scope command: one transaction, lock, check, swap

**Decision.** `organization.tax_id_scope.set` (`objectType: 'organization_tax_id_policy'`,
`objectId: 'installation'`), run through the Command Bus, does on its transactional `em`:

1. `select … from organization_tax_id_policy for update` — serialises concurrent scope changes.
2. Same scope as stored → re-assert DDL idempotently (`if not exists` / guarded `do` block), return
   `skipAudit: true`.
3. `global → per-tree-root`: `lock table organizations in share row exclusive mode`; add the exclusion
   constraint; drop `organizations_tax_id_unique`. Adding before dropping keeps the table covered.
4. `per-tree-root → global`: same lock; run the duplicate report (`select tax_id, count(*) … group by
   tax_id having count(*) > 1`, plus up to 20 examples with their organization ids); any row → throw
   `409 ORGANIZATION_TAX_ID_SCOPE_DUPLICATES` with `{ sharedTaxIdCount, examples }`; else add the
   unique constraint, then drop the exclusion constraint.
5. Update the row; audit `before: { scope }`, `after: { scope }` (codes, `audit-state.md` §5: the policy
   is platform-global).

The lock blocks inserts and tax-ID/path updates for the duration of the constraint build — seconds at
the sizes this table has; the screen says so before the operator confirms.

**Gate.** `requireAdmin('organizations:manage-tax-id-scope')` **and** an unscoped tenant context
(`ctx.mode === 'all'`), the idiom of the parent route (`routes.admin.ts` l. 1029–1053, D-260): a
scoped administrator must not change a platform-wide invariant.

**Alternatives rejected.** *`create index concurrently`* — cannot run in a transaction, so the row and
the constraint would change separately. *A migration per mode* — migrations must not depend on runtime
state (owner's working doc: "migrations do not depend on the mode").

## R-6 Mapping `23505` and `23P01` — at the statement **and** at commit

**Verified.** `@mikro-orm/postgresql@6.6.16` `PostgreSqlExceptionConverter` maps `23505` to
`UniqueConstraintViolationException` and has no case for `23P01`, which becomes a plain
`DriverException` carrying `code` (and the pg error's `constraint`). `catalog`'s
`url-key.service.ts` l. 171–174 already recognises both codes the same way.

**Decision.** One pure helper in `organizations`,
`taxIdConflictOf(err): 'tax_id_exists' | 'tax_id_shared_across_trees' | null`, which reads `code` and
`constraint` from the error or its `cause`, and recognises `23505` on `organizations_tax_id_unique` /
`23P01` on `organizations_tax_id_one_tree`. Two places use it:

- **Inside a Command's `run`**, around its `flush` (today's catch sites:
  `create-organization.command.ts` l. 68–79, `registration-service.ts` l. 185–196) — catches a
  `global`-mode `23505`.
- **Around `commandBus.run`** at each call site — a single wrapper
  `runOrganizationWrite(bus, command, kind)` — because a **deferred** constraint fires at `COMMIT`,
  which the bus performs after `run` returns (`packages/platform/src/commands/command-bus.ts` l. 65).
  Call sites: admin create, the parent route (set-parent / move), the conversion route and port,
  and registration (today the service's own flush; after 176, its Command's run site).

The answer depends on the path: creation and conversion → `409 ORGANIZATION_TAX_ID_EXISTS`;
set-parent / move → `409 ORGANIZATION_TREE_INVALID` with `details.code = 'tax_id_shared_across_trees'`.
Never the constraint name in the message.

**Alternatives rejected.** *`SET CONSTRAINTS … IMMEDIATE` at the end of each `run`* — surfaces the
error inside `run`, but breaks the moment a Command runs as a child of another (176's hooks, a
create-then-attach composite): the child would force a check the parent meant to defer. *Patch
MikroORM's converter* — a fork of a dependency for one code. *Platform-level translation in the bus* —
the platform cannot know which 409 a module wants; a module-level wrapper is the owner's answer.

## R-7 Pre-checks: clear refusals before the database has to

**Decision.** The database is the guarantee; pre-checks give the readable answer and the details.

- **Create / registration / conversion** (new or changed row with tax ID X and intended root R):
  conflict iff some live-or-deleted company row with X has `root_id ≠ R` (in `per-tree-root`) or
  exists at all (in `global`). A root-creating path has R = its own new id, so any existing X is a
  conflict — registration therefore refuses in both scopes (FR-022).
- **Set-parent / move** (subtree S moving to new root R'): in `per-tree-root`, conflict iff some tax ID
  of S exists on a row outside S whose root after the move ≠ R'. One SQL statement over `root_id` and
  `path like :subtreePath || '%'`. In `global` a move cannot conflict (no tax ID is shared), so the
  check is skipped.

**Alternatives rejected.** *Database only* — correct but answers with no detail and only at commit.

## R-8 `findByTaxId` / `resolveByTaxId`

**Decision.** On `organizationDetailsPort` (the read port, `organization-details-port.ts`; contract
`OrganizationDetailsPort`, `contracts/src/organizations.ts` l. 547):

```ts
findByTaxId(taxId: string, options?: { includeDeleted?: boolean }): Promise<OrganizationRecord[]>;
resolveByTaxId(taxId: string): Promise<TaxIdResolution>;
type TaxIdResolution =
  | { kind: 'none' }
  | { kind: 'one'; organization: OrganizationRecord }
  | { kind: 'ambiguous'; organizations: OrganizationRecord[] };
```

`findByTaxId` normalises with the admin boundary's rule (`schemas/organization.ts` l. 18–24: strip
whitespace and dashes, upper-case), orders `root_id = id desc, depth asc, created_at asc, id asc`
(depth = segment count of `path`). `resolveByTaxId` answers `none` for `[]`, `one` with the root when
all matches share one root, `ambiguous` otherwise — unreachable in both scopes (asserted by a test that
builds the database states each scope allows). The in-module service methods take an optional `em`
so Commands use them inside their transaction.

The owner's working doc places `findByTaxId` on `organizationCommandPort`; it is a read and belongs on
the read port beside `findById`/`findByIds`, which is what modules already resolve for reads. The
command port (R-10) carries writes only.

**Alternatives rejected.** *Keep `findOne({ taxId })`* — in `per-tree-root` it returns an arbitrary
member of the tree. *Only `resolveByTaxId`* — integrators that list branches need the list.

## R-9 Admin create gains an optional `parentId`

**Decision.** `AdminOrganizationCreateBodySchema` (`contracts/src/organizations.ts` l. 1075) gains
`parentId?: uuid`. The create Command inserts the row with `parentId` and a computed `path` (the tree
service's path rule, `organization-tree-service.ts` l. 298), after the cycle-free/depth checks the tree service already runs
(`assertMaxDepth`). Naming a parent requires an unscoped tenant context, D-260's rule (an
organization's parentage widens a sales representative's reach, `routes.admin.ts` l. 1037–1047).

**Rationale.** Today create has no parent (`create-organization.command.ts`), so in `per-tree-root`
the branch would be a new root with the head office's tax ID and be refused — create-then-attach would
need two requests and two transactions, the second of which the constraint refuses. One Command,
one transaction, one audit entry.

**Alternatives rejected.** *A separate `organization.create_branch` command* — same write with a
second name. *Relying on deferral across two requests* — impossible, deferral ends at commit.

## R-10 `organizationCommandPort` — new, with `convertToCompany` only

**Verified.** PR #990 (`feat/org-custom-field-write-port`, open) publishes
`organizationCustomFieldWritePort` (`OrganizationCustomFieldWritePort`, method
`setCustomFieldValues(organizationId, merge)`), **not** an `organizationCommandPort`; the
implementation is `OrganizationCustomFieldWriteService(commandBus)` registered with
`ctx.di.providePort` in `backend/index.ts`.

**Decision.** This feature publishes a new port `organizationCommandPort`
(`OrganizationCommandPort` in `@endora-commerce/contracts`) with one method:

```ts
convertToCompany(organizationId: string, input: OrganizationConvertToCompanyInput): Promise<OrganizationRecord>;
```

built exactly like #990's service (a class over `commandBus`, `providePort`, ambient actor,
`503 MODULE_DISABLED` off-gate inherited from the port machinery). If #990 has merged first the new
service sits beside `OrganizationCustomFieldWriteService` and copies its shape; if not, nothing in
177 depends on #990. Folding `setCustomFieldValues` into `organizationCommandPort` (the architect
review's e1 suggestion) is **not** done here — renaming a just-published port is a second breaking
change for no consumer; recorded as an open decision (OD-4).

**"Never from customer routes"** is a property of where the port is resolved, which no type can
express, so it is a test (FR-031): enumerate every registered route whose path does not start
`/api/v1/admin/`, inject a request for each, and assert the conversion Command never ran (a recording
Command Bus); plus a static check that no file under `routes.customer.ts`, `routes.public.ts`,
`routes.storefront.ts`, `routes.members.ts`, `routes.roles.ts` or `storefront/` names
`convertToCompany` or `makeConvertToCompanyCommand`.

## R-11 Conversion: what the transaction does

**Decision.** `organization.convert_to_company` on its transactional `em`:

1. Load and lock the organization (`for update`); refuse `404` out of reach;
   `409 ORGANIZATION_CONVERSION_REFUSED` with `not_personal` (company) or `deleted` (soft-deleted or
   anonymised — `isFullyScrubbed`/`deletedAt`).
2. Read the scope; run the R-7 pre-check for (X, root of this org); refuse
   `409 ORGANIZATION_TAX_ID_EXISTS`.
3. Roles: ensure both predefined rows exist (`insert … on conflict do nothing`, the trigger's own
   statement — `20261103T173304_organizations_organization_roles.ts` l. 122–131 — since the M2
   migration and the trigger already give every organization both rows, this is a guard); read the
   live member's role through `customerAccountReadPort` and refuse `owner_not_administrator` when it
   is not the administrator role (FR-070a of `specs/170-organization-roles/` makes this unreachable;
   the refusal stops a company with no administrator being produced from a breached invariant).
4. Write `isPersonal = false`, `taxId`, `name`, `legalName`, `registeredAddress`, `vatStatus`,
   `personalAccountId = null`, `convertedToCompanyAt = now()`, and `approvedAt/approvedByAdminUserId`
   when `approvedAt` is null (the admin-create precedent, `create-organization.command.ts` l. 64–67).
5. Audit (names only, `audit-state.md`): `before { isPersonal: true }`,
   `after { isPersonal: false, changedFields: [...] , taxIdScope }`.
6. `event` → `organization.converted_to_company.v1 { eventId, occurredAt, organizationId,
   convertedAt }`, dispatched once on commit by the bus.

After commit, the route drops the organization's role-cache entry (`OrganizationRoleCache.dropAndAnnounce`,
the existing pub/sub channel `b2b:organization-roles:changed`) because role management now applies
to it; and, when asked, runs `OrganizationTaxIdValidationService.triggerValidation` (R-13).

**Rationale for not re-assigning roles.** Personal organizations already hold both predefined rows
(R-28 trigger) and their member already holds *Administrator* (`specs/170-organization-roles/`
FR-070a, `ensureForCustomerAccountId` l. 265–269). The account's role column belongs to
`customer_accounts`; writing it would need a port that joins this transaction, which does not exist
(`CustomerAccountMemberWritePort` takes no `em`). Asserting the invariant is enough and stays in one
transaction.

**Status.** Kept; a personal organization is `active` from provisioning, and an operator converting
it is the moderator. `moderation_mode = manual` governs self-registration, not an operator's write —
the admin-create precedent.

## R-12 Which consumers react to the conversion (scoped for this release)

Verified by `grep isPersonal` outside `organizations` (non-test): `customers` (address-book retirement,
depletion guard, org assignment), `orders` (`order-service.ts` billing snapshot, `routes.ts`),
`quote_requests` (RFQ panel, document), `returns` (consumer withdrawal), the storefront account area.
**No** match in `price_lists`, `credit_limits`, `sales_channels` or `taxes`: net/gross display, credit
and channel access do not branch on personal vs company today.

| Consumer | Reaction | In this release |
| --- | --- | --- |
| orders, quote_requests, storefront account area, customers | read `isPersonal` live; after conversion they treat the organization as a company | nothing to do (tests assert the live behaviour) |
| **returns** — `return-case-service.ts` l. 420–440 | classifies a return as a consumer withdrawal from the organization's **current** `isPersonal`; after conversion it would deny a consumer's statutory withdrawal for an order placed as a consumer | **yes**: classify by `isPersonal \|\| (convertedToCompanyAt && order placed before it)`; `OrderReturnContext` gains the order's placement time |
| price_lists (net/gross), credit_limits, sales_channels | none: they do not branch on personal | none; the event is documented for them |

The event is emitted with no subscriber in core; it exists for overlays, ERP connectors and the
future join/credit work. **Alternatives rejected.** *A `returns` subscriber snapshotting orders on the
event* — a write per historical order for a read that one timestamp answers.

## R-13 VAT validation at conversion: after commit, not inside the transaction

**Decision.** The dialog's *Validate the tax ID after converting* (default on when a provider serves
the country) runs `OrganizationTaxIdValidationService.triggerValidation` after the conversion commits,
as its own audited write (the existing `POST …/vat-validations` path, `routes.admin.ts` l. 736–757).
Its outcome is shown; failure does not roll back.

**Rationale.** VIES/MF are network calls with multi-second timeouts; holding the conversion's row lock
and the transaction open across them blocks the organization for that long and turns a provider outage
into failed conversions. The owner's text lists validation among the conversion's steps; this keeps it
in the operator's single action while keeping it out of the transaction — OD-2 records the deviation.

## R-14 Personal organizations and VAT validation

**Decision.** `triggerValidation` refuses `422 VALIDATION_FAILED` when `org.taxId` is null, before
`pickProvider` (`organization-tax-id-validation-service.ts` l. 84). The admin VAT panel is hidden for a
personal organization (it validated the placeholder until now — inventory row 7).

## R-15 Registration and spec 176

**Decision.** 177 changes registration in two layers.
- **Before 176 (Phase A):** the minimum that makes `per-tree-root` safe — the existing pre-check moves to
  `resolveByTaxId` (`registration-service.ts` l. 152) and the existing catch (l. 185–196) uses
  `taxIdConflictOf`. The service's flushes are not in one transaction today, so the deferred
  constraint fires at the organization's own flush, which this catch sees.
- **After 176 (Phase R):** registration is one Command; the pre-check and the conflict policy
  (`registrationConflictPolicy`, returning `'refuse'`) move into it, and the commit-time mapping wraps
  its `commandBus.run` call site (R-6). If 176 introduces policy chains (e2), `registrationConflictPolicy`
  is declared as the first participant with `refuse` as the owner's deepest default.

## R-16 CI in both scopes

**Decision.** `backend/test/template-seed.ts` gains `establishTaxIdScope(orm)`: when
`ORGANIZATIONS_TAX_ID_SCOPE=per-tree-root`, it runs the scope service's swap (no Command, no actor —
test infrastructure) on the template, so every clone starts in that scope; the template name includes
the variable so the two templates never mix (`backend-test-suite.md`, template digest). A CI job
`test:backend:organizations-per-tree-root` (GitLab and the GitHub `backend-suite.yml` workflow) runs
`test/contract/organizations`, `test/integration/organizations` and
`packages/modules/organizations/src/**/*.test.ts` with that variable. Tests whose expectation differs by
scope read the scope from the database and assert the scope's answer; tests that need a specific scope
set it themselves through the command.

## R-17 The palette action for conversion needs a static route

`module-admin-surfaces.md` §Command palette item 5/7: an action targets a static route; a
`/organizations/:id` detail screen cannot be targeted (the reason `organizations:manage-roles` has no
action, `manifest.ts` l. 408–411). **Decision:** a screen `/organizations/convert-to-company` with a
personal-organization picker and the same form component the detail dialog uses; the detail button
deep-links nothing, it opens the dialog in place.

## R-18 What is not rewritten

Orders' `billing_address.taxId`, invoices, quote documents and audit `stateAfter` written before #767
may hold a personal placeholder. They are legal or historical records; this feature does not rewrite
them (FR-007). The upgrade note gives an operator the read-only query to find such orders. OD-3.
