import { MikroORM } from '@mikro-orm/postgresql';
import type { Options } from '@mikro-orm/postgresql';

/**
 * Thin ORM bootstrap wrapper.
 *
 * `initOrm()` boots MikroORM once and caches it; `getOrm()` returns it;
 * `closeOrm()` disposes it. That is the whole surface.
 *
 * **`getEm()` and `withTransaction()` were removed in feature 072 (T144).**
 * They were the only `RequestContext` reference in the tree, and they had no
 * callers outside this file — the header still advertised `withTransaction` as
 * used by "order-placement, credit-limit reservation, and every multi-row
 * mutation", none of which had called it for a long time.
 *
 * They are not worth restoring. `RequestContext` is AsyncLocalStorage-backed
 * ambient state: a service reached the request's EntityManager by asking the
 * runtime rather than by being given one, so what a service could touch was
 * invisible in its signature and untestable without a live request scope. Every
 * module takes an explicit `emFactory` now, and the kernel's request scope
 * (`../kernel/scope.ts`) is where per-request state lives — declared, not
 * ambient. Deleting these is what makes that a property of the tree rather than
 * a convention.
 *
 * ## Why it is a factory (`specs/110-instance-repository/` T116)
 *
 * The cached instance is one process's, and so is the configuration it was
 * booted from: which database this process talks to is decided by the host's
 * `DATABASE_URL`, and which registries it was configured over is decided by the
 * host's committed artefacts (R7.4). So the platform owns the bootstrap and the
 * host owns the one call that binds it — `backend/src/db/index.ts` creates it
 * once, at module scope, and re-exports the three names every caller already
 * uses. One creation, one cached instance; two would be two ORMs over one pool.
 */
export interface OrmBootstrap {
  initOrm(): Promise<MikroORM>;
  getOrm(): MikroORM;
  closeOrm(): Promise<void>;
}

export function createOrmBootstrap(config: () => Promise<Options>): OrmBootstrap {
  let ormInstance: MikroORM | undefined;

  return {
    async initOrm(): Promise<MikroORM> {
      if (!ormInstance) {
        ormInstance = await MikroORM.init(await config());
      }
      return ormInstance;
    },
    getOrm(): MikroORM {
      if (!ormInstance) {
        throw new Error('ORM not initialised — call initOrm() during application bootstrap.');
      }
      return ormInstance;
    },
    async closeOrm(): Promise<void> {
      if (ormInstance) {
        await ormInstance.close(true);
        ormInstance = undefined;
      }
    },
  };
}
