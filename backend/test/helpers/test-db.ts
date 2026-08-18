import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../src/db/mikro-orm.config.js';
import { SalesChannel } from '../../src/kernel/sales-channels/sales-channel.entity.js';

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

export async function setupTestDb(): Promise<TestDb> {
  const orm = await MikroORM.init(mikroOrmConfig);
  let activeEm: EntityManager | undefined;

  // Read outside any test transaction, once per file: the channel is platform
  // state that `global-setup.ts` guarantees, not per-test fixture data.
  const systemDefault = await orm.em
    .fork()
    .findOne(SalesChannel, { systemDefault: true });
  if (!systemDefault) {
    throw new Error(
      'No system-default sales channel in the test database. One is established ' +
        'by test/global-setup.ts immediately after the migrations, so this means ' +
        'either the run bypassed globalSetup or something deleted it. Do not ' +
        'default the id — the platform guarantees the channel (D-47…D-51).',
    );
  }

  return {
    orm,
    systemDefaultChannelId: systemDefault.id,
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
