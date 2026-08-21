---
title: Database Migrations (Naming, Registry & Ordering)
---

# Database Migrations

Migrations are **module-local files with UTC timestamp names**, registered once in a
single static registry, and executed **module by module, in a topological order of the
module-manifest dependency graph** (feature `081`). A timestamp orders a module's own
migrations and nothing else. There is no repo-wide migration number, and no
hand-maintained execution list.

Feature `065` ordered by timestamp and *corrected* the result with the dependency
graph inside a 45-day horizon. Feature `081` inverted that: the graph is the order, and
the horizon, the correction edges and the `unresolvable-order` failure are gone. The
reason is that the set of modules stopped being fixed at build time — an installed npm
package ships its own entities and migrations, and its author cannot know the host's
history, so a rule that ordered by a timestamp they choose orders nothing.

Two files carry the mechanism, both under `backend/src/db/`:

| File | Role |
|------|------|
| `migrations-registry.generated.ts` | The single registration point — one static import + one entry per migration, grouped by owning module. **Generated** from a filesystem walk by `scripts/generate-composer.ts` and committed; never edited by hand. |
| `migration-order.ts` | The pure `orderMigrations()` function that computes the execution order, plus the `BASELINE_THROUGH` watermark. No I/O, no clock, no ORM. |

`mikro-orm.config.ts` only wires them together; it holds no ordering knowledge.

## Why the global counter was removed

Every migration used to claim "the next free number" repo-wide
(`001_foundation_init.ts` → `Migration001FoundationInit`). That convention failed on
its own terms:

- **Four numbers were used twice**, each by a different module: `044`
  (`catalog/044_product_status_inactive` vs `catalog/044_product_value_overrides_init`),
  `068` (`prompt_actions` vs `catalog`), `069` (`settings` vs `carts`), `080`
  (`returns` vs `pwa`).
- **`078` was skipped entirely** — the counter carried no information anyone relied on.
- **The list order already diverged from numeric order.** MikroORM hands
  `migrationsList` to umzug *unsorted*, so the array order in the config file — not
  the number in the filename — is what deployed databases actually executed. The
  array ran `…068_prompt_actions, 069_settings_secret, 068_product_packaging,
  069_cart_item…`.
- **Every branch conflicted.** Two concurrent branches both appended an import and an
  entry at the same place in a 565-line file, so a merge conflict was guaranteed even
  when the two migrations had nothing to do with each other.

The timestamp scheme removes the coordination step entirely: two developers on two
branches never need to agree on anything, and the registry is partitioned per module
so their edits do not touch the same lines.

## Naming convention

The single authoritative statement lives in
`specs/065-manifest-aware-migrations/contracts/naming-convention.md`. In short:

```text
<YYYYMMDDTHHmmss>_<SEGMENT>_<SLUG>.ts
```

| Part | Rule |
|------|------|
| Timestamp | UTC, fixed width (15 chars), literal `T` at index 8. No `Z`, no separators. Lexicographically sortable. **Unique within its own module** — two modules may legally share a stamp, because after feature `081` a stamp orders nothing outside its module and two package authors cannot coordinate. |
| `<SEGMENT>` | The owning module id with a leading underscore stripped; the literal `core` for the cross-cutting migrations in `backend/src/db/migrations/`. |
| `<SLUG>` | `snake_case` (`[a-z0-9_]+`) describing the change. |

The **class name is derived mechanically** from the filename: strip the extension,
PascalCase each `_`-separated segment of the tail (only the first character of each
segment is upper-cased, so `i18n` → `I18n`), and prefix `Migration` + the timestamp:

| Filename | Class name |
|----------|------------|
| `20260424T165847_core_foundation_init.ts` | `Migration20260424T165847CoreFoundationInit` |
| `20260507T091405_i18n_admin_i18n_init.ts` | `Migration20260507T091405I18nAdminI18nInit` |
| `20260724T193611_orders_order_placement_intents.ts` | `Migration20260724T193611OrdersOrderPlacementIntents` |

Segment normalization has exactly two special cases:

| Owning directory | `<SEGMENT>` | Registry `moduleId` |
|------------------|-------------|---------------------|
| `backend/src/modules/orders/migrations/` | `orders` | `'orders'` |
| `backend/src/modules/_i18n/migrations/` | `i18n` | `'_i18n'` |
| `backend/src/modules/_lifecycle/migrations/` | `lifecycle` | `'_lifecycle'` |
| `backend/src/db/migrations/` | `core` | `'core'` |

**The class-name tail must begin with the module's segment**, and that is a rule now,
not just a consequence of deriving the name from the path (feature `081`). It is what
makes class names globally unique without a registry, a namespace or a hash: module ids
are unique platform-wide, so `Migration<stamp>Orders…` cannot collide with any other
module's migration. `orderMigrations()` refuses a violation as `unscoped-name` — the
only place a package's name can be checked — and `scripts/check-naming.sh` refuses one
in the core tree at build time. All 141 migrations already satisfied it when the rule
landed.

**The class name is the migration name persisted in `mikro_orm_migrations.name`.**
Renaming an applied migration class is therefore a database problem, not a refactor:
every database that already ran it sees the new name as pending. Nothing in the
repository forbids the rename — see "Renaming an applied migration" below for what it
costs and how to ship it.

## How to create a migration

```bash
pnpm --filter backend run migration:new -- --module orders --name placement_intents
```

The scaffolder (`backend/scripts/new-migration.ts`):

1. validates `--module` against the module directories that carry a `manifest.ts`
   (plus the literal `core`), and lists the valid ids when it does not match;
2. resolves a **free UTC timestamp**, advancing by whole seconds until no migration
   file anywhere in the core tree uses it. Tree-wide freedom is tidiness, not ordering:
   only per-module uniqueness is required;
3. **clamps the timestamp above `BASELINE_THROUGH`.** Today's wall clock can still be
   *earlier* than `BASELINE_THROUGH = 20260801T000000`; a naive stamp would then land
   inside the frozen historical prefix, whose order is history and is never recomputed
   — the migration would be ordered by that history instead of by its module's
   `dependencies`. The scaffolder emits a stamp one second past the watermark instead;
4. writes the file from a template into the module's `migrations/` directory.

Register it by regenerating the committed registry, and commit both files:

```bash
pnpm --filter backend run composer:generate
```

The generator walks `src/db/migrations/` and every `src/modules/<id>/migrations/`,
derives each class name from its filename, and refuses — rather than skips — a file it
cannot place: an unrecognized `.ts` in a migrations directory, a class the file does
not export, two files deriving the same name, or a migration under
`src/apps/<deployment>/` (overlay modules cannot ship migrations, so registering one
would be a new capability rather than a side effect of generating the list).

**An unregistered migration does not run.** The registry is a static-import list, not
a glob (glob discovery needs runtime dynamic `import()` of `.ts`, which Node's ESM
loader cannot transform and which breaks under Vitest — the same reason
`entities-registry.generated.ts` exists, and it is emitted by the same command). The
round-trip guard
`backend/test/unit/db/migrations-registry.test.ts` fails the build for a file with no
entry, an entry with no file, a class name that does not match its filename, a
declared `moduleId` that disagrees with the owning directory, a filename segment that
disagrees with the module id, an unrecognized `.ts` file in a `migrations/` directory,
and any leftover `NNN_`-numbered file.

`mikro-orm migration:create` / `migration:generate` are **not** sanctioned: they write
into a single configured path and cannot know the owning module.

:::note Helper files
A non-migration `.ts` helper may live inside a `migrations/` directory, but it must be
on the guard's explicit allow-list — today exactly one entry,
`backend/src/modules/quote_requests/migrations/status-mapping.ts`. The allow-list
exists so a typo'd migration filename fails loudly instead of silently disappearing
from the migrator.
:::

## Ordering rules

`orderMigrations()` (`backend/src/db/migration-order.ts`) is a pure function: same
inputs, same output, no database, no clock, no environment. The emitted order is the
concatenation of **two blocks**.

**1. The baseline block — the frozen historical prefix.** Every entry that came from
the committed core registry *and* is stamped at or before `BASELINE_THROUGH`
(`20260801T000000`), in plain timestamp order. That block predates feature `065`: it
was written and applied in a hand-maintained array order its manifests do not describe
— they contradict it in 37 places — so emitting it any other way produces an order a
fresh database cannot apply. It is closed, it never grows (the scaffolder clamps every
new core stamp past the watermark), and nothing should try to drain it.

Membership takes **both** conditions. A stamp-only test lets a migration that arrived
from outside the committed registry join a prefix whose order is historical fact:
measured, a package migration stamped `20250101T000000` was emitted at index 0, ahead
of the platform's own foundation migration. An entry's `origin` says where it came
from, and only `'core'` may join.

**2. The open block — everything else, module by module.** The modules are sorted
topologically over the ordering graph, ties broken by module id ascending, and each
module's migrations are emitted contiguously in ascending timestamp order.

- The **ordering graph** has module ids as nodes and manifest `dependencies` as edges,
  and reads **no other manifest array** — not `acknowledgedDependencies`, not
  `nonBindingDependencies`, neither of which is an ordering claim.
- The `core` pseudo-module sorts first. It declares nothing and nothing declares it,
  so it is always ready; every module's tables sit downstream of the bootstrap tables.
- **A timestamp never crosses a module boundary.** If module `A` declares `B`, every
  open migration of `A` follows every open migration of `B` — however far apart their
  stamps are, and in either chronological direction. There is no horizon.
- **Determinism.** The topological sort drains its ready set by the smallest module id,
  so the emitted order is byte-identical across input permutations and across runs.
  Feeding the output back in yields the same output.

The hazard this exists for: branch A adds a `catalog` migration on Wednesday, branch B
adds an `orders` migration on Monday whose foreign key targets the column branch A
creates. `orders` transitively depends on `catalog`, so `catalog`'s whole block is
emitted first and a fresh database applies cleanly — with no renumbering and no
coordination between the branches. Under feature `065` that only worked while the two
stamps were within 45 days of each other; now it works unconditionally.

### Cycles are reported, not thrown

If the ordering graph has a strongly connected component of more than one module, the
order is still computed: the component's migrations are emitted as one contiguous block
in timestamp order across the whole component — the baseline block's rule, applied
locally, and the only defined answer when the declarations contain no order. The
component comes back as a **diagnostic**, and nothing is thrown.

That is deliberate. Under feature `065` the graph was a correction, so refusing a cycle
cost nothing. Now the graph is the primary ordering and a manifest can arrive from
`node_modules`, so a throw would mean *one stranger's mis-declared package stops this
shop's core schema from migrating*. Three readers react instead:

| Reader | Reaction |
|--------|----------|
| `backend/test/unit/db/module-graph.test.ts` | asserts **zero** diagnostics over the committed manifests — a cycle in this repository is still a red build |
| `backend/src/db/mikro-orm.config.ts` | logs each diagnostic at `warn`, naming its members |
| the `_lifecycle` orchestrator | refuses an install whose arrival closes a cycle, naming every member and exiting `65` |

The three reactions differ on purpose, and the difference is where each one sits. A cycle
**in this repository** is a mistake made by someone who can fix it before anything ships,
so it is a red build. A cycle **on a running platform** is already deployed, so the
platform says so and keeps serving — nothing else it could do would leave the operator
better off. A cycle that is about to **arrive** is refused, because the install is the one
moment where refusing costs nothing: nothing downstream of the module exists yet, and the
operator is standing right there.

The refusal is scoped to the arriving module: the graph it walks is the installed set plus
that module, and only a component holding it is refused. A loop between two modules that
are already installed does not block a third module's install — that would reproduce, one
command later, exactly the platform-wide stall the no-throw rule exists to prevent. It
walks the graph with `findModuleCycles` from `migration-order.ts`, so the member list an
operator reads at the install prompt is the same list the boot warning would print.

### Accepted limitation

A migration added later MAY change the relative order of two migrations that some
databases have **already applied**. That is harmless for those databases: umzug
computes pending as `list.filter(name ∉ executed)`, so an applied migration is filtered
out regardless of its position in the list. Measured on a real database built under the
feature-`065` order and then read with the feature-`081` one: **pending 0, executed
142, `up()` applied 0**. Fresh databases are covered by the CI backend job, which
creates an empty database and applies the whole chain on every pipeline.

## What `dependencies` in a manifest means

A module manifest's `dependencies` array is now the **whole** cross-module ordering
input, so it must be honest — but it still means **install-time necessity**, not "every
table I hold a foreign key to". Read it as: *this module cannot function without that
one.*

Where two modules look mutually dependent, three precedence rules decide which
direction to keep:

- **Rule 1 — platform root.** A platform-root module (`settings`, `audit_logs`, …)
  never depends on a domain module.
- **Rule 2 — bridge owner.** The owner of a junction table never depends on what it
  bridges; the domain module that cannot function without the bridge declares the
  bridge owner instead. (`sales_channels` owns `sales_channel_products`; `catalog`
  declares `sales_channels`, not the reverse — aligned with Principle XII.)
- **Rule 3 — tenancy root.** `organizations` is the tenancy root (Principle XI) and
  never depends on tenant-owned modules.

**Every dropped edge must be commented in the manifest that would have declared it**,
naming the foreign keys it covers, the rule that drops it, and the cycle it would
create where it creates one. See `backend/src/modules/organizations/manifest.ts` for
the worked example.

A cycle in the graph is a **red build** — `module-graph.test.ts` fails on any
diagnostic. It is not a boot failure: see "Cycles are reported, not thrown" above.

## The FK-drift validator

The backfilled graph is locked in by a blocking check:
`backend/test/unit/db/fk-dependency-drift.test.ts`.

It derives **every cross-module foreign key** from the migration SQL (statement-scoped
`create table` / `alter table` bodies, matching `references "<table>"`), resolves each
table to its owning module (entity `tableName` declarations first, then the explicitly
enumerated `backend/test/unit/db/table-owner-overrides.ts` for the bridge tables no
entity claims), and asserts that the referencing module **transitively declares** the
referenced module in its manifest `dependencies`.

- It is a **pure unit test**: no database, no ORM bootstrap, runs inside
  `pnpm --filter backend run test:unit` in well under a second.
- It has **no runtime effect whatsoever**. Nothing under `backend/src/` imports it, it
  does not influence `orderMigrations()`, and its artifacts live in the test tree. It
  validates the *input* the ordering algorithm consumes, nothing more.
- A table created by a migration that no entity and no override claims **fails** the
  check, and so does a foreign key whose target cannot be resolved to a module. It
  never silently skips.

A failure reads:

```text
[fk-drift] undeclared cross-module foreign key:
  orders.order_placement_intents → api_keys
  module "orders" references module "api_keys" but does not declare it
  (transitively) in backend/src/modules/orders/manifest.ts.

  Fix one of:
    (a) add 'api_keys' to `dependencies` in orders/manifest.ts  ← usually this
    (b) if the edge must stay undeclared (it would create a cycle), add an entry to
        backend/test/unit/db/acknowledged-fk-edges.ts with a reason and the cycle.
```

**Option (a) is almost always right.** Reach for the allow-list only when declaring
the edge would create a cycle — and then you owe a reason, a precedence rule, and a
cycle statement.

### The acknowledged-edge allow-list

`backend/test/unit/db/acknowledged-fk-edges.ts` holds the edges the precedence rules
deliberately drop — currently 15, matching on the `(from, to)` module pair. Each entry
carries `from`, `to`, `via` (the concrete table pairs, for blast radius), a non-empty
`reason`, the `rule`, and a `cycle` statement.

The list is **minimality-asserted**, so it cannot grow monotonically:

| Assertion | Effect |
|-----------|--------|
| M1 | An entry whose underlying foreign key no longer exists fails as stale. |
| M2 | An entry whose module pair is now satisfied by the manifest graph fails as dead weight. |
| M3 | An empty `reason`, an unknown `rule`, or an empty `cycle` fails. |
| M4 | A duplicate `(from, to)` pair fails. |
| M5 | A 16th entry fails — the cap is a visible, reviewable act, not a quiet append. |

:::note `cycle` has wider semantics than "the cycle this closes"
Measured against the shipped graph, only **6 of the 15** entries actually close a
cycle (`organizations → customer_accounts`; `sales_channels → catalog / cms /
customer_accounts / promotions`; `settings → sales_channels`), and
`organizations → inventory` closes one only once the `sales_channels` bridge edge is
also declared. Rather than invent paths, the remaining entries carry an explicit
"no cycle on its own — dropped because …" statement naming the precedence reason. M3
still asserts the field is non-empty either way.
:::

## Failure modes and their fixes

All of these throw at **config-build time** — i.e. the first time anything imports
`mikro-orm.config.ts` — with `MigrationOrderError` and an actionable message.

| Symptom | Cause | Fix |
|---------|-------|-----|
| `module "orders" has two migrations stamped 20260801T000001` | Two branches scaffolded in the same second **inside one module** (common: both were clamped to the same `BASELINE_THROUGH + 1s` floor) and then merged. | Advance one of them by a whole second — rename the file **and** the class, then regenerate. Inside a module the timestamp is the whole order, so the collision is loud and names both classes rather than silently reordering. Two *different* modules sharing a stamp is legal and is not reported. |
| `migration "…" is owned by module "orders", so it must be named Migration…Orders…` | A migration class whose tail does not begin with its module's segment. | Rename the class (and the file, which derives it). The name is the database's key for what has run; scoping it by module is what keeps it unique platform-wide. |
| `migration "…" declares the unknown owning module "x"` | A brand-new module whose manifest is not in the generated index. | `pnpm --filter backend run manifest-index:generate` |
| `migration class "…" does not match the naming convention` | Hand-written or hand-renamed file; class and filename disagree. | Re-derive the class name from the filename (see the table above) or re-scaffold. |
| Round-trip guard fails naming a file/class | A migration on disk with no registry entry, or the reverse. | `pnpm --filter backend run composer:generate` and commit the artefact. |
| `db:fresh` fails on a foreign key the chain should already have created | The referencing module does not declare the module that owns the referenced table. | Add it to `dependencies` in the referencing module's `manifest.ts`, or move the constraint into a migration owned by the module that owns the referencing table. **Do not touch the timestamp** — after feature `081` a stamp cannot fix a cross-module ordering problem, and `fk-dependency-drift.test.ts` fails the build for the undeclared edge anyway. |

Two things never fix an ordering surprise: **moving a line in the generated registry**
(declaration order is not execution order, and regenerating restores it) and **bumping
a timestamp** (a stamp orders nothing outside its own module). The remedy is always the
manifest `dependencies`.

## The baseline block, and renaming an applied migration

`mikro_orm_migrations` records executed migrations **by name**, and those names are the
class names. The class name is derived mechanically from the filename, so **moving a
migration file renames it**: relocating
`modules/settings/migrations/20260430T101450_settings_init.ts` into `db/migrations/`
forces the `core` segment, and `Migration20260430T101450SettingsInit` becomes
`Migration20260430T101450CoreSettingsInit`.

Feature `065` shipped a frozen rename map and a boot-time assertion that pinned every
pre-`065` class name in place, so a database deployed under the old scheme would not
re-run 112 migrations. Feature `072` retired both: there is no deployed database, and
the assertion made a legitimate relocation impossible. What is left is the
**position** watermark, `BASELINE_THROUGH`, which fixes only the *order* of the
pre-`065` block. Renaming a class inside it is a no-op for the emitted order.

It is not a no-op for an existing database. After a rename, umzug — which computes
pending as `list.filter(name not in executed)` — sees the new name as unapplied and
re-runs the migration against a schema that already has it:

- `pnpm --filter backend run test` fails in `globalSetup`, which runs `migrator.up()`,
  with something like `relation "settings" already exists`. Every test file then fails
  and the message names a migration, not the change that caused it.
- `pnpm run dev` fails the same way at boot.
- `allOrNothing: true` and `transactional: true` mean the replay rolls back rather than
  half-applying: you lose the run, not the database.

So a rename ships with a coordinated rebuild of the **dev** database — every developer runs
`pnpm --filter backend run db:reset` in the same window as the merge.

The test suite needs no intervention. Since issue #289 the migrated template every invocation
is cloned from is named `<base>_tpl_<digest>`, the digest covering the ordered migration class
names and the content of every migration file — so a renamed class is a *different* migration
set, and the next invocation builds a template of its own instead of trying to re-apply
anything into the one you have. CI builds an empty database and needs no intervention either.
`db:fresh` and `db:reset` read `backend/.env` and default to the **dev** database, so always
pass `DATABASE_URL` explicitly when you mean anything else.

## Module-uninstall migration revert

Hard-uninstalling a module reverts that module's migrations. They are resolved from
`MIGRATION_REGISTRY` filtered by `moduleId`, sorted ascending, and reverted in reverse
order via `migrator.down({ migrations: [name] })`. Sorting a single module's names
ascending *is* the resolved order — `orderMigrations()` guarantees intra-module
chronology — which lets the orchestrator import the registry (pure data) without
importing `mikro-orm.config.ts`.

This replaced a filename-pattern scan (`^\d+_<moduleId>_` against
`backend/src/db/migrations/` only) that could never work: it looked in the wrong
directory for module-local migrations and passed filename stems where the stored names
are class names, so hard-uninstall silently reverted **nothing** and only logged. If
a module owns no registered migration, the orchestrator logs a warning and reverts
nothing — hard-uninstall then relies on the module's `uninstallHook`.

That makes the registry `moduleId` load-bearing beyond ordering: **file a migration
under the module that owns the tables it writes to.** Until feature `072` T020 the
settings and sales-channel migrations were still filed under their modules although the
kernel owns those tables, so `modules:uninstall --hard settings` dropped `settings`,
`setting_groups` and `setting_values`. `backend/test/unit/db/kernel-migration-ownership.test.ts`
now fails the build when a module-owned migration writes to a kernel-owned table; both
sets are derived (from the entity tree and from each migration's SQL), never enumerated.

---

Full design, contracts and rationale:

- **`specs/081-per-module-migration-order/contracts/`** — `ordering-algorithm.md` (the
  current normative statement of the order, superseding the `065` one in whole) and
  `migration-identity.md` (class-name scoping and per-module stamp uniqueness).
- **`specs/065-manifest-aware-migrations/contracts/`** — `naming-convention.md` §1 and
  §2 are still the only recognizers any tool may use;
  `contracts/fk-dependency-check.md` still describes the FK-drift validator.
  `contracts/ordering-algorithm.md` there is **superseded**.
- The frozen rename map and the `getMigrator` accessor those `065` contracts describe
  were retired by feature `072`; see `specs/072-module-kernel-di/MIGRATION-RESET.md`.
