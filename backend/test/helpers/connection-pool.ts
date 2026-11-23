import type { EntityManager } from '@mikro-orm/postgresql';

/** What a test reads of the pool the ORM's connection draws from. */
export interface ConnectionPoolGauge {
  /** Connections checked out right now. */
  used(): number;
  /** The pool's ceiling. */
  readonly max: number;
}

/**
 * The ORM connection's pool, for the tests that measure how many connections a
 * path holds (issue #1864).
 *
 * MikroORM 6 pools through knex's `tarn` pool, and no ORM API reports it, so
 * this is the harness's one driver-specific read: kept here, behind a
 * structural type, so the MikroORM 7 switch (#1866) changes this file and no
 * test.
 */
export function connectionPool(em: EntityManager): ConnectionPoolGauge {
  const connection = em.getConnection() as unknown as {
    getKnex(): { client: { pool: { numUsed(): number; max: number } } };
  };
  const pool = connection.getKnex().client.pool;
  return { used: () => pool.numUsed(), max: pool.max };
}
