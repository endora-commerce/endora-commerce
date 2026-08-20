import { describe, expect, it } from 'vitest';
import {
  orderMigrations,
  type MigrationClass,
  type MigrationOrderDiagnostic,
  type MigrationRegistryEntry,
} from '../../../src/db/migration-order.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

/**
 * The module dependency graph the migration order is computed from (081
 * FR-011).
 *
 * Pure: no database, no ORM bootstrap. The graph is assembled exactly as
 * src/db/mikro-orm.config.ts assembles it
 * (specs/081-per-module-migration-order/contracts/ordering-algorithm.md §3).
 *
 * A cycle is no longer thrown — under the new rule the graph is the primary
 * ordering, so a throw would let one mis-declared manifest stop a whole
 * platform's schema from migrating. It comes back as a diagnostic instead, and
 * this file is the reader that turns a diagnostic over *this* repository's
 * manifests into a red build.
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

function diagnose(
  moduleDependencies: ReadonlyMap<string, readonly string[]>,
): readonly MigrationOrderDiagnostic[] {
  return orderMigrations({
    entries: PROBE,
    moduleDependencies,
    baselineThrough: '20260801T000000',
  }).diagnostics;
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

  it('is acyclic (orderMigrations produces zero diagnostics)', () => {
    const cycles = diagnose(MODULE_DEPENDENCIES);
    expect(
      cycles.map((diagnostic) => diagnostic.modules.join(' + ')),
      'a dependency cycle was introduced into the committed manifests',
    ).toEqual([]);
  });

  it('never declares a module as its own dependency', () => {
    const selfEdges = [...DECLARED.entries()]
      .filter(([moduleId, dependencies]) => dependencies.includes(moduleId))
      .map(([moduleId]) => moduleId);
    expect(selfEdges).toEqual([]);
  });
});

describe('module dependency graph — an injected cycle is reported (FR-010)', () => {
  // The red proof for the assertion above: without it, a `diagnose` that
  // reported nothing for every graph would look exactly as green.
  it('names every member when an edge closes a cycle in the real graph', () => {
    // `catalog` already reaches `sales_channels`; the reverse edge closes a
    // cycle through whatever path the real graph uses.
    const cyclic = new Map(MODULE_DEPENDENCIES);
    cyclic.set('sales_channels', [...(cyclic.get('sales_channels') ?? []), 'catalog']);

    const cycles = diagnose(cyclic);

    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.kind).toBe('module-cycle');
    expect(cycles[0]!.modules).toContain('sales_channels');
    expect(cycles[0]!.modules).toContain('catalog');
    expect(cycles[0]!.modules.length).toBeGreaterThanOrEqual(2);
    expect(cycles[0]!.message).toContain('dependencies');
  });

  it('reports all three members of a three-module cycle', () => {
    const cyclic = new Map(MODULE_DEPENDENCIES);
    cyclic.set('taxes', ['seo']);
    cyclic.set('seo', ['shopping_lists']);
    cyclic.set('shopping_lists', ['taxes']);

    const cycles = diagnose(cyclic);

    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.modules).toEqual(['seo', 'shopping_lists', 'taxes']);
  });

  it('still emits every migration while the cycle stands', () => {
    // The property that makes reporting the right answer: a mis-declared
    // manifest must not stop core's schema from migrating.
    const cyclic = new Map(MODULE_DEPENDENCIES);
    cyclic.set('taxes', ['seo']);
    cyclic.set('seo', ['shopping_lists']);
    cyclic.set('shopping_lists', ['taxes']);

    const emitted = orderMigrations({
      entries: PROBE,
      moduleDependencies: cyclic,
      baselineThrough: '20260801T000000',
    }).migrations;

    expect(emitted.map((migration) => migration.name)).toEqual([PROBE[0]!.cls.name]);
  });
});
