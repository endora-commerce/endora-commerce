import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_MIGRATIONS } from '@endora-commerce/platform/migrations';
import {
  BASELINE_THROUGH as REAL_BASELINE_THROUGH,
  historicalBaselineOrder,
  orderMigrations,
  type MigrationClass,
  type MigrationOrderError,
  type MigrationOrderResult,
  type MigrationRegistryEntry,
} from '../../../src/db/migration-order.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';

/**
 * Invariants J1-J14 of
 * specs/081-per-module-migration-order/contracts/ordering-algorithm.md §3,
 * replacing the feature-065 contract's I1-I10. I3 (inversion corrected) and I4
 * (minimality) went with the correction horizon: there is no correction any
 * more, so I4 has no successor by intent — minimality was a property of one.
 *
 * J1-J13 are pure: no database, synthetic entries only. J11, J12 and J14 add
 * the real registry and the real manifest graph — still no database, still no
 * ORM bootstrap.
 */

const BASELINE_THROUGH = '20260801T000000';

/** Builds a class whose `.name` is exactly the supplied migration name. */
function migrationClass(name: string): MigrationClass {
  const holder = { [name]: class {} };
  return holder[name] as unknown as MigrationClass;
}

function pascal(tail: string): string {
  return tail
    .split('_')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

/** `entry('orders', '20260901T090000', 'a')` → class Migration20260901T090000OrdersA. */
function entry(
  moduleId: string,
  stamp: string,
  slug: string,
  origin?: 'core' | 'external',
): MigrationRegistryEntry {
  const segment = moduleId.startsWith('_') ? moduleId.slice(1) : moduleId;
  return {
    moduleId,
    cls: migrationClass(`Migration${stamp}${pascal(`${segment}_${slug}`)}`),
    ...(origin ? { origin } : {}),
  };
}

function deps(map: Record<string, readonly string[]>): ReadonlyMap<string, readonly string[]> {
  return new Map(Object.entries(map));
}

function names(entries: readonly MigrationRegistryEntry[]): string[] {
  return entries.map((e) => e.cls.name);
}

/**
 * A fixture's own frozen prefix: every entry stamped at or below the watermark,
 * in the order the baseline block emits them.
 *
 * `historicalBaselineOrder` is the derivation `composer:generate` renders the
 * published list with, so these fixtures and the real artefact cannot come to
 * disagree about what "history" means. Membership itself is an **identity**
 * since `specs/110-instance-repository/` — J1's second case is what asserts
 * that — and this is how a synthetic corpus declares which of its names are
 * historical.
 */
function frozen(entries: readonly MigrationRegistryEntry[]): string[] {
  return historicalBaselineOrder(names(entries), BASELINE_THROUGH);
}

function result(
  entries: readonly MigrationRegistryEntry[],
  moduleDependencies: ReadonlyMap<string, readonly string[]>,
  baseline: readonly string[] = frozen(entries),
): MigrationOrderResult {
  return orderMigrations({ entries, moduleDependencies, baseline });
}

function run(
  entries: readonly MigrationRegistryEntry[],
  moduleDependencies: ReadonlyMap<string, readonly string[]>,
  baseline?: readonly string[],
): string[] {
  return result(entries, moduleDependencies, baseline ?? frozen(entries)).migrations.map(
    (m) => m.name,
  );
}

/** invoices → orders → catalog; catalog is a root. */
const CHAIN = deps({
  catalog: [],
  orders: ['catalog'],
  invoices: ['orders'],
  core: [],
});

/** Deterministic PRNG so a failing permutation is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

describe('migration-order module purity', () => {
  it('imports nothing but @mikro-orm/core types and the platform graph walk', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, '../../../src/db/migration-order.ts'), 'utf8');
    const imports = [...source.matchAll(/^import\s+(?:type\s+)?[\s\S]*?from\s+'([^']+)';$/gm)].map(
      (match) => match[1]!,
    );

    // The second import is the strongly-connected-components walk, and it is
    // not a loosening of this rule (feature 080, D-160.11). The property this
    // file has to keep is *purity* — no I/O, no clock, no environment, no module
    // — and the walk is a pure function over a `Map<string, string[]>`. What
    // changed is who owns it: the lifecycle orchestrator refuses an install
    // whose arrival closes a cycle, and it lives in
    // `@endora-commerce/platform`, which may not name a file this application
    // owns (D-52/D-53). One implementation is what makes the member list an
    // operator reads in a refused install the member list this order reports;
    // two would be free to disagree.
    expect(imports).toEqual(['@mikro-orm/core', '../lifecycle/services/dep-graph.js']);
    expect(source).not.toContain("from '../modules/");
    expect(source).not.toContain('mikro-orm.config');
  });

  it('carries no trace of the correction machinery feature 081 deleted', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, '../../../src/db/migration-order.ts'), 'utf8');

    for (const gone of [
      'correctionHorizonDays',
      'MS_PER_DAY',
      'UNCORRECTED_THROUGH',
      'unresolvable-order',
      'buildClosures',
      'assertAcyclic',
      // `specs/110-instance-repository/` R1.6: no ordering decision is taken on
      // `origin` any more, and `isBaseline` was the one that was. Its removal is
      // asserted here because the alternative — a second membership predicate
      // living beside the identity one — is how an instance would come to order
      // a corpus differently from the repository that shipped it.
      'isBaseline',
    ]) {
      expect(source, `${gone} is still in migration-order.ts`).not.toContain(gone);
    }
  });
});

describe('orderMigrations — J1 baseline prefix', () => {
  const oldOrders = entry('orders', '20260701T090000', 'legacy_a');
  const oldCatalog = entry('catalog', '20260702T090000', 'legacy_b');

  it('emits the baseline first, in timestamp order, whatever the open set is', () => {
    const prefix = [oldOrders.cls.name, oldCatalog.cls.name];

    // `orders` declares `catalog`, so the open block reorders the two modules.
    // The prefix must not notice.
    const withOpen = run(
      [
        entry('orders', '20260901T090000', 'open_a'),
        oldCatalog,
        entry('catalog', '20260905T090000', 'open_b'),
        oldOrders,
      ],
      CHAIN,
    );
    expect(withOpen.slice(0, 2)).toEqual(prefix);
    expect(run([oldCatalog, oldOrders], CHAIN)).toEqual(prefix);
  });

  it('splits on identity — a name the list does not hold is open, whatever its stamp', () => {
    // `specs/110-instance-repository/contracts/instance-migration-order.md` R1.1
    // and R1.2, and the inversion of what this case used to assert. The prefix
    // was a *position* — a stamp below the watermark and an origin of `core` —
    // and it emptied the moment those modules became installed packages,
    // because `origin` answers "did this come out of our build" and not "is this
    // one of the migrations whose order is history".
    //
    // So the frozen block is now a list of names, and a stamp is a claim an
    // arriving package can make: `oldCatalog` is stamped inside the watermark
    // and is emitted in the **open** block, after the module its owner depends
    // on, because history does not name it.
    const openCatalog = entry('catalog', '20260901T090000', 'open_a');
    const emitted = run([openCatalog, oldCatalog, oldOrders], CHAIN, [oldOrders.cls.name]);

    expect(emitted[0]).toBe(oldOrders.cls.name);
    expect(emitted.indexOf(oldCatalog.cls.name)).toBeGreaterThan(0);
    expect(emitted.indexOf(oldCatalog.cls.name)).toBeLessThan(
      emitted.indexOf(openCatalog.cls.name),
    );
  });

  it('emits the block in the list\'s order, not a comparator\'s', () => {
    // The list is ordered and that order is history's (R1.1). A comparator that
    // ever disagreed with it would make the published artefact a lie; emitting
    // the list's own order means there is nothing for one to disagree with.
    const reversed = [oldCatalog.cls.name, oldOrders.cls.name];
    expect(run([oldOrders, oldCatalog], CHAIN, reversed)).toEqual(reversed);
  });
});

describe('orderMigrations — J2 contiguity', () => {
  it("keeps a module's open migrations in consecutive positions", () => {
    const entries = [
      entry('catalog', '20260901T090000', 'a'),
      entry('orders', '20260902T090000', 'a'),
      entry('catalog', '20260903T090000', 'b'),
      entry('invoices', '20260904T090000', 'a'),
      entry('orders', '20260905T090000', 'b'),
      entry('catalog', '20260906T090000', 'c'),
    ];
    const emitted = run(entries, CHAIN);

    for (const module of ['Catalog', 'Orders', 'Invoices']) {
      const indices = emitted
        .map((name, index) => (name.includes(module) ? index : -1))
        .filter((index) => index >= 0);
      expect(indices.length, module).toBeGreaterThan(0);
      for (let i = 1; i < indices.length; i += 1) {
        expect(indices[i], `${module} block is not contiguous`).toBe(indices[i - 1]! + 1);
      }
    }
  });
});

describe('orderMigrations — J3 intra-module chronology', () => {
  it('emits a module’s own migrations in ascending timestamp order', () => {
    const a = entry('orders', '20260910T090000', 'a');
    const b = entry('orders', '20260912T090000', 'b');
    const c = entry('orders', '20260914T090000', 'c');
    const catalog = entry('catalog', '20260913T090000', 'x');

    const emitted = run([c, catalog, a, b], CHAIN);

    expect(emitted).toEqual([catalog.cls.name, a.cls.name, b.cls.name, c.cls.name]);
  });
});

describe('orderMigrations — J4 dependency order, with no horizon', () => {
  it('emits the dependency module first however far apart the stamps are', () => {
    const orders = entry('orders', '20260901T090000', 'placement');
    // 15 months later — the old 45-day horizon would have declined to correct.
    const catalog = entry('catalog', '20271201T090000', 'column');

    expect(run([orders, catalog], CHAIN)).toEqual([catalog.cls.name, orders.cls.name]);
  });

  it('honours a transitive dependency the same way', () => {
    const invoices = entry('invoices', '20260901T090000', 'a');
    const catalog = entry('catalog', '20280903T090000', 'b');

    expect(run([invoices, catalog], CHAIN)).toEqual([catalog.cls.name, invoices.cls.name]);
  });
});

describe('orderMigrations — J5 timestamps do not cross modules', () => {
  it('permuting the stamps of two unrelated modules changes no position', () => {
    const graph = deps({ catalog: [], orders: [], core: [] });
    const early = '20260901T090000';
    const late = '20260903T090000';

    const oneWay = run([entry('catalog', early, 'a'), entry('orders', late, 'b')], graph);
    const other = run([entry('catalog', late, 'a'), entry('orders', early, 'b')], graph);

    // `catalog` sorts before `orders`, and that — not the stamp — is the order.
    expect(oneWay.map((name) => name.replace(/\d{8}T\d{6}/, ''))).toEqual(
      other.map((name) => name.replace(/\d{8}T\d{6}/, '')),
    );
  });

  it('two modules may legally share a timestamp', () => {
    const graph = deps({ catalog: [], orders: [], core: [] });
    const shared = '20260901T090000';
    expect(() => run([entry('catalog', shared, 'a'), entry('orders', shared, 'b')], graph)).not.toThrow();
  });
});

describe('orderMigrations — J6 determinism under permutation', () => {
  it('produces identical output for 1000 shuffles of the same entries', () => {
    const entries = [
      entry('orders', '20260701T090000', 'legacy'),
      entry('catalog', '20260702T090000', 'legacy'),
      entry('core', '20260703T090000', 'legacy'),
      entry('orders', '20260901T090000', 'a'),
      entry('catalog', '20260903T090000', 'b'),
      entry('invoices', '20260902T090000', 'c'),
      entry('catalog', '20260905T090000', 'd'),
      entry('orders', '20260906T090000', 'e'),
      entry('invoices', '20261201T090000', 'f'),
    ];
    const expected = run(entries, CHAIN).join('\n');

    for (let seed = 1; seed <= 1000; seed += 1) {
      const permuted = shuffle(entries, mulberry32(seed));
      expect(run(permuted, CHAIN).join('\n'), `seed ${seed}`).toBe(expected);
    }
  });
});

describe('orderMigrations — J7 idempotence', () => {
  it('re-ordering the emitted order yields the same order', () => {
    const entries = [
      entry('orders', '20260901T090000', 'a'),
      entry('catalog', '20260903T090000', 'b'),
      entry('invoices', '20260902T090000', 'c'),
      entry('catalog', '20260905T090000', 'd'),
    ];
    const first = run(entries, CHAIN);
    const byName = new Map(entries.map((e) => [e.cls.name, e]));
    const reordered = first.map((name) => byName.get(name)!);

    expect(run(reordered, CHAIN)).toEqual(first);
  });
});

/**
 * J8, J9 and J10 are the three shapes of the cycle answer, one test each: a
 * rule with one proof for three behaviours can go blind in two of them.
 */
const CYCLIC = deps({ a: ['b'], b: ['a'], catalog: [], core: [] });

describe('orderMigrations — J8 a cycle is total', () => {
  it('emits every input exactly once and throws nothing', () => {
    const entries = [
      entry('a', '20260903T090000', 'x'),
      entry('b', '20260902T090000', 'y'),
      entry('catalog', '20260901T090000', 'z'),
    ];

    let emitted: string[] = [];
    expect(() => {
      emitted = run(entries, CYCLIC);
    }).not.toThrow();

    expect([...emitted].sort()).toEqual([...names(entries)].sort());
    expect(new Set(emitted).size).toBe(entries.length);
  });

  it('reports a cycle even when no migration belongs to it', () => {
    const emitted = result([entry('catalog', '20260901T090000', 'x')], CYCLIC);
    expect(emitted.migrations).toHaveLength(1);
    expect(emitted.diagnostics).toHaveLength(1);
  });
});

describe('orderMigrations — J9 a cycle is reported', () => {
  it('returns exactly one module-cycle diagnostic naming both members', () => {
    const { diagnostics } = result([entry('a', '20260903T090000', 'x')], CYCLIC);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.kind).toBe('module-cycle');
    expect(diagnostics[0]!.modules).toEqual(['a', 'b']);
    expect(diagnostics[0]!.message).toContain('a, b');
    expect(diagnostics[0]!.message).toContain('dependencies');
  });

  it('names every member of a three-module cycle', () => {
    const three = deps({ a: ['b'], b: ['c'], c: ['a'], core: [] });
    const { diagnostics } = result([entry('a', '20260903T090000', 'x')], three);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.modules).toEqual(['a', 'b', 'c']);
  });

  it('reports nothing for an acyclic graph', () => {
    // The control: without it the assertions above would pass over a function
    // that reports a cycle for every graph.
    expect(result([entry('orders', '20260903T090000', 'x')], CHAIN).diagnostics).toEqual([]);
  });
});

describe('orderMigrations — J10 a cycle is contiguous and chronological', () => {
  it('emits the component as one block, in timestamp order across it', () => {
    const entries = [
      entry('a', '20260904T090000', 'second'),
      entry('b', '20260903T090000', 'first'),
      entry('a', '20260905T090000', 'third'),
      entry('catalog', '20260901T090000', 'unrelated'),
    ];
    const emitted = run(entries, CYCLIC);

    const block = emitted.filter((name) => !name.includes('Catalog'));
    expect(block).toEqual([
      'Migration20260903T090000BFirst',
      'Migration20260904T090000ASecond',
      'Migration20260905T090000AThird',
    ]);
    const start = emitted.indexOf(block[0]!);
    expect(emitted.slice(start, start + block.length)).toEqual(block);
  });
});

describe('orderMigrations — J13 input errors', () => {
  it('throws unparsable-name for a class that is not timestamp-prefixed', () => {
    const bad: MigrationRegistryEntry = {
      moduleId: 'orders',
      cls: migrationClass('Migration042LegacyStyle'),
    };
    expect(() => run([bad], CHAIN)).toThrow(
      expect.objectContaining({ code: 'unparsable-name' }) as Error,
    );
  });

  it('throws unparsable-name for a stamp that is not a real UTC instant', () => {
    const bad: MigrationRegistryEntry = {
      moduleId: 'orders',
      cls: migrationClass('Migration20261301T090000OrdersA'),
    };
    let thrown: unknown;
    try {
      run([bad], CHAIN);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as MigrationOrderError).code).toBe('unparsable-name');
    expect((thrown as MigrationOrderError).message).toContain('Migration20261301T090000OrdersA');
  });

  it('throws duplicate-name naming both owning modules', () => {
    const a = entry('orders', '20260901T090000', 'a');
    const clone: MigrationRegistryEntry = { moduleId: 'orders', cls: a.cls };
    let thrown: unknown;
    try {
      run([a, clone], CHAIN);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as MigrationOrderError).code).toBe('duplicate-name');
    expect((thrown as MigrationOrderError).message).toContain(a.cls.name);
  });

  it('throws duplicate-timestamp within one module, naming both classes', () => {
    const a = entry('orders', '20260901T090000', 'a');
    const b = entry('orders', '20260901T090000', 'b');
    let thrown: unknown;
    try {
      run([a, b], CHAIN);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as MigrationOrderError).code).toBe('duplicate-timestamp');
    expect((thrown as MigrationOrderError).message).toContain(a.cls.name);
    expect((thrown as MigrationOrderError).message).toContain(b.cls.name);
    expect((thrown as MigrationOrderError).message).toContain('orders');
  });

  it('does not throw duplicate-timestamp across two modules', () => {
    // The half that changed: two third-party authors cannot coordinate stamps,
    // and after J5 a stamp orders nothing outside its own module.
    const a = entry('orders', '20260901T090000', 'a');
    const b = entry('catalog', '20260901T090000', 'b');
    expect(() => run([a, b], CHAIN)).not.toThrow();
  });

  it('throws unscoped-name naming the module and the expected prefix', () => {
    const bad: MigrationRegistryEntry = {
      moduleId: 'orders',
      cls: migrationClass('Migration20260901T090000CatalogSomething'),
    };
    let thrown: unknown;
    try {
      run([bad], CHAIN);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as MigrationOrderError).code).toBe('unscoped-name');
    expect((thrown as MigrationOrderError).message).toContain('orders');
    expect((thrown as MigrationOrderError).message).toContain('Migration20260901T090000Orders');
  });

  it('accepts an underscore-prefixed module id by its segment', () => {
    const graph = deps({ _i18n: [], core: [] });
    const ok: MigrationRegistryEntry = {
      moduleId: '_i18n',
      cls: migrationClass('Migration20260901T090000I18nInit'),
    };
    expect(run([ok], graph)).toEqual([ok.cls.name]);
  });

  it('throws unknown-module naming the module and the remediation command', () => {
    const ghost = entry('ghost_module', '20260901T090000', 'a');
    let thrown: unknown;
    try {
      run([ghost], CHAIN);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as MigrationOrderError).code).toBe('unknown-module');
    expect((thrown as MigrationOrderError).message).toContain('ghost_module');
    expect((thrown as MigrationOrderError).message).toContain('manifest-index:generate');
  });

  it("accepts the 'core' pseudo-module even when it is absent from the graph", () => {
    const graph = deps({ catalog: [] });
    const core = entry('core', '20260901T090000', 'foundation');
    expect(run([core], graph)).toEqual([core.cls.name]);
  });
});

/**
 * The real module dependency graph, assembled exactly as
 * src/db/mikro-orm.config.ts assembles it (contracts/ordering-algorithm.md §2).
 */
const REAL_MODULE_DEPENDENCIES: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  ['core', []],
  ...DISCOVERED_MANIFESTS.map(
    (manifestEntry) => [manifestEntry.id, manifestEntry.manifest.dependencies ?? []] as const,
  ),
]);

function runReal(entries: readonly MigrationRegistryEntry[]): MigrationOrderResult {
  return orderMigrations({
    entries,
    moduleDependencies: REAL_MODULE_DEPENDENCIES,
    baseline: BASELINE_MIGRATIONS,
  });
}

/** The registry's baseline entries, in the order the prefix must emit them. */
function realBaselinePrefix(): string[] {
  return MIGRATION_REGISTRY.map((registryEntry) => registryEntry.cls.name)
    .filter(
      (name) => name.slice('Migration'.length, 'Migration'.length + 15) <= REAL_BASELINE_THROUGH,
    )
    .sort();
}

describe('orderMigrations — J11 a back-dated arrival', () => {
  // The measured defect of the 065-era rule: with the baseline split on the
  // stamp alone, this entry was emitted at index 0 — before the platform's own
  // foundation migration — because its author picked a stamp from 2025.
  //
  // It was closed by adding `origin === 'core'`, and **that** repair is retired:
  // an origin answers "did this come out of our build", which is not the
  // question "is this one of the migrations whose order is history", and using
  // it as one emptied the frozen prefix for every instance that installs its
  // modules (`specs/110-instance-repository/`, R1.1). The property survives, and
  // the last case below is what says it is now stronger rather than merely
  // different.
  const backDated = entry('acme_gateway', '20250101T000000', 'init', 'external');
  const graph = new Map(REAL_MODULE_DEPENDENCIES).set('acme_gateway', ['orders']);

  function withPackage(): string[] {
    return orderMigrations({
      entries: [...MIGRATION_REGISTRY, backDated],
      moduleDependencies: graph,
      baseline: BASELINE_MIGRATIONS,
    }).migrations.map((m) => m.name);
  }

  it('puts an external entry stamped below the watermark in the open block', () => {
    const emitted = withPackage();
    expect(emitted.indexOf(backDated.cls.name)).toBeGreaterThanOrEqual(realBaselinePrefix().length);
  });

  it("emits it after core's foundation migration, not before it", () => {
    const emitted = withPackage();
    expect(emitted.indexOf('Migration20260424T165847CoreFoundationInit')).toBeLessThan(
      emitted.indexOf(backDated.cls.name),
    );
  });

  it('emits it after every migration of the module it declares', () => {
    const emitted = withPackage();
    const ordersLast = Math.max(
      ...MIGRATION_REGISTRY.filter((e) => e.moduleId === 'orders').map((e) =>
        emitted.indexOf(e.cls.name),
      ),
    );
    expect(ordersLast).toBeGreaterThan(-1);
    expect(ordersLast).toBeLessThan(emitted.indexOf(backDated.cls.name));
  });

  it('keeps it out of the baseline even when it claims to be core', () => {
    // The control that makes the three assertions above mean something, and the
    // one place the identity rule is measurably *stronger* than the origin rule
    // it replaced. Under `origin === 'core' && stamp <= watermark` this entry
    // was emitted at index 0, ahead of the platform's own foundation migration:
    // the conjunction rested on a claim the arriving package makes about itself.
    // A name is not a claim — the published list either holds it or does not.
    const asCore = entry('acme_gateway', '20250101T000000', 'init');
    const emitted = orderMigrations({
      entries: [...MIGRATION_REGISTRY, asCore],
      moduleDependencies: graph,
      baseline: BASELINE_MIGRATIONS,
    }).migrations.map((m) => m.name);

    expect(emitted[0]).toBe('Migration20260424T165847CoreFoundationInit');
    expect(emitted.indexOf(asCore.cls.name)).toBeGreaterThanOrEqual(BASELINE_MIGRATIONS.length);
  });
});

describe('orderMigrations — J12 leaf-package neutrality', () => {
  it('adding a module nothing declares changes the relative order of nothing', () => {
    const before = runReal(MIGRATION_REGISTRY).migrations.map((m) => m.name);

    const leaf = entry('acme_gateway', '20270101T000000', 'init', 'external');
    const graph = new Map(REAL_MODULE_DEPENDENCIES).set('acme_gateway', ['orders', 'payment_methods']);
    const after = orderMigrations({
      entries: [...MIGRATION_REGISTRY, leaf],
      moduleDependencies: graph,
      baseline: BASELINE_MIGRATIONS,
    }).migrations.map((m) => m.name);

    expect(after).toContain(leaf.cls.name);
    expect(after.filter((name) => name !== leaf.cls.name)).toEqual(before);
  });
});

describe('orderMigrations — J14 real registry', () => {
  it('orders the real registry against the real manifest graph without throwing', () => {
    expect(() => runReal(MIGRATION_REGISTRY)).not.toThrow();
  });

  it('reports no diagnostic — this repository’s own graph is acyclic', () => {
    const { diagnostics } = runReal(MIGRATION_REGISTRY);
    expect(
      diagnostics.map((d) => d.modules.join(', ')),
      'a dependency cycle was introduced into the committed manifests',
    ).toEqual([]);
  });

  it('emits exactly as many migrations as the registry holds, each named by its class', () => {
    const { migrations } = runReal(MIGRATION_REGISTRY);

    expect(migrations).toHaveLength(MIGRATION_REGISTRY.length);
    for (const emitted of migrations) {
      expect(emitted.name).toBe(emitted.class!.name);
    }
    expect(new Set(migrations.map((m) => m.name)).size).toBe(MIGRATION_REGISTRY.length);
  });

  it('emits every baseline migration first, in plain chronological order', () => {
    const expectedPrefix = realBaselinePrefix();
    const emitted = runReal(MIGRATION_REGISTRY).migrations.map((m) => m.name);

    // Non-trivial: the pre-065 block is the bulk of the registry.
    expect(expectedPrefix.length).toBeGreaterThan(100);
    expect(emitted.slice(0, expectedPrefix.length)).toEqual(expectedPrefix);
  });

  it('emits every module’s open migrations contiguously and chronologically', () => {
    const baselineLength = realBaselinePrefix().length;
    const emitted = runReal(MIGRATION_REGISTRY).migrations.map((m) => m.name);
    const ownerOf = new Map(MIGRATION_REGISTRY.map((e) => [e.cls.name, e.moduleId]));

    const blocks: { moduleId: string; names: string[] }[] = [];
    for (const name of emitted.slice(baselineLength)) {
      const moduleId = ownerOf.get(name)!;
      const last = blocks[blocks.length - 1];
      if (last && last.moduleId === moduleId) last.names.push(name);
      else blocks.push({ moduleId, names: [name] });
    }

    // One block per module: a module appearing twice is a broken contiguity.
    const owners = blocks.map((block) => block.moduleId);
    expect(owners.length, 'the open block is empty').toBeGreaterThan(0);
    expect(new Set(owners).size, `a module owns two open blocks: ${owners.join(', ')}`).toBe(
      owners.length,
    );
    for (const block of blocks) {
      expect([...block.names].sort(), block.moduleId).toEqual(block.names);
    }
  });

  it('emits every module after every module it declares', () => {
    const emitted = runReal(MIGRATION_REGISTRY).migrations.map((m) => m.name);
    const baselineLength = realBaselinePrefix().length;
    const firstOpen = new Map<string, number>();
    const lastOpen = new Map<string, number>();
    emitted.slice(baselineLength).forEach((name, offset) => {
      const moduleId = MIGRATION_REGISTRY.find((e) => e.cls.name === name)!.moduleId;
      if (!firstOpen.has(moduleId)) firstOpen.set(moduleId, offset);
      lastOpen.set(moduleId, offset);
    });

    for (const [moduleId, position] of firstOpen) {
      for (const dependency of REAL_MODULE_DEPENDENCIES.get(moduleId) ?? []) {
        const dependencyEnd = lastOpen.get(dependency);
        if (dependencyEnd === undefined) continue;
        expect(dependencyEnd, `${moduleId} is emitted before its dependency ${dependency}`).toBeLessThan(
          position,
        );
      }
    }
  });
});
