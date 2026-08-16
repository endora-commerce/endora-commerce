import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MigrationOrderError,
  orderMigrations,
  UNCORRECTED_THROUGH as REAL_UNCORRECTED_THROUGH,
  type MigrationClass,
  type MigrationRegistryEntry,
} from '../../../src/db/migration-order.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

/**
 * Invariants I1-I10 of
 * specs/065-manifest-aware-migrations/contracts/ordering-algorithm.md §3.
 *
 * I1-I9 are pure: no database, synthetic entries only. I10 runs the same pure
 * function over the real registry and the real manifest graph — still no
 * database, still no ORM bootstrap.
 */

const UNCORRECTED_THROUGH = '20260801T000000';
const HORIZON_DAYS = 45;

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
function entry(moduleId: string, stamp: string, slug: string): MigrationRegistryEntry {
  const segment = moduleId.startsWith('_') ? moduleId.slice(1) : moduleId;
  return {
    moduleId,
    cls: migrationClass(`Migration${stamp}${pascal(`${segment}_${slug}`)}`),
  };
}

function deps(map: Record<string, readonly string[]>): ReadonlyMap<string, readonly string[]> {
  return new Map(Object.entries(map));
}

function names(entries: readonly MigrationRegistryEntry[]): string[] {
  return entries.map((e) => e.cls.name);
}

function run(
  entries: readonly MigrationRegistryEntry[],
  moduleDependencies: ReadonlyMap<string, readonly string[]>,
): string[] {
  return orderMigrations({
    entries,
    moduleDependencies,
    uncorrectedThrough: UNCORRECTED_THROUGH,
    correctionHorizonDays: HORIZON_DAYS,
  }).map((m) => m.name);
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
  it('imports nothing but @mikro-orm/core types', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, '../../../src/db/migration-order.ts'), 'utf8');
    const imports = [...source.matchAll(/^import\s+(?:type\s+)?[\s\S]*?from\s+'([^']+)';$/gm)].map(
      (match) => match[1]!,
    );

    expect(imports).toEqual(['@mikro-orm/core']);
    expect(source).not.toContain("from '../modules/");
    expect(source).not.toContain('mikro-orm.config');
  });
});

describe('orderMigrations — I1 chronological base', () => {
  it('emits ascending-timestamp order when no dependency pair is inverted', () => {
    const entries = [
      entry('catalog', '20260901T090000', 'a'),
      entry('catalog', '20260902T090000', 'b'),
      entry('orders', '20260903T090000', 'c'),
      entry('orders', '20260904T090000', 'd'),
      entry('invoices', '20260905T090000', 'e'),
      entry('invoices', '20260906T090000', 'f'),
    ];
    expect(run(entries, CHAIN)).toEqual(names(entries));
  });
});

describe('orderMigrations — I2 intra-module chronology', () => {
  it("keeps a module's own migrations in ascending timestamp order under a correction", () => {
    const ordersA = entry('orders', '20260910T090000', 'a');
    const ordersB = entry('orders', '20260912T090000', 'b');
    const ordersC = entry('orders', '20260914T090000', 'c');
    const catalog = entry('catalog', '20260913T090000', 'x');

    const emitted = run([ordersC, catalog, ordersA, ordersB], CHAIN);

    expect(emitted).toEqual([
      catalog.cls.name,
      ordersA.cls.name,
      ordersB.cls.name,
      ordersC.cls.name,
    ]);
    const ordersOnly = emitted.filter((name) => name.includes('Orders'));
    expect(ordersOnly).toEqual([ordersA.cls.name, ordersB.cls.name, ordersC.cls.name]);
  });
});

describe('orderMigrations — I3 inversion corrected', () => {
  it('emits the dependency migration first when the pair is inverted inside the horizon', () => {
    const orders = entry('orders', '20260901T090000', 'placement');
    const catalog = entry('catalog', '20260903T090000', 'column');

    expect(run([orders, catalog], CHAIN)).toEqual([catalog.cls.name, orders.cls.name]);
  });

  it('corrects a transitive dependency inversion', () => {
    const invoices = entry('invoices', '20260901T090000', 'a');
    const catalog = entry('catalog', '20260903T090000', 'b');

    expect(run([invoices, catalog], CHAIN)).toEqual([catalog.cls.name, invoices.cls.name]);
  });
});

describe('orderMigrations — I4 minimality', () => {
  it('leaves a non-inverted cross-module dependency pair in chronological order', () => {
    const catalog = entry('catalog', '20260901T090000', 'a');
    const orders = entry('orders', '20260903T090000', 'b');

    expect(run([orders, catalog], CHAIN)).toEqual([catalog.cls.name, orders.cls.name]);
  });

  it('leaves an inversion beyond the correction horizon in chronological order', () => {
    const orders = entry('orders', '20260901T090000', 'a');
    // 91 days later — well beyond the 45-day horizon.
    const catalog = entry('catalog', '20261201T090000', 'b');

    expect(run([orders, catalog], CHAIN)).toEqual([orders.cls.name, catalog.cls.name]);
  });

  it('does not correct a pair whose modules are unrelated', () => {
    const graph = deps({ catalog: [], orders: [], core: [] });
    const orders = entry('orders', '20260901T090000', 'a');
    const catalog = entry('catalog', '20260903T090000', 'b');

    expect(run([catalog, orders], graph)).toEqual([orders.cls.name, catalog.cls.name]);
  });
});

describe('orderMigrations — I5 uncorrected prefix', () => {
  const oldOrders = entry('orders', '20260701T090000', 'legacy_a');
  const oldCatalog = entry('catalog', '20260702T090000', 'legacy_b');
  const openCatalog = entry('catalog', '20260901T090000', 'open_a');
  const openOrders = entry('orders', '20260805T090000', 'open_b');

  it('emits the pre-watermark block first, in timestamp order, uncorrected', () => {
    const emitted = run([openCatalog, oldCatalog, openOrders, oldOrders], CHAIN);

    expect(emitted.slice(0, 2)).toEqual([oldOrders.cls.name, oldCatalog.cls.name]);
    // The open entries are corrected among themselves but never enter the prefix.
    expect(emitted.slice(2)).toEqual([openCatalog.cls.name, openOrders.cls.name]);
  });

  it('splits on the timestamp alone — renaming a class changes nothing', () => {
    // Feature 072 retired the frozen rename map: the prefix is a position, not
    // a set of names. Moving a migration between groups renames its class
    // (`Migration…SettingsInit` → `Migration…CoreSettingsInit`) and that must
    // stay a pure no-op for the emitted order.
    const before = run([openCatalog, oldCatalog, openOrders, oldOrders], CHAIN);

    const renamedOldOrders: MigrationRegistryEntry = {
      moduleId: 'core',
      cls: migrationClass('Migration20260701T090000CoreLegacyA'),
    };
    const after = run([openCatalog, oldCatalog, openOrders, renamedOldOrders], CHAIN);

    expect(after[0]).toBe(renamedOldOrders.cls.name);
    expect(after.slice(1)).toEqual(before.slice(1));
  });
});

describe('orderMigrations — I6 determinism under permutation', () => {
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

describe('orderMigrations — I7 idempotence', () => {
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

describe('orderMigrations — I8 module cycle', () => {
  it('throws module-cycle naming the full cycle path', () => {
    const graph = deps({ a: ['b'], b: ['c'], c: ['a'], core: [] });
    let thrown: unknown;
    try {
      run([entry('a', '20260901T090000', 'x')], graph);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MigrationOrderError);
    const error = thrown as MigrationOrderError;
    expect(error.code).toBe('module-cycle');
    for (const hop of ['a', 'b', 'c']) {
      expect(error.message).toContain(hop);
    }
    expect(error.message).toMatch(/a → b → c → a|b → c → a → b|c → a → b → c/);
    expect(error.message).toContain('manifest.ts');
  });

  it('detects a cycle even when no migration belongs to the cycle', () => {
    const graph = deps({ catalog: [], a: ['b'], b: ['a'], core: [] });
    expect(() => run([entry('catalog', '20260901T090000', 'x')], graph)).toThrow(
      MigrationOrderError,
    );
  });
});

describe('orderMigrations — I9 input errors', () => {
  it('throws duplicate-timestamp naming both classes', () => {
    const a = entry('orders', '20260901T090000', 'a');
    const b = entry('catalog', '20260901T090000', 'b');
    let thrown: unknown;
    try {
      run([a, b], CHAIN);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MigrationOrderError);
    const error = thrown as MigrationOrderError;
    expect(error.code).toBe('duplicate-timestamp');
    expect(error.message).toContain(a.cls.name);
    expect(error.message).toContain(b.cls.name);
  });

  it('throws duplicate-name naming the class', () => {
    const a = entry('orders', '20260901T090000', 'a');
    const clone: MigrationRegistryEntry = { moduleId: 'orders', cls: a.cls };
    let thrown: unknown;
    try {
      run([a, clone], CHAIN);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MigrationOrderError);
    expect((thrown as MigrationOrderError).code).toBe('duplicate-name');
    expect((thrown as MigrationOrderError).message).toContain(a.cls.name);
  });

  it('throws unparsable-name for a class that is not timestamp-prefixed', () => {
    const bad: MigrationRegistryEntry = {
      moduleId: 'orders',
      cls: migrationClass('Migration042LegacyStyle'),
    };
    let thrown: unknown;
    try {
      run([bad], CHAIN);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MigrationOrderError);
    expect((thrown as MigrationOrderError).code).toBe('unparsable-name');
    expect((thrown as MigrationOrderError).message).toContain('Migration042LegacyStyle');
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
    expect(thrown).toBeInstanceOf(MigrationOrderError);
    expect((thrown as MigrationOrderError).code).toBe('unparsable-name');
    expect((thrown as MigrationOrderError).message).toContain('Migration20261301T090000OrdersA');
  });

  it('throws unknown-module naming the module and the remediation command', () => {
    const ghost = entry('ghost_module', '20260901T090000', 'a');
    let thrown: unknown;
    try {
      run([ghost], CHAIN);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MigrationOrderError);
    const error = thrown as MigrationOrderError;
    expect(error.code).toBe('unknown-module');
    expect(error.message).toContain('ghost_module');
    expect(error.message).toContain(ghost.cls.name);
    expect(error.message).toContain('manifest-index:generate');
  });

  it("accepts the 'core' pseudo-module even when it is absent from the graph", () => {
    const graph = deps({ catalog: [] });
    const core = entry('core', '20260901T090000', 'foundation');
    expect(run([core], graph)).toEqual([core.cls.name]);
  });
});

/**
 * The real module dependency graph, assembled exactly as
 * src/db/mikro-orm.config.ts assembles it (contracts/ordering-algorithm.md §5).
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

function runReal(entries: readonly MigrationRegistryEntry[]): string[] {
  return orderMigrations({
    entries,
    moduleDependencies: REAL_MODULE_DEPENDENCIES,
    uncorrectedThrough: REAL_UNCORRECTED_THROUGH,
    correctionHorizonDays: HORIZON_DAYS,
  }).map((m) => m.name);
}

/** The registry's pre-watermark entries, in the order the prefix must emit. */
function realChronologicalPrefix(): string[] {
  return MIGRATION_REGISTRY.map((registryEntry) => registryEntry.cls.name)
    .filter((name) => name.slice('Migration'.length, 'Migration'.length + 15) <= REAL_UNCORRECTED_THROUGH)
    .sort();
}

describe('orderMigrations — I10 real registry', () => {
  it('orders the real registry against the real manifest graph without throwing', () => {
    expect(() => runReal(MIGRATION_REGISTRY)).not.toThrow();
  });

  it('emits exactly as many migrations as the registry holds, each named by its class', () => {
    const ordered = orderMigrations({
      entries: MIGRATION_REGISTRY,
      moduleDependencies: REAL_MODULE_DEPENDENCIES,
      uncorrectedThrough: REAL_UNCORRECTED_THROUGH,
      correctionHorizonDays: HORIZON_DAYS,
    });

    expect(ordered).toHaveLength(MIGRATION_REGISTRY.length);
    for (const emitted of ordered) {
      expect(emitted.name).toBe(emitted.class!.name);
    }
    expect(new Set(ordered.map((m) => m.name)).size).toBe(MIGRATION_REGISTRY.length);
  });

  it('emits every pre-watermark migration first, in plain chronological order', () => {
    const expectedPrefix = realChronologicalPrefix();
    const emitted = runReal(MIGRATION_REGISTRY);

    // Non-trivial: the pre-065 block is the bulk of the registry.
    expect(expectedPrefix.length).toBeGreaterThan(100);
    expect(emitted.slice(0, expectedPrefix.length)).toEqual(expectedPrefix);
  });
});

describe('orderMigrations — the concurrent-branch hazard, against the real graph', () => {
  // The hazard this feature exists to fix: two branches merge, the module that
  // owns the referenced table lands with the later timestamp, and a fresh
  // database applies the referencing migration first. `orders` transitively
  // depends on `catalog` in the real manifest graph.
  const ordersEntry = entry('orders', '20260810T090000', 'placement_intents');

  it('emits the dependency module first when the merge inverted them', () => {
    const catalogEntry = entry('catalog', '20260812T090000', 'product_column');
    const emitted = runReal([...MIGRATION_REGISTRY, ordersEntry, catalogEntry]);

    expect(emitted.indexOf(catalogEntry.cls.name)).toBeLessThan(
      emitted.indexOf(ordersEntry.cls.name),
    );
  });

  it('leaves chronological order alone once the pair is beyond the correction horizon', () => {
    // 52 days after the orders entry — outside CORRECTION_HORIZON_DAYS.
    const catalogEntry = entry('catalog', '20261001T090000', 'product_column');
    const emitted = runReal([...MIGRATION_REGISTRY, ordersEntry, catalogEntry]);

    expect(emitted.indexOf(ordersEntry.cls.name)).toBeLessThan(
      emitted.indexOf(catalogEntry.cls.name),
    );
  });

  it('leaves the uncorrected prefix untouched in both cases', () => {
    const expectedPrefix = realChronologicalPrefix();
    const catalogEntry = entry('catalog', '20260812T090000', 'product_column');
    const emitted = runReal([...MIGRATION_REGISTRY, ordersEntry, catalogEntry]);

    expect(emitted.slice(0, expectedPrefix.length)).toEqual(expectedPrefix);
  });
});
