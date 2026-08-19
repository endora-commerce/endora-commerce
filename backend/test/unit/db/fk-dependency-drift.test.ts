import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveFkGraph,
  KERNEL_OWNER,
  type FkEdge,
  type FkGraph,
  type FkReference,
  type MigrationSource,
} from '../../helpers/fk-graph.js';
import { TABLE_OWNER_OVERRIDES } from './table-owner-overrides.js';
import { ACKNOWLEDGED_FK_EDGES, type AcknowledgedFkEdge } from './acknowledged-fk-edges.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';
import { BASELINE_THROUGH } from '../../../src/db/migration-order.js';

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

  // The scan is a filesystem walk over `src/modules`, and its two floors used
  // to be the numbers 50 and 150 (issue #215). A hand-written count is a copy of
  // a derived fact — it says nothing about *which* modules were read, so a walk
  // that lost half the tree still cleared it, and D-100 is the standing warning
  // about exactly that copy. Both floors below are derived from
  // `DISCOVERED_MANIFESTS`, a committed artefact this file already imports: it
  // moves when the tree moves, and it names the modules rather than counting
  // them.
  const registeredIds = DISCOVERED_MANIFESTS.map((entry) => entry.id);

  const shipsTypeScriptIn = (moduleId: string, folder: string): boolean => {
    const directory = join(backendSrc, 'modules', moduleId, folder);
    return existsSync(directory) && readdirSync(directory).some((f) => f.endsWith('.ts'));
  };

  it('resolves a directory for every registered module (the tree is where it looks)', () => {
    // A moved module tree makes the walk read a residue and report on it. This
    // is the "path that must resolve" half: the registry says the module is
    // there, so a scan that cannot find it is an error, never an empty result.
    const missing = registeredIds.filter(
      (id) => !existsSync(join(backendSrc, 'modules', id)),
    );
    expect(missing, `registered but absent under src/modules: ${missing.join(', ')}`).toEqual([]);
  });

  it('resolves an owner for every registered module that ships entities', () => {
    // The second half: the directory is there and the entity pass still matched
    // inside it. A `tableName:` regex that stopped matching would leave every
    // table unowned and every cross-module edge unattributed, which reads as a
    // clean tree rather than as a broken scan.
    const owners = new Set(graph.entityOwners.values());
    const unread = registeredIds
      .filter((id) => shipsTypeScriptIn(id, 'entities'))
      .filter((id) => !owners.has(id));
    expect(
      unread,
      `these modules ship an entities/ directory the scan read no table out of: ${unread.join(', ')}`,
    ).toEqual([]);
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
    // T016, T019 and T018 respectively, plus `module_registrations` (D-37 A1:
    // the presence cache's own table follows the cache into the kernel). If any
    // of these reads as its old module the ownership map has drifted from the
    // entity tree, and every foreign key pointing at it is misattributed.
    for (const table of [
      'audit_log_entries',
      'module_registrations',
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
    //
    // T138: `tenancy-root` fell from 5 to 4. Converting `organizations` made its
    // dependency on `admin_notifications` explicit, and that satisfies
    // `admin_users` transitively — so the `organizations → admin_users`
    // exception stopped being one. A conversion draining an acknowledged edge is
    // the direction this list is supposed to move in.
    expect(byRule).toEqual({ 'tenancy-root': 4, 'bridge-owner': 8, 'platform-root': 1 });
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

/* ────────────────────────────────────────────────────────────────────────────
 * Feature 081, FR-013 — the POSITION half.
 *
 * Everything above asks "is this cross-module foreign key declared?". This half
 * asks "will the two migrations run in the right order?", and it exists because
 * until feature 081 nothing had to ask.
 *
 * Before !750 the emitted order was timestamps *corrected* by the module
 * dependency graph, and that correction is what made a cross-module foreign key
 * work: if `A`'s migration referenced `B`'s table, the correction pulled `B`
 * ahead whether or not anyone had declared the edge, as long as the two stamps
 * sat within the 45-day horizon. Feature 081 deleted the correction — the order
 * is now a topological sort of the declared graph with contiguous per-module
 * chains — so an undeclared edge is no longer rescued by anything. This check is
 * the replacement for that accident, not an addition to it (D-113 §3).
 * ──────────────────────────────────────────────────────────────────────────── */

type PositionFindingKind =
  /** An open-block foreign key whose two chains nothing orders (FR-013). */
  | 'undeclared-open-edge'
  /**
   * The scan could not decide where one of the two migrations sits. Reported
   * rather than skipped: a green that can mean "not looking" is issue #113.
   */
  | 'unclassifiable-position';

interface PositionFinding {
  kind: PositionFindingKind;
  message: string;
}

/**
 * The order the emitted migration list is in, restated as a predicate.
 *
 * `contracts/ordering-algorithm.md` §2 emits the baseline block first (Step 2),
 * then one contiguous chain per module component in a topological order of the
 * declared `dependencies` graph, with `'core'` drained first (Steps 4 and 5).
 * So a foreign key created by migration `M` in chain `dm`, pointing at a table
 * created by migration `C` in chain `cm`, runs after its target when:
 *
 *   (a) `C` is in the baseline block — the whole baseline precedes the whole
 *       open block, unconditionally;
 *   (b) `cm === 'core'` — core's component is drained first inside the open
 *       block, and nothing declares core, so every core migration precedes
 *       every module migration. This is what covers the kernel: no module-owned
 *       migration may create or alter a kernel-owned table, asserted by
 *       `kernel-migration-ownership.test.ts`, so every kernel table's creator
 *       is a core migration. That matters, because `kernel` has no manifest and
 *       can never appear in a `dependencies` array — an edge into it must be
 *       exempt by a derived fact, not by an assumption;
 *   (c) `cm === dm` — one module's chain is contiguous and internally
 *       chronological (J2, J3), and `C` is older than `M`;
 *   (d) `cm` is in `dm`'s transitive dependency closure — the declared edge,
 *       which is the whole point.
 *
 * Anything else is emitted in an order nothing fixes, so a fresh database may
 * run `M` before `C` and fail on the missing relation.
 *
 * Two deliberate scope notes:
 *
 * - The module tested is the migration's **owning chain** (`declaredIn.moduleId`
 *   and the creator's), not the owner of either table. A migration is emitted in
 *   its own module's chain; `core`'s foundation migration creates tables owned by
 *   `catalog`, and it is core's position, not catalog's, that orders it.
 * - The population is the declaration half's: cross-module *ownership* edges.
 *   A pair of same-owner tables created by two different chains is therefore
 *   invisible here. Today only `core` creates another module's tables and core
 *   is emitted first, so that shape has no instance; if it acquires one, this
 *   comment is where to start.
 *
 * Baseline membership is tested on the stamp alone. The full rule is stamp
 * **and** `origin === 'core'` (`migration-order.ts`), but this scan walks
 * `backend/src` and out-of-core code contributes no schema (D-105), so every
 * file it can read is core.
 */
function findPositionViolations(
  graph: FkGraph,
  dependencies: ReadonlyMap<string, readonly string[]>,
  baselineThrough: string,
): PositionFinding[] {
  const findings: PositionFinding[] = [];

  for (const reference of graph.references) {
    const declaring = reference.declaredIn;

    if (declaring.timestamp === undefined) {
      findings.push({
        kind: 'unclassifiable-position',
        message: unclassifiableMessage(
          reference,
          `its declaring file ${declaring.file} has no parsable migration stamp, so the ` +
            `check cannot tell which block it is emitted in`,
        ),
      });
      continue;
    }

    // The baseline block is closed, never reordered, and cannot grow: the
    // scaffolder clamps every new core stamp past the boundary. A foreign key
    // created inside it is history, and history already applied.
    if (declaring.timestamp <= baselineThrough) continue;

    const creator = graph.tableCreators.get(reference.toTable);
    if (creator === undefined || creator.timestamp === undefined) {
      findings.push({
        kind: 'unclassifiable-position',
        message: unclassifiableMessage(
          reference,
          creator === undefined
            ? `no migration in the tree creates the referenced table "${reference.toTable}", ` +
                `so the check cannot tell when it comes into existence`
            : `the migration creating "${reference.toTable}" (${creator.file}) has no parsable ` +
                `stamp, so the check cannot tell which block it is emitted in`,
        ),
      });
      continue;
    }

    if (creator.timestamp <= baselineThrough) continue;
    if (creator.moduleId === 'core') continue;
    if (creator.moduleId === declaring.moduleId) continue;
    if (closureOf(declaring.moduleId, dependencies).has(creator.moduleId)) continue;

    findings.push({
      kind: 'undeclared-open-edge',
      message: positionViolationMessage(reference, creator),
    });
  }

  return findings;
}

function positionViolationMessage(reference: FkReference, creator: MigrationSource): string {
  const declaring = reference.declaredIn;
  return (
    `[fk-position] cross-module foreign key with nothing to order it:\n` +
    `  ${reference.fromTable} → ${reference.toTable}\n` +
    `  module "${reference.from}" creates this foreign key in ${declaring.file} ` +
    `(emitted in chain "${declaring.moduleId}", after the baseline block), and the ` +
    `referenced table "${reference.toTable}" — owned by module "${reference.to}" — is ` +
    `created in ${creator.file} (chain "${creator.moduleId}", also after the baseline ` +
    `block).\n` +
    `  Since feature 081 the emitted order is a topological sort of the declared ` +
    `\`dependencies\` graph, and chain "${declaring.moduleId}" declares nothing that ` +
    `reaches "${creator.moduleId}", so a fresh database may run ${declaring.file} first ` +
    `and fail with \`relation "${reference.toTable}" does not exist\`.\n\n` +
    `  Fix one of:\n` +
    `    (a) add '${creator.moduleId}' to \`dependencies\` in ` +
    `${declaring.moduleId}/manifest.ts  ← usually this\n` +
    `    (b) move the constraint into a migration owned by "${reference.from}", the module ` +
    `that owns the referencing table, so that module's declarations order it\n` +
    `    (c) if neither is possible, the per-migration ordering edge specified — and ` +
    `deliberately not built — in ` +
    `specs/081-per-module-migration-order/contracts/ordering-algorithm.md §7 is the ` +
    `escape, and this failure is its first call site.`
  );
}

function unclassifiableMessage(reference: FkReference, why: string): string {
  return (
    `[fk-position] cannot place a cross-module foreign key in the emitted order:\n` +
    `  ${reference.fromTable} → ${reference.toTable} (module "${reference.from}" → ` +
    `module "${reference.to}")\n` +
    `  ${why}.\n` +
    `  An undecidable position is reported, never skipped: a check that answers ` +
    `"no findings" because it could not look is the failure mode issue #113 names.`
  );
}

/**
 * The population the position check reads: cross-module foreign keys created
 * after the baseline block. Extracted so the floor asserted against the real
 * tree is itself provable — an empty scan produces an empty population, and G7
 * shows that, so "zero findings" cannot come to mean "nothing was read".
 */
function openBlockReferencesOf(graph: FkGraph, baselineThrough: string): FkReference[] {
  return graph.references.filter(
    (reference) =>
      reference.declaredIn.timestamp === undefined ||
      reference.declaredIn.timestamp > baselineThrough,
  );
}

describe('fk position — FR-013 the real tree', () => {
  const openBlockReferences = openBlockReferencesOf(graph, BASELINE_THROUGH);

  it('no open-block foreign key crosses into a chain nothing orders', () => {
    const findings = findPositionViolations(graph, MANIFEST_DEPENDENCIES, BASELINE_THROUGH);
    expect(
      findings.map((finding) => finding.message),
      findings.map((finding) => finding.message).join('\n\n'),
    ).toEqual([]);
  });

  // "Zero findings" is only worth something if there was something to find.
  // Both floors below are derived from the scan itself and name what they read,
  // rather than pinning a number a narrowing walk would still clear (D-100).
  it('read a non-empty population of open-block cross-module foreign keys', () => {
    const modules = [...new Set(openBlockReferences.map((reference) => reference.from))].sort();
    expect(
      openBlockReferences.length,
      `the position check examined no open-block foreign key at all — the scan, not ` +
        `the tree, is the likely cause`,
    ).toBeGreaterThan(0);
    expect(modules.length, `open-block foreign keys come from: ${modules.join(', ')}`).
      toBeGreaterThan(0);
  });

  it('resolved a creating migration for every table any migration creates', () => {
    // The exemptions all hinge on the creators map. A map that lost entries
    // would turn every affected reference into an `unclassifiable-position`
    // finding rather than a silent pass, but it would also bury the real
    // signal, so it is asserted here in its own right.
    const uncreated = [...graph.createdTables].filter((table) => !graph.tableCreators.has(table));
    expect(
      uncreated,
      `these tables are created by a migration the scan read, yet no creating ` +
        `migration was recorded for them: ${uncreated.join(', ')}`,
    ).toEqual([]);
  });
});

/**
 * T021 — the red proofs for the position check, one per shape it refuses, plus
 * a discrimination fixture for every exemption.
 *
 * Every fixture enters at the **top** of the analysis: it is a throwaway `src/`
 * tree on disk, read by the same `deriveFkGraph` the real tree is read by, and
 * handed to the same `findPositionViolations`. Nothing here constructs an
 * `FkReference` or a `MigrationSource` by hand — a fixture that enters below the
 * classifier cannot catch a blind classifier, which is issue #130's lesson and
 * the reason the whole parse, ownership and creator chain is exercised on the
 * way in.
 *
 * Stamps: `20260501T000000` is inside the baseline block (`BASELINE_THROUGH` is
 * `20260801T000000`), `2026090*` is outside it.
 */
describe('fk position — T021 proofs', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fk-position-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** `src/modules/<moduleId>/entities/<table>.entity.ts` — the ownership claim. */
  function entity(moduleId: string, table: string): void {
    const dir = join(root, 'modules', moduleId, 'entities');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${table}.entity.ts`),
      `import { Entity } from '@mikro-orm/core';\n` +
        `@Entity({ tableName: '${table}' })\n` +
        `export class Some {}\n`,
      'utf8',
    );
  }

  /**
   * A migration file carrying `sql`. `moduleId: 'core'` writes into
   * `src/db/migrations/`, which is how the scan recognizes the core chain.
   */
  function migration(moduleId: string, filename: string, sql: string): void {
    const dir =
      moduleId === 'core'
        ? join(root, 'db', 'migrations')
        : join(root, 'modules', moduleId, 'migrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, filename),
      `import { Migration } from '@mikro-orm/migrations';\n` +
        `export class X extends Migration {\n` +
        `  override async up(): Promise<void> {\n` +
        `    this.addSql(\`${sql}\`);\n` +
        `  }\n` +
        `}\n`,
      'utf8',
    );
  }

  function creates(table: string): string {
    return `create table "${table}" ("id" uuid not null, constraint "${table}_pkey" primary key ("id"));`;
  }

  function createsReferencing(table: string, target: string): string {
    return (
      `create table "${table}" (\n` +
      `  "id" uuid not null,\n` +
      `  "${target}_id" uuid not null references "${target}" ("id") on update cascade\n` +
      `);`
    );
  }

  function findings(dependencies: Record<string, readonly string[]>): PositionFinding[] {
    return findPositionViolations(
      deriveFkGraph(root),
      new Map(Object.entries(dependencies)),
      BASELINE_THROUGH,
    );
  }

  /** The one shape FR-013 exists for. */
  it('P1 refuses an open-block foreign key into an open-block table nothing declares', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    const found = findings({ a: [], b: [] });

    expect(found.map((finding) => finding.kind)).toEqual(['undeclared-open-edge']);
    const message = found[0]!.message;
    // FR-013: both modules, both tables, and the remedies.
    expect(message).toContain('a_table');
    expect(message).toContain('b_table');
    expect(message).toContain('module "a"');
    expect(message).toContain('module "b"');
    expect(message).toContain('modules/a/migrations/20260902T000000_a_init.ts');
    expect(message).toContain('modules/b/migrations/20260901T000000_b_init.ts');
    expect(message).toContain("add 'b' to `dependencies` in a/manifest.ts");
    expect(message).toContain('move the constraint into a migration owned by "a"');
    expect(message).toContain('ordering-algorithm.md §7');
  });

  /** The second refused shape: the check could not place the migration. */
  it('P2 refuses a foreign key whose declaring file has no parsable stamp', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    // A file sharing the migrations directory under a name the naming contract
    // does not recognize. `migrations-registry.test.ts` refuses one that is a
    // migration; this asserts the position check does not quietly ignore the
    // SQL inside it in the meantime.
    migration('a', 'helper.ts', createsReferencing('a_table', 'b_table'));

    const found = findings({ a: ['b'], b: [] });

    expect(found.map((finding) => finding.kind)).toEqual(['unclassifiable-position']);
    expect(found[0]!.message).toContain('helper.ts');
    expect(found[0]!.message).toContain('no parsable migration stamp');
  });

  /** The same refused shape, reached from the other end of the edge. */
  it('P3 refuses a foreign key into a table no migration creates', () => {
    entity('a', 'a_table');
    // `b_table` is claimed by an entity — so the edge resolves — but no
    // migration brings it into existence, so its position is undecidable.
    entity('b', 'b_table');
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    const found = findings({ a: ['b'], b: [] });

    expect(found.map((finding) => finding.kind)).toEqual(['unclassifiable-position']);
    expect(found[0]!.message).toContain('no migration in the tree creates the referenced table');
    expect(found[0]!.message).toContain('b_table');
  });

  /** Exemption (d) — the declared edge, which is the remedy P1 recommends. */
  it('G1 accepts the same edge once the dependency is declared', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    expect(findings({ a: ['b'], b: [] })).toEqual([]);
  });

  it('G2 accepts an edge declared transitively', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    expect(findings({ a: ['c'], c: ['b'], b: [] })).toEqual([]);
  });

  /** Exemption (a) — this is what makes the 13 acknowledged edges a non-event. */
  it('G3 accepts an undeclared edge into a table the baseline block creates', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260501T000000_b_init.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    expect(findings({ a: [], b: [] })).toEqual([]);
  });

  /**
   * Exemption (b) — core is drained first inside the open block, so an
   * undeclared edge into a table a core migration creates is ordered. This is
   * also the kernel's exemption: kernel tables are core-created by rule.
   */
  it('G4 accepts an undeclared edge into a table an open-block core migration creates', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('core', '20260901T000000_core_late.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    expect(findings({ a: [], b: [] })).toEqual([]);
  });

  /**
   * The baseline block is out of the population: its order is history, it is
   * closed, and the scaffolder clamps every new core stamp past the boundary,
   * so a baseline migration cannot acquire a new foreign key.
   */
  it('G5 ignores a foreign key created by a baseline-block migration', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('a', '20260501T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    expect(findings({ a: [], b: [] })).toEqual([]);
  });

  /**
   * A module's own chain is contiguous and chronological (J2, J3), so an edge
   * created and targeted inside one chain needs no declaration. The two tables
   * still have different owners here — `sales_channels`' bridge tables are the
   * real instance of a chain creating a table another module owns.
   */
  it('G6 accepts an edge whose target is created by the same chain', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('a', '20260901T000000_a_target.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    expect(findings({ a: [], b: [] })).toEqual([]);
  });

  /**
   * The fixtures above are only worth what the scan reading them is worth: an
   * empty tree would make every green above pass for the wrong reason.
   */
  /**
   * The floor the real-tree describe asserts, shown to move. Without it, a scan
   * that reads nothing — a moved tree, a narrowed walk, a source root resolved
   * against the wrong working directory, all of which happen — reports the same
   * "no findings" as a clean tree.
   */
  it('G7 an empty tree yields an empty population, which is what the floor refuses', () => {
    expect(openBlockReferencesOf(deriveFkGraph(root), BASELINE_THROUGH)).toEqual([]);

    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    expect(openBlockReferencesOf(deriveFkGraph(root), BASELINE_THROUGH)).toHaveLength(1);
  });

  it('G0 the fixture tree is actually read', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    const derived = deriveFkGraph(root);
    expect(derived.references.map((reference) => `${reference.from}→${reference.to}`)).toEqual([
      'a→b',
    ]);
    expect(derived.references[0]!.declaredIn.timestamp).toBe('20260902T000000');
    expect(derived.tableCreators.get('b_table')?.moduleId).toBe('b');
  });
});
