import { MikroORM, type EntityManager, RequestContext } from '@mikro-orm/postgresql';
import mikroOrmConfig from './mikro-orm.config.js';

/**
 * Thin ORM bootstrap wrapper.
 *
 * - `initOrm()` boots MikroORM once and caches it.
 * - `getEm()` returns the current request's EntityManager — works when called inside a
 *   Fastify request handler wrapped with `RequestContext` (see Fastify plugin below).
 * - `withTransaction(fn)` runs fn inside an explicit transaction; used by order-placement,
 *   credit-limit reservation, and every multi-row mutation.
 */

let ormInstance: MikroORM | undefined;

export async function initOrm(): Promise<MikroORM> {
  if (!ormInstance) {
    ormInstance = await MikroORM.init(mikroOrmConfig);
  }
  return ormInstance;
}

export function getOrm(): MikroORM {
  if (!ormInstance) {
    throw new Error('ORM not initialised — call initOrm() during application bootstrap.');
  }
  return ormInstance;
}

/** Current request's EntityManager, forked inside a RequestContext scope. */
export function getEm(): EntityManager {
  const em = RequestContext.getEntityManager();
  if (!em) {
    throw new Error(
      'No RequestContext active — wrap calls in RequestContext.create(orm.em, ...) or use the Fastify mikroOrm plugin.',
    );
  }
  return em as EntityManager;
}

export async function closeOrm(): Promise<void> {
  if (ormInstance) {
    await ormInstance.close(true);
    ormInstance = undefined;
  }
}

/**
 * Run fn inside a Postgres transaction. The provided EntityManager is a forked
 * em bound to that transaction; all repository operations must use it (not a
 * previously captured em) to land in the right transaction.
 */
export async function withTransaction<T>(
  fn: (em: EntityManager) => Promise<T>,
): Promise<T> {
  const em = getEm();
  return em.transactional(async (txEm) => fn(txEm as EntityManager));
}
