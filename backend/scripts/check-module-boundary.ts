/**
 * CI check — a module does not reach into another module's internals
 * (Constitution I; feature 075, FR-001…FR-005 and FR-020…FR-028; feature 077,
 * D-87).
 *
 * **The rule, in one sentence:** no file under `backend/src/modules/<A>/` or
 * `backend/src/apps/<deployment>/modules/<A>/` may name an import specifier that
 * resolves into a different module's directory, **or** name another module's
 * table in raw SQL.
 *
 * Features 072 and 073 finished the *runtime* half of Principle I: 891 port
 * resolutions through the container with zero violations. What was left is the
 * *compile-time* half — the type annotation each of those resolutions is written
 * against, and the entity class a module still queries directly — and it is
 * **674 sites**, 43% of them `import type`. `check-port-dependencies.ts`' header
 * defers this work by name; this is the different rule it defers to.
 *
 * ## Two predicates, one ledger
 *
 * The **import** predicate reads specifiers. The **`sql`** predicate reads table
 * identifiers and resolves each against a table→owner map. Both produce findings
 * into the same per-consumer shard and the same `ledger-size`, because the
 * question the number answers is "is there cross-module coupling left", not "is
 * there coupling of a particular syntax left" (D-87). A raw `SELECT` across a
 * package boundary compiles, runs and returns rows; a `violations=0` that cannot
 * see one licenses a package split that is 116 couplings short of true.
 *
 * The `sql` predicate reads a table identifier **two ways** — a third
 * recognition path for the check, not a third predicate: a SQL **statement** in
 * a string or template literal (D-87), and a knex query **builder**, which names
 * its table as a call argument and is therefore invisible to the statement path
 * and to the import predicate alike (issue #187 — ten such reaches, in six
 * files, stood outside a `sql=111` that read as the whole coupling). Both
 * resolve through the same owner map, produce the same finding and take the same
 * ledger key, so one table reached both ways in one file is one entry. `syntax`
 * says which path saw it. `scripts/lib/sql-tables.ts` states what each has to
 * look like, and why the builder's method list is enumerated rather than open.
 *
 * A path that went blind cannot pass quietly: the ledger is two-way, so the ten
 * entries the builder path seeded go **stale** the moment it stops seeing them,
 * and the run fails on the stale entries rather than reporting a smaller number.
 * That is the same property the owner map's two counts buy, one level up.
 *
 * The owner map is built from **two** sources and the second is not optional:
 * every `@Entity()` class's table name (220 tables), and every `create table` in
 * a `migrations/` file (21 more). The 21 are all join tables and bridges, and
 * they carry the findings that matter most — every `sales_channel_*` bridge is
 * declared in DDL and by no entity class, so an entity-only map reports zero of
 * them. Where the two disagree the **entity wins**: an entity is a live
 * declaration and a migration is a historical one.
 *
 * A table whose DDL sits in `src/db/migrations` is attributed to no module by
 * either pass, and most of those are one module's own join table that happens to
 * have been created in the pre-065 core block. So a **core-owned table is
 * attributed to the module that owns the table its name begins with**:
 * `product_categories` and `product_assets` belong to `catalog` because
 * `products` does, `sales_channel_products` belongs to the kernel because
 * `sales_channels` does. That is the one judgement the map needs, and stating it
 * this way keeps it derived from the map rather than listed in it. A table that
 * is still core-owned after attribution is nobody's to ask for, so it is not a
 * finding — the count of those is printed, so a residue cannot grow in silence.
 *
 * ## The third source: installed packages (feature 080, T034)
 *
 * Since T031 a platform composes modules that are in neither of those two
 * places — an npm package installed into the instance's `node_modules` — and
 * D-106.2 lets one own tables. A table it owns was in no map, so a core module
 * reaching into it resolved to no owner and was **not a finding**: exactly the
 * silence `unattributed` is printed to make visible, one layer further out than
 * the printing reaches.
 *
 * So `scripts/lib/package-declarations.ts` supplies a third pass, read out of
 * the artefact the platform composes rather than out of a source text a
 * published package does not ship: its `entities` export for the tables it maps,
 * and the `create table` literals in the files beside its `./migrations` entry
 * point for the ones it creates and maps with no class. The package's owner
 * directory is `package:<npm name>`, which can equal no module directory, so the
 * reach is cross-boundary by construction.
 *
 * **What the map does when it cannot attribute one: it refuses.** There is no
 * silent third state for a package. A discovered package whose declarations
 * cannot be enumerated in full stops the run at exit 2 before the map is built,
 * naming the package. `package pass=0` therefore means "no package is
 * installed", never "a package was installed and said nothing" — which is the
 * property the two existing passes buy with their own exit-2 guards, extended
 * to the source that arrives from outside the repository. Where the tree and a
 * package declare one table, the **tree wins**, for the reason the entity pass
 * wins over the migration pass: it is the declaration this repository can
 * change, and a stranger must not take a core table's attribution away from the
 * module that owns it.
 *
 * ## What counts as a specifier
 *
 * Every shape TypeScript admits, through `scripts/lib/specifiers.ts` — the
 * walker extracted from `check-kernel-boundary.ts`, which polices the opposite
 * direction across the same boundary. Two independently written walkers drift,
 * and the shape one forgets is the shape the next violation uses.
 *
 * **`import type` is a violation** (FR-003), on three grounds worth restating
 * here because the reader of a failure message will want them: precedent
 * (`check-container-imports.ts` decides it the same way); ESLint's
 * `prefer: 'type-imports'` would otherwise rewrite value imports into exempt
 * ones automatically; and a type edge is a real edge in a `package.json`,
 * because types resolve at build time.
 *
 * ## Resolution
 *
 * The specifier is **normalised** against the importing file's directory before
 * the target is decided. A prefix match on one nesting depth is what produced
 * the documented 2.2× undercount (348 against the real 674), so `../catalog/x`
 * from `modules/blog/plugin.ts` and `../../catalog/x` from
 * `modules/blog/services/x.ts` resolve to one edge and one ledger key — and both
 * depths carry their own red proof.
 *
 * A module's identity here is its **directory**, not its bare name, so an
 * overlay `catalog` reaching the core `catalog` is the cross-tree edge it is
 * rather than an internal import.
 *
 * A **bare** specifier can reach a module too, since !910 moved the first one
 * out of `backend/src/modules`. This paragraph used to say the opposite — "there
 * is no `@endora-commerce/mod-*` package yet, so a bare specifier cannot reach a
 * module" — and the sentence outlived the fact by one merge request. Measured on
 * that tree: `organizations` importing the `BlogPost` entity as
 * `@endora-commerce/mod-blog/backend` left `reaches=25 violations=0`,
 * byte-identical to the run without it. The cost is not that the reach is
 * permitted; it is that rewriting a **ledgered** relative import into a package
 * specifier deletes it from the walk, whereupon the two-way ledger reports the
 * entry describing it as stale and asks the author to remove the record of a
 * debt nobody paid. `blog` shipped with no shard, so the hole was free and
 * invisible; the next module to move has one.
 *
 * So a specifier is also resolved against {@link ModuleBoundaryInput.modulePackages},
 * the npm name → manifest id map `lib/module-roots.ts` derives from each
 * workspace member's own `endora` block. Keyed on the **declared id** and never
 * on the name's spelling (D-142): the edge that was `../blog/entities/blog-post.entity`
 * before the move has to be one key after it, and a `mod-` prefix rule would be a
 * derived fact written down (D-100). The map is matched on whole name segments,
 * because `startsWith` over a package name is the prefix match that produced the
 * documented 2.2× undercount, one namespace up. An empty map is the tree that has
 * no module package and is the behaviour that shipped — which is why the CLI
 * reconciles the map it built against the layout's own package roots and refuses
 * a run where those disagree.
 *
 * ## Contract surface is not a reach (D-171)
 *
 * Not every subpath of a module package is that module's internals. T050 (!928)
 * gave one a type-only `./ports` subpath so that an `EntityManager`-taking port
 * interface has a home — `packages/contracts` is compiled by `admin` and
 * `storefront` and carries zero `@mikro-orm` imports, so it cannot — and this
 * check went on counting `import type { X } from '<pkg>/ports'` exactly as it
 * counts `<pkg>/backend`. Publishing the interface therefore gave it a supported
 * name and did **not** retire the consumer's ledger entry, which is what D-169
 * says the conversion removes.
 *
 * **A subpath is contract surface iff the module it resolves to exports no
 * runtime binding.** `./ports` emits `export {};` → exempt; `./backend` exports
 * `registerModule` and `entities` → reach; `./migrations` exports `migrations`
 * plus the named classes → reach; the root exports `manifest` → reach. Derived
 * from the artefact on every run and from nothing written down — a named list in
 * the layout contract would be D-100 exactly, and a field in the package's own
 * `endora` block would be a self-certified exemption from this check's ledger,
 * issued by the measured party.
 *
 * Three consequences, each of them the point rather than a side effect. It
 * **fails closed**: a `const` added to `./ports` makes the reach count again in
 * the same run T050's guard goes red, and a subpath the package does not declare
 * at all stays a reach. A later `./types` is exempt automatically and correctly
 * while a `./services` is not. And the predicate is **one function**, shared with
 * that guard (`scripts/lib/emitted-exports.ts`), because two derivations of one
 * fact are two answers waiting to disagree.
 *
 * The parity is structural rather than granted: `packages/contracts` is exempt
 * for carrying no `endora` block at all, so it never enters
 * {@link ModuleBoundaryInput.modulePackages} and there is no exemption to point
 * at. A port type there is exempt for *not being a module*; the same type on
 * `./ports` counted only because its owner *is* one.
 *
 * **"Retire by reclassification" is structurally unavailable.**
 * {@link resolveModulePackage} answers `null` for any specifier starting with
 * `.`, and an unconverted reach *is* a relative specifier — so it has no subpath
 * for the exemption to apply to. Reaching the exempt state takes three separable
 * edits, each visible in the diff: package the owner, publish the interface,
 * rewrite the specifier. `surfaceOf` is **not** the seam that decides this: it
 * answers `'port'` for any path holding a `ports` segment, a relative
 * `services/ports/foo.ts` included, which is a private file — a path-text
 * heuristic, right for choosing a remedy sentence and wrong as a boundary
 * decision.
 *
 * ## The admin application is a consumer too (feature 091, P1)
 *
 * FR-017 put module-owned admin code into this population before any admin
 * directory moved. It judges a reach between two **modules**, so a directory the
 * module root does not attribute — `_shared`, `home`, `platform`, `profile`,
 * `cms_pages` — is the admin application's and is judged as nobody's: right for
 * the directory, and it leaves the reach unrecorded.
 *
 * Nine files under `admin/src/components` reach a module's admin code that way,
 * and `admin/src/components/IdleLogout.tsx` — which takes `settings`' admin API
 * client — was in no ledger at all. That is the admin application asking a
 * module for something, and it is the shape with the worse failure mode: a
 * *ledgered* reach rewritten as a package specifier goes stale loudly, while an
 * **unrecorded** one is rewritten and nothing goes red, because there was no
 * entry to strand. So `admin/src` outside the module root is walked, and a reach
 * out of it is attributed to {@link ADMIN_HOST_OWNER}, whose shard is `host.ts`.
 * That constant lives in `lib/admin-surfaces.ts` and not in a ledger for exactly
 * this reason: `check:admin-registrations`, which used to own the spelling, was
 * deleted with its ledger when the drain emptied its population (feature 091,
 * Phase 5 T5) and this ledger outlives it.
 *
 * **Source side only.** {@link ownerLocationOf} answers `host`; the target
 * position keeps asking {@link moduleLocationOf}, which answers `null` for a
 * host path. Asked at both ends this would turn every module→host reach in
 * `admin/src/modules` into a finding — roughly 1700 of them, into published kit
 * surface, which is `check:admin-surface`'s population and not a boundary
 * question.
 *
 * **`_shared` stays out, deliberately**, and the reason is in
 * `scripts/ledgers/cross-module-imports/host.ts`: where that directory goes is
 * an open owner decision, a ledger cannot answer it, and attributing it to a
 * module to make the walk produce findings would put a false owner into an
 * artefact three checks read.
 *
 * ## Out of scope, each for a stated reason
 *
 *   - `src/composition.ts` and the generated registries — a composition root
 *     naming modules is a root doing its job. Out **by construction**, since the
 *     walk is over module directories, not by exemption.
 *   - **`App.tsx`, `components/AppShell.tsx` and the generated
 *     `modules.generated.ts`** — the admin's three registries, and the same rule
 *     one frontend over. All three are named by the layout rather than spelled
 *     here (see {@link AdminBoundarySurfaces.registryFiles}); `App.tsx` imports
 *     one component per module screen, so ledgering it would record this
 *     feature's own subject as its debt, churning with every batch.
 *   - `src/kernel`, `src/http`, `src/events`, `src/tenancy`, `src/commands`,
 *     `src/db`, `src/overlay` — not modules. The reverse direction is
 *     `check-kernel-boundary.ts` rules B and C.
 *   - `backend/test/**` — reporting only, under `--tests`. A test is allowed to
 *     know more than the code it tests, and after F4 a test importing another
 *     module's entity is a `devDependency` edge.
 *   - **`migrations/`, for the `sql` predicate's *rule*, and not for its
 *     population** (feature 097). This entry read "a migration naming another
 *     module's table is the dependency-corrected execution order's problem, and
 *     `test/unit/db/fk-dependency-drift.test.ts` already owns it", and **that
 *     sentence is why the hole existed for as long as it did**: it names a real
 *     file that plausibly covers the case, so a reader who followed it stopped.
 *     It does not cover it. `fk-graph.ts` is that test's whole reader and its
 *     own header commits it to "node:fs + regex only"; its complete vocabulary
 *     is `tableName:`, `create|alter table` and `references "…"`. There is no
 *     `insert`, no `update`, no `delete` and no `select` anywhere in the file.
 *     Ordering is neither instrument's subject and never was — that is
 *     `src/db/migration-order.ts`'.
 *
 *     So the two subjects are: **DDL** there, **DML** here. The populations
 *     cannot overlap even in principle, because `STATEMENT_HEAD` admits only
 *     `select`, `insert into`, `update`, `delete from` and `with`, and never
 *     `create` or `alter`. What a migration is excluded from above is this
 *     predicate's rule — *every reach is debt*, into
 *     `scripts/ledgers/cross-module-imports/` — and {@link analyzeMigrationSql}
 *     judges the same statements under two rules of their own, with two ledgers
 *     of their own: **R1**, a cross-module table reference requires the owner in
 *     the declaring module's transitive manifest `dependencies` closure (which
 *     is AGENTS.md § *Migrations* item 4 with its predicate widened from
 *     `references` to DML), and **R2**, a migration may not *write* another
 *     module's table whether or not R1 holds. Kernel-owned tables are outside
 *     both, by derivation from the owner map.
 *   - **Comments, for both `sql` paths** — not by exclusion but by
 *     construction: the predicate reads literal *nodes*. The first spike was a
 *     regex over source text and hallucinated a dozen tables (`every`, `bumps`,
 *     `used`, `path`), because an apostrophe in an English comment opens a
 *     string literal that runs to the next apostrophe. `sql-in-a-comment` is a
 *     red proof for exactly that.
 *   - {@link GENERATED_MODULE_FILES} — a file is exempt because a **generator
 *     owns it**, and the entry says which. Not a `.generated.` filename match:
 *     scoping a rule to a filename convention makes the rule's reach a property
 *     of naming rather than of code, which is what `check-kernel-boundary.ts`'
 *     rule A was widened away from (issue #113).
 *
 * ## The ledger
 *
 * `scripts/ledgers/cross-module-imports/<module>.ts`, one file per **consumer**
 * module, loaded by walking the directory. Sharded rather than flat (FR-023)
 * because a single table makes all 45 cut merge requests edit one file, and that
 * is the serialisation point this design exists to remove.
 *
 * It fails **eight** ways, not two: an unledgered import fails, a stale entry
 * fails, an empty shard fails (delete the file instead), an orphan shard fails,
 * a **misfiled** entry fails — without that one, an engineer blocked on
 * `catalog` could park an `orders` finding in `catalog.ts` and both merge
 * requests would read green — a **permanent entry with no retiring condition**
 * fails, an entry whose **recorded count** is not what the walk found fails in
 * either direction (issue #267, below), and a shard that **declares an entry
 * type of its own** fails (issue #217). The last one is what makes the sixth
 * reachable: `payments` was typed `Readonly<Record<string, string>>` for as long
 * as it existed, so its co-transactional seam could claim permanence in prose
 * only — it counted toward `ledger-size` as debt nothing was going to drain, and
 * {@link permanentEntryIssue} had no field to run on. It was not one file
 * departing from a convention: **29 of the 33 shards** were typed that way, the
 * four exceptions being the shards that had already had to hold a permanent
 * entry, so the rule could not have been learned from the others' example. The
 * declared type is now read from the shard's own source and compared against
 * {@link CANONICAL_SHARD_ENTRY_TYPE}.
 *
 * There is **no global count** anyone can raise to make the build pass (FR-028):
 * `ledger-size` is derived from the walk and printed, never written down.
 *
 * ## Permanent entries (D-77)
 *
 * Most entries are debt: a sentence saying why an edge still stands and what
 * retires it, drained by the cut that removes the import. A few are not, and the
 * ledger has to be able to say so — the worked example is `catalog` reaching
 * `custom_fields`' apply seam, which a foreign key with `on delete restrict`
 * makes co-transactional, so no port can carry it and no merge request will
 * remove it. Such an entry is `{ permanent: true, reason, retiredBy }`:
 * **excluded from `ledger-size`**, printed separately, and held to the opposite
 * rule from a draining one — it must name what would retire it, and naming the
 * sweep fails the build. See {@link PermanentLedgerEntry}.
 *
 * `ledger-size` is **keys**, `cross-module imports` is **sites**, and at MR-0
 * they read 670 and 674. The four are one file reaching one target path twice —
 * `orders`' two dynamic imports of `stock-level.entity` and of
 * `stock-allocation.entity`, `customers`' duplicated `import type` of
 * `quick_order`'s preference service, and `organizations`' route file naming
 * `customer-account.entity` once as a type and once dynamically. Keying by file
 * and target rather than by line (FR-026) is what makes them one entry, and it
 * is the property that lets code move inside a file without invalidating the
 * ledger; the entry retires when the *last* of the sites under it goes.
 *
 * ## The count on an entry (issue #267)
 *
 * That last property has a cost, and it was paid: because the key answers "is
 * this file already known to reach this table" rather than "how much", the
 * **Nth** reach of a shape a file already carries lands against an unchanged
 * ledger. MR !793 added two `select … from product_categories` statements, in
 * `price-list-service.ts` and in `pricing-service.ts`; both files already had an
 * entry for that table, so `sql` rose 52 -> 54, the ledger did not move, `stale`
 * and `violations` stayed 0, and nothing asked anybody to justify them. The
 * entries were honest and the merge request was good work — which is the point:
 * a correct change added cross-module coupling that the mechanism built to make
 * coupling visible did not surface.
 *
 * So an entry carries a **count**, two-way like every other ledger in this tree.
 * The key stays exactly as it was: an entry is `{ sites, reason }` where the
 * file reaches its target more than once, and stays a plain string — meaning one
 * — where it does not. The field is **omittable** because 60 of the 68 keys
 * standing when it landed cover exactly one reach (7 cover two, 1 covers three,
 * and 6 of the 8 are `sql`), so a required field would have written `sites: 1`
 * fifty-odd times to say nothing. The default is safe because it fails
 * **closed**: a new entry over a file that already reaches three times records 1
 * by omission and the run says the walk found three.
 *
 * Both directions fail. A count **below** the walk is the gap this closes — a
 * reach nobody was asked about. A count **above** it is the stale entry the key
 * already refuses, one granularity down: a number left standing after the
 * statements under it went. {@link countIssueFor} is the whole rule, and it says
 * nothing when the walk found **none** — that is staleness, reported once by the
 * name it already had.
 *
 * A permanent entry carries the count on the same terms
 * ({@link PermanentLedgerEntry.sites}). Permanence answers "why does this edge
 * stand", never "why does it stand twice", and a co-transactional seam that
 * grows a second statement deserves the question a draining one's growth gets.
 *
 * **`ledger-size` still means keys.** An entry is the unit of review and of
 * retirement — the cut that removes it removes every reach under it — and a file
 * with three reaches under one entry contributes 1, as it always did. Counting
 * sites instead would have moved the published number 57 -> 64 with no code
 * changed, reading as a regression in a drain that is nearly finished. The site
 * total is printed beside it as `(sites=…)`, derived from the counts and never
 * written down, so growth inside an entry is visible in the summary line too.
 *
 * **"Not yet cut" is a reason only during the sweep.** Every entry generated in
 * MR-0 says so and names the merge request that retires it; after
 * **2026-12-31** that sentence stops being an acceptable reason, and an entry
 * still carrying it is a boundary the repository has decided to keep rather than
 * one it is in the middle of removing.
 *
 * Usage: `tsx scripts/check-module-boundary.ts [--list] [--tests] [--module <id>]`
 * Exit 0 = every cross-module reach is ledgered in its own shard;
 * exit 1 = at least one is not, or the ledger lies in one of the other seven ways;
 * exit 2 = the check read nothing — no module sources, no ledger directory, a
 * table→owner map in which **either** in-tree pass resolved zero tables, an
 * admin layout that resolved while its **host walk opened no file** (feature
 * 091, P1: the route table and the nav the layout was read from both live
 * there, so an empty host walk is a walk that stopped working), an installed
 * package whose declarations could not be enumerated, or a module package
 * subpath a module reached whose **emitted module could not be read**
 * (D-171). Each pass proves it looked, and a silently empty migration pass is
 * precisely the entity-only blindness the second source exists to remove
 * (issue #113) — as is a file whose unreadability would otherwise grant the
 * reach into it an exemption.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname as posixDirname, join as posixJoin, normalize as posixNormalize } from 'node:path/posix';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ADMIN_HOST_OWNER } from './lib/admin-surfaces.js';
import { moduleOf } from './check-container-imports.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import {
  EVERY_SUBPATH_IS_A_REACH,
  modulePackageSurfaces,
  UnreadableSubpathError,
  type ModulePackageSurfaces,
} from './lib/module-package-subpaths.js';
import {
  declaresNoDependency,
  dependencyClosures,
  loadManifestDependencies,
  ManifestDependenciesUnreadableError,
  type DeclaredDependencies,
  type DependencyClosures,
} from './lib/manifest-dependencies.js';
import {
  declaredMigrationClasses,
  migrationRegistryCoverage,
  registeredMigrations,
} from './lib/migration-registry.js';
import { namedSpecifiers, type SpecifierKind } from './lib/specifiers.js';
import {
  declaredTableNames,
  sqlTableAccesses,
  type SqlAccessDirection,
  type SqlAccessSyntax,
} from './lib/sql-tables.js';
import { pluralize, toSnakeCase } from '../src/db/pluralizing-naming-strategy.js';

/**
 * The convention an `@Entity()` with no `tableName` follows, handed to
 * `declaredTableNames` rather than imported by it: the naming strategy is the
 * application's and `lib/sql-tables.ts` is the package's (feature 101, Phase 2).
 */
const entityTableName = (className: string): string => pluralize(toSnakeCase(className));
import {
  loadRegisteredModuleIds,
  modulePopulationCoverage,
  NO_HOST_RESIDENT_MODULES,
  type HostResidentModules,
  vacuousModulePopulation,
} from './lib/module-population.js';
import {
  loadPackageDeclarations,
  packageCoverage,
  refuseUnreadablePackages,
  type PackageDeclarations,
  type PackageTable,
} from './lib/package-declarations.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TEST_ROOT = join(BACKEND_ROOT, 'test');
const LEDGER_ROOT = join(BACKEND_ROOT, 'scripts', 'ledgers', 'cross-module-imports');
/**
 * R1's ledger — a migration naming a table its module does not declare
 * (feature 097, contract §4.1).
 *
 * A directory of its own rather than entries in `cross-module-imports`, because
 * the two hold different rules: there, every reach is debt; here, a *declared*
 * reach is fine and only an undeclared one is recorded. One file carrying two
 * predicates with different verdicts is how `ledger-size` stops meaning
 * anything (contract §4.3).
 */
const MIGRATION_REFERENCE_LEDGER_ROOT = join(
  BACKEND_ROOT,
  'scripts',
  'ledgers',
  'migration-undeclared-references',
);
/** R2's ledger — a migration writing another module's table (contract §4.2). */
const MIGRATION_WRITE_LEDGER_ROOT = join(
  BACKEND_ROOT,
  'scripts',
  'ledgers',
  'migration-foreign-writes',
);

/**
 * Module files a generator owns, and the script that emits each.
 *
 * Checked **two ways** by {@link generatedExemptionIssues}: an entry naming a
 * file that does not exist fails, and a file whose named generator does not
 * exist fails. An exemption nobody can go stale on is an exemption that outlives
 * its reason.
 */
export const GENERATED_MODULE_FILES: Readonly<Record<string, string>> = {
  'manifest-index.generated.ts': 'scripts/generate-composer.ts',
};

/** The specifier shape, as `scripts/lib/specifiers.ts` classifies it. */
export type CrossModuleImportKind = SpecifierKind;

/** Which surface of the target the specifier reaches — it selects the remedy. */
export type CrossModuleSurface = 'entity' | 'service' | 'port' | 'manifest' | 'wiring' | 'other';

export interface CrossModuleImport {
  /** Which predicate produced it — see the header's "two predicates, one ledger". */
  readonly predicate: 'import';
  /** Path under `src/`, POSIX separators: `modules/orders/services/order-service.ts`. */
  readonly file: string;
  readonly line: number;
  /** The module the importing file belongs to. */
  readonly moduleId: string;
  /** The module the specifier resolves into. Always a different directory. */
  readonly target: string;
  /** The specifier exactly as written, for the message. */
  readonly specifier: string;
  /**
   * The target path with the module segment stripped, normalised, extension
   * dropped: `entities/product.entity`. Normalised rather than taken verbatim,
   * so `../catalog/x` and `../../catalog/x` from two depths produce one key.
   */
  readonly targetPath: string;
  readonly kind: CrossModuleImportKind;
  readonly surface: CrossModuleSurface;
  /** True when either side lives under `src/apps/<deployment>/modules/`. */
  readonly overlay: boolean;
}

/**
 * A module naming another module's table in raw SQL or in a query builder
 * (D-87; issue #187).
 *
 * The owner is the module (or the kernel) whose entity class or `create table`
 * DDL declares the table, so the remedy is the same one an import edge gets:
 * ask the owner through a port. `syntax` says which recognition path saw it —
 * the two share the ledger key, so one table reached both ways in one file is
 * one entry.
 */
export interface CrossModuleSqlAccess {
  readonly predicate: 'sql';
  /** Path under `src/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  /** The module the literal lives in. */
  readonly moduleId: string;
  /** The owner of the table — a module id, or `kernel`. */
  readonly target: string;
  /** The table identifier as the statement names it, lower-cased. */
  readonly table: string;
  readonly direction: SqlAccessDirection;
  /** A SQL statement literal, or a knex query builder. */
  readonly syntax: SqlAccessSyntax;
  /** The head of the statement or of the builder chain, for the message. */
  readonly statement: string;
  /** True when either side lives under `src/apps/<deployment>/modules/`. */
  readonly overlay: boolean;
}

/** What either predicate produces. Both are ledgered in the same shard. */
export type ModuleBoundaryFinding = CrossModuleImport | CrossModuleSqlAccess;

/**
 * Which of the two migration rules a finding states (feature 097, contract §2).
 *
 * Two findings and not one, because they have different remedies: an R1 finding
 * is repaired by a manifest line **or** by moving the statement; an R2 finding
 * only by moving it. A single merged finding would let the R2 population go
 * blind behind R1's red for every module that happens to declare its target —
 * 21 of the 37 module-targeting writes standing when this landed, which is
 * issue #130's shape (one signal's red hiding another's blindness).
 *
 * One statement may produce **both**; `transactional_emails`' two `UPDATE`s did.
 */
export type MigrationSqlRule =
  | 'undeclared-migration-table-reference'
  | 'migration-writes-a-foreign-table';

/**
 * A migration naming another module's table in DML (feature 097).
 *
 * Deliberately **not** a `ModuleBoundaryFinding`: it takes its own two ledgers,
 * because the host check's rule over an ordinary source is "every reach is debt"
 * and R1's rule is "a declared reach is fine". Sharing the shards would put two
 * verdicts in one file (contract §4.3).
 */
export interface MigrationSqlFinding {
  readonly rule: MigrationSqlRule;
  /** Path under `src/`, POSIX separators — `layout.keyOf`'s spelling. */
  readonly file: string;
  readonly line: number;
  /** The module whose `migrations/` directory holds the file. */
  readonly moduleId: string;
  /** The module that owns the table. Never the kernel — see {@link analyzeMigrationSql}. */
  readonly target: string;
  readonly table: string;
  readonly direction: SqlAccessDirection;
  readonly syntax: SqlAccessSyntax;
  readonly statement: string;
}

/**
 * The migration ledgers' key: `<file>:<table>`.
 *
 * Not `(file, target)`: a migration may name two of `B`'s tables for different
 * reasons and the entry has to say which. Not `(file, line)`: a line-keyed entry
 * reds on any insertion above the site, which is `check:admin-zones`' recorded
 * reasoning and this repository's rule for every ledger it has.
 */
export function migrationKeyOf(found: MigrationSqlFinding): string {
  return `${found.file}:${found.table}`;
}

/**
 * The ledger key, and a site's identity.
 *
 * `<file>:<target module>/<target path>` for an import,
 * `<file>:sql:<owner>/<table>` for a SQL access. Keyed by file and target rather
 * than by line (FR-026), so code can move inside a file without invalidating the
 * ledger, and the `sql:` segment keeps the two predicates' keys disjoint while
 * leaving the file half — which is what decides misfiling — in the same place.
 */
export function keyOf(found: ModuleBoundaryFinding): string {
  if (found.predicate === 'sql') {
    return `${found.file}:sql:${found.target}/${found.table}`;
  }
  return found.targetPath === ''
    ? `${found.file}:${found.target}`
    : `${found.file}:${found.target}/${found.targetPath}`;
}

/**
 * An entry the repository has decided to **keep** (feature 075, D-77).
 *
 * The ordinary entry is a sentence saying why an edge still stands and what
 * retires it; the sweep drains them, and `ledger-size` counts them so the
 * draining is visible. A permanent entry is the opposite claim — this edge is
 * not waiting for a merge request, it rests on something in the tree — and it is
 * held to a different rule in both directions:
 *
 *  - it is **excluded from `ledger-size`** and printed separately, so a residue
 *    that has stopped shrinking because the last few entries are permanent does
 *    not read as a stalled sweep (the idiom D-72 gave the parity ledger);
 *  - it **must name what would retire it**, and "the cut merge request" is not
 *    an acceptable answer for one. An entry with no retiring condition is a
 *    boundary nobody can argue with later, which is exactly what a permanent
 *    flag must not be allowed to create.
 *
 * The worked example is `catalog` → `custom_fields`' apply seam: a child insert
 * must see its parent inside one transaction because of
 * `fk_product_attributes_custom_field_definition`, so no port can carry it, and
 * what retires it is F4's package entry points — not a cut.
 */
export interface PermanentLedgerEntry {
  readonly permanent: true;
  /** Why the edge stands. Names the constraint, not the inconvenience. */
  readonly reason: string;
  /** What would retire it. A merge request is not a retiring condition. */
  readonly retiredBy: string;
  /**
   * How many reaches stand under this key. Omitted means one — see
   * {@link CountedLedgerEntry}, and the header's "the count on an entry".
   *
   * A permanent entry carries it on the same terms as a draining one:
   * permanence answers "why does this edge stand", never "why does it stand
   * three times", and a co-transactional seam that grows a second statement is
   * worth exactly the question a draining one's growth is worth.
   */
  readonly sites?: number;
}

/**
 * A draining entry whose file reaches its target more than once (issue #267).
 *
 * The plain string form *is* this entry with `sites: 1`, which is what 60 of
 * the 68 keys standing when the count landed are. The field is written only
 * where the key covers more than one reach, so the common entry stays a
 * sentence and the exceptional one says how many.
 */
export interface CountedLedgerEntry {
  /** How many reaches stand under this key. At least 1, and an integer. */
  readonly sites: number;
  /** The same sentence a string entry carries. */
  readonly reason: string;
}

/** What a shard maps a key to: a reason, a counted reason, or a permanent entry. */
export type LedgerEntry = string | CountedLedgerEntry | PermanentLedgerEntry;

/**
 * How many reaches the entry claims stand under its key, or `null` when it
 * declares a `sites` that is not a positive integer.
 *
 * Omitting the field means one. That default is safe because it fails
 * **closed**: an author who ledgers a file that already reaches its target
 * three times writes a sentence, records 1 by omission, and the run tells them
 * the walk found three.
 */
export function recordedSites(entry: LedgerEntry): number | null {
  if (typeof entry === 'string') return 1;
  const sites: unknown = (entry as { sites?: unknown }).sites;
  if (sites === undefined) return 1;
  if (typeof sites !== 'number' || !Number.isInteger(sites) || sites < 1) return null;
  return sites;
}

/** The reason text an entry carries, whichever of the three forms it takes. */
export function reasonOf(entry: LedgerEntry): string {
  return typeof entry === 'string' ? entry : entry.reason;
}

/**
 * Whether a shard value is a counted draining entry: a reason with a `sites`
 * field beside it.
 *
 * Structural, and deliberately tolerant of a malformed `sites` — a
 * `sites: 'two'` is a *count* defect, reported as one, rather than a value the
 * malformed-entry message calls "neither a reason nor a permanent entry" while
 * saying nothing about the number.
 */
function isCounted(entry: unknown): entry is CountedLedgerEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'sites' in entry &&
    typeof (entry as { reason?: unknown }).reason === 'string'
  );
}

/**
 * Why an entry's recorded count does not describe what the walk found, or
 * `null` when it does.
 *
 * `found === 0` is not this rule's business: the entry describes no reach at
 * all, which is the stale direction the key has always refused, and reporting
 * it twice would name one defect two ways.
 */
export function countIssueFor(key: string, entry: LedgerEntry, found: number): string | null {
  const recorded = recordedSites(entry);
  if (recorded === null) {
    const written = JSON.stringify((entry as { sites?: unknown }).sites);
    return (
      `${key} records \`sites: ${written}\` — a site count is a positive integer, and an ` +
      'entry that cannot say how many reaches it covers cannot be compared with the walk'
    );
  }
  if (found === 0 || recorded === found) return null;
  if (recorded < found) {
    return (
      `${key} records ${recorded}, the walk found ${found} (+${found - recorded}) — the file ` +
      'grew a reach into that target and no reviewer was asked why. Record ' +
      `${found} and say in the reason what the new one is for, or remove it.`
    );
  }
  return (
    `${key} records ${recorded}, the walk found ${found} (-${recorded - found}) — a count left ` +
    `standing after a reach went is the stale entry the key already refuses. Record ${found}` +
    (found === 1 ? ', or drop the `sites` field and leave the reason.' : '.')
  );
}

/** One ledger shard: the module it belongs to, and its entries. */
export interface LedgerShard {
  /** The consumer module the shard is named for — the filename's stem. */
  readonly moduleId: string;
  /** Key → the reason it still stands and the question that retires it. */
  readonly entries: Readonly<Record<string, LedgerEntry>>;
  /**
   * The shard file's source text, so the analysis can read the entry type the
   * file **declares** — see {@link shardShapeIssue}.
   *
   * `undefined` means "built in memory, no file to declare a type in", which is
   * what the check's own fixtures hand in; {@link loadLedgerShards} always sets
   * it, and refuses a shard whose file read back empty, so a real run cannot
   * skip the signal by supplying nothing.
   */
  readonly source?: string;
}

/**
 * The one entry type a shard may declare (issue #217).
 *
 * A shard is loaded through a dynamic `import`, so `tsc` sees its annotation and
 * the check does not — and the annotation decides what an author is *able* to
 * write in the file. `payments` declared `Readonly<Record<string, string>>`, so
 * a `{ permanent: true, reason, retiredBy }` entry was a type error in it: the
 * one edge a foreign key holds co-transactional had to claim permanence in
 * prose, counted toward `ledger-size` as debt nothing would drain, and
 * {@link permanentEntryIssue} never ran over that shard at all.
 */
export const CANONICAL_SHARD_ENTRY_TYPE = 'Readonly<Record<string, LedgerEntry>>';

/** `export const entries: <type> =`, with the type as the only capture. */
const ENTRY_DECLARATION = /export\s+const\s+entries\s*:([^=]+)=/;

/**
 * The entry type a shard's source declares, whitespace-normalised, or `null`
 * when it declares none.
 *
 * Text rather than types, because the shard is imported at runtime: what the
 * check can compare is the sentence the author wrote.
 */
export function declaredEntryType(source: string): string | null {
  const declared = ENTRY_DECLARATION.exec(source)?.[1];
  if (declared === undefined) return null;
  const normalised = declared.replace(/\s+/g, ' ').trim();
  return normalised === '' ? null : normalised;
}

/**
 * Why a shard's declared entry type is not acceptable, or `null` when it is —
 * including when the shard has no source, which is an in-memory fixture rather
 * than a file that got the declaration wrong.
 */
export function shardShapeIssue(moduleId: string, source: string | undefined): string | null {
  if (source === undefined) return null;
  const declared = declaredEntryType(source);
  if (declared === CANONICAL_SHARD_ENTRY_TYPE) return null;
  const found = declared === null ? 'declares no entry type' : `declares \`${declared}\``;
  return (
    `${moduleId} ${found} — a shard declares \`${CANONICAL_SHARD_ENTRY_TYPE}\`, or a ` +
    'permanent entry cannot be written in it and its permanence is never checked (issue #217)'
  );
}

/**
 * Whether a shard value claims permanence.
 *
 * Structural rather than trusting the declared type, because a shard is loaded
 * at runtime through a dynamic `import` and `tsc` never sees it. A value that is
 * neither a string nor a permanence claim is reported as a malformed entry
 * rather than silently read as a reason.
 */
export function isPermanent(entry: unknown): entry is PermanentLedgerEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    (entry as { permanent?: unknown }).permanent === true
  );
}

/** A merge request is not a retiring condition — see {@link PermanentLedgerEntry}. */
const SWEEP_RETIRING_CONDITION = /merge request|the cut\b|not yet cut|phase c/i;

/**
 * Why a permanent entry is not acceptable as written, or `null` when it is.
 *
 * Separate from the shard walk so the rule can be proven on one entry rather
 * than on a tree, and so the message names the key the reader has to fix.
 */
export function permanentEntryIssue(key: string, entry: PermanentLedgerEntry): string | null {
  const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
  if (reason === '') {
    return `${key} is permanent but states no reason`;
  }
  const retiredBy = typeof entry.retiredBy === 'string' ? entry.retiredBy.trim() : '';
  if (retiredBy === '') {
    return `${key} is permanent but names no retiring condition`;
  }
  if (SWEEP_RETIRING_CONDITION.test(retiredBy)) {
    return (
      `${key} is permanent but names the sweep as its retiring condition ` +
      `("${retiredBy}") — an entry a merge request retires is not permanent`
    );
  }
  return null;
}

export interface ModuleBoundaryInput {
  /** Every module source, keyed by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, string>;
  /**
   * Every source the table→owner map is built from, keyed the same way — the
   * whole of `src/`, because entity classes live in modules **and** in the
   * kernel and the pre-065 DDL lives in `src/db/migrations`.
   *
   * Absent means "do not run the `sql` predicate": that is what keeps the
   * import predicate's own fixtures — which hand in three files and no schema —
   * meaning what they meant.
   */
  readonly schema?: ReadonlyMap<string, string>;
  /**
   * Tables the installed extension packages own (feature 080, T034).
   *
   * Absent means "this input describes no installed package", which is what
   * every fixture in the tree says and what every run of this repository's CI
   * says. It never means "the packages own nothing": a package the loader could
   * not read stops the run at exit 2 before this map is built.
   */
  readonly packageTables?: readonly PackageTable[];
  /**
   * Each module package's npm name mapped to the module id it declares, so a
   * bare specifier can be resolved to a module (feature 080).
   *
   * Absent is the tree with no module package, and it is the behaviour that
   * shipped before !910 — not "no package reaches a module". The CLI derives the
   * map from `lib/module-roots.ts` and refuses a run in which the layout found
   * package roots and this map came back empty, because that disagreement is the
   * only way the absence can mean something other than what it says.
   */
  readonly modulePackages?: ReadonlyMap<string, string>;
  /**
   * Which of those packages' subpaths are **contract surface** (D-171).
   *
   * Absent is {@link EVERY_SUBPATH_IS_A_REACH}, the behaviour that shipped: an
   * exemption is granted by a measurement and never by the absence of one. The
   * CLI builds a real reader over each package's directory, so the answer comes
   * off the package's own `exports` map and its own emitted module.
   */
  readonly modulePackageSurfaces?: ModulePackageSurfaces;
  /**
   * Directories whose files belong to a module no `modules/<id>/` segment names
   * — `lib/module-roots.ts`' `hostResidentModules` (feature 080, T040b).
   *
   * Absent is a tree that has none. Present, it is what lets both predicates
   * attribute a host-resident module's files: without it they are read as
   * belonging to no module, which clears every reach out of them and reports
   * that module's shard as an orphan.
   */
  readonly hostResidentModules?: HostResidentModules;
  /**
   * The admin application's module surfaces (feature 091, FR-017).
   *
   * Absent is a workspace with no frontend — every fixture, and CI before this
   * field existed. See {@link AdminBoundarySurfaces}: the CLI refuses a run
   * whose ledger holds admin keys and whose admin layout came back empty, which
   * is the one way this absence can mean something other than what it says.
   */
  readonly adminSurfaces?: AdminBoundarySurfaces | null;
  /**
   * Each module's **transitive** manifest `dependencies` closure (feature 097).
   *
   * Absent means "do not run the migration rules" — the idiom
   * {@link ModuleBoundaryInput.schema} already uses for the `sql` predicate, and
   * what keeps every import-predicate fixture in this tree meaning what it
   * meant. It never means "nothing is declared": an empty graph makes R1 fire
   * on every cross-module access there is, which is why the CLI refuses one
   * outright (contract §6.3) rather than analysing under it.
   *
   * Computed once from the generated manifest index, by the traversal
   * `test/unit/db/fk-dependency-drift.test.ts` also uses — one closure, or the
   * two instruments enforcing AGENTS.md § *Migrations* item 4 over DDL and DML
   * answer differently for one edge.
   */
  readonly dependencyClosures?: DependencyClosures;
}

/** The tree with no module package installed — every fixture, and CI before !910. */
const NO_MODULE_PACKAGES: ReadonlyMap<string, string> = new Map();

export interface CheckResult extends LedgerVerdict<ModuleBoundaryFinding> {
  readonly total: number;
  /** What each pass of the table→owner map resolved, and what is left over. */
  readonly tableOwners: TableOwnerReport;
  /**
   * Import specifiers the walk examined, cleared ones included (issue #244).
   *
   * The `read:` line's `sites=` is this **plus**
   * {@link CheckResult.examinedTableReferences}, and the two are carried apart
   * rather than pre-summed for the reason
   * `READ_SIZE_WITHOUT_A_SITE_POPULATION` recorded against printing one number
   * here at all: a sum over two populations hides the one that went to zero. So
   * each addend has a floor of its own in {@link vacuousReason}, and zero is
   * refused before the sum is printed.
   */
  readonly examinedSpecifiers: number;
  /** Table references the walk examined, in migrations and outside them. */
  readonly examinedTableReferences: number;
  /** How many migration files the walk opened (feature 097, contract §6.1). */
  readonly migrationFiles: number;
  /** Every migration class those files declare — contract §5's coverage half. */
  readonly migrationClasses: ReadonlySet<string>;
  /** Every R1 and R2 finding, in file then line order. */
  readonly migrationFindings: readonly MigrationSqlFinding[];
  /** R1's verdict — a migration naming a table its module does not declare. */
  readonly undeclaredReferences: LedgerVerdict<MigrationSqlFinding>;
  /** R2's verdict — a migration writing another module's table. */
  readonly foreignWrites: LedgerVerdict<MigrationSqlFinding>;
}

/** Where a module lives and what it is called: `{ id: 'orders', dir: 'modules/orders' }`. */
interface ModuleLocation {
  readonly id: string;
  readonly dir: string;
}

/**
 * The admin application's module surfaces, as this check needs them
 * (feature 091, FR-017).
 *
 * Absent is a workspace with no frontend — every fixture in the tree — and it
 * is the behaviour that shipped before this field existed. It never means "the
 * admin has no module surfaces": the CLI refuses a run whose ledger holds admin
 * keys and whose admin layout came back empty, which is the one way the absence
 * could mean something other than what it says.
 *
 * Every path here is spelled the way `ModuleTreeLayout.keyOf` spells it —
 * repository-relative, because the admin has no `backend/src` to be relative
 * to — so a ledger key, a message and a walked source are one namespace.
 */
export interface AdminBoundarySurfaces {
  /** `admin/src` — what the source alias resolves to. */
  readonly sourceRoot: string;
  /**
   * `admin/src/modules` — the directory holding the module surfaces — or `null`
   * when the application has none left (feature 091, R16).
   *
   * The layout's own field, carried through unchanged. Every site below answers
   * the `null` the same trivial way: nothing is under a directory that does not
   * exist, so no path is a module surface, no directory is attributed, and the
   * host population is the whole source root — which is what it now is.
   */
  readonly moduleRoot: string | null;
  /** The prefix a specifier writes {@link AdminBoundarySurfaces.sourceRoot} as, slash included. */
  readonly aliasPrefix: string;
  /**
   * Directory name under {@link AdminBoundarySurfaces.moduleRoot} → the module
   * that owns it.
   *
   * A directory that is absent is the admin application's own and is not
   * judged, which is the fail-closed direction: `basename` would attribute a
   * directory to a module that does not exist, so its reaches would be
   * ledgered under an orphan shard and a reach from the owner's own screens
   * into it would read as cross-module when it is a module reaching its own
   * code. `admin/src/modules/warehouses/` was the standing example — the nav
   * attributes it to `inventory` — until feature 091's Phase 4 batch 13 moved
   * both of that module's surface directories into its package. Derived by
   * `scripts/lib/admin-surfaces.ts` from the route table and the nav, never
   * from the directory name.
   */
  readonly moduleOfDirectory: ReadonlyMap<string, string>;
  /**
   * The two hand-written registries, excluded from the host population.
   *
   * `App.tsx` and `components/AppShell.tsx`, as the layout itself names them —
   * never a second spelling of the pair here. They are the registries Story 3
   * deletes and `App.tsx` imports one component per module screen, so ledgering
   * them would record the feature's own subject as its debt, one entry per
   * route, re-written by every batch.
   *
   * The consequence is stated rather than discovered: a genuine host→module
   * reach added to either file is invisible to this check. It used to be
   * visible to `check:admin-registrations`, whose entire population was those
   * two files; that check is deleted (feature 091, Phase 5 T5) and what now
   * holds them is an assertion in the admin's own suite —
   * `admin/test/modules/host-admin-registrations.test.tsx`, which counts both
   * registries in **totals** and names the four routes and three nav entries
   * that are the admin application's own (`contracts/admin-registry.md` R13a).
   */
  readonly registryFiles: ReadonlySet<string>;
  /**
   * The generated contribution registry, excluded for the reason
   * `composition.generated.ts` is: a generated composition root naming every
   * contributing module by a bare specifier is the artefact doing its job.
   *
   * Unlike {@link GENERATED_MODULE_FILES} this needs no two-way rot check,
   * because it is not written down — the path is the layout's own, derived from
   * the alias member and from the constant the generator writes with.
   */
  readonly generatedRegistryFile: string;
}

/** The workspace with no frontend — every fixture, and CI before feature 091. */
const NO_ADMIN_SURFACES = null;

/**
 * The admin **host** file's owner — the application itself (feature 091, P1).
 *
 * `null` for anything outside `admin/src`, and for everything under the admin
 * module root, which {@link adminLocationOf} answers for instead.
 *
 * ## Why the host is an owner at all
 *
 * `check:module-boundary`'s admin population judges a reach between two
 * *modules*, so a file the module root does not hold is judged as nobody's —
 * right for the file, and it leaves the reach unrecorded. Nine files under
 * `admin/src/components` import a module's admin API client or component;
 * `admin/src/components/IdleLogout.tsx` takes `settings`' client and is in no
 * ledger at all. That is a real coupling — the admin application asking a module
 * for something — and it is the coupling with the *worse* failure mode: a
 * ledgered reach rewritten as a package specifier goes stale loudly
 * (`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0),
 * while an **unrecorded** one is rewritten and nothing anywhere goes red,
 * because there was no entry to strand.
 *
 * ## Why only this half of the gap
 *
 * `specs/091-module-owned-admin-surfaces/research.md` §6.6 measures three shapes
 * in no instrument's population; this admits one of them. The other two are
 * `_shared/email-builder` in both directions, and they are deliberately left
 * out: `_shared` is the admin application's by the same derivation that makes
 * `home`, `platform` and `profile` so, and where the directory *goes* is an open
 * owner decision (`cms`' package, or a fourth `page-builder`-family package —
 * `plan.md` § *Phase 4* P5). A ledger cannot answer that, and attributing
 * `_shared` to a module to make the walk produce findings would put a false
 * owner into an artefact three checks read.
 *
 * What would bring it in is the answer to that question: once `_shared` has a
 * home, its files are either a module's — {@link adminLocationOf} attributes
 * them with no change here — or the kit's, at which point the reaches are
 * `check:admin-surface`'s and not a boundary question at all. Until then a
 * reach into `_shared` resolves to no owner and is not a finding, and a reach
 * out of it is made by a file this function answers `null` for.
 */
function adminHostOwnerOf(
  path: string,
  admin: AdminBoundarySurfaces | null,
): ModuleLocation | null {
  if (admin === null) return null;
  if (!path.startsWith(`${admin.sourceRoot}/`)) return null;
  if (admin.moduleRoot !== null && path.startsWith(`${admin.moduleRoot}/`)) return null;
  return { id: ADMIN_HOST_OWNER, dir: admin.sourceRoot };
}

/**
 * Whether this admin host file declares the platform's own wiring, and is
 * therefore not a consumer whose reaches are ledgered.
 *
 * Both exclusions are derived from the layout — see
 * {@link AdminBoundarySurfaces.registryFiles} and
 * {@link AdminBoundarySurfaces.generatedRegistryFile} — so neither can name a
 * file that has moved, and neither is a path spelled in this check.
 */
function isAdminRegistryFile(file: string, admin: AdminBoundarySurfaces | null): boolean {
  if (admin === null) return false;
  return admin.registryFiles.has(file) || file === admin.generatedRegistryFile;
}

/**
 * The module an **admin** path belongs to, with its directory, or `null` for a
 * path outside the admin module root or in a directory no module owns.
 */
function adminLocationOf(
  path: string,
  admin: AdminBoundarySurfaces | null,
): ModuleLocation | null {
  if (admin === null || admin.moduleRoot === null) return null;
  const prefix = `${admin.moduleRoot}/`;
  if (!path.startsWith(prefix)) return null;
  const directory = path.slice(prefix.length).split('/')[0];
  if (directory === undefined || directory === '') return null;
  const id = admin.moduleOfDirectory.get(directory);
  return id === undefined ? null : { id, dir: `${admin.moduleRoot}/${directory}` };
}

/**
 * The module a path under `src/` belongs to, with its directory.
 *
 * `moduleOf` is shared with `check-container-imports.ts` so the two checks
 * cannot disagree about what a module is; the trailing slash is what lets it
 * answer for a specifier that resolves to the module directory itself
 * (`from '../catalog'`).
 *
 * The admin branch is consulted **first** and cannot be reached by a backend
 * path, because it keys on the admin module root's own prefix. It has to come
 * first: `moduleOf`'s `/src/modules/<id>/` regex matches inside any
 * `admin/src/modules/<directory>/` path and answers the **directory name**,
 * which is not a module id. `warehouses` was the standing example — a
 * directory the nav attributes to `inventory` — until feature 091's Phase 4
 * batch 13 moved it into that module's package; the ordering is what makes the
 * rule hold for the next such directory rather than for that one.
 */
function moduleLocationOf(
  pathUnderSrc: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
  admin: AdminBoundarySurfaces | null = NO_ADMIN_SURFACES,
): ModuleLocation | null {
  if (
    admin !== null &&
    admin.moduleRoot !== null &&
    pathUnderSrc.startsWith(`${admin.moduleRoot}/`)
  ) {
    return adminLocationOf(pathUnderSrc, admin);
  }
  const id = moduleOf(`/src/${pathUnderSrc}/`, hostResident);
  if (id === null) return null;
  const segments = pathUnderSrc.split('/');
  const modulesAt = segments.indexOf('modules');
  const index = segments.indexOf(id, modulesAt);
  // A host-resident module's directory is not named after its id (feature 080,
  // T040b), so the segment search cannot find it — the map that named the
  // module is also the one that says where it starts.
  if (index === -1) {
    for (const [directory, moduleId] of hostResident) {
      if (moduleId === id && (pathUnderSrc === directory || pathUnderSrc.startsWith(`${directory}/`))) {
        return { id, dir: directory };
      }
    }
    return null;
  }
  return { id, dir: segments.slice(0, index + 1).join('/') };
}

/**
 * Who a walked file's reaches are **attributed to**: its module, or the admin
 * application (feature 091, P1).
 *
 * The distinction from {@link moduleLocationOf} is the whole of P1's design and
 * it is a **direction**. This function is asked at the *source* position only —
 * the file whose specifiers are being read, the shard a key is filed under, the
 * owner set an orphan shard is judged against. The *target* position keeps
 * asking {@link moduleLocationOf}, which answers `null` for a host path, so
 * `host` can never be the target of a finding.
 *
 * Were it asked at both ends, every module→host reach in `admin/src/modules`
 * would become a boundary finding — that is `check:admin-surface`'s population,
 * roughly 1700 reaches into published kit surface, and duplicating it here would
 * report the admin design system as cross-module debt.
 */
function ownerLocationOf(
  pathUnderSrc: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
  admin: AdminBoundarySurfaces | null = NO_ADMIN_SURFACES,
): ModuleLocation | null {
  return (
    moduleLocationOf(pathUnderSrc, hostResident, admin) ?? adminHostOwnerOf(pathUnderSrc, admin)
  );
}

/**
 * The specifier resolved against the importing file's directory, extension
 * dropped, or `null` for a bare specifier.
 */
/**
 * The module a **bare** specifier reaches, and the subpath it names, or `null`.
 *
 * The longest declared name that the specifier matches **on a segment boundary**
 * wins. Both halves are load-bearing and neither is decoration:
 * `@endora-commerce/mod-blog-extra` must not answer with `blog`, which a bare
 * `startsWith` gives — that is the prefix match behind the documented 2.2×
 * undercount, moved from a path to a package name. Longest-first is what lets
 * two module packages share a prefix at all.
 *
 * The subpath is returned as written (`backend`, `migrations`), never resolved
 * through the `exports` map: the map's targets are `dist/**` under D-164, and a
 * ledger key naming a build artefact would change whenever the emit layout does.
 * The package root answers `''`, which is what a relative specifier naming the
 * module directory already answers.
 *
 * The matched **name** comes back too, because D-171's question is asked of the
 * package rather than of the module: the exemption is a property of the subpath
 * the owner declared, and the declaration lives in that package's manifest.
 */
function resolveModulePackage(
  specifier: string,
  modulePackages: ReadonlyMap<string, string>,
): { readonly id: string; readonly name: string; readonly subpath: string } | null {
  if (specifier.startsWith('.') || modulePackages.size === 0) return null;
  let best: {
    readonly id: string;
    readonly name: string;
    readonly subpath: string;
    readonly length: number;
  } | null = null;
  for (const [name, id] of modulePackages) {
    if (!specifier.startsWith(name)) continue;
    const rest = specifier.slice(name.length);
    if (rest !== '' && !rest.startsWith('/')) continue;
    if (best !== null && name.length <= best.length) continue;
    best = {
      id,
      name,
      subpath: rest.replace(/^\//, '').replace(/\.(js|ts)$/, ''),
      length: name.length,
    };
  }
  return best === null ? null : { id: best.id, name: best.name, subpath: best.subpath };
}

/**
 * The specifier resolved against the importing file's directory, extension
 * dropped, or `null` for a bare specifier.
 *
 * The admin writes 67 of its 94 cross-module reaches through the `@/` alias
 * (feature 091), so a relative-only resolver sees 27 of them and reports the
 * rest as third-party imports it cleared. The alias is expanded against the
 * admin source root the layout derived from the tsconfig that declares it — the
 * same declaration `tsc` and Vite resolve it through — and never against a path
 * written here.
 */
function resolveSpecifier(
  fromFile: string,
  specifier: string,
  admin: AdminBoundarySurfaces | null = NO_ADMIN_SURFACES,
): string | null {
  if (admin !== null && specifier.startsWith(admin.aliasPrefix)) {
    const joined = posixNormalize(
      posixJoin(admin.sourceRoot, specifier.slice(admin.aliasPrefix.length)),
    );
    return joined.replace(/\.(jsx?|tsx?)$/, '');
  }
  if (!specifier.startsWith('.')) return null;
  const joined = posixNormalize(posixJoin(posixDirname(fromFile), specifier));
  return joined.replace(/\.(jsx?|tsx?)$/, '');
}

/**
 * Which surface of the target the specifier reaches.
 *
 * `kind` is the specifier shape and `surface` is the target shape: the red
 * proofs are about the first (can the walker still see it?) and the failure
 * message's remedy is about the second (what should this become?).
 */
function surfaceOf(targetPath: string): CrossModuleSurface {
  const segments = targetPath.split('/');
  const head = segments[0] ?? '';
  const base = segments[segments.length - 1] ?? '';
  if (head === 'entities' || base.endsWith('.entity')) return 'entity';
  if (segments.includes('ports') || base.endsWith('.port')) return 'port';
  if (head === 'services' || base.endsWith('.service') || base.endsWith('-service')) {
    return 'service';
  }
  if (base.startsWith('manifest')) return 'manifest';
  if (base === 'backend' || base === 'plugin' || base.startsWith('routes')) return 'wiring';
  return 'other';
}

/**
 * How many units an analysis **examined**, as opposed to had a finding in
 * (issue #244's `sites=`).
 *
 * A mutable counter passed down rather than a second walk, because the walk is
 * the expensive half: both recognisers already parse every source once, and
 * re-parsing 2190 files to count what they cleared would add most of the check's
 * runtime to answer a disclosure question. Every fixture omits it and pays
 * nothing.
 */
export interface SiteTally {
  count: number;
}

/**
 * Every cross-module import `source` names.
 *
 * `file` is the path **under `src/`**, because that is what decides the owning
 * module, the target module and whether the file is scanned at all — which is
 * also why every red proof enters here, with source text and a path, rather than
 * with a resolved pair the check normally computes (issue #130).
 */
export function analyzeSource(
  source: string,
  file: string,
  modulePackages: ReadonlyMap<string, string> = NO_MODULE_PACKAGES,
  surfaces: ModulePackageSurfaces = EVERY_SUBPATH_IS_A_REACH,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
  admin: AdminBoundarySurfaces | null = NO_ADMIN_SURFACES,
  tally?: SiteTally,
): CrossModuleImport[] {
  if (GENERATED_MODULE_FILES[file] !== undefined) return [];
  if (isAdminRegistryFile(file, admin)) return [];
  const owner = ownerLocationOf(file, hostResident, admin);
  if (owner === null) return [];

  const found: CrossModuleImport[] = [];
  for (const specifier of namedSpecifiers(source, file)) {
    if (tally !== undefined) tally.count += 1;
    const packaged = resolveModulePackage(specifier.text, modulePackages);
    if (packaged !== null) {
      // The importer's own package, named by its own npm name — the self-import
      // the directory comparison answers for the application tree. Compared by
      // id because a bare specifier carries no directory to compare.
      if (packaged.id === owner.id) continue;
      // D-171: a subpath whose emitted module exports no runtime binding is
      // contract surface, and reaching contract surface is not cross-module
      // debt. Derived from the artefact on every run, so a `const` added to a
      // type-only subpath makes the reach count again in the same run T050's
      // guard goes red. A subpath whose emitted module cannot be read throws,
      // and the CLI turns that into exit 2 — an unreadable file must never be
      // an exemption (issue #113).
      if (surfaces.surfaceOfSubpath(packaged.name, packaged.subpath).kind === 'contract') continue;
      found.push({
        predicate: 'import',
        file,
        line: specifier.line,
        moduleId: owner.id,
        target: packaged.id,
        specifier: specifier.text,
        targetPath: packaged.subpath,
        kind: specifier.kind,
        surface: surfaceOf(packaged.subpath),
        // A package is a workspace member, never a file under `src/apps/`, so
        // only the importing side can make this edge an overlay one.
        overlay: owner.dir.startsWith('apps/'),
      });
      continue;
    }
    const resolved = resolveSpecifier(file, specifier.text, admin);
    if (resolved === null) continue;
    const target = moduleLocationOf(resolved, hostResident, admin);
    if (target === null) continue;
    if (target.dir === owner.dir) continue;
    // In the backend the **directory** is the identity, so an overlay `catalog`
    // reaching the core `catalog` is the cross-tree edge it is. In the admin it
    // is not: one module may own two surface directories under two names —
    // `inventory` owned `inventory/` and `warehouses/` until feature 091's
    // Phase 4 batch 13 moved both into its package — so a reach between them
    // is a module reaching its own code and comparing directories would report
    // `inventory -> inventory` as a cross-module violation. The tree holds no
    // such pair today; the rule stays because the next one costs no edit.
    if (isAdminPath(file, admin) && isAdminPath(resolved, admin) && target.id === owner.id) {
      continue;
    }
    const targetPath = resolved === target.dir ? '' : resolved.slice(target.dir.length + 1);
    found.push({
      predicate: 'import',
      file,
      line: specifier.line,
      moduleId: owner.id,
      target: target.id,
      specifier: specifier.text,
      targetPath,
      kind: specifier.kind,
      surface: surfaceOf(targetPath),
      overlay: owner.dir.startsWith('apps/') || target.dir.startsWith('apps/'),
    });
  }
  return found;
}

/**
 * Every cross-module import in the input, in file then line order, with the
 * number of specifiers the walk examined to find them.
 *
 * `sites` is the import half of the `read:` line's finer population. It counts
 * what was **cleared** as well as what was reported, which is the distinction
 * issue #244 is about — a number that moves with the findings cannot answer
 * "did you read the tree".
 */
export function findCrossModuleImports(input: ModuleBoundaryInput): {
  readonly found: CrossModuleImport[];
  readonly sites: number;
} {
  const packages = input.modulePackages ?? NO_MODULE_PACKAGES;
  const surfaces = input.modulePackageSurfaces ?? EVERY_SUBPATH_IS_A_REACH;
  const hostResident = input.hostResidentModules ?? NO_HOST_RESIDENT_MODULES;
  const admin = input.adminSurfaces ?? NO_ADMIN_SURFACES;
  const tally: SiteTally = { count: 0 };
  const found = [...input.sources].flatMap(([file, text]) =>
    analyzeSource(text, file, packages, surfaces, hostResident, admin, tally),
  );
  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return { found, sites: tally.count };
}

// ---------------------------------------------------------------------------
// The `sql` predicate (D-87)
// ---------------------------------------------------------------------------

/** Who owns a table: a module id and the directory that decides its identity. */
interface TableOwner {
  readonly id: string;
  readonly dir: string;
}

/**
 * What the two passes resolved, so a green cannot mean "the map was empty".
 *
 * Both counts are in the vacuous-pass guard, separately: an entity pass that
 * resolves nothing is a walk that read no `src/`, and a migration pass that
 * resolves nothing is exactly the entity-only blindness the second source was
 * added to remove — and it would report a *smaller* number rather than an error.
 */
export interface TableOwnerReport {
  readonly entityTables: number;
  readonly migrationTables: number;
  /**
   * Tables an installed extension package owns (feature 080, T034).
   *
   * A third pass, printed like the other two. It is **not** in the vacuous-pass
   * guard, and the asymmetry is deliberate: zero is the honest answer for every
   * checkout and every CI run of this repository, whereas a package that was
   * installed and could not be read has already stopped the run at exit 2.
   */
  readonly packageTables: number;
  /**
   * Tables the migration pass resolved that **no** entity declares — the 21 the
   * second source exists for. Printed, because an entity pass that started
   * swallowing them would leave this at zero while every other number held.
   */
  readonly migrationOnlyTables: number;
  /** Tables no module or kernel owns after attribution — never a finding. */
  readonly unattributed: readonly string[];
}

/**
 * The owner id the kernel's own tables carry.
 *
 * Spelled once because two rules turn on it: this check's `sql` predicate
 * reports a kernel reach as an ordinary finding, and feature 097's migration
 * rules exclude one from both (contract §3). `fk-dependency-drift.test.ts` has
 * its own `KERNEL_OWNER` for the same reason on the DDL side.
 */
const KERNEL_OWNER = 'kernel';

/** The declaring file's owner: a module, the kernel, or a core directory. */
function declaringOwnerOf(
  file: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): TableOwner | null {
  const module = moduleLocationOf(file, hostResident);
  if (module !== null) return module;
  const head = file.split('/')[0] ?? '';
  if (head === KERNEL_OWNER) return { id: KERNEL_OWNER, dir: KERNEL_OWNER };
  if (head === '') return null;
  // `core:*` marks "declared outside any module" — the pre-065 DDL block lives
  // in `src/db/migrations`, and attribution below decides whose table it is.
  return { id: `core:${head}`, dir: `core:${head}` };
}

/** A `core:*` owner is a placeholder for "nobody's yet" — see the header. */
function isCoreOwner(owner: TableOwner): boolean {
  return owner.id.startsWith('core:');
}

/**
 * The table→owner map, from entity declarations and migration DDL.
 *
 * Two passes over the same sources, entity first because it wins: an entity is a
 * live declaration and a migration is a historical one. Then the join-table
 * attribution the header describes — a core-owned table belongs to the module
 * that owns the table its name begins with, longest prefix first, so
 * `sales_channel_products` resolves through `sales_channels` and not through
 * some shorter accident.
 */
export function buildTableOwners(
  schema: ReadonlyMap<string, string>,
  packageTables: readonly PackageTable[] = [],
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): {
  readonly owners: ReadonlyMap<string, TableOwner>;
  readonly report: TableOwnerReport;
} {
  const owners = new Map<string, TableOwner>();
  const fromEntity = new Set<string>();
  const fromMigration = new Set<string>();

  for (const [file, text] of schema) {
    const owner = declaringOwnerOf(file, hostResident);
    if (owner === null) continue;
    for (const declaration of declaredTableNames(text, file, entityTableName)) {
      const seen = declaration.source === 'entity' ? fromEntity : fromMigration;
      seen.add(declaration.table);
      if (declaration.source === 'entity') owners.set(declaration.table, owner);
      else if (!fromEntity.has(declaration.table)) owners.set(declaration.table, owner);
    }
  }

  // The third source. A package's owner directory is `package:<npm name>`, so
  // it can never equal a module directory and a core module reaching a
  // package's table is the cross-boundary reach it is — the same identity rule
  // that makes an overlay `catalog` reaching the core `catalog` a real edge.
  //
  // The tree wins a collision, for the reason the entity pass wins one over the
  // migration pass: it is the declaration this repository can change, and a
  // stranger must not be able to take a core table's attribution away from the
  // module that owns it.
  const fromPackage = new Set<string>();
  for (const declared of packageTables) {
    if (owners.has(declared.table)) continue;
    fromPackage.add(declared.table);
    owners.set(declared.table, {
      id: declared.moduleId,
      dir: `package:${declared.packageName}`,
    });
  }

  const unattributed: string[] = [];
  for (const [table, owner] of [...owners]) {
    if (!isCoreOwner(owner)) continue;
    const attributed = attributeCoreTable(table, owners);
    if (attributed === null) unattributed.push(table);
    else owners.set(table, attributed);
  }

  return {
    owners,
    report: {
      entityTables: fromEntity.size,
      migrationTables: fromMigration.size,
      packageTables: fromPackage.size,
      migrationOnlyTables: [...fromMigration].filter((table) => !fromEntity.has(table)).length,
      unattributed: unattributed.sort(),
    },
  };
}

/**
 * The module that owns the table a core-owned table's name begins with.
 *
 * `product_categories` → `products` → `catalog`; `sales_channel_products` →
 * `sales_channels` → the kernel. Longest prefix first, and the prefix is tried
 * both as written and pluralised, because a join table names the owning side in
 * the singular.
 */
function attributeCoreTable(
  table: string,
  owners: ReadonlyMap<string, TableOwner>,
): TableOwner | null {
  const segments = table.split('_');
  for (let take = segments.length - 1; take >= 1; take -= 1) {
    const head = segments.slice(0, take).join('_');
    for (const candidate of [pluralize(head), head]) {
      const owner = owners.get(candidate);
      if (owner !== undefined && !isCoreOwner(owner)) return owner;
    }
  }
  return null;
}

/**
 * Every table another module owns that `source` names in raw SQL.
 *
 * Same entry point as {@link analyzeSource}: source text and a path in, findings
 * out. The owner map is a parameter rather than a module-level cache so that
 * {@link findCrossModuleSql} can build it from source text too — a fixture that
 * handed in a ready-made map would leave both owner-map passes unproven, which
 * is the failure mode issue #130 is about.
 */
export function analyzeSqlSource(
  source: string,
  file: string,
  owners: ReadonlyMap<string, TableOwner>,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
  admin: AdminBoundarySurfaces | null = NO_ADMIN_SURFACES,
  tally?: SiteTally,
): CrossModuleSqlAccess[] {
  if (GENERATED_MODULE_FILES[file] !== undefined) return [];
  // A migration is judged by {@link analyzeMigrationSql}, under R1 and R2, with
  // its own two ledgers — not by this predicate's "every reach is debt" rule
  // (feature 097). The exclusion is **narrowed**, not deleted: what is excluded
  // here is the host rule, not the population.
  if (isMigration(file)) return [];
  const owner = moduleLocationOf(file, hostResident, admin);
  if (owner === null) return [];

  const found: CrossModuleSqlAccess[] = [];
  for (const access of sqlTableAccesses(source, file)) {
    if (tally !== undefined) tally.count += 1;
    const target = owners.get(access.table);
    if (target === undefined || isCoreOwner(target)) continue;
    if (target.dir === owner.dir) continue;
    found.push({
      predicate: 'sql',
      file,
      line: access.line,
      moduleId: owner.id,
      target: target.id,
      table: access.table,
      direction: access.direction,
      syntax: access.syntax,
      statement: access.statement,
      overlay: owner.dir.startsWith('apps/') || target.dir.startsWith('apps/'),
    });
  }
  return found;
}

/** Every cross-module SQL access in the input, in file then line order. */
export function findCrossModuleSql(input: ModuleBoundaryInput): {
  readonly found: CrossModuleSqlAccess[];
  readonly report: TableOwnerReport;
  /** Table references examined outside `migrations/` — the `read:` line's half. */
  readonly sites: number;
  /** The map both SQL analyses resolve against, so the caller builds it once. */
  readonly owners: ReadonlyMap<string, TableOwner>;
} {
  if (input.schema === undefined) {
    return {
      found: [],
      sites: 0,
      owners: new Map(),
      report: {
        entityTables: 0,
        migrationTables: 0,
        packageTables: 0,
        migrationOnlyTables: 0,
        unattributed: [],
      },
    };
  }
  const hostResident = input.hostResidentModules ?? NO_HOST_RESIDENT_MODULES;
  const { owners, report } = buildTableOwners(
    input.schema,
    input.packageTables ?? [],
    hostResident,
  );
  const tally: SiteTally = { count: 0 };
  const found = [...input.sources].flatMap(([file, text]) =>
    analyzeSqlSource(
      text,
      file,
      owners,
      hostResident,
      input.adminSurfaces ?? NO_ADMIN_SURFACES,
      tally,
    ),
  );
  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return { found, report, sites: tally.count, owners };
}

// ---------------------------------------------------------------------------
// A migration's cross-module SQL (feature 097)
// ---------------------------------------------------------------------------

/**
 * Whether this path is a migration, in the one spelling the whole check uses.
 *
 * A module's migrations live in its own `migrations/` directory — the
 * scaffolder's answer for the application tree and for a package alike
 * (AGENTS.md § *Migrations* item 1) — and the core block at `db/migrations/` is
 * outside every module walk root, so it never reaches this predicate at all.
 */
function isMigration(file: string): boolean {
  return file.includes('/migrations/');
}

/**
 * Every finding R1 and R2 produce over one migration source.
 *
 * The entry point is the same as {@link analyzeSqlSource}'s — source text, a
 * path, and the two maps — so a red proof enters where a real run enters and the
 * owner map's passes and the closure traversal both run rather than being handed
 * their answers (issue #130).
 *
 * **The kernel is out of both rules, by derivation** (contract §3). Not because
 * kernel tables are unimportant: both rules are about a **manifest edge**, and
 * the kernel is not a module — it is composed unconditionally, cannot be
 * switched off, cannot be uninstalled and cannot appear in a `dependencies`
 * array, so R1 over a kernel table would demand a declaration
 * `defineModuleManifest` has no vocabulary for. The answer comes off the owner
 * map, never off a table-name list: 17 of the 76 accesses standing when this
 * landed are kernel-targeting, and a written list would go stale the first time
 * the platform relocates a table — the failure
 * `check:platform-surface`'s row records, which was fail-**open**.
 *
 * R2's silence over kernel *writes* is deferred rather than ruled
 * (`research.md` §8): every kernel write in the tree is a `sales_channel_*`
 * bridge insert inside a seed CTE that R2 already reports at its module end, so
 * widening changes no count today.
 */
export function analyzeMigrationSql(
  source: string,
  file: string,
  owners: ReadonlyMap<string, TableOwner>,
  closures: DependencyClosures,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
  tally?: SiteTally,
): MigrationSqlFinding[] {
  if (!isMigration(file)) return [];
  const owner = moduleLocationOf(file, hostResident);
  if (owner === null) return [];

  const declared = closures.get(owner.id) ?? new Set<string>();
  const found: MigrationSqlFinding[] = [];
  for (const access of sqlTableAccesses(source, file)) {
    if (tally !== undefined) tally.count += 1;
    const target = owners.get(access.table);
    if (target === undefined || isCoreOwner(target)) continue;
    if (target.dir === owner.dir) continue;
    if (target.id === KERNEL_OWNER) continue;
    const common = {
      file,
      line: access.line,
      moduleId: owner.id,
      target: target.id,
      table: access.table,
      direction: access.direction,
      syntax: access.syntax,
      statement: access.statement,
    } as const;
    // Both, where both hold. A statement may produce two findings — the two
    // `transactional_emails` `UPDATE`s that produced this feature do — because
    // the remedies differ: R1 is answered by a manifest line or by moving the
    // statement, R2 only by moving it.
    if (!declared.has(target.id)) {
      found.push({ rule: 'undeclared-migration-table-reference', ...common });
    }
    if (access.direction === 'write') {
      found.push({ rule: 'migration-writes-a-foreign-table', ...common });
    }
  }
  return found;
}

/**
 * Every migration finding in the input, in file then line order.
 *
 * `input.dependencyClosures` absent means "do not run the migration rules" —
 * the idiom {@link ModuleBoundaryInput.schema} already uses, and what keeps
 * every import-predicate fixture in the tree meaning what it meant. It never
 * means "nothing is declared": the CLI's own refusal
 * ({@link vacuousReason}'s `declaresNoDependency`) is what answers that.
 */
export function findMigrationSql(
  input: ModuleBoundaryInput,
  /**
   * The owner map, where the caller has already built it.
   *
   * The CLI has: {@link checkModuleBoundary} runs both SQL analyses over one
   * tree and `buildTableOwners` parses 1836 schema sources, so building it twice
   * would double the check's most expensive walk to answer the same question.
   * **No red proof passes it** — every fixture hands in source text and lets
   * both owner-map passes run, which is what issue #130 asks for; this argument
   * exists so a caller that has already paid can say so.
   */
  prebuiltOwners?: ReadonlyMap<string, TableOwner>,
): {
  readonly found: MigrationSqlFinding[];
  /** Table references examined **inside** `migrations/`. */
  readonly sites: number;
  /** How many migration files the walk opened — contract §6.1's input. */
  readonly files: number;
  /** Every migration class the walk found declared — contract §5's coverage. */
  readonly declaredClasses: ReadonlySet<string>;
} {
  const migrations = [...input.sources].filter(([file]) => isMigration(file));
  const declaredClasses = new Set<string>();
  for (const [file, text] of migrations) {
    for (const name of declaredMigrationClasses(text, file)) declaredClasses.add(name);
  }
  if (input.schema === undefined || input.dependencyClosures === undefined) {
    return { found: [], sites: 0, files: migrations.length, declaredClasses };
  }
  const hostResident = input.hostResidentModules ?? NO_HOST_RESIDENT_MODULES;
  const owners =
    prebuiltOwners ??
    buildTableOwners(input.schema, input.packageTables ?? [], hostResident).owners;
  const tally: SiteTally = { count: 0 };
  const found = migrations.flatMap(([file, text]) =>
    analyzeMigrationSql(text, file, owners, input.dependencyClosures!, hostResident, tally),
  );
  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return { found, sites: tally.count, files: migrations.length, declaredClasses };
}

/** The file half of a ledger key, or `null` when the key does not parse. */
function fileOfKey(key: string): string | null {
  const at = key.indexOf(':');
  if (at <= 0 || at === key.length - 1) return null;
  return key.slice(0, at);
}

/**
 * One ledger's verdict, over the findings it accounts for.
 *
 * Extracted rather than copied when feature 097 added two more ledgers: the
 * eight failure modes are one rule about how a ledger may lie, and three
 * implementations of them are three answers waiting to disagree — the reasoning
 * AGENTS.md gives for the permission inventory carrying its own ratchet.
 */
export interface LedgerVerdict<T> {
  /** Findings no shard accounts for. */
  readonly violations: readonly T[];
  readonly ledgered: readonly T[];
  /** Keys that describe no finding in this run. */
  readonly stale: readonly string[];
  /** Shards with no entries — the file is to be deleted, not emptied. */
  readonly emptyShards: readonly string[];
  /** Shards named for a module that does not exist. */
  readonly orphanShards: readonly string[];
  /** `<shard>: <key>` for a key whose file is not this shard's module. */
  readonly misfiledEntries: readonly string[];
  /** Keys the repository has decided to keep — excluded from `ledger-size`. */
  readonly permanentKeys: readonly string[];
  /** A permanent entry that states no reason or no retiring condition. */
  readonly permanentIssues: readonly string[];
  /** An entry whose recorded site count is not what the walk found (issue #267). */
  readonly countIssues: readonly string[];
  /** A shard whose file declares an entry type of its own (issue #217). */
  readonly shardShapeIssues: readonly string[];
}

/**
 * The two-way comparison, over all eight failure modes, for one ledger.
 *
 * `shardOfKey` and `shardOfFinding` are the filing rule: a shard accounts for
 * its own module and nothing else, or one module's shard could absorb another
 * module's violation. `knownModules` is derived from the sources rather than
 * from a second walk, so "this module exists" means exactly "this module has
 * sources in the input the check read" — an orphan shard cannot be created by
 * two walks disagreeing.
 */
function compareLedger<T>(
  findings: readonly T[],
  shards: readonly LedgerShard[],
  keyFor: (finding: T) => string,
  shardOfKey: (key: string) => string | null,
  knownModules: ReadonlySet<string>,
): LedgerVerdict<T> {
  const present = new Set(findings.map(keyFor));
  // How many reaches each key actually covers, so an entry can be compared with
  // a number rather than with a boolean (issue #267).
  const found = new Map<string, number>();
  for (const finding of findings) {
    const key = keyFor(finding);
    found.set(key, (found.get(key) ?? 0) + 1);
  }

  const ledger = new Map<string, LedgerEntry>();
  const misfiledEntries: string[] = [];
  const emptyShards: string[] = [];
  const orphanShards: string[] = [];
  const permanentKeys: string[] = [];
  const permanentIssues: string[] = [];
  const countIssues: string[] = [];
  const shardShapeIssues: string[] = [];

  for (const shard of shards) {
    const keys = Object.keys(shard.entries);
    if (keys.length === 0) emptyShards.push(shard.moduleId);
    if (!knownModules.has(shard.moduleId)) orphanShards.push(shard.moduleId);
    const shapeIssue = shardShapeIssue(shard.moduleId, shard.source);
    if (shapeIssue !== null) shardShapeIssues.push(shapeIssue);
    for (const key of keys) {
      const owner = shardOfKey(key);
      if (owner === null || owner !== shard.moduleId) {
        misfiledEntries.push(`${shard.moduleId}: ${key}`);
        continue;
      }
      const entry = shard.entries[key] ?? '';
      ledger.set(key, entry);
      if (isPermanent(entry)) {
        permanentKeys.push(key);
        const issue = permanentEntryIssue(key, entry);
        if (issue !== null) permanentIssues.push(issue);
      } else if (typeof entry !== 'string' && !isCounted(entry)) {
        permanentIssues.push(
          `${key} is neither a reason nor a permanent entry — a shard value is a string, ` +
            '`{ sites, reason }` or `{ permanent: true, reason, retiredBy }`',
        );
        continue;
      }
      // The count is checked on every form, permanent included: the question a
      // second reach raises is the same one either way (issue #267).
      const countIssue = countIssueFor(key, entry, found.get(key) ?? 0);
      if (countIssue !== null) countIssues.push(countIssue);
    }
  }

  return {
    violations: findings.filter((entry) => !ledger.has(keyFor(entry))),
    ledgered: findings.filter((entry) => ledger.has(keyFor(entry))),
    // A permanent entry goes stale exactly like a draining one: it describes a
    // reach, and a reach that is gone is an entry that lies.
    stale: [...ledger.keys()].filter((key) => !present.has(key)).sort(),
    emptyShards: emptyShards.sort(),
    orphanShards: orphanShards.sort(),
    misfiledEntries: misfiledEntries.sort(),
    permanentKeys: permanentKeys.sort(),
    permanentIssues: permanentIssues.sort(),
    countIssues: countIssues.sort(),
    shardShapeIssues: shardShapeIssues.sort(),
  };
}

/**
 * The migration rules' two ledgers (feature 097, contract §4).
 *
 * Two directories rather than entries in `cross-module-imports`, because they
 * hold different rules — there every reach is debt, here a *declared* reach is
 * fine — and because the two migration rules have different remedies from each
 * other. Omitted is a fixture with no migration ledger.
 */
export interface MigrationLedgers {
  /** R1 — `scripts/ledgers/migration-undeclared-references/<module>.ts`. */
  readonly undeclaredReferences: readonly LedgerShard[];
  /** R2 — `scripts/ledgers/migration-foreign-writes/<module>.ts`. */
  readonly foreignWrites: readonly LedgerShard[];
}

const NO_MIGRATION_LEDGERS: MigrationLedgers = {
  undeclaredReferences: [],
  foreignWrites: [],
};

/**
 * The two-way comparison, in both directions and over all eight failure modes,
 * for each of the three ledgers this check now carries.
 */
export function checkModuleBoundary(
  input: ModuleBoundaryInput,
  shards: readonly LedgerShard[],
  migrationLedgers: MigrationLedgers = NO_MIGRATION_LEDGERS,
): CheckResult {
  const sql = findCrossModuleSql(input);
  const imports = findCrossModuleImports(input);
  const migration = findMigrationSql(input, sql.owners);
  const all: ModuleBoundaryFinding[] = [...imports.found, ...sql.found];
  all.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const hostResident = input.hostResidentModules ?? NO_HOST_RESIDENT_MODULES;
  const admin = input.adminSurfaces ?? NO_ADMIN_SURFACES;
  // The owner set an orphan shard is judged against, and a shard's filing
  // rule. `ownerLocationOf` rather than `moduleLocationOf`, so `host` is a
  // legitimate shard name exactly while the walk produced an admin host file
  // (feature 091, P1) — never because the name is written down here.
  const modules = new Set<string>();
  for (const file of input.sources.keys()) {
    const owner = ownerLocationOf(file, hostResident, admin);
    if (owner !== null) modules.add(owner.id);
  }
  const shardOfKey = (key: string): string | null => {
    const file = fileOfKey(key);
    return file === null ? null : (ownerLocationOf(file, hostResident, admin)?.id ?? null);
  };

  const hostVerdict = compareLedger(all, shards, keyOf, shardOfKey, modules);
  const byRule = (rule: MigrationSqlRule): readonly MigrationSqlFinding[] =>
    migration.found.filter((finding) => finding.rule === rule);

  return {
    total: all.length,
    ...hostVerdict,
    tableOwners: sql.report,
    examinedSpecifiers: imports.sites,
    examinedTableReferences: sql.sites + migration.sites,
    migrationFiles: migration.files,
    migrationClasses: migration.declaredClasses,
    migrationFindings: migration.found,
    // Kept apart, deliberately (contract §2.1): merged, R2 would go blind
    // behind R1's red for every module that happens to declare its target.
    undeclaredReferences: compareLedger(
      byRule('undeclared-migration-table-reference'),
      migrationLedgers.undeclaredReferences,
      migrationKeyOf,
      shardOfKey,
      modules,
    ),
    foreignWrites: compareLedger(
      byRule('migration-writes-a-foreign-table'),
      migrationLedgers.foreignWrites,
      migrationKeyOf,
      shardOfKey,
      modules,
    ),
  };
}

/**
 * Why this run must not report a pass, or `null` when it read something.
 *
 * Exit **2**, never 0 and never 1: a green result must not be able to mean "not
 * looking" (issue #113, FR-021).
 */
export function vacuousReason(input: {
  /** Every file the module walk produced, relative to `src/`. */
  readonly moduleFiles: readonly string[];
  /** Module ids the generated manifest index registers (issue #215). */
  readonly registeredModules: readonly string[];
  /** How a walked path is attributed, where the layout knows better (T040a). */
  readonly moduleIdOf?: (path: string) => string | null;
  readonly ledgerDirectoryExists: boolean;
  /** Tables the `@Entity()` pass resolved. */
  readonly entityTables: number;
  /** Tables the `create table` pass resolved — see {@link TableOwnerReport}. */
  readonly migrationTables: number;
  /**
   * Where the admin's module surfaces are, or `null` when this workspace has
   * none (feature 091, FR-017).
   */
  readonly adminSurfaces?: AdminBoundarySurfaces | null;
  /**
   * Every ledger key in the shards, so the admin population has an anchor of
   * its own.
   *
   * A ledger key naming a file under the admin module root is this
   * repository's own statement that it *has* admin surfaces. Losing the
   * derivation — the alias renamed, the tsconfig gone, the module root moved —
   * would otherwise take the whole admin population out of the walk while
   * every other number held, which is the #215 shape the coverage floor cannot
   * see because it is derived from the very thing that went missing. Omitted
   * is a caller with no shards, which is every fixture of this analysis.
   */
  readonly ledgerKeys?: readonly string[];
  /**
   * Whether a repository-relative path is still on disk — see
   * {@link adminPopulationLost}. The default answers `true`, which is what a
   * fixture handing in keys and no filesystem means.
   */
  readonly fileExists?: (repoRelativePath: string) => boolean;
  /**
   * The keys of the files the **module** walk produced, so a `.tsx` that has
   * already moved into a module package is not mistaken for admin code — see
   * {@link adminPopulationLost}. Omitted is a fixture with no module walk.
   */
  readonly moduleFileKeys?: ReadonlySet<string>;
  /**
   * Every file the admin **host** walk produced, or `undefined` for a caller
   * that performs no host walk (feature 091, P1).
   *
   * The two spellings mean different things and the distinction is the point.
   * `undefined` is a fixture handing in three source files and no filesystem —
   * the behaviour that shipped. An empty **array** is a real run saying "I
   * walked `admin/src` outside the module root and opened nothing", which is
   * impossible for a tree that has an admin at all: the layout only resolves
   * because it read `App.tsx` and `AppShell.tsx`, both of which sit there. So
   * an empty array can only mean the walk stopped working, and that is exit 2
   * rather than a run reporting `violations=0` over a population it never
   * opened (issue #113).
   */
  readonly adminHostFiles?: readonly string[];
  /**
   * How many migration files the walk opened (feature 097, contract §6.1).
   *
   * **The refusal that matters most in this check**, and the one a careless
   * implementation omits: the module-population floor above is satisfied by any
   * file a registered module contributes, and a module's backend sources are
   * plentiful — so a `migrations/` walk that stopped resolving leaves every
   * other number intact and leaves R1 and R2 judging nothing, which is
   * `violations=0` over an unjudged population. That is
   * `check:subscribe-seam`'s worker-half reasoning at a second population.
   *
   * Omitted is a caller that runs no migration analysis — every fixture of the
   * import predicate, which hands in three sources and no schema.
   */
  readonly migrationFiles?: number;
  /**
   * Migration classes the generated registry registers that the walk did not
   * find (contract §6.2) — §5's reconciliation, as a refusal.
   */
  readonly migrationRegistryMissing?: readonly string[];
  /**
   * Whether **no** manifest declared a dependency at all (contract §6.3).
   *
   * An empty closure makes R1 fire on every cross-module access there is, so the
   * failure is loud rather than silent — but it is still a broken read, and
   * reporting 59 findings that are all artefacts of it is worse than stopping.
   */
  readonly declaresNoDependency?: boolean;
  /**
   * Whether both migration ledger directories are on disk (contract §6.5).
   *
   * Distinct from an empty one: an empty directory after the R2 sweep drains is
   * legal and green, while a missing directory is a read that failed, and
   * treating the two alike is how a two-way ratchet becomes a one-way one.
   */
  readonly migrationLedgerDirectoriesExist?: boolean;
  /**
   * Import specifiers the walk examined (issue #244), where the caller counts
   * them.
   *
   * The `sites=` number is a **sum** over two populations, so each addend needs
   * a floor of its own or the sum hides the one that went to zero — the
   * objection `READ_SIZE_WITHOUT_A_SITE_POPULATION` recorded against printing
   * one number here at all.
   */
  readonly importSites?: number;
  /** Table references the walk examined, on the same terms. */
  readonly tableSites?: number;
}): string | null {
  if (input.moduleFiles.length === 0) {
    return 'no module sources under src/ — refusing to report a vacuous pass';
  }
  // Emptiness is the weaker half of the same question (issue #215). `src/apps`
  // is the walk's second root, so a moved module tree leaves five overlay files
  // behind: the walk is non-empty, every shard reads as an orphan, and the day
  // the ledger finishes draining that red goes away and this reports
  // `violations=0` over a tree it never opened. The floor is one source per
  // registered module, and the index it comes from is a path that must resolve.
  const population = vacuousModulePopulation({
    registered: input.registeredModules,
    files: input.moduleFiles,
    ...(input.moduleIdOf === undefined ? {} : { moduleIdOf: input.moduleIdOf }),
  });
  if (population !== null) return population;
  if (!input.ledgerDirectoryExists) {
    return 'ledger directory missing — refusing to report a vacuous pass';
  }
  // Each pass of the owner map proves it looked, separately. A half-blind map
  // does not fail — it reports *fewer* SQL findings — so a green `violations=0
  // ledger-size=0` must be unable to mean "the map was empty" (issue #113).
  if (input.entityTables === 0) {
    return 'the table→owner map resolved no @Entity() table — refusing to report a vacuous pass';
  }
  if (input.migrationTables === 0) {
    return (
      'the table→owner map resolved no `create table` DDL — an entity-only map is blind to ' +
      'every join table and every channel bridge; refusing to report a vacuous pass'
    );
  }
  const adminAnchor = adminPopulationLost(
    input.adminSurfaces ?? null,
    input.ledgerKeys ?? [],
    input.fileExists ?? (() => true),
    input.moduleFileKeys ?? new Set<string>(),
  );
  if (adminAnchor !== null) return adminAnchor;
  if (
    (input.adminSurfaces ?? null) !== null &&
    input.adminHostFiles !== undefined &&
    input.adminHostFiles.length === 0
  ) {
    return (
      'the admin layout resolved and the host walk outside its module root opened no file — ' +
      'the route table and the nav the layout was read from both live there, so an empty ' +
      'host walk is a walk that stopped working; refusing to report a vacuous pass'
    );
  }
  // Feature 097, contract §6. Each is an input whose absence makes one of the
  // two migration rules **vacuously clean** — never "the tree is in violation".
  if (input.migrationFiles !== undefined && input.migrationFiles === 0) {
    return (
      'the walk opened no migration file — the module floor above is satisfied by any file a ' +
      "registered module contributes, and a module's backend sources are plentiful, so a " +
      'migrations/ walk that stopped resolving leaves R1 and R2 judging nothing; refusing to ' +
      'report a vacuous pass'
    );
  }
  if (input.migrationRegistryMissing !== undefined && input.migrationRegistryMissing.length > 0) {
    const named = input.migrationRegistryMissing.slice(0, 8).join(', ');
    const rest = input.migrationRegistryMissing.length - 8;
    return (
      `${input.migrationRegistryMissing.length} migrations the generated registry registers ` +
      `were not found by the walk (${named}${rest > 0 ? `, and ${rest} more` : ''}) — the ` +
      'registry enumerates them by import and this walk finds them by path, so the two ' +
      'disagreeing is a walk that came back short; refusing to report a vacuous pass'
    );
  }
  if (input.declaresNoDependency === true) {
    return (
      'no manifest declared a dependency — an empty closure makes R1 fire on every ' +
      'cross-module access in the tree, and reporting findings that are all artefacts of a ' +
      'failed read is worse than stopping; refusing to report a vacuous pass'
    );
  }
  if (input.migrationLedgerDirectoriesExist === false) {
    return (
      'a migration ledger directory is missing — an empty one after the sweep drains is legal, ' +
      'an absent one is a read that failed, and treating the two alike turns a two-way ratchet ' +
      'into a one-way one; refusing to report a vacuous pass'
    );
  }
  // The `sites=` sum's two addends, each with its own floor: a sum cannot hide
  // an addend that went to zero if zero is refused before the sum is printed.
  if (input.importSites !== undefined && input.importSites === 0) {
    return 'the walk examined no import specifier — refusing to report a vacuous pass';
  }
  if (input.tableSites !== undefined && input.tableSites === 0) {
    return 'the walk examined no table reference — refusing to report a vacuous pass';
  }
  return null;
}

/**
 * Why an admin population the ledger says exists is not in this walk, or
 * `null`.
 *
 * The ledger is the independent author here. Its keys are `<file>:<target>`
 * pairs, so a key whose file sits under an admin module root is a statement
 * that this repository has admin surfaces — written by the merge request that
 * ledgered the reach, not by the derivation being checked. When the derivation
 * answers `null` while such keys stand, the honest verdict is "the walk did not
 * read what it is meant to read", which is exit 2, not the 94 stale entries the
 * comparison would otherwise report.
 *
 * The anchor is exhausted when the ledger is: at the end of the drain there is
 * no admin module code left for a walk to lose, because every module's screens
 * are in its package and are covered by the package roots.
 */
export function adminPopulationLost(
  admin: AdminBoundarySurfaces | null,
  ledgerKeys: readonly string[],
  exists: (repoRelativePath: string) => boolean = () => true,
  moduleFileKeys: ReadonlySet<string> = new Set<string>(),
): string | null {
  if (admin !== null) return null;
  // With the layout gone there is no module root to match a key against, so
  // the discriminator is the **extension**: every walk this check performs over
  // the backend collects `.ts` and every module source in the tree is one, so a
  // ledger key naming a `.tsx` file can only have come from a frontend
  // population. Its one blind spot is stated rather than discovered: an admin
  // ledger holding only `.ts` keys would not anchor, which is why the coverage
  // floor above is the instrument for a walk that came back *short* and this
  // one is for a walk that came back with no admin at all.
  //
  // **The extension alone stopped being exact when the drain started** (feature
  // 091, Phase 4). It rested on a measurement — "zero `.tsx` files under
  // `backend/src` and zero under any module package" — that Story 3 falsifies
  // one directory at a time, and the direction it fails in is the wrong one: a
  // packaged screen would anchor the admin population it is no longer part of,
  // so a genuinely lost derivation would be reported as fine. The module walk's
  // own keys are the discriminator, and they are exact for the same reason the
  // extension was: a key the module walk produced is module code by
  // construction, whatever it is called.
  //
  // And the file has to still **be there**. The anchor's question is "the
  // derivation broke while the tree it derives from stayed", not "these entries
  // are stale" — a checkout with no `admin/` at all has genuinely stale entries
  // and the two-way ledger says so in its own words. Without this half the
  // refusal fires on every synthetic backend that copies the real ledger
  // shards, which is `test/helpers/moved-module-tree-fixture.ts` and which is
  // exit 2 for a reason that has nothing to do with the module tree.
  const adminKeys = ledgerKeys.filter((key) => {
    if (!/\.tsx:/.test(key)) return false;
    const file = key.slice(0, key.indexOf(':'));
    return !moduleFileKeys.has(file) && exists(file);
  });
  if (adminKeys.length === 0) return null;
  return (
    `${adminKeys.length} ledger entries name a .ts/.tsx file under a module surface directory ` +
    '(for example ' +
    `${adminKeys[0]!.split(':')[0]!}), and no workspace member declares the admin source ` +
    'alias any more — so the admin population is not in this walk and every one of those ' +
    'entries would be reported as stale. Refusing to report a vacuous pass'
  );
}

/** Where the shards live. Exported so the check and its test read one directory. */
export function ledgerDirectory(): string {
  return LEDGER_ROOT;
}

/**
 * Every shard in `directory`, loaded.
 *
 * Rejects rather than returning an empty list when the directory is missing or a
 * shard fails to import: both are "read nothing", and the CLI turns the
 * rejection into exit 2.
 */
export async function loadLedgerShards(directory: string): Promise<LedgerShard[]> {
  if (!existsSync(directory)) {
    throw new Error('ledger directory missing — refusing to report a vacuous pass');
  }
  const shards: LedgerShard[] = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.ts')) continue;
    const moduleId = name.replace(/\.ts$/, '');
    let loaded: unknown;
    try {
      loaded = (await import(pathToFileURL(join(directory, name)).href)) as unknown;
    } catch (error) {
      throw new Error(`ledger shard '${moduleId}' failed to load: ${String(error)}`);
    }
    const entries = (loaded as { entries?: unknown }).entries;
    if (typeof entries !== 'object' || entries === null) {
      throw new Error(`ledger shard '${moduleId}' failed to load: it exports no 'entries' record`);
    }
    // The imported value cannot say what the file *declares*, so the source is
    // carried alongside it — and an empty read is "read nothing" like the two
    // failures above, never a shard the shape signal silently skips.
    const source = readFileSync(join(directory, name), 'utf8');
    if (source.trim() === '') {
      throw new Error(`ledger shard '${moduleId}' failed to load: its source read back empty`);
    }
    shards.push({ moduleId, entries: entries as Readonly<Record<string, LedgerEntry>>, source });
  }
  return shards;
}

/**
 * Every file the rule applies to: the shared core module tree plus every
 * deployment overlay's module tree.
 *
 * Exported so the check's own test asserts the **real** tree through the same
 * walk the CLI uses — both callers agree on the scan scope by construction
 * rather than by two similar walks (`check-container-imports.ts`' precedent).
 *
 * `*.test.ts` is **included**: `src/modules/orders/prompt-tools.test.ts` is a
 * test file living under `src/` and is therefore in scope (it moves to
 * `backend/test/`). Declaration files are not, because they are emitted.
 *
 * **`.tsx` as well as `.ts`, and that is not symmetry for its own sake**
 * (feature 091, Phase 4). A module's admin screen is a `.tsx` file, and Story 3
 * moves it from `admin/src/modules/<id>/` — where {@link collectAdminFiles}
 * reads it — into `packages/modules/<id>/src/admin/`, which is a module walk
 * root. A `.ts`-only walk here would therefore make the move itself delete the
 * file from every boundary population in the repository: exactly the laundering
 * FR-017 exists to refuse, arriving one layer over, inside the instrument built
 * to prevent it. `google_analytics` was the first batch and carried no
 * cross-module reach, so nothing was lost; `cms`, `catalog`, `invoices` and
 * `orders` each carry several, and each would have gone silently.
 */
export function collectModuleFiles(roots: readonly string[]): string[] {
  return roots.flatMap((root) => walk(root, [], ['.ts', '.tsx']));
}

/**
 * Every file the **owner map** is built from: the whole of `src/`.
 *
 * Wider than {@link collectModuleFiles} on purpose, and it is the difference the
 * `sql` predicate lives on — five of the tables it resolves are the kernel's
 * (`sales_channels` alone carries 25 findings) and 21 more are declared only by
 * DDL under `src/db/migrations`, which no module walk reaches.
 */
/**
 * How a schema source becomes an owner-map key.
 *
 * The platform's files keep their `kernel/…`, `http/…` spelling, which is what
 * {@link declaringOwnerOf} reads to attribute `sales_channels`, `settings`,
 * `audit_logs` and `module_registrations` to the kernel. `layout.keyOf` is
 * repository-relative outside the application's `src/`, so after the platform
 * relocation those four tables were owned by `core:packages` instead — and the
 * failure is fail-**open**: a module's SQL naming a table nobody owns is not a
 * cross-module reach, so two ledgered reaches went stale and the predicate
 * stopped seeing them rather than reporting them.
 *
 * Exported because `test/unit/scripts/check-module-boundary.test.ts` builds the
 * same map over the real tree, and two derivations of one key space are two
 * answers waiting to disagree.
 */
export function schemaKeyOf(layout: ModuleTreeLayout): (absolutePath: string) => string {
  const platformRoot = layout.platformRoot;
  return (absolutePath: string): string =>
    platformRoot !== null && absolutePath.startsWith(`${platformRoot}/`)
      ? relative(platformRoot, absolutePath).split('\\').join('/')
      : layout.keyOf(absolutePath);
}

export function collectSchemaFiles(roots: readonly string[]): string[] {
  return roots.flatMap((root) => walk(root));
}

/**
 * Each module package's npm name mapped to its own directory (D-171).
 *
 * Both halves come off the layout and neither is spelled here: the names are the
 * ones each member's `endora` block declares, and the directory is the one the
 * layout resolved the module id to. A package the layout knows the name of and
 * not the directory of is left out, so the surfaces reader answers `undeclared`
 * for it — a reach, which is the fail-closed direction.
 */
export function modulePackageDirectories(layout: ModuleTreeLayout): ReadonlyMap<string, string> {
  const directories = new Map<string, string>();
  for (const [name, id] of layout.modulePackageNames) {
    const directory = layout.moduleDirectoryOf(id);
    if (directory !== null) directories.set(name, directory);
  }
  return directories;
}

function walk(dir: string, out: string[] = [], extensions: readonly string[] = ['.ts']): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out, extensions);
    } else if (extensions.some((extension) => name.endsWith(extension)) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every admin file the rule applies to (feature 091, FR-017).
 *
 * `.tsx` as well as `.ts`, because that is what an admin screen is written in
 * and a `.ts`-only walk would read the 40-odd helper files and report clean
 * over the 287 that carry the reaches. Exported so the check's own test walks
 * the **real** tree through the same function the CLI uses.
 */
export function collectAdminFiles(admin: AdminBoundarySurfaces | null, repoRoot: string): string[] {
  if (admin === null || admin.moduleRoot === null) return [];
  return walk(join(repoRoot, admin.moduleRoot), [], ['.ts', '.tsx']);
}

/**
 * Every admin **host** file — `admin/src` outside the module root (feature 091,
 * P1).
 *
 * The complement of {@link collectAdminFiles} within the same source root, so
 * between them the two walks are all of `admin/src` and a file cannot fall
 * between them. Same extensions, for the same measured reason: the population
 * this widening exists for is `.tsx`-heavy — eight of the nine files that seed
 * its ledger are `.tsx` — and a `.ts`-only walk would open the ninth, find one
 * reach, and report over the other eight without saying so.
 *
 * The registry exclusions are **not** applied here. This is the walk, and a file
 * the walk did not open is a file the `read:` line cannot count; the exclusion
 * is a judgement and belongs where the other one is, at the top of
 * {@link analyzeSource}.
 *
 * Exported so the check's own test walks the real tree through the same function
 * the CLI uses. Two derivations of one population are two answers waiting to
 * disagree, and this repository has watched that happen — `i18n:hardcoded`'s
 * script grew a third root family while its companion test kept a hand-written
 * list of two (!1182).
 */
export function collectAdminHostFiles(
  admin: AdminBoundarySurfaces | null,
  repoRoot: string,
): string[] {
  if (admin === null) return [];
  // With no module root the two walks stop being complements and this one is
  // all of `admin/src`, which is the measurement: every file under it is the
  // admin application's own.
  const files = walk(join(repoRoot, admin.sourceRoot), [], ['.ts', '.tsx']);
  if (admin.moduleRoot === null) return files;
  const moduleRoot = join(repoRoot, admin.moduleRoot);
  return files.filter((file) => !file.startsWith(`${moduleRoot}/`));
}

/** Does this path sit under the admin module root? */
function isAdminPath(path: string, admin: AdminBoundarySurfaces | null): boolean {
  return admin !== null && admin.moduleRoot !== null && path.startsWith(`${admin.moduleRoot}/`);
}

/**
 * Which admin surface directories the walk actually produced a file for.
 *
 * The `covered` half of the admin floor, and it counts **attributed**
 * directories only: a host-owned one (`_shared`, `home`, `platform`,
 * `profile`) is not in the expectation, so counting it would inflate the
 * coverage past the population and hide a shortfall.
 */
export function adminDirectoriesWalked(
  admin: AdminBoundarySurfaces,
  keys: readonly string[],
): Set<string> {
  const seen = new Set<string>();
  if (admin.moduleRoot === null) return seen;
  const prefix = `${admin.moduleRoot}/`;
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const directory = key.slice(prefix.length).split('/')[0];
    if (directory !== undefined && admin.moduleOfDirectory.has(directory)) seen.add(directory);
  }
  return seen;
}

/**
 * The admin **host** files the ledger says exist, and how many of them this walk
 * opened (feature 091, P1).
 *
 * The host population's short-walk floor, and its independent author is the
 * **ledger** — the same author `adminPopulationLost` already trusts for the
 * sibling population, and for the same reason: a key is written by the merge
 * request that recorded the reach, not by the derivation being checked. So the
 * expectation moves when a human moves it and the coverage moves when the walk
 * does, and the two cannot be the same number twice.
 *
 * `expected` counts only keys whose file is **still on disk**, because an entry
 * describing a file that has genuinely gone is staleness — which the two-way
 * ledger reports in its own words — and not a walk that came back short.
 *
 * It is reported only while it is non-empty, the idiom `module-packages` already
 * uses: `expected=0` is a refusal in this grammar, and the day the last host
 * reach drains there is no host debt for a floor to protect. The walk's own
 * emptiness is covered separately and unconditionally — see
 * {@link vacuousReason}'s `adminHostFiles`.
 *
 * What it cannot see is stated rather than discovered: a host **directory** the
 * walk lost that carries no ledger entry today. A reach added there would go
 * unrecorded, exactly as the nine seeded here did before P1. The unconditional
 * emptiness refusal is what stands between that and losing the whole population.
 */
export function adminHostFilesWalked(
  admin: AdminBoundarySurfaces,
  ledgerKeys: readonly string[],
  walkedKeys: ReadonlySet<string>,
  exists: (repoRelativePath: string) => boolean,
): { readonly expected: number; readonly covered: number } {
  const wanted = new Set<string>();
  for (const key of ledgerKeys) {
    const file = fileOfKey(key);
    if (file === null) continue;
    if (adminHostOwnerOf(file, admin) === null) continue;
    if (!exists(file)) continue;
    wanted.add(file);
  }
  let covered = 0;
  for (const file of wanted) if (walkedKeys.has(file)) covered += 1;
  return { expected: wanted.size, covered };
}

/**
 * The layout's admin surfaces in the shape the analysis reads them — every path
 * spelled as `layout.keyOf` spells it, so a ledger key, a message and a walked
 * source are one namespace.
 */
export async function adminSurfacesOf(
  layout: ModuleTreeLayout,
): Promise<AdminBoundarySurfaces | null> {
  const admin = await layout.adminSurfaces();
  if (admin === null) return null;
  return {
    sourceRoot: layout.keyOf(admin.sourceRoot),
    moduleRoot: admin.moduleRoot === null ? null : layout.keyOf(admin.moduleRoot),
    aliasPrefix: admin.aliasPrefix,
    moduleOfDirectory: admin.moduleOfDirectory,
    registryFiles: new Set(admin.registryFiles.map(layout.keyOf)),
    generatedRegistryFile: layout.keyOf(admin.generatedRegistryFile),
  };
}

/**
 * Absolute paths → the source map the analysis reads, keyed under `src/`.
 *
 * `keyOf` is `resolveModuleLayout().keyOf` from the CLI (feature 080, T040a):
 * `modules/<id>/…` for the application's own tree, byte-for-byte as before, and
 * the repository-relative path for a module that has become a workspace
 * package, which has no `src/` of the application's to be relative to.
 */
export function sourcesOf(
  files: readonly string[],
  keyOf: (file: string) => string,
): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(keyOf(file), readFileSync(file, 'utf8'));
  }
  return sources;
}

/**
 * One walk of the real tree, and the {@link ModuleBoundaryInput} built from it.
 *
 * **Both callers take their input from here, and that is the point.** The
 * collectors above were already shared with this check's own test, and the
 * comment there said the two "cannot come to disagree about the scan scope".
 * They did — not over the *walk* but over the **record**: five of
 * {@link ModuleBoundaryInput}'s seven fields are optional, each with a
 * documented "absent means …", and the test assembled its own record from three
 * of them. Every field it left out silently narrowed the analysis, and the
 * narrowing that bit was `modulePackages`: absent, a **bare** specifier resolves
 * to no module package, so no reach is produced for one at all. Batch 10 of
 * feature 091 added this repository's first bare-specifier ledger key
 * (`@endora-commerce/mod-credentials/admin-ui`, D-191's published-component
 * seam); the CLI read `stale=0` over it, and the test — which could not see the
 * reach that justifies the entry — called the entry stale and took `master` red.
 *
 * That is the shape AGENTS.md already records: **the merge request that creates
 * a derived entry is structurally the one that cannot see it go stale.** Sharing
 * the *walk* while re-deriving the *record* is the same defect one layer in, so
 * the record is derived once, here. A field added to
 * {@link ModuleBoundaryInput} now reaches the tree assertion by construction
 * rather than by an author remembering a second call site.
 *
 * The intermediates come back with it because both callers need them for
 * something other than the analysis — the CLI for its vacuous guard and its
 * summary line, the test for its own floors — and re-walking to recover them
 * would re-open the seam this closes.
 */
export interface ModuleBoundaryScan {
  /**
   * Exactly what {@link checkModuleBoundary} is called with over this tree.
   *
   * Two fields are narrowed to present because a real-tree scan always produces
   * them, and both callers read them back out for something other than the
   * analysis: only a fixture may mean "do not run the `sql` predicate" or "grant
   * no contract-surface exemption" by omitting one.
   */
  readonly input: ModuleBoundaryInput & {
    readonly schema: ReadonlyMap<string, string>;
    readonly modulePackageSurfaces: ModulePackageSurfaces;
  };
  readonly moduleFiles: readonly string[];
  readonly adminFiles: readonly string[];
  readonly adminHostFiles: readonly string[];
  readonly adminSurfaces: AdminBoundarySurfaces | null;
  /**
   * The installed extension packages, unrefused. The CLI hands this to
   * {@link refuseUnreadablePackages}, which exits the process; a scan may not,
   * so the refusal stays where ending the process is allowed.
   */
  readonly packages: PackageDeclarations;
}

export async function scanModuleBoundaryTree(
  layout: ModuleTreeLayout,
): Promise<ModuleBoundaryScan> {
  // The admin population (feature 091, FR-017). It is merged into the same
  // source map rather than judged by a second analysis, because the first
  // module whose admin code imports its own backend package would otherwise be
  // judged by neither — the recorded reason `research.md` §3.2 gives for
  // refusing a separate `check:admin-boundary`.
  const adminSurfaces = await adminSurfacesOf(layout);
  const adminFiles = collectAdminFiles(adminSurfaces, layout.repoRoot);
  // The admin **host** population (feature 091, P1): `admin/src` outside the
  // module root, whose reaches into a module are the admin application asking a
  // module for something. Walked separately from the module surfaces so the
  // summary line can say which walk produced what, and so the two floors stay
  // separable — the surface floor is per attributed directory and this one is
  // per ledgered file.
  const adminHostFiles = collectAdminHostFiles(adminSurfaces, layout.repoRoot);
  // The two walks stay separable, because the backend floor is "one source per
  // registered module" and an admin directory produces a file for its module
  // too: merging them first would let `admin/src/modules/blog/` satisfy the
  // floor for a `blog` whose backend sources had vanished, which is issue #215
  // re-opened by the repair for FR-017.
  const moduleFiles = collectModuleFiles(layout.moduleWalkRoots);
  const sources = sourcesOf([...moduleFiles, ...adminFiles, ...adminHostFiles], layout.keyOf);
  const schema = sourcesOf(collectSchemaFiles(layout.sourceRoots), schemaKeyOf(layout));
  // The third owner-map source (T034). It is read before the caller's vacuous
  // guard so that a package whose schema cannot be enumerated stops the run
  // instead of leaving its tables attributed to nobody — the silence that would
  // let every reach into one report clean.
  const packages = await loadPackageDeclarations();
  return {
    input: {
      sources,
      schema,
      packageTables: packages.tables,
      modulePackages: layout.modulePackageNames,
      // D-171's reader, over the module packages the layout found: each
      // package's own `exports` map and its own emitted modules, so the
      // contract-surface designation is re-derived here rather than written
      // down anywhere. Constructing it reads nothing — the reader is lazy and
      // throws `UnreadableSubpathError` at the subpath it cannot measure.
      modulePackageSurfaces: modulePackageSurfaces(modulePackageDirectories(layout)),
      hostResidentModules: layout.hostResidentModules,
      adminSurfaces,
    },
    moduleFiles,
    adminFiles,
    adminHostFiles,
    adminSurfaces,
    packages,
  };
}

/**
 * The two ways a {@link GENERATED_MODULE_FILES} entry can rot: the file it names
 * is gone, or the generator it credits is.
 */
export function generatedExemptionIssues(
  exists: (repoRelativePath: string) => boolean = (path) => existsSync(join(BACKEND_ROOT, path)),
): string[] {
  const issues: string[] = [];
  for (const [file, generator] of Object.entries(GENERATED_MODULE_FILES)) {
    if (!exists(`src/${file}`)) {
      issues.push(`${file} is exempt as generated, but no such file exists`);
    }
    if (!exists(generator)) {
      issues.push(`${file} names generator ${generator}, which does not exist`);
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** What the module author should do instead, chosen by the surface reached. */
function remedyFor(finding: ModuleBoundaryFinding): string {
  if (finding.predicate === 'sql') return sqlRemedyFor(finding);
  if (finding.moduleId === ADMIN_HOST_OWNER) return hostRemedyFor(finding);
  const consumer = finding.moduleId;
  const owner = finding.target;
  const head = `    This is ${describe(finding.surface)} of \`${owner}\`.`;
  const port = [
    `      1. \`${owner}\` publishes a port and its contract type in`,
    `         packages/contracts/src/${owner}.ts;`,
    '      2. resolve it here with lazyPort<ContractType>(ctx, \'<literalPortName>\')',
    '         — the name must be a string literal;',
    `      3. add '${owner}' to \`dependencies\` in src/modules/${consumer}/manifest.ts.`,
  ].join('\n');

  switch (finding.surface) {
    case 'entity':
      return [
        `${head} Ask \`${owner}\` for the data instead:`,
        port,
        '',
        '    Do not relocate the entity: moving it changes the specifier and not the',
        '    coupling.',
      ].join('\n');
    case 'wiring':
      return [
        `${head} Reaching another module's registration file makes the two one unit.`,
        `    Replace it with a contribution point \`${owner}\` owns, following the split`,
        '    feature 073 performed on `orders`\' five guest modules.',
      ].join('\n');
    case 'manifest':
      return [
        `${head} Read the deployment-resolved module registry instead of another`,
        "    module's manifest file.",
      ].join('\n');
    default:
      return [`${head} Ask \`${owner}\` for the behaviour instead:`, port].join('\n');
  }
}

/**
 * What to do about the admin application reaching into a module (feature 091,
 * P1).
 *
 * A separate sentence because the module remedy's three steps are all wrong
 * here: the host declares no manifest, so it has no `dependencies` to add the
 * owner to, and a port is a backend seam that a React component cannot resolve.
 * The exits are the frontend's own, and which of them applies is a question
 * about the reach rather than about this check — so the message names all three
 * and the ledger entry says which one this reach is waiting for.
 */
function hostRemedyFor(finding: CrossModuleImport): string {
  return [
    `    This is the admin application reaching into \`${finding.target}\`'s admin code.`,
    '    Three exits, and the reach picks one:',
    `      1. rebuild the call from the published \`apiClient\` and \`${finding.target}\`'s`,
    '         contract types, where the reach is an admin API client;',
    `      2. take the component as a **contribution** \`${finding.target}\` declares, where`,
    '         the host screen is offering a slot (FR-007);',
    '      3. publish it in @endora-commerce/admin-kit, where the piece turns out to hold',
    '         no module knowledge at all.',
    '',
    "    Do not move the file into the module's package without answering that: a bare",
    '    package specifier resolves, and the reach then reads as supported rather than',
    '    as paid.',
  ].join('\n');
}

function describe(surface: CrossModuleSurface): string {
  switch (surface) {
    case 'entity':
      return 'an entity';
    case 'service':
      return 'a service';
    case 'port':
      return 'a port declaration';
    case 'manifest':
      return 'the manifest';
    case 'wiring':
      return 'the wiring';
    default:
      return 'an internal';
  }
}

/**
 * What to do about a raw statement against another module's table.
 *
 * The `sales_channel_*` bridges get their own sentence because Principle XII
 * names the accessor by hand and, until D-87, credited a lint rule that was
 * wired into no ESLint config with enforcing it.
 */
function sqlRemedyFor(finding: CrossModuleSqlAccess): string {
  const head = `    \`${finding.table}\` is owned by \`${finding.target}\`.`;
  if (finding.table.startsWith('sales_channel')) {
    return [
      `${head} It is a sales-channel membership bridge, and Principle XII`,
      '    says those are read and written only through the channel-membership service:',
      '      SalesChannelMembershipPort.listEntityIdsForChannel(channelId, entityType)',
      '    for a read, and the membership service for a write — a direct write records no',
      '    `sales_channel_membership` audit row, which is Principle XIII as well.',
    ].join('\n');
  }
  const invisibility =
    finding.syntax === 'builder'
      ? [
          `${head} A query builder names its table as a call argument, so`,
          '    neither an import specifier nor a SQL statement names it — and it still',
          '    compiles, runs and returns rows. Ask the owner instead:',
        ]
      : [
          `${head} A raw statement across the boundary compiles, runs and returns`,
          '    rows, and no import specifier names it. Ask the owner instead:',
        ];
  return [
    ...invisibility,
    `      1. \`${finding.target}\` publishes a port and its contract type in`,
    `         packages/contracts/src/${finding.target}.ts;`,
    "      2. resolve it here with lazyPort<ContractType>(ctx, '<literalPortName>');",
    `      3. add '${finding.target}' to \`dependencies\` in`,
    `         src/modules/${finding.moduleId}/manifest.ts.`,
  ].join('\n');
}

function describeFinding(finding: ModuleBoundaryFinding): string {
  if (finding.predicate === 'sql') {
    return (
      `  - ${finding.file}:${finding.line}\n` +
      `      ${finding.moduleId} -> ${finding.target}   sql ${finding.syntax} ${finding.direction}` +
      `   ${finding.table}\n      ${finding.statement}\n`
    );
  }
  return (
    `  - ${finding.file}:${finding.line}\n` +
    `      ${finding.moduleId} -> ${finding.target}   ${finding.kind}   ${finding.specifier}\n`
  );
}

/** `backend/test/**` — reporting only, never part of the exit code. */
function testSites(hostResident: HostResidentModules): number {
  let total = 0;
  for (const file of walk(TEST_ROOT)) {
    const fromBackend = relative(BACKEND_ROOT, file).split('\\').join('/');
    for (const specifier of namedSpecifiers(readFileSync(file, 'utf8'), fromBackend)) {
      if (!specifier.text.startsWith('.')) continue;
      const resolved = posixNormalize(posixJoin(posixDirname(fromBackend), specifier.text));
      if (!resolved.startsWith('src/')) continue;
      if (moduleLocationOf(resolved.slice('src/'.length), hostResident) !== null) total += 1;
    }
  }
  return total;
}

/**
 * What a migration finding is, what to do about it and where to record it
 * (feature 097).
 *
 * The two rules print separately because their remedies differ, and the
 * sentence is what an author reads before they reach for a manifest line that
 * would make a switchable module unswitchable.
 */
function describeMigrationFinding(finding: MigrationSqlFinding): string {
  const head =
    `  - ${finding.file}:${finding.line}\n` +
    `      ${finding.moduleId} -> ${finding.target}   ${finding.syntax} ${finding.direction}` +
    `   ${finding.table}\n      ${finding.statement}\n`;
  if (finding.rule === 'undeclared-migration-table-reference') {
    return (
      `${head}\n` +
      `    \`${finding.moduleId}\` names a table \`${finding.target}\` owns, and its manifest\n` +
      `    does not declare \`${finding.target}\` (transitively). Two remedies:\n` +
      `      1. add '${finding.target}' to \`dependencies\` in ${finding.moduleId}'s manifest.ts\n` +
      `         — but not if ${finding.moduleId} is \`nonDeactivatable\` and ${finding.target}\n` +
      `         is switchable, because that makes ${finding.target}'s activation control a\n` +
      '         dead switch (AGENTS.md § *Composition* item 4a);\n' +
      `      2. move the statement into a \`${finding.target}\`-owned migration.\n`
    );
  }
  return (
    `${head}\n` +
    `    A migration owned by \`${finding.moduleId}\` may not decide what is in a table\n` +
    `    \`${finding.target}\` owns, whether or not the dependency is declared: a declaration\n` +
    '    is an ordering-and-presence fact and a write is an ownership fact. Three seams:\n' +
    `      1. \`${finding.target}\`'s own migration — the seed it could equally have written;\n` +
    `      2. \`${finding.moduleId}\`'s \`installHook\`, which is idempotent by contract and\n` +
    '         re-runs after a soft-uninstall -> install cycle;\n' +
    `      3. \`${finding.target}\`'s port, at boot, where the seed needs services.\n`
  );
}

/** The eight failure modes, printed for one migration ledger. */
function reportMigrationLedger(
  verdict: LedgerVerdict<MigrationSqlFinding>,
  rule: MigrationSqlRule,
  directory: string,
): void {
  if (verdict.violations.length > 0) {
    console.error(
      `\nA migration's cross-module SQL (feature 097, ${rule}).\n`,
    );
    for (const finding of verdict.violations) {
      console.error(describeMigrationFinding(finding));
      console.error(
        '    If the statement must stand for now, record it in\n' +
          `    backend/scripts/ledgers/${directory}/${finding.moduleId}.ts with a reason\n` +
          '    naming the seam its repair takes.\n',
      );
    }
  }
  if (verdict.stale.length > 0) {
    console.error(`\nStale ${directory} entries (they describe no statement any more):`);
    for (const key of verdict.stale) console.error(`  - ${key}`);
  }
  if (verdict.emptyShards.length > 0) {
    console.error(`\nEmpty ${directory} shards — delete the file rather than emptying it:`);
    for (const id of verdict.emptyShards) {
      console.error(`  - backend/scripts/ledgers/${directory}/${id}.ts`);
    }
  }
  if (verdict.orphanShards.length > 0) {
    console.error(`\n${directory} shards named for a module that does not exist:`);
    for (const id of verdict.orphanShards) console.error(`  - ${id}`);
  }
  for (const [label, issues] of [
    ['Misfiled', verdict.misfiledEntries],
    ['Permanence', verdict.permanentIssues],
    ['Count', verdict.countIssues],
    ['Shard shape', verdict.shardShapeIssues],
  ] as const) {
    if (issues.length === 0) continue;
    console.error(`\n${label} issues in ${directory}:`);
    for (const issue of issues) console.error(`  - ${issue}`);
  }
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const testMode = process.argv.includes('--tests');
  const moduleAt = process.argv.indexOf('--module');
  const only = moduleAt === -1 ? null : (process.argv[moduleAt + 1] ?? null);

  // Both roots, derived (feature 080, T040a): the module walk covers each
  // application tree and every module that has become a workspace package; the
  // owner map is built over the wider source list, for the same reason it was
  // always wider than the module walk.
  const layout = await requireModuleLayout('[module-boundary]');
  // One walk, one record, shared with this check's own tree assertion — see
  // {@link scanModuleBoundaryTree} for why the record and not only the walk.
  const scan = await scanModuleBoundaryTree(layout);
  const { moduleFiles: files, adminFiles, adminHostFiles, adminSurfaces: admin, packages } = scan;
  const { sources, schema } = scan.input;
  refuseUnreadablePackages('[module-boundary]', packages);
  const owners = buildTableOwners(schema, packages.tables, layout.hostResidentModules).report;
  let registeredModules: readonly string[];
  try {
    registeredModules = await loadRegisteredModuleIds(layout.manifestIndexPath);
  } catch (error: unknown) {
    console.error(
      `[module-boundary] the module index at ${layout.manifestIndexPath} could not be read ` +
        `(${String(error)}) — the expected population is derived from it; ` +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
    return;
  }
  let shards: LedgerShard[];
  let migrationLedgers: MigrationLedgers;
  try {
    shards = await loadLedgerShards(LEDGER_ROOT);
    migrationLedgers = {
      undeclaredReferences: await loadLedgerShards(MIGRATION_REFERENCE_LEDGER_ROOT),
      foreignWrites: await loadLedgerShards(MIGRATION_WRITE_LEDGER_ROOT),
    };
  } catch (error) {
    console.error(`[module-boundary] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
    return;
  }
  // The transitive manifest closure R1 compares against, from the artefact this
  // check already reads for its module floor (feature 097, FR-006). The
  // traversal is `lib/manifest-dependencies.ts`', shared with
  // `test/unit/db/fk-dependency-drift.test.ts` so the DDL and DML halves of
  // AGENTS.md § *Migrations* item 4 cannot answer differently for one edge.
  let declaredDependencies: DeclaredDependencies;
  try {
    declaredDependencies = await loadManifestDependencies(layout.manifestIndexPath);
  } catch (error: unknown) {
    const detail =
      error instanceof ManifestDependenciesUnreadableError ? error.message : String(error);
    console.error(
      `[module-boundary] the manifest dependency graph could not be read (${detail}) — R1 ` +
        'compares against it; refusing to report a vacuous pass',
    );
    process.exit(2);
    return;
  }
  // The migration population's independent author (contract §5): the generator
  // finds migrations by walking module directories and writes them down as
  // registry entries, this check finds them by path. A module tree that moved
  // makes the two disagree in the same run.
  const registryPath = join(layout.srcRoot, 'db', 'migrations-registry.generated.ts');
  if (!existsSync(registryPath)) {
    console.error(
      `[module-boundary] the migration registry at ${registryPath} is not on disk — it is the ` +
        'independent expectation for the migration walk; refusing to report a vacuous pass',
    );
    process.exit(2);
    return;
  }
  const registered = registeredMigrations(readFileSync(registryPath, 'utf8'), registryPath);

  // The shards are loaded before the vacuous guard rather than after it, so
  // that guard can use the ledger as the admin population's independent author
  // (feature 091). Its own "ledger directory missing" answer still fires first
  // in the failure that matters, because `loadLedgerShards` rejects on it.
  // The analysis runs **before** the vacuous guard, because four of feature
  // 097's five refusals are about what the analysis read — how many migration
  // files it opened, which migration classes it found, how many specifiers and
  // table references it examined — and none of those is knowable from the walk
  // alone. The guard still exits 2 rather than reporting, so nothing it refuses
  // can be printed as a verdict.
  const analysed: ModuleBoundaryInput = {
    ...scan.input,
    dependencyClosures: dependencyClosures(declaredDependencies),
  };
  let result: CheckResult;
  try {
    result = checkModuleBoundary(analysed, shards, migrationLedgers);
  } catch (error) {
    if (!(error instanceof UnreadableSubpathError)) throw error;
    console.error(`[module-boundary] ${error.message}`);
    process.exit(2);
    return;
  }
  const migrations = migrationRegistryCoverage(registered, result.migrationClasses);

  const vacuous = vacuousReason({
    moduleFiles: files,
    registeredModules,
    moduleIdOf: layout.moduleIdOfPath,
    ledgerDirectoryExists: existsSync(LEDGER_ROOT),
    entityTables: owners.entityTables,
    migrationTables: owners.migrationTables,
    adminSurfaces: admin,
    ledgerKeys: shards.flatMap((shard) => Object.keys(shard.entries)),
    fileExists: (path) => existsSync(join(layout.repoRoot, path)),
    moduleFileKeys: new Set(files.map((file) => layout.keyOf(file))),
    adminHostFiles,
    migrationFiles: result.migrationFiles,
    migrationRegistryMissing: migrations.missing,
    declaresNoDependency: declaresNoDependency(declaredDependencies),
    migrationLedgerDirectoriesExist:
      existsSync(MIGRATION_REFERENCE_LEDGER_ROOT) && existsSync(MIGRATION_WRITE_LEDGER_ROOT),
    importSites: result.examinedSpecifiers,
    tableSites: result.examinedTableReferences,
  });
  if (vacuous !== null) {
    console.error(`[module-boundary] ${vacuous}`);
    process.exit(2);
  }
  const selected = <T extends { readonly moduleId: string }>(entries: readonly T[]): readonly T[] =>
    only === null ? entries : entries.filter((entry) => entry.moduleId === only);

  const violations = selected(result.violations);
  const ledgered = selected(result.ledgered);

  if (listMode) {
    for (const finding of [...violations, ...ledgered].sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
    )) {
      const tag = result.violations.includes(finding) ? 'CROSS   ' : 'LEDGERED';
      const detail =
        finding.predicate === 'sql'
          ? `sql  ${finding.syntax} ${finding.direction}\n           ${finding.table}`
          : `${finding.kind}  ${finding.surface}\n           ${finding.specifier}`;
      console.log(
        `${tag} ${finding.file}:${finding.line}  [${finding.moduleId} -> ${finding.target}] ${detail}`,
      );
    }
    console.log('');
  }

  // `ledger-size` is what is left to drain, so the entries the repository has
  // decided to keep are excluded from it and printed on their own line. A
  // residue that stops shrinking because the last few entries are permanent
  // would otherwise read as a stalled sweep (D-77; the idiom D-72 gave the
  // parity ledger).
  const ledgerSize =
    shards.reduce((sum, shard) => sum + Object.keys(shard.entries).length, 0) -
    result.permanentKeys.length;
  // `ledger-size` stays **keys** (issue #267): an entry is the unit of review
  // and of retirement — the cut that removes it removes every reach under it —
  // and redefining the number would move it 57 -> 64 with no code changed,
  // making the drain read as a regression. The sites the draining entries cover
  // are printed beside it, derived from their counts and never written down, so
  // a file that grew a reach is visible in the summary line as well as in the
  // diff of the entry it made a reviewer edit.
  const ledgerSites = shards.reduce(
    (sum, shard) =>
      sum +
      Object.entries(shard.entries)
        .filter(([key]) => !result.permanentKeys.includes(key))
        .reduce((inner, [, entry]) => inner + (recordedSites(entry) ?? 1), 0),
    0,
  );
  const sqlFindings = result.violations
    .concat(result.ledgered)
    .filter((finding) => finding.predicate === 'sql').length;
  // What was read, in the shared grammar (issue #244). `files` counts both
  // walks — the module sources judged and the schema sources the table→owner
  // map is built from — because a half-read schema makes the SQL predicate
  // report *fewer* reaches rather than fail. No `sites=`: this check records
  // the reaches it finds and never counts the specifiers and table references
  // it cleared, so there is no examined-unit number without a second walk;
  // ledgered in `test/helpers/check-read-sizes.ts`.
  const modules = modulePopulationCoverage({
    registered: registeredModules,
    files: files.map(layout.keyOf),
    // The keys are `layout.keyOf`'s, not absolute paths, so the layout's own
    // resolver cannot be used here: the attribution has to happen on the key,
    // which is what `moduleOf` does for every other population in this file.
    moduleIdOf: (key) => moduleOf(`/src/${key}`, layout.hostResidentModules),
  });
  const installed = packageCoverage(packages);
  const coverages: ReadCoverage[] = installed === null ? [modules] : [modules, installed];
  // The migration population's independent author (feature 097, contract §5).
  // `manifest-index` cannot answer for it: that token is satisfied by any file a
  // registered module contributes, and a module's backend sources are plentiful,
  // so a `migrations/` walk that stopped resolving leaves it intact.
  coverages.push({
    source: 'migration-registry',
    expected: migrations.expected,
    covered: migrations.covered,
  });
  // The npm name of every module package, reconciled against the package roots
  // the layout found by a different route — the directories it walks against the
  // names it read off their manifests. An empty map is a legal answer (no module
  // package) and is indistinguishable, from inside, from a derivation that
  // silently stopped working: a bare specifier into a module whose name is
  // missing reads as a third-party import and is cleared. Reported only when
  // there are roots, because `expected=0` is a refusal in this grammar and
  // "no module package" was the whole tree until !910.
  const packageRoots = layout.moduleRoots.filter((root) => root.origin === 'workspace-package');
  if (packageRoots.length > 0) {
    coverages.push({
      source: 'module-packages',
      expected: packageRoots.length,
      covered: layout.modulePackageNames.size,
    });
  }
  // The admin population's own floor (feature 091, FR-017), reconciled against
  // an independent derivation: the directories the route table and the nav
  // attribute to a module. A directory that produced no file is a walk that
  // came back short over exactly the population that would otherwise report
  // `violations=0` — issue #215 one frontend over.
  //
  // **Printed only while there is a population to protect**, on exactly the
  // terms the host token below already states: `expected=0` is a refusal in
  // this grammar, and SC-007 drains this population to zero by design (R16).
  // What still refuses a blind run over it is {@link adminPopulationLost},
  // whose anchor is the **ledger** rather than the walk — a run whose shards
  // name admin files that are still on disk while the layout answered nothing
  // is exit 2 — plus the unconditional refusal of a resolved layout whose host
  // walk opened nothing, which R16 makes reachable again.
  if (admin !== null) {
    const surfaces = {
      expected: admin.moduleOfDirectory.size,
      covered: adminDirectoriesWalked(admin, adminFiles.map(layout.keyOf)).size,
    };
    if (surfaces.expected > 0) {
      coverages.push({ source: 'admin-surfaces', ...surfaces });
    }
    // The host population's own floor (feature 091, P1), reconciled against the
    // ledger — the independent author, because a key is written by the merge
    // request that recorded the reach. Printed only while there is host debt to
    // protect: `expected=0` is a refusal in this grammar, and the day the last
    // host reach drains the token goes with it. A host walk that came back
    // *empty* is refused above, unconditionally, so the two together cover both
    // #113 and #215 over this population.
    const host = adminHostFilesWalked(
      admin,
      shards.flatMap((shard) => Object.keys(shard.entries)),
      new Set(adminHostFiles.map(layout.keyOf)),
      (path) => existsSync(join(layout.repoRoot, path)),
    );
    if (host.expected > 0) {
      coverages.push({ source: 'admin-host', expected: host.expected, covered: host.covered });
    }
  }
  reportReadSize({
    prefix: '[module-boundary]',
    // The finer population, over both predicates (issue #244). Printed as one
    // number and floored as two — see {@link CheckResult.examinedSpecifiers}.
    sites: result.examinedSpecifiers + result.examinedTableReferences,
    // The surfaces reader is lazy — it opens a package's manifest and its
    // emitted module only for a subpath a module actually reached — so its
    // contribution is 0 on a tree where no module names a package specifier,
    // and that is the honest number rather than a rounding of it (issue #244).
    files:
      sources.size +
      schema.size +
      packages.filesRead +
      scan.input.modulePackageSurfaces.filesRead(),
    coverage: coverages,
  });
  console.log(
    `[module-boundary] module files=${files.length} admin files=${adminFiles.length} ` +
      `admin host files=${adminHostFiles.length} ` +
      `cross-module reaches=${result.total} ` +
      `(imports=${result.total - sqlFindings} sql=${sqlFindings}) ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${ledgerSize} (sites=${ledgerSites}) shards=${shards.length} ` +
      `stale=${result.stale.length} permanent=${result.permanentKeys.length}`,
  );
  // The migration rules' own summary (feature 097). Separate from the line
  // above because the two populations are separate: `ledger-size` there is the
  // packaging sweep's residue, and these two are a rule that has just landed —
  // R1's ledger is not expected to empty and R2's is.
  const migrationLedgerSize = (shardsOf: readonly LedgerShard[], permanent: readonly string[]) =>
    shardsOf.reduce((sum, shard) => sum + Object.keys(shard.entries).length, 0) - permanent.length;
  console.log(
    `[module-boundary] migrations=${result.migrationFiles} ` +
      `cross-module DML=${result.migrationFindings.length} ` +
      `(undeclared=${result.undeclaredReferences.violations.length + result.undeclaredReferences.ledgered.length} ` +
      `foreign-writes=${result.foreignWrites.violations.length + result.foreignWrites.ledgered.length}) ` +
      `violations=${result.undeclaredReferences.violations.length + result.foreignWrites.violations.length} ` +
      `r1-ledger=${migrationLedgerSize(migrationLedgers.undeclaredReferences, result.undeclaredReferences.permanentKeys)} ` +
      `r2-ledger=${migrationLedgerSize(migrationLedgers.foreignWrites, result.foreignWrites.permanentKeys)} ` +
      `stale=${result.undeclaredReferences.stale.length + result.foreignWrites.stale.length} ` +
      `permanent=${result.undeclaredReferences.permanentKeys.length + result.foreignWrites.permanentKeys.length}`,
  );
  console.log(
    `[module-boundary] table→owner map: entity pass=${result.tableOwners.entityTables} ` +
      `migration pass=${result.tableOwners.migrationTables} ` +
      `(declared by no entity=${result.tableOwners.migrationOnlyTables}) ` +
      `package pass=${result.tableOwners.packageTables} ` +
      `unattributed=${result.tableOwners.unattributed.length}` +
      (result.tableOwners.unattributed.length > 0
        ? ` (${result.tableOwners.unattributed.join(', ')} — owned by no module, so never a finding)`
        : ''),
  );
  if (result.permanentKeys.length > 0) {
    console.log(
      '[module-boundary] permanent entries (kept, not draining — excluded from ledger-size):',
    );
    for (const key of result.permanentKeys) console.log(`  - ${key}`);
  }

  if (testMode) {
    console.log(
      `[module-boundary] test sites=${testSites(layout.hostResidentModules)} (backend/test/** — reporting only, ` +
        'a test is allowed to know more than the code it tests)',
    );
  }

  const exemptionIssues = generatedExemptionIssues();
  if (exemptionIssues.length > 0) {
    console.error('\nThe generated-file exemption no longer describes the tree:');
    for (const issue of exemptionIssues) console.error(`  - ${issue}`);
  }

  if (result.violations.length > 0) {
    console.error(
      "\nA module reached another module's internals (Constitution I; feature 075 FR-001,\n" +
        'feature 077 D-87).\n',
    );
    for (const finding of result.violations) {
      console.error(describeFinding(finding));
      console.error(remedyFor(finding));
      console.error(
        '\n    Do not wrap the port call in a catch: it turns fail-closed into fail-open.\n' +
          '\n    If the edge must stand for now, add it to\n' +
          `    backend/scripts/ledgers/cross-module-imports/${finding.moduleId}.ts with a reason\n` +
          '    and the question that retires it.\n',
      );
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (they describe no import any more — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }
  if (result.emptyShards.length > 0) {
    console.error(
      '\nEmpty ledger shards. A shard with no entries is a done signal that says nothing —\n' +
        'delete the file instead:',
    );
    for (const id of result.emptyShards) {
      console.error(`  - backend/scripts/ledgers/cross-module-imports/${id}.ts`);
    }
  }
  if (result.orphanShards.length > 0) {
    console.error('\nLedger shards named for a module that does not exist:');
    for (const id of result.orphanShards) console.error(`  - ${id}`);
  }
  if (result.misfiledEntries.length > 0) {
    console.error(
      '\nMisfiled ledger entries. A shard accounts for its own module and nothing else,\n' +
        'or one module\'s shard could absorb another module\'s violation:',
    );
    for (const entry of result.misfiledEntries) console.error(`  - ${entry}`);
  }

  if (result.permanentIssues.length > 0) {
    console.error(
      '\nA permanent ledger entry has to say what would retire it, and a merge request\n' +
        'is not a retiring condition. An entry nobody can argue with later is exactly what\n' +
        'the flag must not create:',
    );
    for (const issue of result.permanentIssues) console.error(`  - ${issue}`);
  }

  if (result.countIssues.length > 0) {
    console.error(
      '\nA ledger entry says how many reaches stand under its key, and the walk disagrees.\n' +
        'The key is `<file>:<target>`, so without the count the *next* reach of a shape this\n' +
        'file already has passes unreviewed — which is how two `product_categories` statements\n' +
        'landed against an unchanged ledger (issue #267). Omitting `sites` means one:',
    );
    for (const issue of result.countIssues) console.error(`  - ${issue}`);
  }

  if (result.shardShapeIssues.length > 0) {
    console.error(
      '\nA ledger shard declares one entry type. A shard of its own typing decides what an\n' +
        'author can write in it — a string-typed one cannot hold a permanent entry at all,\n' +
        'so the rule above never runs over it (issue #217):',
    );
    for (const issue of result.shardShapeIssues) console.error(`  - ${issue}`);
  }

  reportMigrationLedger(
    result.undeclaredReferences,
    'undeclared-migration-table-reference',
    'migration-undeclared-references',
  );
  reportMigrationLedger(
    result.foreignWrites,
    'migration-writes-a-foreign-table',
    'migration-foreign-writes',
  );

  const migrationFailed =
    [result.undeclaredReferences, result.foreignWrites].some(
      (verdict) =>
        verdict.violations.length > 0 ||
        verdict.stale.length > 0 ||
        verdict.emptyShards.length > 0 ||
        verdict.orphanShards.length > 0 ||
        verdict.misfiledEntries.length > 0 ||
        verdict.permanentIssues.length > 0 ||
        verdict.countIssues.length > 0 ||
        verdict.shardShapeIssues.length > 0,
    );

  const failed =
    migrationFailed ||
    result.violations.length > 0 ||
    result.stale.length > 0 ||
    result.emptyShards.length > 0 ||
    result.orphanShards.length > 0 ||
    result.misfiledEntries.length > 0 ||
    result.permanentIssues.length > 0 ||
    result.countIssues.length > 0 ||
    result.shardShapeIssues.length > 0 ||
    exemptionIssues.length > 0;
  process.exit(failed ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
