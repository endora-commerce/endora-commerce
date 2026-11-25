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
 * On MikroORM 7 (#1866) the connection is kysely over a `pg.Pool`, which
 * `getNativeClient()` returns — asynchronously, because it opens the connection
 * first. A checked-out client is one the pool counts and does not hold idle.
 * Kept here, behind a structural type, so a driver change edits this file and
 * not the tests.
 */
export async function connectionPool(em: EntityManager): Promise<ConnectionPoolGauge> {
  const pool = (await em.getConnection().getNativeClient()) as unknown as {
    readonly totalCount: number;
    readonly idleCount: number;
    readonly options: { readonly max: number };
  };
  return { used: () => pool.totalCount - pool.idleCount, max: pool.options.max };
}
