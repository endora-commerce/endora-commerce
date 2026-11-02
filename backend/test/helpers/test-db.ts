import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../src/db/mikro-orm.config.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { assertServicesAvailable } from '../declared-services.js';
import { declareChannelBridgesForTests } from './channel-bridges.js';
import { BASE_DATABASE_URL_ENV, TEMPLATE_DATABASE_ENV } from '@endora-commerce/test-kit/database';
import { cloneTemplateForCaller, dropRunDatabase } from '@endora-commerce/test-kit/database';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migratedDatabase } from './migrated-database.js';

/**
 * Transaction-rollback fixture pattern (R-03):
 *   - boot MikroORM once per test file
 *   - each test opens its own transaction, runs, and rolls back
 *   - DB stays clean without paying schema-create cost per test
 *
 * Principle III bans DB mocking in integration tests, so this is the cheap path
 * to getting isolated tests against a real Postgres.
 *
 * The isolation only holds for statements that actually run inside the
 * transaction, which is a property of how they are issued: `em.execute(...)`,
 * `em.find`, `em.flush` do; `em.getConnection().execute(...)` and
 * `em.getKnex()` take their own pooled connection and commit past the rollback
 * (issue #200). Two files' fixtures were written around that — they seeded and
 * asserted through the connection so that both halves escaped together, and
 * broke the moment the code under test started honouring the transaction. Use
 * `db.em().execute(...)` for raw SQL inside a test transaction.
 *
 * Usage:
 *   const db = await setupTestDb();
 *   beforeEach(() => db.beginTx());
 *   afterEach(() => db.rollbackTx());
 *   afterAll(() => db.close());
 */

export interface TestDb {
  orm: MikroORM;
  beginTx: () => Promise<EntityManager>;
  rollbackTx: () => Promise<void>;
  /** EntityManager bound to the active test transaction; throws if no tx is open. */
  em: () => EntityManager;
  /**
   * The id of the platform's system-default Sales Channel — never empty, never
   * a placeholder (issue #159).
   *
   * A default channel always exists (D-47…D-51): production creates it at
   * install, `setupBackendServer` re-creates it after its truncate, and
   * `global-setup.ts` establishes it right after the migrations so a database
   * this file is the first to touch already has one. So this is a plain
   * `string`, and the six files that each wrote
   * `(await em.findOne(SalesChannel, { systemDefault: true }))?.id ?? ''` have
   * nothing left to write: the shape they were reaching for is here, and it
   * cannot answer `''`.
   *
   * That mattered. `cart-abandonment-worker.integration.test.ts` was green only
   * because some other file's `setupBackendServer` had run first in the same
   * invocation; against a fresh database every one of its six tests died on
   * `invalid input syntax for type uuid: ""`.
   */
  systemDefaultChannelId: string;
  close: () => Promise<void>;
}

/**
 * `setupTestDb({ firstBoot })` — see {@link setupFirstBootTestDb}. One name for
 * both on purpose: `check-test-ownership` reads a call of `setupTestDb` as the
 * host's composition, and a first-boot database is composed from exactly the
 * same generated entity index and migration registry.
 */
export function setupTestDb(): Promise<TestDb>;
export function setupTestDb(options: FirstBootOptions): Promise<FirstBootTestDb>;
export async function setupTestDb(options?: FirstBootOptions): Promise<TestDb | FirstBootTestDb> {
  if (options !== undefined) return setupFirstBootTestDb(options.firstBoot);
  // Issue #211 — see the note in `setupBackendServer`; same seam, same reason.
  assertServicesAvailable('setupTestDb');
  // Feature 120 (FR-015) — this harness composes no platform, so no module's
  // boot hook has said which table holds its channel memberships. The suites
  // built on it construct the kernel's membership service by hand, and without
  // this every call in them would meet FR-017's refusal. The descriptors come
  // from the owning modules, never from a list kept here; see the helper.
  await declareChannelBridgesForTests();
  return openTestDb(await mikroOrmConfig());
}

/**
 * `Awaited<ReturnType<…>>` rather than `typeof mikroOrmConfig`: the config is
 * an async factory since feature 080's T033, because an installed extension
 * package's entities and migrations are discovered at runtime (D-119/D-155).
 * The annotation follows the value the caller awaits, so the two spellings
 * cannot drift.
 */
type MikroOrmConfig = Awaited<ReturnType<typeof mikroOrmConfig>>;

async function openTestDb(config: MikroOrmConfig): Promise<TestDb> {
  const orm = await MikroORM.init(config);

  // Read outside any test transaction, once per file: the channel is platform
  // state that `global-setup.ts` guarantees, not per-test fixture data.
  const systemDefault = await orm.em
    .fork()
    .findOne(SalesChannel, { systemDefault: true });
  if (!systemDefault) {
    await orm.close(true);
    throw new Error(
      'No system-default sales channel in the test database. One is established ' +
        'by test/global-setup.ts immediately after the migrations, so this means ' +
        'either the run bypassed globalSetup or something deleted it. Do not ' +
        'default the id — the platform guarantees the channel (D-47…D-51).',
    );
  }

  return { ...transactionHandle(orm), systemDefaultChannelId: systemDefault.id };
}

/** The per-test transaction half of a {@link TestDb}, over an ORM it owns. */
function transactionHandle(orm: MikroORM): Omit<TestDb, 'systemDefaultChannelId'> {
  let activeEm: EntityManager | undefined;
  return {
    orm,
    async beginTx() {
      const forked = orm.em.fork({ clear: true }) as EntityManager;
      await forked.begin();
      activeEm = forked;
      return forked;
    },
    async rollbackTx() {
      if (activeEm) {
        await activeEm.rollback();
        activeEm = undefined;
      }
    },
    em() {
      if (!activeEm) {
        throw new Error('No active transaction — call beginTx() first.');
      }
      return activeEm;
    },
    async close() {
      if (activeEm) {
        await activeEm.rollback();
        activeEm = undefined;
      }
      await orm.close(true);
    },
  };
}

/**
 * A database of this file's own, for a test that drives the real migrator.
 *
 * Every other fixture in this file mutates rows inside a transaction that is
 * rolled back. `orm.getMigrator().up()` / `.down()` mutates the **schema**,
 * outside any such fixture — and since per-invocation isolation (issue #189)
 * the run database is the invocation's only copy, so a migration sequence that
 * dies half-way is not one red file: measured, it was 21 red files in
 * `test/integration/catalog`, 20 of them collateral, each with a message that
 * pointed at itself.
 *
 * So the file gets its own clone of the same migrated template the run was
 * cloned from — a `create database … template …` file copy, a fraction of a
 * second — and `close()` drops it. A file using this seam owes its neighbours
 * nothing: it does not have to leave the schema migrated, which is exactly the
 * `afterAll` that was doing the damage.
 *
 * Who may call it is a declared, two-way-checked list:
 * `test/migrator-driving-tests.ts`, kept honest by
 * `test/unit/harness/migrator-driving-ledger.test.ts`.
 *
 * Under `BACKEND_TEST_ISOLATION=shared` there is no template to clone — the
 * base env var is not exported — so this falls back to `setupTestDb()` and says
 * so. That is the escape hatch's cost, declared rather than discovered: the
 * shared path is the pre-#189 behaviour in full, and this is part of it.
 */
export async function setupMigratorTestDb(): Promise<TestDb> {
  assertServicesAvailable('setupMigratorTestDb');
  const baseUrl = process.env[BASE_DATABASE_URL_ENV];
  const template = process.env[TEMPLATE_DATABASE_ENV];
  if (!baseUrl || !template) {
    process.stdout.write(
      `[test-db] ${BASE_DATABASE_URL_ENV}/${TEMPLATE_DATABASE_ENV} are not set, so this ` +
        `invocation has no template to ` +
        `clone — a migrator-driving file is running against the shared database, and a ` +
        `migration sequence that fails here will take the rest of the run with it.\n`,
    );
    const shared = await setupTestDb();
    const closeShared = shared.close;
    return {
      ...shared,
      close: async () => {
        // The compensation the caller no longer owes anybody, owed again here
        // because on this path the caller *is* sharing: leave the schema
        // migrated for the files after it. It lives in the seam rather than in
        // an `afterAll`, so the file reads the same in both modes and only the
        // mode that needs it pays. A failure re-migrating is the run's problem
        // and is raised, but the ORM is closed either way.
        try {
          await shared.orm.getMigrator().up();
        } finally {
          await closeShared();
        }
      },
    };
  }

  const clone = await cloneTemplateForCaller(baseUrl, template);
  const db = await openTestDb({ ...(await mikroOrmConfig()), clientUrl: clone.url });
  const closeOrm = db.close;
  return {
    ...db,
    close: async () => {
      await closeOrm();
      await dropRunDatabase(baseUrl, clone.name, () => {});
    },
  };
}

/** A {@link TestDb} over a database whose `sales_channels` table is empty. */
export type FirstBootTestDb = Omit<TestDb, 'systemDefaultChannelId'>;

export interface FirstBootOptions {
  /** Names the database on the shared-isolation fallback (`<prefix>_<rand>_test`). */
  readonly firstBoot: string;
}

const BACKEND_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * A database of the file's own in the state a platform's **first boot** meets
 * it: every migration applied and nothing else — in particular **no sales
 * channel**, which every other fixture here guarantees (issue #115).
 *
 * It exists for the files whose subject is what happens around an empty or
 * hand-arranged `sales_channels` table: the boot-time reconciler, the
 * system-default flag move, the migration that adds a channel column. They
 * used to empty the shared table to get there — `update "quote_requests" set
 * "sales_channel_id" = null`, then every channel removed one by one — inside a
 * rolled-back transaction, which held as long as every statement really ran
 * inside it, and broke the platform's one guarantee (D-47…D-51) for every file
 * after it the moment one did not. `check:shared-table-wipes` refuses that
 * shape since. Here the table is empty because nothing put a row in it, and
 * the database is dropped on `close()`.
 *
 * The database is `migratedDatabase()`'s: a clone of this invocation's
 * template with the platform invariants withdrawn, or, under
 * `BACKEND_TEST_ISOLATION=shared`, an empty database the migration runner is
 * spawned into. Cases still run in a transaction that is rolled back, so they
 * do not leak into one another.
 */
async function setupFirstBootTestDb(prefix: string): Promise<FirstBootTestDb> {
  assertServicesAvailable('setupTestDb');
  await declareChannelBridgesForTests();
  const database = await migratedDatabase(prefix, (url) => migrateInto(url));
  let orm: MikroORM;
  try {
    orm = await MikroORM.init({ ...(await mikroOrmConfig()), clientUrl: database.url });
  } catch (error) {
    await database.drop();
    throw error;
  }
  const handle = transactionHandle(orm);
  return {
    ...handle,
    close: async () => {
      try {
        await handle.close();
      } finally {
        await database.drop();
      }
    },
  };
}

/** `migration:up` into `url`, as an operator runs it — the shared-isolation fallback only. */
async function migrateInto(url: string): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'src/db/migrate.ts', 'up'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`migration:up into ${url} exited ${code}\n${output}`));
    });
  });
}
