import { describe, expect, it, vi } from 'vitest';
import {
  checkModuleBoundary,
  findCrossModuleImports,
  findCrossModuleSql,
  findMigrationSql,
} from '../../../scripts/check-module-boundary.js';
import {
  checkFixtureSubstitution,
  filesReadingTheDatabase,
  findDefaultedReads,
  scanFixtureSubstitution,
} from '../../../scripts/check-fixture-substitution.js';
import {
  checkSharedTableWipes,
  filesDeletingRows,
  findUnscopedWipes,
  scanSharedTableWipes,
} from '../../../scripts/check-shared-table-wipes.js';
import {
  checkSubscribeSeam,
  checkWorkerSeam,
  findBareSubscriptions,
  scanSubscribeSeam,
} from '../../../scripts/check-subscribe-seam.js';
import { dependencyClosures } from '../../../scripts/lib/manifest-dependencies.js';

/**
 * The whole-tree checks parse each source once (issue #910).
 *
 * Each of these checks runs several recognisers over one tree, and each
 * recogniser parsed the text it was handed: `check:module-boundary` made 14662
 * `ts.createSourceFile` calls over 3929 files, `check:subscribe-seam` 10399
 * over 2652, `check:shared-table-wipes` 6347 and `check:fixture-substitution`
 * 4396 over 2199. The property pinned here is the one the repair claims, over
 * the function each CLI runs: every file is parsed **once** — the one stated
 * exception being a subscribe-seam file that can hold a worker site — and the
 * answers are the ones the same recognisers give unshared.
 *
 * The spy is on the compiler itself rather than on the shared-parse helper, so
 * a recogniser that goes back to calling `ts.createSourceFile` directly is
 * counted too — a helper that counted only its own calls could not see the
 * regression it exists to catch.
 */

const parses = vi.hoisted(() => [] as string[]);

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('typescript') }>();
  const real = actual.default;
  const createSourceFile: typeof real.createSourceFile = (...args) => {
    parses.push(args[0]);
    return real.createSourceFile(...args);
  };
  // `typescript`'s exports are getter-only, so the module is wrapped rather
  // than patched: every other member reads through to the real compiler.
  const wrapped = new Proxy(real, {
    get: (target, property, receiver) =>
      property === 'createSourceFile' ? createSourceFile : Reflect.get(target, property, receiver),
  });
  return { ...actual, default: wrapped };
});

const A_SERVICE = 'modules/a/services/a-service.ts';
const A_ENTITY = 'modules/a/entities/a-thing.entity.ts';
const A_MIGRATION = 'modules/a/migrations/20260901T101010_a_widen.ts';
const A_LATER_MIGRATION = 'modules/a/migrations/20260902T101010_a_narrow.ts';
const B_ENTITY = 'modules/b/entities/b-thing.entity.ts';
const B_SERVICE = 'modules/b/services/b-service.ts';
const CORE_MIGRATION = 'db/migrations/20260424T165847_core_foundation_init.ts';

/** Every recogniser has something to find in at least one of these. */
const SOURCES: ReadonlyMap<string, string> = new Map([
  ['modules/a/backend.ts', 'export function registerModule(ctx) {}'],
  ['modules/b/backend.ts', 'export function registerModule(ctx) {}'],
  [
    A_SERVICE,
    [
      "import { BService } from '../../b/services/b-service';",
      'export async function load(knex) {',
      "  await knex('b_things').where({ id: 1 });",
      '  return knex.raw(`select * from "b_things" where "id" = 1`);',
      '}',
    ].join('\n'),
  ],
  [A_ENTITY, "@Entity({ tableName: 'a_table' })\nexport class AThing {}"],
  [B_ENTITY, '@Entity()\nexport class BThing {}'],
  [B_SERVICE, 'export class BService {}'],
  [
    A_MIGRATION,
    [
      'export class Migration20260901T101010AWiden {',
      '  async up() {',
      '    this.addSql(`create index "b_things_flag_index" on "b_things" ("flag");`);',
      '    this.addSql(`update "b_things" set "flag" = true where "id" is not null;`);',
      '  }',
      '}',
    ].join('\n'),
  ],
  [
    A_LATER_MIGRATION,
    [
      'export class Migration20260902T101010ANarrow {',
      '  async up() {',
      '    this.addSql(`drop index "b_things_flag_index";`);',
      '  }',
      '}',
    ].join('\n'),
  ],
]);

/** The owner map's walk: the module sources' `.ts` files plus a core migration. */
const SCHEMA: ReadonlyMap<string, string> = new Map([
  ...[...SOURCES].filter(([file]) => file !== 'modules/a/backend.ts' && file !== 'modules/b/backend.ts'),
  [
    CORE_MIGRATION,
    'this.addSql(`create table "sales_channel_products" ("sales_channel_id" uuid not null);`);',
  ],
]);

const INPUT = {
  sources: SOURCES,
  schema: SCHEMA,
  dependencyClosures: dependencyClosures(
    new Map([
      ['a', []],
      ['b', []],
    ]),
  ),
};

/** How many times each file was parsed while `work` ran. */
function parsesPerFile(work: () => unknown): Map<string, number> {
  parses.length = 0;
  work();
  const perFile = new Map<string, number>();
  for (const file of parses) perFile.set(file, (perFile.get(file) ?? 0) + 1);
  return perFile;
}

/** The files parsed more than once — `[]` is the property. */
const reparsed = (perFile: ReadonlyMap<string, number>): string[] =>
  [...perFile].filter(([, count]) => count > 1).map(([file, count]) => `${file} x${count}`);

describe('check:module-boundary — one parse per source (issue #910)', () => {
  it('parses every file the analysis reads exactly once', () => {
    const perFile = parsesPerFile(() => checkModuleBoundary(INPUT, []));
    expect(reparsed(perFile), 'files parsed more than once').toEqual([]);
    // And none is skipped: the walk still reads every source and every schema
    // file, which is what makes the count above mean "once" rather than "never".
    expect(new Set(perFile.keys())).toEqual(new Set([...SOURCES.keys(), ...SCHEMA.keys()]));
  });

  it('reports what the same recognisers report unshared', () => {
    // Each `find*` below runs outside any shared-parse scope, so it parses for
    // itself exactly as the check did before #910: the reference answer.
    const sql = findCrossModuleSql(INPUT);
    const imports = findCrossModuleImports(INPUT);
    const migration = findMigrationSql(INPUT);
    // Not vacuous: each predicate found something in the fixture.
    expect(imports.found.length).toBeGreaterThan(0);
    expect(sql.found.length).toBeGreaterThan(0);
    expect(migration.found.map((finding) => finding.statement)).toContain(
      'drop index "b_things_flag_index";',
    );

    const result = checkModuleBoundary(INPUT, []);
    const reference = [...imports.found, ...sql.found].sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
    );
    expect(result.violations).toEqual(reference);
    expect(result.migrationFindings).toEqual(migration.found);
    expect(result.tableOwners).toEqual(sql.report);
    expect(result.examinedSpecifiers).toBe(imports.sites);
    expect(result.examinedTableReferences).toBe(sql.sites + migration.sites);
    expect(result.migrationClasses).toEqual(migration.declaredClasses);
  });
});

/** Two test files: one that reads the database and defaults it, one that wipes a table. */
const TEST_SOURCES = {
  sources: new Map([
    [
      'integration/carts/x.integration.test.ts',
      [
        'beforeAll(async () => {',
        '  const ch = await em.findOne(SalesChannel, { systemDefault: true });',
        "  systemDefaultChannelId = ch?.id ?? '';",
        '});',
      ].join('\n'),
    ],
    [
      'contract/comparisons/x.contract.test.ts',
      [
        'beforeEach(async () => {',
        '  await em.nativeDelete(Comparison, {});',
        "  await em.findOne(Comparison, { id: '1' });",
        '});',
      ].join('\n'),
    ],
  ]),
};

describe('check:fixture-substitution — one parse per test file (issue #910)', () => {
  it('parses each file once between the guard, the rule and the listing', () => {
    const perFile = parsesPerFile(() => scanFixtureSubstitution(TEST_SOURCES));
    expect(reparsed(perFile), 'files parsed more than once').toEqual([]);
    expect(new Set(perFile.keys())).toEqual(new Set(TEST_SOURCES.sources.keys()));
  });

  it('reports what the same walks report unshared', () => {
    const scan = scanFixtureSubstitution(TEST_SOURCES);
    expect(scan.found.length).toBeGreaterThan(0);
    expect(scan.reading).toBe(filesReadingTheDatabase(TEST_SOURCES));
    expect(scan.found).toEqual(findDefaultedReads(TEST_SOURCES));
    expect(scan.result).toEqual(checkFixtureSubstitution(TEST_SOURCES));
  });
});

describe('check:shared-table-wipes — one parse per test file (issue #910)', () => {
  it('parses each file once between the guard, the listing and the rule', () => {
    const perFile = parsesPerFile(() => scanSharedTableWipes(TEST_SOURCES));
    expect(reparsed(perFile), 'files parsed more than once').toEqual([]);
    expect(new Set(perFile.keys())).toEqual(new Set(TEST_SOURCES.sources.keys()));
  });

  it('reports what the same walks report unshared', () => {
    const scan = scanSharedTableWipes(TEST_SOURCES);
    expect(scan.wipes.length).toBeGreaterThan(0);
    expect(scan.deleting).toBe(filesDeletingRows(TEST_SOURCES));
    expect(scan.wipes).toEqual(findUnscopedWipes(TEST_SOURCES));
    expect(scan.result).toEqual(checkSharedTableWipes(TEST_SOURCES));
  });
});

const QUEUE_FACTORY = 'modules/pwa/services/push-delivery-queue.ts';
const PLUGIN = 'modules/pwa/plugin.ts';
const SUBSCRIBER = 'modules/pwa/subscribers.ts';
const FORWARDER = 'modules/catalog/backend.ts';
const BYSTANDER = 'modules/catalog/services/catalog-service.ts';

const SEAM_INPUT = {
  sources: new Map([
    [
      QUEUE_FACTORY,
      [
        "import { Queue, Worker } from 'bullmq';",
        'export function createPushDeliveryWorker(redis, processor) {',
        '  return new Worker(QUEUE, (job) => processor(job), { connection: redis });',
        '}',
      ].join('\n'),
    ],
    [PLUGIN, 'createPushDeliveryWorker(options.redis, processor);'],
    [SUBSCRIBER, "eventBus.on('order.status_changed.v1', handler);"],
    [FORWARDER, 'register({ registerWorker: (worker, options) => ctx.worker(worker, options) });'],
    [BYSTANDER, 'export function list() { return find(); }'],
  ]),
};

describe('check:subscribe-seam — one parse per source, but for worker sites (issue #910)', () => {
  it('parses a file twice only when it can hold a worker site', () => {
    const perFile = parsesPerFile(() => scanSubscribeSeam(SEAM_INPUT));
    // The worker-site walk depends on every file's factories and forwarders,
    // so it re-reads exactly the files that hold a BullMQ binding or a call to
    // a factory, and nothing else (`SeamReads` in the rule says why).
    expect(reparsed(perFile)).toEqual([`${QUEUE_FACTORY} x2`, `${PLUGIN} x2`]);
    expect(new Set(perFile.keys())).toEqual(new Set(SEAM_INPUT.sources.keys()));
  });

  it('reports what the same walks report unshared', () => {
    const scan = scanSubscribeSeam(SEAM_INPUT);
    expect(scan.subscriptions.length).toBeGreaterThan(0);
    expect(scan.workers.violations.length).toBeGreaterThan(0);
    expect(scan.result).toEqual(checkSubscribeSeam(SEAM_INPUT));
    expect(scan.workers).toEqual(checkWorkerSeam(SEAM_INPUT));
    expect(scan.subscriptions).toEqual(findBareSubscriptions({ sources: SEAM_INPUT.sources }));
  });
});
