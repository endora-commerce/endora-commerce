import { describe, expect, it } from 'vitest';
import {
  MigrationOrderError,
  orderMigrations,
  type MigrationClass,
  type MigrationRegistryEntry,
} from '../../../src/db/migration-order.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

/**
 * The module dependency graph the migration order is corrected by (FR-029,
 * FR-030, SC-007).
 *
 * Pure: no database, no ORM bootstrap. The graph is assembled exactly as
 * src/db/mikro-orm.config.ts assembles it
 * (specs/065-manifest-aware-migrations/contracts/ordering-algorithm.md §5).
 */

const DECLARED: ReadonlyMap<string, readonly string[]> = new Map(
  DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
);

const MODULE_DEPENDENCIES: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([['core', []], ...DECLARED]);

function migrationClass(name: string): MigrationClass {
  const holder = { [name]: class {} };
  return holder[name] as unknown as MigrationClass;
}

const PROBE: readonly MigrationRegistryEntry[] = [
  { moduleId: 'core', cls: migrationClass('Migration20260901T090000CoreProbe') },
];

function order(moduleDependencies: ReadonlyMap<string, readonly string[]>): string[] {
  return orderMigrations({
    entries: PROBE,
    moduleDependencies,
    uncorrectedThrough: '20260801T000000',
    correctionHorizonDays: 45,
  }).map((migration) => migration.name);
}

/** Iterative three-colour DFS, independent of the implementation under test. */
function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of graph.keys()) colour.set(id, WHITE);

  for (const root of graph.keys()) {
    if (colour.get(root) !== WHITE) continue;
    const path: string[] = [];
    const stack: { id: string; enter: boolean }[] = [{ id: root, enter: true }];
    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (!frame.enter) {
        colour.set(frame.id, BLACK);
        path.pop();
        continue;
      }
      if (colour.get(frame.id) === BLACK) continue;
      colour.set(frame.id, GREY);
      path.push(frame.id);
      stack.push({ id: frame.id, enter: false });
      for (const dependency of graph.get(frame.id) ?? []) {
        if (!graph.has(dependency)) continue;
        if (colour.get(dependency) === GREY) {
          return [...path.slice(path.indexOf(dependency)), dependency];
        }
        if (colour.get(dependency) === WHITE) stack.push({ id: dependency, enter: true });
      }
    }
  }
  return null;
}

describe('module dependency graph — the real manifests', () => {
  it('declares only module ids that exist in the manifest index', () => {
    const dangling: string[] = [];
    for (const [moduleId, dependencies] of DECLARED) {
      for (const dependency of dependencies) {
        if (!DECLARED.has(dependency)) dangling.push(`${moduleId} → ${dependency}`);
      }
    }
    expect(
      dangling,
      `these manifest dependencies name a module that is not registered: ${dangling.join(', ')}`,
    ).toEqual([]);
  });

  it('is acyclic (independent DFS)', () => {
    const cycle = findCycle(MODULE_DEPENDENCIES);
    expect(cycle, cycle ? `cycle: ${cycle.join(' → ')}` : undefined).toBeNull();
  });

  it('is acyclic (orderMigrations accepts it)', () => {
    expect(() => order(MODULE_DEPENDENCIES)).not.toThrow();
  });

  it('never declares a module as its own dependency', () => {
    const selfEdges = [...DECLARED.entries()]
      .filter(([moduleId, dependencies]) => dependencies.includes(moduleId))
      .map(([moduleId]) => moduleId);
    expect(selfEdges).toEqual([]);
  });
});

describe('module dependency graph — a cycle fails loudly (SC-007)', () => {
  it('throws module-cycle naming every hop when an edge is injected', () => {
    // `catalog` already reaches `sales_channels`; the reverse edge closes a
    // cycle through whatever path the real graph uses.
    const cyclic = new Map(MODULE_DEPENDENCIES);
    cyclic.set('sales_channels', [...(cyclic.get('sales_channels') ?? []), 'catalog']);

    let thrown: unknown;
    try {
      order(cyclic);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationOrderError);
    const error = thrown as MigrationOrderError;
    expect(error.code).toBe('module-cycle');
    expect(error.message).toContain('sales_channels');
    expect(error.message).toContain('catalog');
    expect(error.message).toContain('manifest.ts');

    const hops = /graph: \[([^\]]+)\]/.exec(error.message)?.[1]?.split(' → ') ?? [];
    expect(hops.length).toBeGreaterThanOrEqual(3);
    expect(hops[0]).toBe(hops[hops.length - 1]);
  });

  it('reports the whole path for a three-module cycle', () => {
    const cyclic = new Map(MODULE_DEPENDENCIES);
    cyclic.set('taxes', ['seo']);
    cyclic.set('seo', ['shopping_lists']);
    cyclic.set('shopping_lists', ['taxes']);

    let thrown: unknown;
    try {
      order(cyclic);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationOrderError);
    const message = (thrown as MigrationOrderError).message;
    for (const hop of ['taxes', 'seo', 'shopping_lists']) {
      expect(message).toContain(hop);
    }
  });
});
