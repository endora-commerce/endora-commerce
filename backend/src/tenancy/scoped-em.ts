import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

/**
 * EM fork used across composition.ts (feature 050). The tenant filters read the
 * ambient TenantContext from AsyncLocalStorage at query time (see filters.ts),
 * so no per-fork `setFilterParams` is required — a plain fork already carries the
 * guard. This wrapper is retained as the single, named injection seam so the
 * intent is explicit at call sites and future per-fork wiring has one home.
 */
export function forkScopedEm(orm: MikroORM): EntityManager {
  return orm.em.fork() as EntityManager;
}
