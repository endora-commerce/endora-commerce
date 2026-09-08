import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SERVICE_DEPENDENT_UNIT_TESTS,
  type ServiceDependentUnitTest,
} from '../../service-dependent-unit-tests.js';
import { SERVICE_FREE_OUTER_TESTS } from '../../service-free-outer-tests.js';

/**
 * Keeps `SERVICE_DEPENDENT_UNIT_TESTS` honest in both directions (issue #211).
 *
 * That list is what `vitest.unit.config.ts` excludes, so it decides which unit
 * tests the fast, service-less job runs. Both ways of being wrong cost
 * something real:
 *
 *   - **unledgered** — a new unit test that boots the harness is included in
 *     the fast run and fails at the seam. Loud, but the message should name the
 *     ledger, and this test is where that instruction lives.
 *   - **stale** — a listed file that no longer touches a service stays excluded
 *     forever. Nothing fails; the fast job just quietly stops covering it. That
 *     is the direction a one-way list cannot see, and the reason this test
 *     sweeps both.
 *
 * Detection is deliberately narrow: **column-zero import statements only**.
 * `test/unit/scripts/*` is full of source fixtures that contain the same import
 * lines as quoted, indented strings, and a looser scan would report the
 * check-script tests as harness users. The narrowness is safe because a real
 * top-level import is always at column zero — and a file that reached a service
 * some other way would still fail loudly at the seam.
 *
 * ## The population widened, and it is two populations rather than one
 *
 * Feature 112 (`specs/112-test-tree-membership/`, FR-008) makes this file the
 * home of a second rule, over `test/contract` and `test/integration`:
 *
 *   - **scope names the tree** — Constitution III's (a)/(b)/(c);
 *   - **service need names the job**, declared and never inferred from a
 *     directory;
 *   - where the two disagree the job moves and the file does not — **except**
 *     for tree (c), which Principle III *defines* by "exercises the real
 *     database", so a service-free file there is misfiled by scope and moves.
 *
 * It is here rather than in a forty-second `check-*` script for the reason
 * §8 of the contract gives: the deciding predicate is not statically sound, so
 * a check built on one would be a fail-open instrument carrying an inventory
 * row, an estate verdict and a read-size band. This file already owns the
 * predicate, and (verified again in the merge request that widened it) is
 * named by none of `test/unit/scripts/check-inventory.test.ts`,
 * `test/helpers/check-read-sizes.ts` or `packages/cli/src/check/estate.ts`.
 *
 * **The two halves keep separate screens, and that is deliberate.**
 * `serviceNeededBy` above is direct and column-zero, and its narrowness is
 * argued for `test/unit` in the paragraph above; a *transitive* screen calls 41
 * of `test/unit`'s files service-dependent against the 16 the ledger declares,
 * a 2.5× disagreement with the one population in this tree where the truth is
 * written down. The outer trees need the closure — a contract test importing a
 * helper that imports `test-db.js` reaches Postgres just as surely — so
 * {@link reachesAServiceThroughImports} is a second, wider screen used for the
 * outer sweep and for nothing else. Two questions, two predicates; neither is a
 * second derivation of the other's population.
 *
 * **And neither screen decides anything.** R5: membership of the service-free
 * population is established by *running* the file under
 * `BACKEND_TEST_SERVICES=none`. A scan may narrow the population to look at; it
 * may not rule on it, and it fails **open** — `SERVICE_BOUND_BEYOND_THE_SCREEN`
 * below holds the two files measured proving it.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');
/**
 * Both roots the fast run includes: `test/unit` and the unit tests that live
 * beside their source. A ledger that swept only one of them would be a two-way
 * check over half a population.
 */
const SCANNED_ROOTS = [join(BACKEND_ROOT, 'test', 'unit'), join(BACKEND_ROOT, 'src')];

/** A top-level (column-zero) import statement, single- or multi-line. */
const TOP_LEVEL_IMPORT = /^import\b[\s\S]*?from\s*'([^']+)';/gm;

function unitTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...unitTestFiles(full));
    } else if (entry.name.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

function serviceNeededBy(source: string): ServiceDependentUnitTest['needs'] | undefined {
  let needsRedis = false;
  for (const match of source.matchAll(TOP_LEVEL_IMPORT)) {
    const statement = match[0];
    const specifier = match[1] ?? '';
    // `import type` imports a shape, never a connection.
    if (/^import\s+type\b/.test(statement)) continue;
    if (/helpers\/test-server\.js$|helpers\/test-db\.js$/.test(specifier)) return 'postgres';
    if (specifier === 'ioredis') needsRedis = true;
  }
  return needsRedis ? 'redis' : undefined;
}

describe('service-dependent unit tests ledger', () => {
  const files = SCANNED_ROOTS.flatMap(unitTestFiles);

  it('reads both roots — a green result may not mean "found nothing"', () => {
    // 339 files stood here when the ledger landed (315 under test/unit, 24
    // beside their source). The floor is a broken-walk detector, not a target:
    // a wrong root, a rename or a failed readdir must fail this test rather
    // than empty the population and pass.
    expect(files.length).toBeGreaterThan(200);
  });

  const observed = new Map<string, ServiceDependentUnitTest['needs']>();
  for (const file of files) {
    const needs = serviceNeededBy(readFileSync(file, 'utf8'));
    if (needs) observed.set(relative(BACKEND_ROOT, file), needs);
  }

  it('lists every unit test that opens a service connection', () => {
    const ledgered = new Set(SERVICE_DEPENDENT_UNIT_TESTS.map((entry) => entry.path));
    const unledgered = [...observed.keys()].filter((path) => !ledgered.has(path)).sort();
    expect(
      unledgered,
      'These unit tests reach a live service but are not in SERVICE_DEPENDENT_UNIT_TESTS, ' +
        'so the fast run (pnpm --filter backend run test:unit:fast) will fail on them. ' +
        'Add each with the service it needs and why it uses the real one.',
    ).toEqual([]);
  });

  it('lists nothing that has stopped needing a service', () => {
    const stale = SERVICE_DEPENDENT_UNIT_TESTS.filter(
      (entry) => !observed.has(entry.path),
    ).map((entry) => entry.path);
    expect(
      stale,
      'These files are excluded from the fast unit run but no longer import a service ' +
        'harness — either they were deleted or renamed, or they were converted to doubles. ' +
        'Remove the entry so the fast job starts covering them again.',
    ).toEqual([]);
  });

  it('agrees with each entry about which service it needs', () => {
    const disagreements = SERVICE_DEPENDENT_UNIT_TESTS.filter(
      (entry) => observed.has(entry.path) && observed.get(entry.path) !== entry.needs,
    ).map((entry) => `${entry.path}: ledger says ${entry.needs}, file imports ${observed.get(entry.path)}`);
    expect(disagreements).toEqual([]);
  });

  it('gives every entry a reason', () => {
    const unexplained = SERVICE_DEPENDENT_UNIT_TESTS.filter(
      (entry) => entry.reason.trim().length < 20,
    ).map((entry) => entry.path);
    expect(unexplained).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * Feature 112 — the outer trees: scope names the tree, service need names the
 * job (`specs/112-test-tree-membership/contracts/test-tree-membership.md`).
 * -------------------------------------------------------------------------- */

/** `test/contract` and `test/integration` — the two trees the fast run does not include. */
const OUTER_ROOTS = [
  join(BACKEND_ROOT, 'test', 'contract'),
  join(BACKEND_ROOT, 'test', 'integration'),
];

const INTEGRATION_ROOT = join(BACKEND_ROOT, 'test', 'integration');

/**
 * A service reached **through the import closure**, not only at the file's own
 * top level.
 *
 * `serviceNeededBy` above answers "does this file import a harness"; over
 * `test/contract` and `test/integration` the question is "does anything this
 * file pulls in open a connection", because a contract test that imports a
 * helper that imports `test-db.js` reaches Postgres exactly as surely. Measured
 * on this tree, the difference is 12 files in `test/integration` alone — a
 * direct-import screen would have called every one of them service-free and put
 * twelve untrue entries in the ledger below.
 *
 * Relative specifiers only. A bare one is a package, and no package in this
 * tree's test closure opens a service the way `ioredis` does — which is itself
 * a named specifier here rather than a resolution.
 */
const SERVICE_CALL =
  /(^|[^\w.])(setupBackendServer|setupTestDb|setupMigratorTestDb)\s*\(|new Redis\(|MikroORM\.init\(|new MeiliSearch\(/;

const closureCache = new Map<string, boolean>();

function resolveRelative(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function reachesAServiceThroughImports(file: string, seen: Set<string> = new Set()): boolean {
  const cached = closureCache.get(file);
  if (cached !== undefined) return cached;
  if (seen.has(file)) return false;
  seen.add(file);
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  let reaches = SERVICE_CALL.test(source);
  if (!reaches) {
    for (const match of source.matchAll(TOP_LEVEL_IMPORT)) {
      const statement = match[0];
      const specifier = match[1] ?? '';
      if (/^import\s+type\b/.test(statement)) continue;
      if (specifier === 'ioredis') {
        reaches = true;
        break;
      }
      const next = resolveRelative(file, specifier);
      if (next !== null && reachesAServiceThroughImports(next, seen)) {
        reaches = true;
        break;
      }
    }
  }
  // Only a fully-explored file is cached: a `seen` short-circuit answers "not
  // through this cycle", never "not at all".
  if (seen.size === 1 || reaches) closureCache.set(file, reaches);
  return reaches;
}

/**
 * Files under `test/integration/` whose scope names another tree (FR-004).
 *
 * Constitution III **defines** tree (c) as the one that exercises the real
 * database and the real module boundary, so a file there that opens no
 * connection is not an integration test and never was. This is a consequence of
 * that wording, not a carve-out from "the job moves, not the file": these files
 * are not being relocated to change which job runs them, they are mislabelled
 * about what they are.
 *
 * **Expected to empty.** Two entries were retired by the merge request that
 * created this ledger (`module-removal.test.ts` and `worker-compose.test.ts`,
 * now under `test/unit/kernel/`) and the rest are the same move waiting for an
 * owner to read them. Each says which tree its scope names, so the batch that
 * takes one is reading a judgement rather than making it from scratch — but the
 * judgement is still the mover's, and FR-012 holds: a move that also edits an
 * assertion is two changes and two merge requests.
 *
 * The alternative, moving all 17 here, was refused for the reason
 * `research.md` D5 gives about a 48-entry ledger: a ledger that starts full is
 * a ledger nobody drains. 17 is drainable.
 */
interface MisfiledIntegrationTest {
  /** The tree Constitution III's scope test puts it in. */
  readonly scope: 'unit' | 'contract';
  readonly reason: string;
}

const MISFILED_INTEGRATION_TESTS: Readonly<Record<string, MisfiledIntegrationTest>> = {
  'test/integration/_lifecycle/boot-cycle-detect.integration.test.ts': {
    scope: 'unit',
    reason:
      'Drives `discoverManifests` over the on-disk cyclic-graph fixture and asserts the ' +
      'error names both modules. One service, one fixture tree, no connection.',
  },
  'test/integration/_lifecycle/boot-duplicate-id.integration.test.ts': {
    scope: 'unit',
    reason:
      'Two hand-built manifests through `buildStaticRegistry`, asserting the throw. Its own ' +
      'header says it is tested at that layer precisely because the filesystem path is not ' +
      'the subject.',
  },
  'test/integration/_lifecycle/boot-validation-perf.integration.test.ts': {
    scope: 'unit',
    reason:
      'A 500 ms budget over `buildStaticRegistry` with 50 synthetic manifests. A timing ' +
      'assertion over one function, with nothing behind it.',
  },
  'test/integration/_lifecycle/disable-mutes-events.integration.test.ts': {
    scope: 'unit',
    reason:
      '`subscribeForModule` over an in-memory `EventBus` and the registry cache, asserting ' +
      'the handler no-ops while the module is off. Three objects, all constructed here.',
  },
  'test/integration/_lifecycle/disable-returns-503-on-routes.integration.test.ts': {
    scope: 'contract',
    reason:
      'Registers `defineModuleRoutes` on a bare Fastify instance and asserts the wire shape ' +
      'a disabled module answers with — 503 plus `Retry-After: 60`. That is a public ' +
      'envelope, which is III(b), and it is injected rather than served.',
  },
  'test/integration/_lifecycle/uninstall-hard-needs-force.integration.test.ts': {
    scope: 'contract',
    reason:
      'Spawns the real uninstall CLI and asserts exit 64 and its sentence when `--hard` ' +
      'arrives without `--force` in a non-tty. An argv contract, which is III(b); its own ' +
      'header places it here for reaching "the real CLI script in a real subprocess", and a ' +
      'subprocess is not a database. Measured green with no service present.',
  },
  'test/integration/_lifecycle/worker-lifecycle-logging.integration.test.ts': {
    scope: 'unit',
    reason:
      '`defineModuleWorker` over the in-memory worker stub, asserting the `{ module, queue }` ' +
      'log shape. Its own header says it uses a stub "instead of spinning up a real ' +
      'Redis-backed BullMQ queue".',
  },
  'test/integration/_lifecycle/worker-presence-at-boot.integration.test.ts': {
    scope: 'unit',
    reason:
      'The pause decision at a fresh boot, over `loadModulePresence` and the registry cache ' +
      'with a fake worker. It names `EntityManager` in a type position only.',
  },
  'test/integration/_lifecycle/worker-resumed-on-boot.integration.test.ts': {
    scope: 'unit',
    reason:
      'The same three objects again — `defineModuleWorker`, the registry cache and a fake ' +
      'worker — asserting that no boot-time resume loop reintroduces itself.',
  },
  'test/integration/blog/url-prefix-validation.test.ts': {
    scope: 'unit',
    reason:
      '`BlogSettingsResolver.assertValidPrefix`, a static method, called directly. Its own ' +
      'header explains that the contract-shaped version — driving it through the Settings ' +
      'admin surface — was deferred, so what stands is a unit test of one validator.',
  },
  'test/integration/inpost/eligibility-list.test.ts': {
    scope: 'unit',
    reason:
      'Two eligibility validators over a `vi.fn()` settings double. Nothing is persisted and ' +
      'no route is exercised.',
  },
  'test/integration/inpost/place-order-courier.test.ts': {
    scope: 'contract',
    reason:
      '`placeOrderRequestSchema.parse` — a wire shape from `@endora-commerce/contracts`, ' +
      'which is III(b) exactly.',
  },
  'test/integration/inpost/place-order-locker.test.ts': {
    scope: 'contract',
    reason:
      'The locker `shippingAdapterData` schema, parsed. Its own header calls it an ' +
      '"integration contract" and says the database coverage is deferred — so it is the ' +
      'contract half that exists.',
  },
  'test/integration/kernel/boot-failure.test.ts': {
    scope: 'unit',
    reason:
      'Composes two hand-built module entries whose `registerModule` throws, and asserts the ' +
      'failure names the module and that nothing ends up listening. One composition, ' +
      'in memory.',
  },
  'test/integration/kernel/decoration.test.ts': {
    scope: 'unit',
    reason:
      'Hand-built entries through `composeModules`, asserting the decoration errors and the ' +
      'wrap order. The same shape as `test/unit/kernel/decoration-drain.test.ts`, which is ' +
      'already where it says it is.',
  },
  'test/integration/quote_requests/migration.test.ts': {
    scope: 'unit',
    reason:
      'Re-asserts `mapLegacyStatus`, a pure table. Its own header says the unit test for it ' +
      'is `test/unit/quote_requests/status-migration.test.ts` and that the migration\'s SQL ' +
      'half is exercised by every boot — so what is here is the pure half, twice.',
  },
  'test/integration/real-socket-reply-contract.test.ts': {
    scope: 'contract',
    reason:
      'Spawns a probe that serves the real `buildServer` stack over a real socket and asserts ' +
      'the reply contract `inject` cannot see. It is genuinely more than a unit test, and it ' +
      'is still not III(c): what it exercises is a socket, not the database, and III(c) is ' +
      'defined by the database. The honest destination is `test/contract/`, and this entry ' +
      'is the place to argue otherwise if the mover disagrees.',
  },
};

/**
 * Files the closure screen calls service-free and that **are not** — measured
 * by running them (R5, FR-005).
 *
 * This ledger is not debt and is not expected to empty. It is the evidence for
 * the contract's central claim, kept in the artefact rather than only in a
 * design document: a static predicate over this population fails **open**, so a
 * check built on one would recommend putting these two files in a job with no
 * database.
 *
 * Both reach the platform through `await import('../../../src/composition.js')`
 * inside a hook — a **dynamic** specifier, which the closure walk above does not
 * follow and no import walk can follow in general. `research.md` §2.3 records a
 * second shape with the same property, `execFile('pnpm', ['exec', 'tsx', …])` in
 * two `_lifecycle` CLI contract tests.
 *
 * An entry retires by the screen learning to see the file, which is the stale
 * direction swept below.
 */
const SERVICE_BOUND_BEYOND_THE_SCREEN: Readonly<Record<string, string>> = {
  'test/integration/kernel/deactivated-boot.test.ts':
    'Its `beforeAll` asserts `DATABASE_URL`, then dynamically imports `src/composition.ts` ' +
    'and calls `composeApp()` twice — a warm-up boot and the boot under test. Measured ' +
    'under `BACKEND_TEST_SERVICES=none`: the hook fails and all 19 cases are skipped, so ' +
    'the file neither passes nor asserts anything. Correctly III(c).',
  'test/integration/kernel/required-module-absent.test.ts':
    'Composes the production root through the same dynamic import with `settings` withheld, ' +
    'and asserts the refusal names it. Measured under `BACKEND_TEST_SERVICES=none`: 3 of 5 ' +
    'cases fail, because the composition dies for the wrong reason before the assertion is ' +
    'reached. Correctly III(c).',
  'test/integration/demo/demo-parity.test.ts':
    'It provisions three PostgreSQL databases of its own with `pg` and spawns the migration ' +
    'runner and both seeds as child processes, so it reaches the database through a client ' +
    'it constructs and through `spawn` — neither of which is an import the closure screen ' +
    'can follow. Measured under `BACKEND_TEST_SERVICES=none`: `connect ECONNREFUSED ' +
    '127.0.0.1:1`, the `beforeAll` fails and all 37 cases are skipped. Correctly III(c).',
};

function outerTestFiles(): string[] {
  return OUTER_ROOTS.flatMap((root) => unitTestFiles(root));
}

describe('112 — the outer trees, swept against their declarations', () => {
  const outerFiles = outerTestFiles();
  const serviceFreeOuter = new Set(
    outerFiles
      .filter((file) => !reachesAServiceThroughImports(file))
      .map((file) => relative(BACKEND_ROOT, file)),
  );

  it('reads both outer roots and classifies both ways', () => {
    // Three floors, and each answers a different way of looking at nothing.
    // A root that stopped resolving empties the population; a screen that
    // matched everything reports no misfiling and passes; a screen that matched
    // nothing reports the whole tree as misfiled, which is a finding about the
    // walk dressed as one about the tree.
    for (const root of OUTER_ROOTS) {
      expect(
        unitTestFiles(root).length,
        `${relative(BACKEND_ROOT, root)} contributed no test file`,
      ).toBeGreaterThan(0);
    }
    expect(serviceFreeOuter.size, 'the screen called every outer test service-bound').toBeGreaterThan(0);
    expect(
      outerFiles.length - serviceFreeOuter.size,
      'the screen called every outer test service-free',
    ).toBeGreaterThan(0);
  });

  it('names every service-free file under test/integration', () => {
    // FR-004. `test/integration` is the one tree Principle III defines by what
    // it dials, so a file there that dials nothing is misfiled by scope.
    const declared = new Set([
      ...Object.keys(MISFILED_INTEGRATION_TESTS),
      ...Object.keys(SERVICE_BOUND_BEYOND_THE_SCREEN),
    ]);
    const unledgered = [...serviceFreeOuter]
      .filter((path) => path.startsWith(relative(BACKEND_ROOT, INTEGRATION_ROOT)))
      .filter((path) => !declared.has(path))
      .sort();
    expect(
      unledgered,
      'These files sit under `test/integration/` and open no service connection that a ' +
        'closure screen can see. Constitution III defines that tree as the one that ' +
        'exercises the real database, so either the file belongs in `test/unit` or ' +
        '`test/contract` — move it, with no change to what it asserts (FR-012) — or it ' +
        'reaches a service in a way the screen cannot follow, in which case run it under ' +
        '`BACKEND_TEST_SERVICES=none` and record it in SERVICE_BOUND_BEYOND_THE_SCREEN with ' +
        'the measurement.',
    ).toEqual([]);
  });

  it('holds no entry that has stopped describing the tree', () => {
    const stale = [
      ...Object.keys(MISFILED_INTEGRATION_TESTS),
      ...Object.keys(SERVICE_BOUND_BEYOND_THE_SCREEN),
    ]
      .filter((path) => !existsSync(join(BACKEND_ROOT, path)))
      .sort();
    expect(
      stale,
      'These ledger entries name a file that is not there — it was moved (which is the ' +
        'point, so delete the entry in the same merge request) or deleted.',
    ).toEqual([]);
  });

  it('holds no misfiling entry for a file the screen now calls service-bound', () => {
    const stale = Object.keys(MISFILED_INTEGRATION_TESTS)
      .filter((path) => existsSync(join(BACKEND_ROOT, path)) && !serviceFreeOuter.has(path))
      .sort();
    expect(
      stale,
      'These files now reach a service, so they are correctly under `test/integration` and ' +
        'the entry claiming otherwise is stale.',
    ).toEqual([]);
  });

  it('holds no blind-spot entry the screen has learned to see', () => {
    const stale = Object.keys(SERVICE_BOUND_BEYOND_THE_SCREEN)
      .filter((path) => existsSync(join(BACKEND_ROOT, path)) && serviceFreeOuter.has(path) === false)
      .sort();
    expect(
      stale,
      'The closure screen now sees the service these files reach, so the entry recording it ' +
        'as a blind spot no longer describes anything. Delete it.',
    ).toEqual([]);
  });

  it('gives every entry a reason', () => {
    const unexplained = [
      ...Object.entries(MISFILED_INTEGRATION_TESTS).map(
        ([path, entry]) => [path, entry.reason] as const,
      ),
      ...Object.entries(SERVICE_BOUND_BEYOND_THE_SCREEN),
    ]
      .filter(([, reason]) => reason.trim().length < 40)
      .map(([path]) => path);
    expect(unexplained).toEqual([]);
  });
});

describe('112 — the fast job\'s outer include, swept against the tree', () => {
  it('names a file that exists, in the tree the entry declares', () => {
    const wrong = SERVICE_FREE_OUTER_TESTS.filter(
      (entry) =>
        !existsSync(join(BACKEND_ROOT, entry.path)) ||
        !entry.path.startsWith(`test/${entry.tree}/`),
    ).map((entry) => `${entry.path} (declared tree: ${entry.tree})`);
    expect(
      wrong,
      'These entries of SERVICE_FREE_OUTER_TESTS name a file that is gone, or that has ' +
        'moved out of the tree the entry records. `vitest.unit.config.ts` includes those ' +
        'paths, so a stale one silently stops the fast job covering the file — the ' +
        'direction a one-way list cannot see.',
    ).toEqual([]);
  });

  it('names no file the closure screen calls service-bound', () => {
    // The static half of FR-008's first direction. The loud half is the seam:
    // a declared file that starts dialling fails `assertServicesAvailable` in
    // the fast run itself, naming this ledger. This catches the shape the seam
    // cannot — an import added while nobody ran the fast job.
    const dialling = SERVICE_FREE_OUTER_TESTS.filter((entry) =>
      reachesAServiceThroughImports(join(BACKEND_ROOT, entry.path)),
    ).map((entry) => entry.path);
    expect(
      dialling,
      'These files are declared service-free and included in the fast, service-less run, ' +
        'and they now reach a service through their import closure. Either the import is ' +
        'the mistake, or the entry is.',
    ).toEqual([]);
  });

  it('gives every entry a reason and a tree', () => {
    const unexplained = SERVICE_FREE_OUTER_TESTS.filter(
      (entry) => entry.reason.trim().length < 40,
    ).map((entry) => entry.path);
    expect(unexplained).toEqual([]);
    expect(SERVICE_FREE_OUTER_TESTS.length, 'the declaration is empty').toBeGreaterThan(0);
  });
});
