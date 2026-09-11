/**
 * The two regimes a migration order is computed under, and the sweep that says
 * whether either one is applicable.
 *
 * `specs/110-instance-repository/contracts/instance-migration-order.md` §3 is
 * normative. The analysis lives here rather than in the guard so that every
 * assertion in `test/unit/db/instance-migration-order.test.ts` enters at the
 * **top** of it — a registry and a manifest graph — and never at a pre-computed
 * order (issue #130). The same functions are driven over the real committed
 * artefacts and over synthetic fixtures, which is what makes the red proofs
 * proofs of anything.
 *
 * ## The two regimes
 *
 * They are the same corpus arriving two ways. In **this repository** every
 * migration is an entry in the committed core registry, contributed by the
 * build. In an **instance** the twelve `core` migrations arrive that way and
 * every module's arrive from an installed package, through
 * `discoverPackageSchema` → `configuredMigrationsFrom`, tagged
 * `origin: 'external'` (`packages/package-runtime.ts`, deliberately). The
 * manifest graph is the same either way: an instance generates its own manifest
 * index over the packages it installed, so `dependencies` is what each module's
 * own manifest says in both regimes.
 *
 * So the difference between the two is exactly one field and one arrival path,
 * and **an ordering that reads that field produces two different orders for one
 * corpus**. That was the state of the tree when this file was written: 181 of
 * 182 positions differed and six migrations landed before the migration that
 * creates a table they touch.
 *
 * ## What each export is for
 *
 * {@link legacyBaselineOf} reproduces the *unrepaired* membership predicate —
 * `origin === 'core' && stamp <= BASELINE_THROUGH` — as a baseline name list,
 * so the defect stays measurable after the repair rather than becoming a
 * sentence in a doc block. It is the input that makes the two regimes
 * *distinguishable*: without it the guard would compare a function against
 * itself over inputs differing in a field nothing reads, which proves nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuredMigrationsFrom } from '../../src/db/configured-migrations.js';
import { BASELINE_THROUGH, type MigrationRegistryEntry } from '@endora-commerce/platform/db';
import type { PackageSchemaContribution } from '../../src/packages/package-runtime.js';
import { resolveModuleLayout } from '../../scripts/lib/module-roots.js';
import { coreMigrationDirs } from './fk-graph.js';
import { sqlTableAccesses } from '../../scripts/lib/sql-tables.js';

/** The cross-cutting pseudo-module owning the platform's own `migrations/`. */
const CORE_MODULE_ID = 'core';

/** Everything an order is computed from, with nothing memoised and nothing global. */
export interface OrderingInputs {
  readonly entries: readonly MigrationRegistryEntry[];
  readonly moduleDependencies: ReadonlyMap<string, readonly string[]>;
  /** The frozen historical prefix, by identity — normally the published list. */
  readonly baseline: readonly string[];
}

/** `Migration20260424T165847CoreFoundationInit` → `20260424T165847`. */
export function stampOf(name: string): string {
  return name.slice('Migration'.length, 'Migration'.length + 15);
}

/**
 * The membership predicate as it stood before this feature, rendered as a
 * baseline name list.
 *
 * Both of its conditions are individually right and their conjunction encodes
 * *"came out of this repository's build"* while being used to mean *"is one of
 * the migrations whose order is history"*. Applied to the repository's entry
 * set it yields 112 names; applied to an instance's — the same corpus, module
 * entries tagged `external` — it yields 11.
 */
export function legacyBaselineOf(
  entries: readonly MigrationRegistryEntry[],
  baselineThrough: string = BASELINE_THROUGH,
): string[] {
  return entries
    .filter(
      (entry) =>
        (entry.origin ?? CORE_MODULE_ID) === CORE_MODULE_ID &&
        stampOf(entry.cls.name) <= baselineThrough,
    )
    .map((entry) => entry.cls.name)
    .sort();
}

/** The order this repository composes: every entry in the committed registry. */
export function repositoryOrder(inputs: OrderingInputs): readonly string[] {
  return configuredMigrationsFrom({
    coreEntries: inputs.entries,
    coreModuleDependencies: inputs.moduleDependencies,
    packages: [],
    baseline: inputs.baseline,
  }).names;
}

/**
 * The same corpus as an instance receives it: `core` from the committed
 * registry, every module from an installed package.
 *
 * It goes through `configuredMigrationsFrom` rather than re-tagging entries in
 * place, because that function *is* the merge an instance performs and the
 * arrival path is half of what the two regimes differ in.
 */
export function instanceOrder(inputs: OrderingInputs): readonly string[] {
  return configuredMigrationsFrom({
    coreEntries: inputs.entries.filter((entry) => entry.moduleId === CORE_MODULE_ID),
    coreModuleDependencies: inputs.moduleDependencies,
    packages: instanceContributions(inputs.entries, inputs.moduleDependencies),
    baseline: inputs.baseline,
  }).names;
}

/** One installed package per module owning a migration, as discovery would report it. */
export function instanceContributions(
  entries: readonly MigrationRegistryEntry[],
  /**
   * The manifest graph, so each contribution carries the `dependencies` its own
   * published manifest declares (`specs/110-instance-repository/` T141).
   *
   * Optional, and the default is the state this helper modelled before that
   * field existed: `configuredMigrationsFrom` fell back to `[]` for any id the
   * host's committed index did not carry, which in an instance is every module.
   * Passing the graph is what makes a contribution here look like one discovery
   * really produces.
   */
  moduleDependencies?: ReadonlyMap<string, readonly string[]>,
): readonly PackageSchemaContribution[] {
  const byModule = new Map<string, MigrationRegistryEntry[]>();
  for (const entry of entries) {
    if (entry.moduleId === CORE_MODULE_ID) continue;
    const owned = byModule.get(entry.moduleId);
    // `origin: 'external'` is not decoration: it is what `readPackageMigrations`
    // tags every entry it reads out of a package's `./migrations` export with.
    const tagged: MigrationRegistryEntry = { ...entry, origin: 'external' };
    if (owned) owned.push(tagged);
    else byModule.set(entry.moduleId, [tagged]);
  }
  return [...byModule.entries()]
    .map(([id, migrations]) => ({
      id,
      // Cosmetic: `PackageSchemaContribution` documents this field as "for
      // humans, and for the template digest's path", and no digest is taken
      // here. Nothing in the ordering reads it.
      packageName: `@endora-commerce/mod-${id}`,
      version: '0.7.0',
      migrationsDirectory: null,
      migrations,
      entities: [],
      dependencies: moduleDependencies?.get(id) ?? [],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** The merged entry set an instance's order is computed over. */
export function instanceEntries(
  entries: readonly MigrationRegistryEntry[],
): readonly MigrationRegistryEntry[] {
  return [
    ...entries.filter((entry) => entry.moduleId === CORE_MODULE_ID),
    ...instanceContributions(entries).flatMap((contribution) => contribution.migrations),
  ];
}

export interface OrderDivergence {
  readonly identical: boolean;
  /** The first position the two orders disagree on, or `-1`. */
  readonly firstIndex: number;
  readonly differingPositions: number;
  /** What each order holds at {@link OrderDivergence.firstIndex}. */
  readonly first: { readonly repository: string; readonly instance: string } | null;
}

/** Position by position, because "the arrays differ" is not a finding anyone can act on. */
export function compareOrders(
  repository: readonly string[],
  instance: readonly string[],
): OrderDivergence {
  const length = Math.max(repository.length, instance.length);
  let firstIndex = -1;
  let differingPositions = 0;
  for (let index = 0; index < length; index += 1) {
    if (repository[index] === instance[index]) continue;
    if (firstIndex === -1) firstIndex = index;
    differingPositions += 1;
  }
  return {
    identical: differingPositions === 0,
    firstIndex,
    differingPositions,
    first:
      firstIndex === -1
        ? null
        : {
            repository: repository[firstIndex] ?? '(nothing)',
            instance: instance[firstIndex] ?? '(nothing)',
          },
  };
}

/** One migration's source, as G3 reads it. */
export interface MigrationSource {
  readonly name: string;
  readonly moduleId: string;
  readonly file: string;
  /** Tables it creates — `create table "<t>"`. */
  readonly creates: readonly string[];
  /** Tables it names — `sqlTableAccesses` plus the `on "<t>"` sweep. */
  readonly references: readonly string[];
}

const CLASS_DECLARATION = /export class (Migration\w+)/;
const CREATE_TABLE = /create table (?:if not exists )?"([a-z0-9_]+)"/gi;
/**
 * `create index … on "<t>"`, `alter table … ` — the second recogniser, and the
 * one that finds the reference this feature was opened by. `sqlTableAccesses`
 * reads statements and knex builders; a DDL statement is neither, so an index
 * created on another module's table names no table it can see.
 */
const ON_TABLE = /\bon "([a-z0-9_]+)"/gi;

/**
 * Every migration source in the checkout, keyed by the class name the registry
 * registers.
 *
 * The module roots are the layout's (`scripts/lib/module-roots.ts`), so a module
 * that has become a package is found where it is and `packages/modules` is
 * spelled nowhere (D-100).
 */
export async function readMigrationSources(): Promise<readonly MigrationSource[]> {
  const layout = await resolveModuleLayout();
  const directories: Array<{ directory: string; moduleId: string }> = coreMigrationDirs(
    layout.srcRoot,
  )
    .filter((directory) => existsSync(directory))
    .map((directory) => ({ directory, moduleId: CORE_MODULE_ID }));
  for (const moduleId of layout.registeredIds) {
    const root = layout.moduleDirectoryOf(moduleId);
    if (root === null) continue;
    for (const candidate of [join(root, 'src', 'migrations'), join(root, 'migrations')]) {
      if (existsSync(candidate)) directories.push({ directory: candidate, moduleId });
    }
  }

  const found: MigrationSource[] = [];
  for (const { directory, moduleId } of directories) {
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.ts')) continue;
      const file = join(directory, name);
      const source = readFileSync(file, 'utf8');
      const declaration = CLASS_DECLARATION.exec(source);
      // A migrations directory also holds its barrel and, in one module, a
      // shared mapping table. Neither declares a migration class, and neither
      // is registered; a file that declares none is not one.
      if (declaration === null) continue;
      const creates = [...source.matchAll(CREATE_TABLE)].map((match) => match[1]!);
      const references = new Set<string>([...source.matchAll(ON_TABLE)].map((match) => match[1]!));
      for (const access of sqlTableAccesses(source, file)) references.add(access.table);
      found.push({
        name: declaration[1]!,
        moduleId,
        file,
        creates,
        references: [...references].sort(),
      });
    }
  }
  return found;
}

export interface ForwardReference {
  readonly migration: string;
  readonly moduleId: string;
  readonly table: string;
  /** The migration that creates the table, and the module that owns it. */
  readonly creator: string;
  readonly creatorModuleId: string;
  readonly at: number;
  readonly creatorAt: number;
}

/**
 * Every table a migration names whose creating migration lands **later** in the
 * order — the shape a fresh database refuses with `relation "…" does not exist`.
 *
 * The bound is declared rather than discovered: an owner is read from a
 * `create table "<t>"` literal and a reference from `sqlTableAccesses` plus the
 * `on "<t>"` sweep, so a reference written in a shape neither recognises is
 * invisible here. That is tolerable because it is the *second* assertion: G1
 * needs no SQL at all and catches an ordering that is wrong only in an
 * instance, which is this feature's whole subject. This one catches a migration
 * that is wrong in both regimes at once — a defect nobody has written yet.
 */
export function forwardReferences(
  order: readonly string[],
  sources: readonly MigrationSource[],
): readonly ForwardReference[] {
  const positionOf = new Map(order.map((name, index) => [name, index] as const));
  const byName = new Map(sources.map((source) => [source.name, source] as const));
  const creatorOf = new Map<string, string>();
  for (const source of sources) {
    const at = positionOf.get(source.name);
    if (at === undefined) continue;
    for (const table of source.creates) {
      const held = creatorOf.get(table);
      // The *first* creator in this order owns the table: a later `create table`
      // of the same name is a re-creation, and a reference between the two is
      // satisfied by the first.
      if (held === undefined || at < (positionOf.get(held) ?? Number.MAX_SAFE_INTEGER)) {
        creatorOf.set(table, source.name);
      }
    }
  }

  const found: ForwardReference[] = [];
  for (const [name, at] of positionOf) {
    const source = byName.get(name);
    if (source === undefined) continue;
    const own = new Set(source.creates);
    for (const table of source.references) {
      if (own.has(table)) continue;
      const creator = creatorOf.get(table);
      if (creator === undefined) continue;
      const creatorAt = positionOf.get(creator)!;
      if (creatorAt <= at) continue;
      found.push({
        migration: name,
        moduleId: source.moduleId,
        table,
        creator,
        creatorModuleId: byName.get(creator)?.moduleId ?? '(unknown)',
        at,
        creatorAt,
      });
    }
  }
  return found;
}

/** R1.7's two directions, reported apart because their remedies are opposite. */
export interface BaselineReconciliation {
  /** In the published list, supplied by no registry entry. */
  readonly unsupplied: readonly string[];
  /** Supplied at or below the watermark by the committed registry, and not listed. */
  readonly unlisted: readonly string[];
}

/**
 * The published baseline list against the registry that has to supply it
 * (R1.7).
 *
 * A published baseline naming a migration nobody ships would silently produce a
 * prefix **shorter** than history; a shipped migration below the watermark the
 * list does not name would silently join the **open** block, where the manifest
 * graph would reorder it. Both are the same defect from opposite sides.
 *
 * It is asked of the **committed core registry**, never of a running platform:
 * an instance installs a subset of the modules, so most of the 112 names are
 * legitimately supplied by nobody there. That is why R1.7 is a guard over this
 * repository's artefacts and not a throw in `orderMigrations`, which would
 * refuse every instance that installs fewer modules than we ship.
 */
export function reconcileBaseline(
  entries: readonly MigrationRegistryEntry[],
  baseline: readonly string[],
  baselineThrough: string = BASELINE_THROUGH,
): BaselineReconciliation {
  const listed = new Set(baseline);
  const supplied = new Set(entries.map((entry) => entry.cls.name));
  return {
    unsupplied: baseline.filter((name) => !supplied.has(name)),
    unlisted: entries
      .filter(
        (entry) =>
          (entry.origin ?? CORE_MODULE_ID) === CORE_MODULE_ID &&
          stampOf(entry.cls.name) <= baselineThrough &&
          !listed.has(entry.cls.name),
      )
      .map((entry) => entry.cls.name)
      .sort(),
  };
}

/**
 * Why this measurement must not be reported at all — the exit-2 half.
 *
 * Every assertion in the guard is over a population, and each of these states
 * makes one of them *vacuously* true: an empty frozen prefix makes G1 and G2
 * agree over nothing, a graph with no edge makes the topological order
 * arbitrary and therefore trivially reproducible, and a source walk that found
 * no migration makes G3 report a clean sweep of nothing. A green must not be
 * able to mean "not looking".
 */
export function refusals(input: {
  readonly entries: readonly MigrationRegistryEntry[];
  readonly moduleDependencies: ReadonlyMap<string, readonly string[]>;
  readonly baseline: readonly string[];
  readonly sources: readonly MigrationSource[];
  readonly baselineThrough?: string;
}): readonly string[] {
  const watermark = input.baselineThrough ?? BASELINE_THROUGH;
  const found: string[] = [];
  if (input.entries.length === 0) {
    found.push('the migration registry contributed no entry at all');
  }
  if (!input.entries.some((entry) => stampOf(entry.cls.name) <= watermark)) {
    found.push(
      `no registry entry is stamped at or below the watermark ${watermark}, so the frozen ` +
        'prefix is empty and both regimes agree over nothing',
    );
  }
  if (input.baseline.length === 0) {
    found.push(
      'the published baseline list is empty — every migration would join the open block, ' +
        'which is the state this guard exists to refuse rather than to report clean',
    );
  }
  if (![...input.moduleDependencies.values()].some((dependencies) => dependencies.length > 0)) {
    found.push(
      'no module declares a dependency, so the topological order is arbitrary and any two ' +
        'computations of it agree for a reason that says nothing about the ordering rule',
    );
  }
  const registered = new Set(input.entries.map((entry) => entry.cls.name));
  const read = new Set(input.sources.map((source) => source.name));
  const unread = [...registered].filter((name) => !read.has(name));
  if (input.sources.length === 0 || unread.length > 0) {
    found.push(
      `the migration source walk read ${input.sources.length} file(s) and did not reach ` +
        `${unread.length} registered migration(s)` +
        (unread.length === 0 ? '' : ` (${unread.slice(0, 3).join(', ')}…)`) +
        ' — a forward-reference sweep over a corpus it cannot read is a clean sweep of nothing',
    );
  }
  return found;
}
