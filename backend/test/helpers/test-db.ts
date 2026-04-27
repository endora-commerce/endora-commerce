import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../src/db/mikro-orm.config.js';

/**
 * Transaction-rollback fixture pattern (R-03):
 *   - boot MikroORM once per test file
 *   - each test opens its own transaction, runs, and rolls back
 *   - DB stays clean without paying schema-create cost per test
 *
 * Principle III bans DB mocking in integration tests, so this is the cheap path
 * to getting isolated tests against a real Postgres.
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
  close: () => Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
  const orm = await MikroORM.init(mikroOrmConfig);
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
