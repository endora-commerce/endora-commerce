---
title: Database Migrations (Naming, Registry & Ordering)
---

# Database Migrations

Migrations are **module-local files with UTC timestamp names**, registered once in a
single static registry, and executed in an order computed from those timestamps and
**corrected by the module-manifest dependency graph** (feature `065`). There is no
repo-wide migration number any more, and no hand-maintained execution list.

Three files carry the mechanism, all under `backend/src/db/`:

| File | Role |
|------|------|
| `migrations-registry.ts` | The single registration point — one static import + one entry per migration, grouped by owning module. |
| `migration-order.ts` | The pure `orderMigrations()` function that computes the execution order. No I/O, no clock, no ORM. |
| `legacy-migration-names.ts` | The frozen rename map for the 112 migrations that predate this scheme, plus `FROZEN_THROUGH`. Never edited. |

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
| Timestamp | UTC, fixed width (15 chars), literal `T` at index 8. No `Z`, no separators. Lexicographically sortable. **Unique across the whole repository.** |
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

**The class name is the migration name persisted in `mikro_orm_migrations.name`.**
Renaming an applied migration class is therefore a data-migration problem, not a
refactor — which is exactly why the legacy rename map (below) exists and is frozen.

## How to create a migration

```bash
pnpm --filter backend run migration:new -- --module orders --name placement_intents
```

The scaffolder (`backend/scripts/new-migration.ts`):

1. validates `--module` against the module directories that carry a `manifest.ts`
   (plus the literal `core`), and lists the valid ids when it does not match;
2. resolves a **free UTC timestamp**, advancing by whole seconds until no migration
   file anywhere in the tree uses it;
3. **clamps the timestamp above `FROZEN_THROUGH`.** Today's wall clock can still be
   *earlier* than `FROZEN_THROUGH = 20260801T000000`; a naive stamp would then land
   inside the order-frozen legacy block and fail the frozen-prefix assertion at
   config-build time. The scaffolder turns that confusing boot error into a stamp one
   second past the boundary;
4. writes the file from a template into the module's `migrations/` directory;
5. **prints** the import line, the `migration(...)` entry line, and the `// ── <id> ──`
   group banner they belong under.

It deliberately does **not** edit the registry — text-munging a source file for a
two-line paste is fragile and can land in the wrong module block, and a forgotten
registration is already a CI failure.

Paste the two printed lines into `backend/src/db/migrations-registry.ts`, in the
owning module's group, chronologically inside that group:

```ts
// import block, under the module's banner
import { Migration20260805T141530OrdersPlacementIntents }
  from '../modules/orders/migrations/20260805T141530_orders_placement_intents.js';

// entry array, under the same banner
  // ── orders ────────────────────────────────────────────────────────────
  migration('orders', Migration20260805T141530OrdersPlacementIntents),
```

**An unregistered migration does not run.** The registry is a static-import list, not
a glob (glob discovery needs runtime dynamic `import()` of `.ts`, which Node's ESM
loader cannot transform and which breaks under Vitest — the same reason
`entities-registry.ts` exists). The round-trip guard
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
inputs, same output, no database, no clock, no environment. It applies, in order:

1. **Chronological primary axis.** Entries are sorted by timestamp ascending. Because
   timestamps are unique, that is already a total order.
2. **Frozen prefix.** Everything at or before `FROZEN_THROUGH` (`20260801T000000`) is
   order-frozen: its relative order is the recorded historical execution order and no
   later migration may ever be emitted among or before it.
3. **Intra-module chronology.** A module's migrations always appear in ascending
   timestamp order, whatever else happens.
4. **Dependency correction.** When a migration of module `M` would run *before* a
   migration of a module that `M` transitively depends on, the dependency's migration
   is pulled ahead. The edge set is derived from module manifests — developers never
   write per-migration dependency metadata.
5. **Minimality.** Only *inverted* pairs get a correction edge. A cross-module pair
   already in the right chronological order is left exactly where chronology put it.
6. **Bounded correction.** An inversion is corrected only when the two timestamps are
   within `CORRECTION_HORIZON_DAYS = 45`. Adding a migration today can therefore never
   reorder history authored months ago.
7. **Determinism.** The topological sort drains its ready set smallest-timestamp
   first, so the emitted order is byte-identical across input permutations and across
   runs. Feeding the output back in yields the same output.

The hazard this exists for: branch A adds a `catalog` migration on Wednesday, branch B
adds an `orders` migration on Monday whose foreign key targets the column branch A
creates. `orders` transitively depends on `catalog`, so the corrector emits the
Wednesday `catalog` migration first and a fresh database applies cleanly — with no
renumbering and no coordination between the branches.

### Accepted limitation

A migration added later, inside the 45-day horizon, MAY change the relative order of
two migrations that some databases have **already applied**. That is harmless for
those databases: umzug computes pending as `list.filter(name ∉ executed)`, so an
applied migration is filtered out regardless of its position in the list. Fresh
databases are covered by the CI backend job, which creates an empty database and
applies the whole chain on every pipeline.

## What `dependencies` in a manifest means

A module manifest's `dependencies` array is the input the corrector consumes, so it
must be honest — but it means **install-time necessity**, not "every table I hold a
foreign key to". Read it as: *this module cannot function without that one.*

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

A cycle in the graph is a **boot failure**, not a warning — see below.

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
| `duplicate-timestamp: 20260801T000001: "MigrationA…" and "MigrationB…"` | Two branches scaffolded in the same second (common: both were clamped to the same `FROZEN_THROUGH + 1s` floor) and then merged. | Advance one of them by a whole second — rename the file **and** the class, and update its registry import. This is designed behaviour: the collision is loud and names both classes rather than silently reordering. |
| `cycle in module dependency graph: [carts → promotions → catalog → carts]` | A manifest `dependencies` edit closed a loop. | Drop one edge per the precedence rules and comment it in the manifest that would have declared it; add an `ACKNOWLEDGED_FK_EDGES` entry if a real foreign key backs it. |
| `migration "…" declares the unknown owning module "x"` | A brand-new module whose manifest is not in the generated index. | `pnpm --filter backend run manifest-index:generate` |
| `migration class "…" does not match the naming convention` | Hand-written or hand-renamed file; class and filename disagree. | Re-derive the class name from the filename (see the table above) or re-scaffold. |
| `the frozen migration prefix diverges … at index N` | A new migration was timestamped at or before `FROZEN_THROUGH`, or the frozen map was edited. | Timestamp the migration **after** `FROZEN_THROUGH`. Never edit `legacy-migration-names.ts`. |
| Round-trip guard fails naming a file/class | A migration on disk with no registry entry, or the reverse. | Add (or remove) the import + `migration(...)` line. |
| `db:fresh` fails on a foreign key the chain should already have created | An inversion **beyond** the 45-day horizon — the corrector deliberately refuses to reorder that far back. | Advance the new migration's timestamp so the pair falls inside the horizon. Do **not** reorder the registry: declaration order has no effect. |

The last row is worth repeating: **never "fix" an ordering surprise by moving a line
in `migrations-registry.ts`.** Declaration order is not execution order. Bump the
timestamp, or fix the manifest `dependencies`.

## The frozen legacy block and the rename map

`mikro_orm_migrations` records executed migrations **by name**, and those names are
the class names. Renaming 112 classes without touching that table would make the
migrator see 112 pending migrations and re-run all of them against a fully-populated
production database.

`backend/src/db/legacy-migration-names.ts` is the committed, **frozen** map: for each
of the 112 pre-`065` migrations, its old executed name and its new name, in the
**historical execution order** (taken verbatim from the pre-change `migrationsList`
array — the order deployed databases actually executed, not the numeric filename
order). Timestamps were derived once from git history and clamped to strictly increase
along that order; the shipped order always wins over the git date.

**Never append to, reorder, or edit this file.** A unit test asserts the resolved
frozen prefix equals it element for element, so an edit is a boot failure.

`backend/src/db/legacy-migration-rename.ts` is the **pre-flight** that rewrites
`mikro_orm_migrations.name` from the old names to the new ones before anything
computes pending work. It:

- resolves the table identity from the ORM's own configuration (never hard-coded);
- is a **no-op on a fresh database** (`to_regclass` returns `null`);
- runs one guarded, parameterized `UPDATE … FROM (VALUES …)` that also matches rows
  stored with a `.ts` / `.js` suffix (MikroORM's own `unlogMigration` deletes all
  three forms, so suffixed rows exist in the wild);
- is **idempotent** — a `not exists` guard prevents duplicate rows, because the table
  carries no unique index on `name`; a second run reports `renamed: 0`;
- **warns, never fails**, on an executed-migration row matching neither a legacy nor a
  current name (e.g. a migration from an abandoned branch).

Operator-facing output on `migration:up`:

```text
[migrations] legacy name pre-flight: renamed 112 row(s)
[migrations] warning: unrecognized executed migration "MigrationXyz" — left untouched
```

## The single migrator accessor

`backend/src/db/migrator.ts` exports `getMigrator(orm)` — **the only sanctioned way**
application and test code obtains a migrator. It runs the pre-flight once per ORM
instance (memoized on a `WeakSet`), before anything can compute pending work, then
returns `orm.getMigrator()`.

Every entry point that can reach the migrator goes through it: the CLI
(`src/db/migrate.ts`, which is also the production path — a one-shot container running
`tsx src/db/migrate.ts up` gates the API start), the module-lifecycle orchestrator
(through an injectable `OrchestratorDeps.migratorFor`, defaulting to `getMigrator`),
and the test-suite bootstrap (`backend/test/global-setup.ts`).

A root ESLint `no-restricted-syntax` rule fails the build on any other
`.getMigrator(` call site, with `backend/src/db/migrator.ts` as the sole exemption.

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

---

Full design, contracts and rationale: `specs/065-manifest-aware-migrations/` —
`contracts/naming-convention.md` (the single statement of the naming rule),
`contracts/ordering-algorithm.md`, `contracts/legacy-rename-map.md`, and
`contracts/fk-dependency-check.md`.
