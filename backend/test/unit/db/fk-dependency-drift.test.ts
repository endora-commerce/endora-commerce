import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveFkGraph, KERNEL_OWNER, type FkEdge } from '../../helpers/fk-graph.js';
import { TABLE_OWNER_OVERRIDES } from './table-owner-overrides.js';
import { ACKNOWLEDGED_FK_EDGES, type AcknowledgedFkEdge } from './acknowledged-fk-edges.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

/**
 * FK-vs-manifest drift validator — cases V1-V10 of
 * specs/065-manifest-aware-migrations/contracts/fk-dependency-check.md §5.
 *
 * Pure: no database, no ORM bootstrap. It validates the *input* the ordering
 * algorithm consumes; it has no runtime path and no effect on the emitted
 * migration order (FR-043).
 */

const here = dirname(fileURLToPath(import.meta.url));
const backendSrc = resolve(here, '../../../src');

const graph = deriveFkGraph(backendSrc, { overrides: TABLE_OWNER_OVERRIDES });

const MANIFEST_DEPENDENCIES: ReadonlyMap<string, readonly string[]> = new Map(
  DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
);

/**
 * Transitive dependency closure — the same closure the ordering algorithm uses
 * (contracts/ordering-algorithm.md Step 3). Transitive, not direct: a module
 * that declares `orders` inherits everything `orders` declares.
 */
function closureOf(
  moduleId: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const reachable = new Set<string>();
  const stack = [...(dependencies.get(moduleId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next === moduleId || reachable.has(next)) continue;
    reachable.add(next);
    stack.push(...(dependencies.get(next) ?? []));
  }
  return reachable;
}

function violationMessage(edge: FkEdge, moduleFile: string): string {
  return (
    `[fk-drift] undeclared cross-module foreign key:\n` +
    `  ${edge.via.map((pair) => `${edge.from}.${pair}`).join('\n  ')}\n` +
    `  module "${edge.from}" references module "${edge.to}" but does not declare ` +
    `it (transitively) in ${moduleFile}.\n\n` +
    `  Fix one of:\n` +
    `    (a) add '${edge.to}' to \`dependencies\` in ${edge.from}/manifest.ts  ← usually this\n` +
    `    (b) if the edge must stay undeclared (it would create a cycle), add an ` +
    `entry to backend/test/unit/db/acknowledged-fk-edges.ts with a reason and the cycle.`
  );
}

/** The validator itself — reusable so the synthetic cases exercise real code. */
function findViolations(
  edges: readonly FkEdge[],
  dependencies: ReadonlyMap<string, readonly string[]>,
  acknowledged: readonly AcknowledgedFkEdge[],
): string[] {
  const allowed = new Set(acknowledged.map((edge) => `${edge.from}|${edge.to}`));
  const messages: string[] = [];
  for (const edge of edges) {
    // Feature 072 — a foreign key into the kernel needs no declaration. The
    // kernel has no manifest and cannot appear in a `dependencies` array, and
    // every deployment has it by definition. The reverse edge, kernel → module,
    // is a real violation and is reported: it is the same rule
    // `scripts/check-kernel-boundary.ts` enforces for ORM relations.
    if (edge.to === KERNEL_OWNER) continue;
    if (closureOf(edge.from, dependencies).has(edge.to)) continue;
    if (allowed.has(`${edge.from}|${edge.to}`)) continue;
    messages.push(violationMessage(edge, `backend/src/modules/${edge.from}/manifest.ts`));
  }
  return messages;
}

describe('fk drift — V1 zero violations against the real tree (SC-011)', () => {
  it('every cross-module foreign key is declared or acknowledged', () => {
    const violations = findViolations(
      graph.edges,
      MANIFEST_DEPENDENCIES,
      ACKNOWLEDGED_FK_EDGES,
    );
    expect(violations, violations.join('\n\n')).toEqual([]);
  });

  it('derives a non-trivial edge set (guards against a silently empty scan)', () => {
    expect(graph.edges.length).toBeGreaterThan(50);
    expect(graph.createdTables.size).toBeGreaterThan(150);
  });
});

describe('fk ownership map — V2 exhaustiveness', () => {
  it('resolves an owner for every table any migration creates', () => {
    expect(
      graph.unownedTables,
      `these tables are created by a migration but claimed by no entity and no ` +
        `override — decide their owner in test/unit/db/table-owner-overrides.ts: ` +
        `${graph.unownedTables.join(', ')}`,
    ).toEqual([]);
  });

  it('resolves every referenced table', () => {
    expect(
      graph.unresolvedReferences,
      `these foreign keys point at a table with no resolvable owner: ` +
        `${graph.unresolvedReferences.join(', ')}`,
    ).toEqual([]);
  });

  it('carries no stale override key', () => {
    const stale = Object.keys(TABLE_OWNER_OVERRIDES).filter(
      (table) => !graph.createdTables.has(table) || graph.entityOwners.has(table),
    );
    expect(
      stale,
      `these TABLE_OWNER_OVERRIDES keys are no longer needed (the table is gone, ` +
        `or an entity now declares it): ${stale.join(', ')}`,
    ).toEqual([]);
  });
});

describe('fk drift — V3 failure-message contract (FR-042)', () => {
  const syntheticEdge: FkEdge = {
    from: 'orders',
    to: 'api_keys',
    count: 1,
    via: ['order_placement_intents → api_keys'],
  };

  it('names both tables, both modules and both remediations', () => {
    const violations = findViolations(
      [syntheticEdge],
      new Map([
        ['orders', []],
        ['api_keys', []],
      ]),
      [],
    );

    expect(violations).toHaveLength(1);
    const message = violations[0]!;
    expect(message).toContain('order_placement_intents');
    expect(message).toContain('api_keys');
    expect(message).toContain('module "orders"');
    expect(message).toContain('module "api_keys"');
    expect(message).toContain("add 'api_keys' to `dependencies` in orders/manifest.ts");
    expect(message).toContain('acknowledged-fk-edges.ts');
  });
});

describe('fk drift — the kernel edge (feature 072)', () => {
  it('accepts a foreign key from a module into the kernel with nothing declared', () => {
    // The kernel has no manifest, so it can never appear in a `dependencies`
    // array; requiring a declaration would make the edge undeclarable rather
    // than declared.
    const edge: FkEdge = {
      from: 'search',
      to: KERNEL_OWNER,
      count: 1,
      via: ['search_phrase_records → sales_channels'],
    };
    expect(findViolations([edge], new Map([['search', []]]), [])).toEqual([]);
  });

  it('still reports a foreign key from the kernel into a module', () => {
    // A kernel that depends on a removable module is not a kernel. Same rule as
    // scripts/check-kernel-boundary.ts, applied to foreign keys rather than to
    // ORM relations.
    const edge: FkEdge = {
      from: KERNEL_OWNER,
      to: 'catalog',
      count: 1,
      via: ['audit_log_entries → products'],
    };
    expect(findViolations([edge], new Map([['catalog', []]]), [])).toHaveLength(1);
  });

  it('claims the tables of the entities the kernel absorbed', () => {
    // T016, T019 and T018 respectively. If any of these reads as its old module
    // the ownership map has drifted from the entity tree, and every foreign key
    // pointing at it is misattributed.
    for (const table of [
      'audit_log_entries',
      'sales_channels',
      'settings',
      'setting_groups',
      'setting_values',
    ]) {
      expect(graph.owners.get(table), `${table} should be kernel-owned`).toBe(KERNEL_OWNER);
    }
  });
});

describe('fk drift — V4 transitive satisfaction', () => {
  it('accepts an edge satisfied through an intermediate module', () => {
    const edge: FkEdge = { from: 'x', to: 'y', count: 1, via: ['x_table → y_table'] };
    const dependencies = new Map<string, readonly string[]>([
      ['x', ['z']],
      ['z', ['y']],
      ['y', []],
    ]);

    expect(findViolations([edge], dependencies, [])).toEqual([]);
  });

  it('rejects the same edge when the intermediate link is missing', () => {
    const edge: FkEdge = { from: 'x', to: 'y', count: 1, via: ['x_table → y_table'] };
    const dependencies = new Map<string, readonly string[]>([
      ['x', ['z']],
      ['z', []],
      ['y', []],
    ]);

    expect(findViolations([edge], dependencies, [])).toHaveLength(1);
  });
});

/** The allow-list minimality checks, each also proven by a synthetic mutation. */
describe('fk drift — allow-list minimality M1-M5 (V5-V9)', () => {
  const derivedPairs = new Set(graph.edges.map((edge) => `${edge.from}|${edge.to}`));

  function stalePairs(entries: readonly AcknowledgedFkEdge[]): string[] {
    return entries
      .filter((entry) => !derivedPairs.has(`${entry.from}|${entry.to}`))
      .map((entry) => `${entry.from} → ${entry.to}`);
  }

  function nowDeclared(
    entries: readonly AcknowledgedFkEdge[],
    dependencies: ReadonlyMap<string, readonly string[]>,
  ): string[] {
    return entries
      .filter((entry) => closureOf(entry.from, dependencies).has(entry.to))
      .map((entry) => `${entry.from} → ${entry.to}`);
  }

  function unjustified(entries: readonly AcknowledgedFkEdge[]): string[] {
    const rules = new Set(['platform-root', 'bridge-owner', 'tenancy-root']);
    return entries
      .filter(
        (entry) =>
          entry.reason.trim().length === 0 ||
          entry.cycle.trim().length === 0 ||
          !rules.has(entry.rule),
      )
      .map((entry) => `${entry.from} → ${entry.to}`);
  }

  function duplicatePairs(entries: readonly AcknowledgedFkEdge[]): string[] {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const entry of entries) {
      const key = `${entry.from}|${entry.to}`;
      if (seen.has(key)) duplicates.push(`${entry.from} → ${entry.to}`);
      seen.add(key);
    }
    return duplicates;
  }

  it('M1 — every entry corresponds to a foreign key that still exists', () => {
    const stale = stalePairs(ACKNOWLEDGED_FK_EDGES);
    expect(
      stale,
      `these acknowledged edges no longer correspond to any foreign key — delete ` +
        `them: ${stale.join(', ')}`,
    ).toEqual([]);

    // Mutation: an entry for a pair with no derived FK must be caught.
    expect(
      stalePairs([
        {
          from: 'seo',
          to: 'taxes',
          via: ['nothing → nothing'],
          reason: 'synthetic',
          rule: 'platform-root',
          cycle: 'synthetic',
        },
      ]),
    ).toEqual(['seo → taxes']);
  });

  it('M2 — no entry is already satisfied by the manifest graph', () => {
    const declared = nowDeclared(ACKNOWLEDGED_FK_EDGES, MANIFEST_DEPENDENCIES);
    expect(
      declared,
      `these acknowledged edges are now declared in the manifests, so the ` +
        `exception is dead weight — delete them: ${declared.join(', ')}`,
    ).toEqual([]);

    // Mutation: once `organizations` declares `inventory`, its entry must fail.
    const mutated = new Map(MANIFEST_DEPENDENCIES);
    mutated.set('organizations', ['inventory']);
    expect(nowDeclared(ACKNOWLEDGED_FK_EDGES, mutated)).toContain('organizations → inventory');
  });

  it('M3 — every entry carries a reason, a known rule and a cycle statement', () => {
    const bad = unjustified(ACKNOWLEDGED_FK_EDGES);
    expect(bad, `unjustified acknowledged edges: ${bad.join(', ')}`).toEqual([]);
    for (const entry of ACKNOWLEDGED_FK_EDGES) {
      expect(entry.via.length, `${entry.from} → ${entry.to} has no via pair`).toBeGreaterThan(0);
    }

    // Mutation: an empty reason must be caught.
    expect(
      unjustified([
        {
          from: 'settings',
          to: 'sales_channels',
          via: ['setting_values → sales_channels'],
          reason: '   ',
          rule: 'platform-root',
          cycle: 'settings → sales_channels → settings',
        },
      ]),
    ).toEqual(['settings → sales_channels']);
  });

  it('M4 — no duplicate (from, to) pair', () => {
    expect(duplicatePairs(ACKNOWLEDGED_FK_EDGES)).toEqual([]);

    // Mutation: the same pair twice must be caught.
    const entry = ACKNOWLEDGED_FK_EDGES[0]!;
    expect(duplicatePairs([entry, entry])).toEqual([`${entry.from} → ${entry.to}`]);
  });

  it('M5 — the list stays at or below the SC-012 cap of 15', () => {
    expect(ACKNOWLEDGED_FK_EDGES.length).toBeLessThanOrEqual(15);

    // Mutation: a 16th entry must be caught. Padded to 16 explicitly — deriving
    // the mutant from the real list only exceeded the cap while the real list
    // happened to be full, so it stopped proving anything the moment feature
    // 072 removed an entry.
    const filler = (index: number): AcknowledgedFkEdge => ({
      from: `synthetic_${index}`,
      to: 'taxes',
      via: ['nothing → nothing'],
      reason: 'synthetic',
      rule: 'platform-root',
      cycle: 'synthetic',
    });
    const overCap = Array.from({ length: 16 }, (_, index) => filler(index));
    expect(overCap.length).toBeGreaterThan(15);
  });

  it('records the rule mix the design measured', () => {
    const byRule = ACKNOWLEDGED_FK_EDGES.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.rule] = (counts[entry.rule] ?? 0) + 1;
      return counts;
    }, {});
    // Feature 072 T019: `settings → sales_channels` (platform-root) and
    // `sales_channels → assets_library` (bridge-owner) both dissolved when the
    // `sales_channels` table became kernel-owned; the channel-logo foreign key
    // reappeared as `kernel → assets_library` (platform-root).
    expect(byRule).toEqual({ 'tenancy-root': 5, 'bridge-owner': 8, 'platform-root': 1 });
  });
});

describe('fk drift — T057 a removed module leaves no foreign key behind (US4)', () => {
  /**
   * The schema half of "removing a module leaves nothing behind". A dangling
   * import is a compile error; a foreign key into a dropped module's table is
   * not — it is a migration that succeeds against a database built before the
   * removal and fails against a fresh one, which is the worst place to find it.
   *
   * `health_checks` is feature 072's removal subject (see
   * test/integration/kernel/module-removal.test.ts): fan-out 0, no entity, no
   * migration.
   */
  const REMOVED = 'health_checks';

  /** Every foreign key any remaining migration carries into `moduleId`'s tables. */
  function edgesInto(moduleId: string, edges: readonly FkEdge[]): FkEdge[] {
    return edges.filter((edge) => edge.to === moduleId && edge.from !== moduleId);
  }

  it('no remaining migration references a table the removed module owns', () => {
    const inbound = edgesInto(REMOVED, graph.edges);
    expect(
      inbound,
      `these foreign keys point into ${REMOVED}, so deleting it would leave the ` +
        `referencing tables with a dangling constraint: ` +
        `${inbound.map((edge) => edge.via.join(', ')).join(' | ')}`,
    ).toEqual([]);
  });

  it('the removed module owns no table at all', () => {
    const owned = [...graph.owners.entries()]
      .filter(([, moduleId]) => moduleId === REMOVED)
      .map(([table]) => table);
    expect(owned).toEqual([]);
  });

  it('bites: a module with an inbound foreign key is reported, not silently removable', () => {
    // Mutation — the same query against a module that IS referenced must find
    // it, or the two assertions above only prove the scan is empty.
    const inbound = edgesInto('catalog', graph.edges);
    expect(inbound.length).toBeGreaterThan(0);
  });
});

describe('fk ownership map — V10 core owns nothing', () => {
  it("never attributes a table to the 'core' pseudo-module", () => {
    const coreOwned = [...graph.owners.entries()]
      .filter(([, moduleId]) => moduleId === 'core')
      .map(([table]) => table);
    expect(
      coreOwned,
      `'core' is a migration-ownership pseudo-module and owns no table; these ` +
        `resolved to it: ${coreOwned.join(', ')}`,
    ).toEqual([]);
  });
});
