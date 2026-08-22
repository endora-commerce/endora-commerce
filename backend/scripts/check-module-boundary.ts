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
 * Bare specifiers are ignored: there is no `@endora-commerce/mod-*` package yet,
 * so a bare specifier cannot reach a module. F4 adds the second predicate — the
 * same limit `check-kernel-boundary.ts` states for itself, and for the same
 * reason (Principle IV).
 *
 * ## Out of scope, each for a stated reason
 *
 *   - `src/composition.ts` and the generated registries — a composition root
 *     naming modules is a root doing its job. Out **by construction**, since the
 *     walk is over module directories, not by exemption.
 *   - `src/kernel`, `src/http`, `src/events`, `src/tenancy`, `src/commands`,
 *     `src/db`, `src/overlay` — not modules. The reverse direction is
 *     `check-kernel-boundary.ts` rules B and C.
 *   - `src/apps/<deployment>/decorations/**` — a decoration names the core
 *     service interface it wraps; that is its contract with `tsc` (features
 *     057/072).
 *   - `backend/test/**` — reporting only, under `--tests`. A test is allowed to
 *     know more than the code it tests, and after F4 a test importing another
 *     module's entity is a `devDependency` edge.
 *   - **`migrations/`, for the `sql` predicate** — a migration naming another
 *     module's table is the dependency-corrected execution order's problem, and
 *     `test/unit/db/fk-dependency-drift.test.ts` already owns it.
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
 * table→owner map in which **either** in-tree pass resolved zero tables, or an
 * installed package whose declarations could not be enumerated. Each pass proves
 * it looked, and a silently empty migration pass is precisely the entity-only
 * blindness the second source exists to remove (issue #113).
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname as posixDirname, join as posixJoin, normalize as posixNormalize } from 'node:path/posix';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { moduleOf } from './check-container-imports.js';
import { namedSpecifiers, type SpecifierKind } from './lib/specifiers.js';
import {
  declaredTableNames,
  sqlTableAccesses,
  type SqlAccessDirection,
  type SqlAccessSyntax,
} from './lib/sql-tables.js';
import { pluralize } from '../src/db/pluralizing-naming-strategy.js';
import {
  loadRegisteredModuleIds,
  modulePopulationCoverage,
  vacuousModulePopulation,
} from './lib/module-population.js';
import {
  loadPackageDeclarations,
  packageCoverage,
  refuseUnreadablePackages,
  type PackageTable,
} from './lib/package-declarations.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');
const TEST_ROOT = join(BACKEND_ROOT, 'test');
const LEDGER_ROOT = join(BACKEND_ROOT, 'scripts', 'ledgers', 'cross-module-imports');

/**
 * Module files a generator owns, and the script that emits each.
 *
 * Checked **two ways** by {@link generatedExemptionIssues}: an entry naming a
 * file that does not exist fails, and a file whose named generator does not
 * exist fails. An exemption nobody can go stale on is an exemption that outlives
 * its reason.
 */
export const GENERATED_MODULE_FILES: Readonly<Record<string, string>> = {
  'modules/_lifecycle/manifest-index.generated.ts': 'scripts/generate-composer.ts',
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
}

export interface CheckResult {
  readonly total: number;
  /** Cross-module reaches no shard accounts for. */
  readonly violations: readonly ModuleBoundaryFinding[];
  readonly ledgered: readonly ModuleBoundaryFinding[];
  /** Ledger keys that describe no finding in this run. */
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
  /**
   * An entry whose recorded site count is not what the walk found, in either
   * direction, or which records a count that is not a positive integer
   * (issue #267).
   */
  readonly countIssues: readonly string[];
  /** A shard whose file declares an entry type of its own (issue #217). */
  readonly shardShapeIssues: readonly string[];
  /** What each pass of the table→owner map resolved, and what is left over. */
  readonly tableOwners: TableOwnerReport;
}

/** Where a module lives and what it is called: `{ id: 'orders', dir: 'modules/orders' }`. */
interface ModuleLocation {
  readonly id: string;
  readonly dir: string;
}

/**
 * The module a path under `src/` belongs to, with its directory.
 *
 * `moduleOf` is shared with `check-container-imports.ts` so the two checks
 * cannot disagree about what a module is; the trailing slash is what lets it
 * answer for a specifier that resolves to the module directory itself
 * (`from '../catalog'`).
 */
function moduleLocationOf(pathUnderSrc: string): ModuleLocation | null {
  const id = moduleOf(`/src/${pathUnderSrc}/`);
  if (id === null) return null;
  const segments = pathUnderSrc.split('/');
  const modulesAt = segments.indexOf('modules');
  const index = segments.indexOf(id, modulesAt);
  if (index === -1) return null;
  return { id, dir: segments.slice(0, index + 1).join('/') };
}

/**
 * The specifier resolved against the importing file's directory, extension
 * dropped, or `null` for a bare specifier.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const joined = posixNormalize(posixJoin(posixDirname(fromFile), specifier));
  return joined.replace(/\.(js|ts)$/, '');
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
 * Every cross-module import `source` names.
 *
 * `file` is the path **under `src/`**, because that is what decides the owning
 * module, the target module and whether the file is scanned at all — which is
 * also why every red proof enters here, with source text and a path, rather than
 * with a resolved pair the check normally computes (issue #130).
 */
export function analyzeSource(source: string, file: string): CrossModuleImport[] {
  if (GENERATED_MODULE_FILES[file] !== undefined) return [];
  const owner = moduleLocationOf(file);
  if (owner === null) return [];

  const found: CrossModuleImport[] = [];
  for (const specifier of namedSpecifiers(source, file)) {
    const resolved = resolveSpecifier(file, specifier.text);
    if (resolved === null) continue;
    const target = moduleLocationOf(resolved);
    if (target === null) continue;
    if (target.dir === owner.dir) continue;
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

/** Every cross-module import in the input, in file then line order. */
export function findCrossModuleImports(input: ModuleBoundaryInput): CrossModuleImport[] {
  const found = [...input.sources].flatMap(([file, text]) => analyzeSource(text, file));
  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return found;
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

/** The declaring file's owner: a module, the kernel, or a core directory. */
function declaringOwnerOf(file: string): TableOwner | null {
  const module = moduleLocationOf(file);
  if (module !== null) return module;
  const head = file.split('/')[0] ?? '';
  if (head === 'kernel') return { id: 'kernel', dir: 'kernel' };
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
): {
  readonly owners: ReadonlyMap<string, TableOwner>;
  readonly report: TableOwnerReport;
} {
  const owners = new Map<string, TableOwner>();
  const fromEntity = new Set<string>();
  const fromMigration = new Set<string>();

  for (const [file, text] of schema) {
    const owner = declaringOwnerOf(file);
    if (owner === null) continue;
    for (const declaration of declaredTableNames(text, file)) {
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
): CrossModuleSqlAccess[] {
  if (GENERATED_MODULE_FILES[file] !== undefined) return [];
  // A migration naming another module's table is the execution order's problem,
  // and `fk-dependency-drift.test.ts` already owns it.
  if (file.includes('/migrations/')) return [];
  const owner = moduleLocationOf(file);
  if (owner === null) return [];

  const found: CrossModuleSqlAccess[] = [];
  for (const access of sqlTableAccesses(source, file)) {
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
} {
  if (input.schema === undefined) {
    return {
      found: [],
      report: {
        entityTables: 0,
        migrationTables: 0,
        packageTables: 0,
        migrationOnlyTables: 0,
        unattributed: [],
      },
    };
  }
  const { owners, report } = buildTableOwners(input.schema, input.packageTables ?? []);
  const found = [...input.sources].flatMap(([file, text]) => analyzeSqlSource(text, file, owners));
  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return { found, report };
}

/** The file half of a ledger key, or `null` when the key does not parse. */
function fileOfKey(key: string): string | null {
  const at = key.indexOf(':');
  if (at <= 0 || at === key.length - 1) return null;
  return key.slice(0, at);
}

/**
 * The two-way comparison, in both directions and over all five failure modes.
 *
 * The module set is derived from the sources rather than from a second walk, so
 * "this module exists" means exactly "this module has sources in the input the
 * check read" — an orphan shard cannot be created by two walks disagreeing.
 */
export function checkModuleBoundary(
  input: ModuleBoundaryInput,
  shards: readonly LedgerShard[],
): CheckResult {
  const sql = findCrossModuleSql(input);
  const all: ModuleBoundaryFinding[] = [...findCrossModuleImports(input), ...sql.found];
  all.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  const present = new Set(all.map(keyOf));
  // How many reaches each key actually covers, so an entry can be compared with
  // a number rather than with a boolean (issue #267).
  const found = new Map<string, number>();
  for (const finding of all) {
    const key = keyOf(finding);
    found.set(key, (found.get(key) ?? 0) + 1);
  }

  const modules = new Set<string>();
  for (const file of input.sources.keys()) {
    const owner = moduleLocationOf(file);
    if (owner !== null) modules.add(owner.id);
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
    if (!modules.has(shard.moduleId)) orphanShards.push(shard.moduleId);
    const shapeIssue = shardShapeIssue(shard.moduleId, shard.source);
    if (shapeIssue !== null) shardShapeIssues.push(shapeIssue);
    for (const key of keys) {
      const file = fileOfKey(key);
      const owner = file === null ? null : moduleLocationOf(file);
      // A shard accounts for its own module and nothing else, so it cannot be
      // used to make another module's violation disappear.
      if (owner === null || owner.id !== shard.moduleId) {
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
    total: all.length,
    violations: all.filter((entry) => !ledger.has(keyOf(entry))),
    ledgered: all.filter((entry) => ledger.has(keyOf(entry))),
    // A permanent entry goes stale exactly like a draining one: it describes an
    // import, and an import that is gone is an entry that lies.
    stale: [...ledger.keys()].filter((key) => !present.has(key)).sort(),
    emptyShards: emptyShards.sort(),
    orphanShards: orphanShards.sort(),
    misfiledEntries: misfiledEntries.sort(),
    permanentKeys: permanentKeys.sort(),
    permanentIssues: permanentIssues.sort(),
    countIssues: countIssues.sort(),
    shardShapeIssues: shardShapeIssues.sort(),
    tableOwners: sql.report,
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
  readonly ledgerDirectoryExists: boolean;
  /** Tables the `@Entity()` pass resolved. */
  readonly entityTables: number;
  /** Tables the `create table` pass resolved — see {@link TableOwnerReport}. */
  readonly migrationTables: number;
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
  return null;
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
 */
export function collectModuleFiles(srcRoot: string = SRC_ROOT): string[] {
  return [...walk(join(srcRoot, 'modules')), ...walk(join(srcRoot, 'apps'))];
}

/**
 * Every file the **owner map** is built from: the whole of `src/`.
 *
 * Wider than {@link collectModuleFiles} on purpose, and it is the difference the
 * `sql` predicate lives on — five of the tables it resolves are the kernel's
 * (`sales_channels` alone carries 25 findings) and 21 more are declared only by
 * DDL under `src/db/migrations`, which no module walk reaches.
 */
export function collectSchemaFiles(srcRoot: string = SRC_ROOT): string[] {
  return walk(srcRoot);
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Absolute paths → the source map the analysis reads, keyed under `src/`. */
export function sourcesOf(files: readonly string[], srcRoot: string = SRC_ROOT): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(srcRoot, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }
  return sources;
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
function testSites(): number {
  let total = 0;
  for (const file of walk(TEST_ROOT)) {
    const fromBackend = relative(BACKEND_ROOT, file).split('\\').join('/');
    for (const specifier of namedSpecifiers(readFileSync(file, 'utf8'), fromBackend)) {
      if (!specifier.text.startsWith('.')) continue;
      const resolved = posixNormalize(posixJoin(posixDirname(fromBackend), specifier.text));
      if (!resolved.startsWith('src/')) continue;
      if (moduleLocationOf(resolved.slice('src/'.length)) !== null) total += 1;
    }
  }
  return total;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const testMode = process.argv.includes('--tests');
  const moduleAt = process.argv.indexOf('--module');
  const only = moduleAt === -1 ? null : (process.argv[moduleAt + 1] ?? null);

  const files = collectModuleFiles();
  const sources = sourcesOf(files);
  const schema = sourcesOf(collectSchemaFiles());
  // The third owner-map source (T034). It is read before the vacuous guard so
  // that a package whose schema cannot be enumerated stops the run instead of
  // leaving its tables attributed to nobody — the silence that would let every
  // reach into one report clean.
  const packages = await loadPackageDeclarations();
  refuseUnreadablePackages('[module-boundary]', packages);
  const owners = buildTableOwners(schema, packages.tables).report;
  let registeredModules: readonly string[];
  try {
    registeredModules = await loadRegisteredModuleIds(SRC_ROOT);
  } catch (error: unknown) {
    console.error(
      `[module-boundary] the module index under ${SRC_ROOT} could not be read ` +
        `(${String(error)}) — the expected population is derived from it; ` +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
    return;
  }
  const vacuous = vacuousReason({
    moduleFiles: [...sources.keys()],
    registeredModules,
    ledgerDirectoryExists: existsSync(LEDGER_ROOT),
    entityTables: owners.entityTables,
    migrationTables: owners.migrationTables,
  });
  if (vacuous !== null) {
    console.error(`[module-boundary] ${vacuous}`);
    process.exit(2);
  }

  let shards: LedgerShard[];
  try {
    shards = await loadLedgerShards(LEDGER_ROOT);
  } catch (error) {
    console.error(`[module-boundary] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
    return;
  }

  const result = checkModuleBoundary({ sources, schema, packageTables: packages.tables }, shards);
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
    files: [...sources.keys()],
  });
  const installed = packageCoverage(packages);
  const coverages: ReadCoverage[] = installed === null ? [modules] : [modules, installed];
  reportReadSize({
    prefix: '[module-boundary]',
    files: sources.size + schema.size + packages.filesRead,
    coverage: coverages,
  });
  console.log(
    `[module-boundary] module files=${files.length} cross-module reaches=${result.total} ` +
      `(imports=${result.total - sqlFindings} sql=${sqlFindings}) ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${ledgerSize} (sites=${ledgerSites}) shards=${shards.length} ` +
      `stale=${result.stale.length} permanent=${result.permanentKeys.length}`,
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
      `[module-boundary] test sites=${testSites()} (backend/test/** — reporting only, ` +
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

  const failed =
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
