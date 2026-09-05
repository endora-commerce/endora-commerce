import { describe, expect, it } from 'vitest';
import { BASELINE_MIGRATIONS } from '@endora-commerce/platform/migrations';
import { coreModuleDependencies } from '../../../src/db/configured-migrations.js';
import { BASELINE_THROUGH, type MigrationRegistryEntry } from '../../../src/db/migration-order.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import {
  compareOrders,
  forwardReferences,
  instanceEntries,
  instanceOrder,
  legacyBaselineOf,
  readMigrationSources,
  reconcileBaseline,
  refusals,
  repositoryOrder,
  stampOf,
  type MigrationSource,
} from '../../helpers/instance-migration-order.js';

/**
 * FR-019 — the migration order an instance computes is the order this
 * repository computes.
 *
 * Normative:
 * `specs/110-instance-repository/contracts/instance-migration-order.md`. §3 is
 * this file, assertion by assertion; the analysis is
 * `test/helpers/instance-migration-order.ts`, so every fixture below enters at
 * the top of it — a registry and a manifest graph — and never as a pre-computed
 * order (issue #130).
 *
 * ## What was wrong, and what this file was red on
 *
 * `isBaseline` decided membership of the frozen historical prefix as
 * `origin === 'core' && timestamp <= BASELINE_THROUGH`. Both conditions are
 * individually right. Their conjunction encodes *"came out of this
 * repository's build"* and was being used to mean *"is one of the migrations
 * whose order is history"* — two things that coincide exactly while every
 * module is compiled into the application and come apart completely the moment
 * a module is installed, because a package's entries are tagged
 * `origin: 'external'` deliberately.
 *
 * On `master@fdcef45ea`, with the real registry and the real manifest graph:
 * the prefix fell from **112** entries to **11**, **181 of 182** positions
 * moved, the first divergence was at index **1**, and six migrations — three of
 * them `core`'s — landed before the migration that creates a table they touch.
 * `Migration20260505T102206AssetsLibraryInit` moved from position 33 to 19,
 * ahead of the `cms` migration that creates the table it indexes, which is the
 * `relation "cms_pages" does not exist` this file's G3 measures.
 *
 * The repair is R1.1: the prefix is a **published, generated list of class
 * names** carried by `@endora-commerce/platform`, and membership is by
 * **identity**. G1 is what says it worked, and it needs no SQL, no owner map
 * and no database.
 *
 * ## Why the legacy predicate is still driven here
 *
 * Because after the repair `orderMigrations` reads no origin at all, so the two
 * regimes are one function over inputs that differ in a field nothing consults
 * — and a guard comparing that against itself proves nothing. The first
 * assertion in G1 therefore keeps the *unrepaired* predicate as an input
 * (`legacyBaselineOf`) and measures the divergence it produces, over the real
 * artefacts. That is what makes the second assertion mean something: the two
 * regimes are demonstrably distinguishable, and they agree because of the
 * repair rather than because nothing could tell them apart.
 */

const MODULE_DEPENDENCIES = coreModuleDependencies();
const SOURCES = await readMigrationSources();

const REAL = {
  entries: MIGRATION_REGISTRY,
  moduleDependencies: MODULE_DEPENDENCIES,
  baseline: BASELINE_MIGRATIONS,
} as const;

/** Builds a class whose `.name` is exactly the supplied migration name. */
function migrationClass(name: string): MigrationRegistryEntry['cls'] {
  const holder = { [name]: class {} };
  return holder[name] as unknown as MigrationRegistryEntry['cls'];
}

function entry(moduleId: string, name: string, origin?: 'core' | 'external'): MigrationRegistryEntry {
  return { moduleId, cls: migrationClass(name), ...(origin ? { origin } : {}) };
}

describe('instance migration order — the run refuses rather than reporting a vacuous pass', () => {
  it('has something to measure: a frozen prefix, a graph with edges, and every source read', () => {
    expect(
      refusals({ ...REAL, sources: SOURCES }),
      'this guard reported over a population one of whose halves is empty',
    ).toEqual([]);
  });

  it('refuses a registry with no entry at or below the watermark', () => {
    // Red proof for the fifth row of §3's table. An empty prefix makes G1 and
    // G2 vacuously true — the orders agree because neither has a baseline, and
    // the list reconciles against nothing.
    const late = [entry('orders', 'Migration20270101T090000OrdersInit')];
    const found = refusals({
      entries: late,
      moduleDependencies: new Map([['core', []], ['orders', ['catalog']], ['catalog', []]]),
      baseline: [],
      sources: [{ name: late[0]!.cls.name, moduleId: 'orders', file: 'x.ts', creates: [], references: [] }],
    });
    expect(found.join('\n')).toContain('at or below the watermark');
    expect(found.join('\n')).toContain('published baseline list is empty');
  });

  it('refuses a graph in which nothing declares anything', () => {
    const entries = [entry('orders', 'Migration20260701T090000OrdersInit')];
    const found = refusals({
      entries,
      moduleDependencies: new Map([['core', []], ['orders', []]]),
      baseline: [entries[0]!.cls.name],
      sources: [{ name: entries[0]!.cls.name, moduleId: 'orders', file: 'x.ts', creates: [], references: [] }],
    });
    expect(found.join('\n')).toContain('no module declares a dependency');
  });

  it('refuses a source walk that did not reach every registered migration', () => {
    const entries = [entry('orders', 'Migration20260701T090000OrdersInit')];
    const found = refusals({
      entries,
      moduleDependencies: new Map([['core', []], ['orders', ['catalog']], ['catalog', []]]),
      baseline: [entries[0]!.cls.name],
      sources: [],
    });
    expect(found.join('\n')).toContain('did not reach 1 registered migration');
  });
});

describe('G1 — the two regimes produce one order', () => {
  it('would differ under the unrepaired predicate — the defect, kept measurable', () => {
    // The input that makes the assertion below mean something: the same corpus,
    // ordered under `origin === 'core' && stamp <= watermark`, computed per
    // regime exactly as `isBaseline` computed it.
    const repositoryLegacy = legacyBaselineOf(MIGRATION_REGISTRY);
    const instanceLegacy = legacyBaselineOf(instanceEntries(MIGRATION_REGISTRY));

    expect(repositoryLegacy.length).toBe(BASELINE_MIGRATIONS.length);
    expect(
      instanceLegacy.length,
      'the instance regime no longer empties the frozen prefix — the defect this ' +
        'guard reproduces is gone, and with it the reason to trust the assertion below',
    ).toBeLessThan(repositoryLegacy.length / 2);

    const divergence = compareOrders(
      repositoryOrder({ ...REAL, baseline: repositoryLegacy }),
      instanceOrder({ ...REAL, baseline: instanceLegacy }),
    );
    expect(divergence.identical).toBe(false);
    expect(divergence.differingPositions).toBeGreaterThan(100);
  });

  it('orders an instance exactly as it orders this repository', () => {
    const repository = repositoryOrder(REAL);
    const instance = instanceOrder(REAL);
    const divergence = compareOrders(repository, instance);

    expect(
      divergence.identical,
      divergence.identical
        ? ''
        : `position ${divergence.firstIndex} holds "${divergence.first?.repository}" in this ` +
          `repository and "${divergence.first?.instance}" in an instance; ` +
          `${divergence.differingPositions} of ${repository.length} positions differ. The ` +
          'frozen historical prefix is entered by identity (R1.1) — a decision taken on ' +
          '`origin` is a decision that stops being true when a module is installed.',
    ).toBe(true);
    expect(instance).toEqual(repository);
    expect(repository.length).toBe(MIGRATION_REGISTRY.length);
  });

  it('emits the published list first, in the order the list holds it', () => {
    // R1.1's other half: the list is *ordered*, and the order is history's, so
    // the baseline block is emitted as the artefact holds it rather than as a
    // comparator recomputes it.
    expect(instanceOrder(REAL).slice(0, BASELINE_MIGRATIONS.length)).toEqual([
      ...BASELINE_MIGRATIONS,
    ]);
  });
});

describe('G2 — the published list and the registry reconcile, both ways (R1.7)', () => {
  it('names a migration for every entry the watermark covers, and nothing else', () => {
    const { unsupplied, unlisted } = reconcileBaseline(MIGRATION_REGISTRY, BASELINE_MIGRATIONS);
    expect(
      unsupplied,
      'the published baseline names a migration no registry entry supplies, so the frozen ' +
        'prefix an instance computes is shorter than history',
    ).toEqual([]);
    expect(
      unlisted,
      'a committed migration stamped at or below the watermark is not on the published list, ' +
        'so it joins the open block and the manifest graph reorders history',
    ).toEqual([]);
  });

  it('reports a name removed from the list', () => {
    const shortened = BASELINE_MIGRATIONS.slice(1);
    const { unlisted, unsupplied } = reconcileBaseline(MIGRATION_REGISTRY, shortened);
    expect(unlisted).toEqual([BASELINE_MIGRATIONS[0]]);
    expect(unsupplied).toEqual([]);
  });

  it('reports a name no entry supplies', () => {
    const invented = 'Migration20260424T165846CoreFoundationInitial';
    const { unsupplied, unlisted } = reconcileBaseline(MIGRATION_REGISTRY, [
      invented,
      ...BASELINE_MIGRATIONS,
    ]);
    expect(unsupplied).toEqual([invented]);
    expect(unlisted).toEqual([]);
  });

  it('holds only names stamped at or below the watermark', () => {
    expect(BASELINE_MIGRATIONS.filter((name) => stampOf(name) > BASELINE_THROUGH)).toEqual([]);
  });
});

describe('G3 — no forward table reference under the instance regime', () => {
  it('creates every table before the migration that names it', () => {
    const order = instanceOrder(REAL);
    const found = forwardReferences(order, SOURCES);
    expect(
      found.map(
        (reference) =>
          `${reference.moduleId}:${reference.migration} names ${reference.creatorModuleId}.` +
          `${reference.table}, created at ${reference.creatorAt} and named at ${reference.at}`,
      ),
      'a fresh database applying this order fails with `relation "…" does not exist`',
    ).toEqual([]);
  });

  it('reports a migration that indexes a table a later one creates', () => {
    // The shape the six had, as a fixture: `library` indexes a table `pages`
    // creates, and the graph puts `library` first because `pages` declares it.
    const sources: MigrationSource[] = [
      {
        name: 'Migration20260101T000000LibraryInit',
        moduleId: 'library',
        file: 'library.ts',
        creates: ['library_assets'],
        references: ['pages_documents'],
      },
      {
        name: 'Migration20260102T000000PagesInit',
        moduleId: 'pages',
        file: 'pages.ts',
        creates: ['pages_documents'],
        references: [],
      },
    ];
    const found = forwardReferences(
      ['Migration20260101T000000LibraryInit', 'Migration20260102T000000PagesInit'],
      sources,
    );
    expect(found).toEqual([
      {
        migration: 'Migration20260101T000000LibraryInit',
        moduleId: 'library',
        table: 'pages_documents',
        creator: 'Migration20260102T000000PagesInit',
        creatorModuleId: 'pages',
        at: 0,
        creatorAt: 1,
      },
    ]);
  });

  it('says nothing about the same pair in the order that works', () => {
    const sources: MigrationSource[] = [
      {
        name: 'Migration20260101T000000LibraryInit',
        moduleId: 'library',
        file: 'library.ts',
        creates: ['library_assets'],
        references: ['pages_documents'],
      },
      {
        name: 'Migration20260102T000000PagesInit',
        moduleId: 'pages',
        file: 'pages.ts',
        creates: ['pages_documents'],
        references: [],
      },
    ];
    expect(
      forwardReferences(
        ['Migration20260102T000000PagesInit', 'Migration20260101T000000LibraryInit'],
        sources,
      ),
    ).toEqual([]);
  });
});
