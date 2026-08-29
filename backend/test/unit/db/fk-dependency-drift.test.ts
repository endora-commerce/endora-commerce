import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverModulePackages } from '../../../scripts/lib/module-packages.js';
import { platformResidentModuleRoots } from '../../../scripts/lib/module-roots.js';
import { platformSourceRootAt } from '../../../scripts/lib/platform-root.js';
import {
  coreModuleRoot,
  deriveFkGraph,
  KERNEL_OWNER,
  type FkEdge,
  type FkGraph,
  type FkReference,
  type ModuleRoot,
  type MigrationSource,
} from '../../helpers/fk-graph.js';
import { TABLE_OWNER_OVERRIDES } from './table-owner-overrides.js';
import { ACKNOWLEDGED_FK_EDGES, type AcknowledgedFkEdge } from './acknowledged-fk-edges.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';
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
/**
 * The kernel's entity classes, which since the relocation are
 * `@endora-commerce/platform`'s. `backend/src/kernel` holds re-export shims that
 * carry no `@Entity()`, so a walk of them owns none of the six kernel tables.
 */
const platformKernel = resolve(here, '../../../../packages/platform/src/kernel');

/**
 * Every module, over both roots the tree now has (feature 080, T040b).
 *
 * A module that has become a workspace package is not under `src/modules`, so
 * without its root here the walk produces no entity and no migration for it and
 * `modulesWithoutDirectories` reports it — which is the refusal below working,
 * and the repair is to read the second root rather than to soften it. The
 * packages are found through their own `endora: { type: 'module', id }` blocks,
 * the same declaration `lib/module-roots.ts` and the composer read; the origin
 * is `core` because these sources are committed in this repository, unlike an
 * installed package's.
 */
const graph = deriveFkGraph(backendSrc, {
  overrides: TABLE_OWNER_OVERRIDES,
  kernelRoot: platformKernel,
  moduleRoots: [
    coreModuleRoot(backendSrc),
    ...discoverModulePackages(resolve(backendSrc, '../..')).map((pkg) => ({
      directory: pkg.dir,
      origin: 'core' as const,
      moduleId: pkg.moduleId,
    })),
    // The third root, and there is one module in it: `_lifecycle`, which merged
    // into the host package (D-160.11) and whose directory is therefore under
    // neither of the two above.
    //
    // It cannot be read off the index's `manifestPath` the way the host-resident
    // case was: a module inside the platform is imported at that package's
    // **built** file, so `manifestPath` names `dist/` — which is where its i18n
    // bundles are and is not where its entities would be. The layout's own
    // derivation is used instead, which finds it by the same marker core
    // discovery uses, so the refusal below keeps meaning "the walk lost a
    // module" rather than "the layout changed".
    ...platformResidentModuleRoots(
      platformSourceRootAt(resolve(backendSrc, '../..')),
      [],
      new Set(DISCOVERED_MANIFESTS.map((entry) => entry.id)),
    ).map((root) => ({
      directory: root.directory,
      origin: 'core' as const,
      moduleId: root.moduleId!,
    })),
  ],
});

/** Every module package's npm name, mapped to the module id it declares. */
const PACKAGE_MODULE_IDS: ReadonlyMap<string, string> = new Map(
  discoverModulePackages(resolve(backendSrc, '../..')).map(
    (pkg) => [pkg.name, pkg.moduleId] as const,
  ),
);

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

/* ────────────────────────────────────────────────────────────────────────────
 * The population floor (issue #215; feature 080, T013).
 *
 * The two floors here used to be the numbers 50 and 150. A hand-written count
 * is a copy of a derived fact — it says nothing about *which* modules were
 * read, so a walk that lost half the tree still cleared it, and D-100 is the
 * standing warning about exactly that copy. They are derived from
 * `DISCOVERED_MANIFESTS`, a committed artefact this file already imports: it
 * moves when the tree moves, and it names the modules rather than counting them.
 *
 * Both are pure functions of the graph and the registry, so the proofs below
 * drive them from a fixture tree on disk read by the same `deriveFkGraph` —
 * a floor that only ever ran against the real tree is a floor nothing shows
 * moving (issue #130).
 * ──────────────────────────────────────────────────────────────────────────── */

const REGISTERED_IDS: readonly string[] = DISCOVERED_MANIFESTS.map((entry) => entry.id);

/** Registered modules the scan resolved no directory for, under any root. */
function modulesWithoutDirectories(graph: FkGraph, registered: readonly string[]): string[] {
  return registered.filter((id) => !graph.modules.has(id));
}

/** Does the module's resolved directory hold TypeScript directly under `folder`? */
function shipsTypeScriptIn(graph: FkGraph, moduleId: string, folder: string): boolean {
  const scanned = graph.modules.get(moduleId);
  if (scanned === undefined) return false;
  const directory = join(scanned.directory, folder);
  return existsSync(directory) && readdirSync(directory).some((f) => f.endsWith('.ts'));
}

/**
 * Module ids the committed migration registry attributes a migration to, read
 * out of its import specifiers.
 *
 * Text rather than an import: the registry pulls in 250 migration classes, and
 * the question here is which modules it *names*, which the specifiers answer
 * without loading anything.
 *
 * **Both spellings, because the generator emits both** (D-149): a relative
 * `'../modules/<id>/migrations/…'` for a module in the application tree, and a
 * bare `'<package>/migrations'` for one that has become a package. The bare
 * half was missing and the floor above is what found it: T040b packaged the
 * last module whose migration the registry named relatively, `expected` came
 * back **empty**, and the non-vacuity assertion beside it fired. That ordering
 * is the whole design — a recognizer that quietly stopped matching would have
 * left `modulesWithoutSources` answering `[]` over a population of nothing,
 * which is the shape issue #215 is about, in the test written to refuse it.
 *
 * The package→id direction is derived, never spelled: a package's npm name is
 * npm's namespace and its `endora.id` is identity of record (D-142), and only
 * the module that declares the block can say which is which.
 */
function modulesWithMigrationsInRegistry(
  registrySource: string,
  packageModuleIds: ReadonlyMap<string, string> = PACKAGE_MODULE_IDS,
): string[] {
  const found = new Set<string>();
  for (const match of registrySource.matchAll(/from '\.\.\/modules\/([A-Za-z0-9_]+)\/migrations\//g)) {
    found.add(match[1]!);
  }
  for (const [name, moduleId] of packageModuleIds) {
    if (registrySource.includes(`from '${name}/migrations'`)) found.add(moduleId);
  }
  return [...found].sort();
}

/**
 * Modules a second committed artefact says ship migrations, out of which this
 * walk opened no file at all.
 *
 * This is the "no **module** files" half, and it needs an *independent* source
 * or it is the same walk asked twice: a module whose directory resolved and
 * whose migrations the scan never read attributes no table, contributes no
 * reference, and is indistinguishable from a module that ships no schema. A
 * count would not do — 44 of the registered modules legitimately ship no
 * migration at all, so the floor has to name which ones it expects.
 */
function modulesWithoutSources(graph: FkGraph, expected: readonly string[]): string[] {
  return expected.filter((id) => (graph.modules.get(id)?.files ?? 0) === 0);
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

  it('resolves a directory for every registered module (the tree is where it looks)', () => {
    // A moved module tree makes the walk read a residue and report on it. This
    // is the "path that must resolve" half: the registry says the module is
    // there, so a scan that cannot find it is an error, never an empty result.
    const missing = modulesWithoutDirectories(graph, REGISTERED_IDS);
    expect(missing, `registered, and no directory under any scanned root: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('reads a source for every module the migration registry names', () => {
    // The "no **module** files" half (feature 080, T013). The directory
    // resolving is not enough: a *partial* move — the one a package split
    // performs — leaves the walk short rather than empty, and a scan that
    // opened none of a module's files attributes none of its tables, which
    // reads as a clean graph and not as a broken scan.
    const expected = modulesWithMigrationsInRegistry(
      readFileSync(join(backendSrc, 'db', 'migrations-registry.generated.ts'), 'utf8'),
    );
    expect(
      expected.length,
      'the migration registry named no module at all — the recognizer, not the tree',
    ).toBeGreaterThan(0);
    const unread = modulesWithoutSources(graph, expected);
    expect(
      unread,
      `the migration registry files migrations under these modules and the scan opened ` +
        `no file in them: ${unread.join(', ')}`,
    ).toEqual([]);
  });

  it('resolves an owner for every registered module that ships entities', () => {
    // The third: the files were opened and the `tableName:` regex still matched
    // inside them. A regex that stopped matching would leave every table
    // unowned and every cross-module edge unattributed, with both floors above
    // still green.
    const owners = new Set(graph.entityOwners.values());
    const unread = REGISTERED_IDS.filter((id) => shipsTypeScriptIn(graph, id, 'entities')).filter(
      (id) => !owners.has(id),
    );
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
 * Baseline membership takes **both** conditions, `origin === 'core'` and the
 * stamp, exactly as `isBaseline` in `migration-order.ts` does (D-154). It used
 * to test the stamp alone, justified here by D-105 — *"out-of-core code
 * contributes no schema"* — and **D-106 overruled that premise**: a package may
 * ship migrations. A package migration stamped inside the baseline window is
 * placed by `orderMigrations` in the open block, where nothing but a declared
 * dependency orders it, and was skipped outright by the predicate below. That
 * is a false negative on precisely the input this check exists for, and it was
 * unreachable until T013 gave the scan roots it could tag (feature 080).
 */
/**
 * `isBaseline` from `migration-order.ts`, over a scanned file rather than a
 * registry entry: **both** conditions, in one place, so the two readers below
 * cannot drift apart from each other or from the algorithm.
 *
 * An unparsable stamp is not baseline — the callers report it as
 * `unclassifiable-position` rather than letting it fall either way.
 */
function isBaselineBlock(migration: MigrationSource, baselineThrough: string): boolean {
  return (
    migration.origin === 'core' &&
    migration.timestamp !== undefined &&
    migration.timestamp <= baselineThrough
  );
}

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
    // created inside it is history, and history already applied — and only a
    // *core* file's history is in that prefix, which is why the origin is half
    // the test.
    if (isBaselineBlock(declaring, baselineThrough)) continue;

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

    if (isBaselineBlock(creator, baselineThrough)) continue;
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
    (reference) => !isBaselineBlock(reference.declaredIn, baselineThrough),
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
    // Both roots exist from the start: `deriveFkGraph` refuses a root that does
    // not resolve, and a proof whose package root happened to be missing would
    // fail on that refusal rather than on the shape it is about.
    mkdirSync(join(root, 'modules'), { recursive: true });
    mkdirSync(join(root, 'packages'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * The two roots every fixture below is read through: the core module tree,
   * and one installed package's (D-106). The package root is created empty by
   * `beforeEach`, so a proof that does not use it is read exactly as it was
   * before T013 — the discrimination the origin proofs rest on is *which root a
   * module was written under*, and nothing else.
   */
  function fixtureRoots(): ModuleRoot[] {
    return [
      { directory: join(root, 'modules'), origin: 'core' },
      { directory: join(root, 'packages'), origin: 'external' },
    ];
  }

  function graphOf(): FkGraph {
    return deriveFkGraph(root, { moduleRoots: fixtureRoots() });
  }

  /** Where a fixture module's directory is written. */
  type Where = 'core' | 'package';

  function moduleDir(moduleId: string, where: Where): string {
    return join(root, where === 'core' ? 'modules' : 'packages', moduleId);
  }

  /** `<root>/entities/<table>.entity.ts` — the ownership claim. */
  function entity(moduleId: string, table: string, where: Where = 'core'): void {
    const dir = join(moduleDir(moduleId, where), 'entities');
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
  function migration(
    moduleId: string,
    filename: string,
    sql: string,
    where: Where = 'core',
  ): void {
    const dir =
      moduleId === 'core'
        ? join(root, 'db', 'migrations')
        : join(moduleDir(moduleId, where), 'migrations');
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
    return findPositionViolations(graphOf(), new Map(Object.entries(dependencies)), BASELINE_THROUGH);
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
    expect(openBlockReferencesOf(graphOf(), BASELINE_THROUGH)).toEqual([]);

    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    expect(openBlockReferencesOf(graphOf(), BASELINE_THROUGH)).toHaveLength(1);
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * D-154 — baseline membership takes the origin, and only a scan with roots
   * can tell one. Every proof below differs from its control by **one thing**:
   * which root the module was written under.
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * The false negative D-154 names, red. Under the stamp-alone rule this
   * fixture produced no finding at all: `20260501T000000` is inside the
   * baseline window, so the declaring migration was skipped before anything
   * about its chain was examined — while `orderMigrations` puts it in the open
   * block, where nothing orders it against `b`.
   */
  it('P4 refuses a package migration stamped inside the baseline window', () => {
    entity('b', 'b_table');
    entity('p', 'p_table', 'package');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('p', '20260501T000000_p_init.ts', createsReferencing('p_table', 'b_table'), 'package');

    const found = findings({ b: [], p: [] });

    expect(found.map((finding) => finding.kind)).toEqual(['undeclared-open-edge']);
    expect(found[0]!.message).toContain('p_table');
    expect(found[0]!.message).toContain('b_table');
  });

  /** The same for the other end of the edge: the creator's origin counts too. */
  it('P5 refuses an edge into a package table stamped inside the baseline window', () => {
    entity('a', 'a_table');
    entity('p', 'p_table', 'package');
    migration('p', '20260501T000000_p_init.ts', creates('p_table'), 'package');
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'p_table'));

    const found = findings({ a: [], p: [] });

    expect(found.map((finding) => finding.kind)).toEqual(['undeclared-open-edge']);
    expect(found[0]!.message).toContain('a_table');
    expect(found[0]!.message).toContain('p_table');
  });

  /**
   * The discrimination for both: the same stamp, the same SQL, under the core
   * root. Its order *is* history and it stays exempt — a check that reported
   * this one would be refusing the frozen prefix itself.
   */
  it('G8 still ignores the same stamp when the module is core', () => {
    entity('b', 'b_table');
    entity('p', 'p_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('p', '20260501T000000_p_init.ts', createsReferencing('p_table', 'b_table'));

    expect(findings({ b: [], p: [] })).toEqual([]);
  });

  /** The declared dependency still exempts a package edge — (d) is origin-blind. */
  it('G9 accepts a package edge once the dependency is declared', () => {
    entity('b', 'b_table');
    entity('p', 'p_table', 'package');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('p', '20260501T000000_p_init.ts', createsReferencing('p_table', 'b_table'), 'package');

    expect(findings({ b: [], p: ['b'] })).toEqual([]);
  });

  it('G0 the fixture tree is actually read', () => {
    entity('a', 'a_table');
    entity('b', 'b_table');
    migration('b', '20260901T000000_b_init.ts', creates('b_table'));
    migration('a', '20260902T000000_a_init.ts', createsReferencing('a_table', 'b_table'));

    const derived = graphOf();
    expect(derived.references.map((reference) => `${reference.from}→${reference.to}`)).toEqual([
      'a→b',
    ]);
    expect(derived.references[0]!.declaredIn.timestamp).toBe('20260902T000000');
    expect(derived.tableCreators.get('b_table')?.moduleId).toBe('b');
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * T013 — the population floor, shown moving.
   *
   * The floors above run against the real tree, where they are green by
   * construction; a floor nothing has ever seen fire is a floor nobody knows
   * the shape of (issue #130). Both proofs below drive the same functions the
   * real-tree assertions call, from a fixture tree read by the same
   * `deriveFkGraph` — the registry is the only thing supplied by hand, because
   * the registry *is* the independent source and a fixture that derived it from
   * the same walk would be asking one walk twice.
   * ────────────────────────────────────────────────────────────────────────── */

  it('F1 names a registered module no root holds a directory for', () => {
    entity('a', 'a_table');

    const derived = graphOf();

    expect(modulesWithoutDirectories(derived, ['a', 'b', 'c'])).toEqual(['b', 'c']);
    // The control: a registry that agrees with the tree refuses nothing, so the
    // finding above is the missing modules rather than anything else the
    // fixture did.
    expect(modulesWithoutDirectories(derived, ['a'])).toEqual([]);
  });

  it('F2 names a module the migration registry files migrations under and the walk missed', () => {
    entity('a', 'a_table');
    migration('a', '20260901T000000_a_init.ts', creates('a_table'));
    // `b` is a module directory with nothing in it — the partial move, which is
    // what a package split performs: the walk is short, not empty, and every
    // emptiness test is green on it.
    mkdirSync(moduleDir('b', 'core'), { recursive: true });

    const registry =
      `import { M1 } from '../modules/a/migrations/20260901T000000_a_init.js';\n` +
      `import { M2 } from '../modules/b/migrations/20260902T000000_b_init.js';\n`;
    const expected = modulesWithMigrationsInRegistry(registry, new Map());

    expect(expected).toEqual(['a', 'b']);
    expect(modulesWithoutSources(graphOf(), expected)).toEqual(['b']);
    // The control, one variable away: the registry that names only what the
    // tree holds.
    expect(modulesWithoutSources(graphOf(), ['a'])).toEqual([]);
  });

  it('F2 reads a packaged module’s bare migration specifier as that module', () => {
    // The other half of the same floor, and the one that was missing. Once a
    // module is a package the registry names it `'<package>/migrations'`, and a
    // recognizer that reads only the relative spelling reports the module as
    // shipping no migration — silently, and by construction more often with
    // every move the sweep makes.
    const packages = new Map([
      ['@endora-commerce/mod-a', 'a'],
      ['@endora-commerce/mod-b', 'b'],
    ]);
    const registry =
      `import { M1 } from '@endora-commerce/mod-a/migrations';\n` +
      `import { M2 } from '@endora-commerce/mod-b/migrations';\n`;

    expect(modulesWithMigrationsInRegistry(registry, packages)).toEqual(['a', 'b']);
    // The control: the same text read without the derivation that maps a
    // package name to a module id sees nothing at all, which is exactly the
    // state that made this proof necessary.
    expect(modulesWithMigrationsInRegistry(registry, new Map())).toEqual([]);
  });

  it('G0b a package fixture is read, and read as a package', () => {
    // The control under all four origin proofs: without it, `P4` and `P5` could
    // be red because the scan never saw the package module at all — the failure
    // mode that would make an origin test pass while proving nothing.
    entity('p', 'p_table', 'package');
    migration('p', '20260501T000000_p_init.ts', creates('p_table'), 'package');

    const derived = graphOf();
    expect(derived.modules.get('p')?.origin).toBe('external');
    expect(derived.modules.get('p')?.files).toBe(2);
    expect(derived.owners.get('p_table')).toBe('p');
    expect(derived.tableCreators.get('p_table')?.origin).toBe('external');
  });
});
