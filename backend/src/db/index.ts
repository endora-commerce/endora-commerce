import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from './mikro-orm.config.js';

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
 * (`src/kernel/scope.ts`) is where per-request state lives — declared, not
 * ambient. Deleting these is what makes that a property of the tree rather than
 * a convention.
 */

let ormInstance: MikroORM | undefined;

export async function initOrm(): Promise<MikroORM> {
  if (!ormInstance) {
    ormInstance = await MikroORM.init(await mikroOrmConfig());
  }
  return ormInstance;
}

export function getOrm(): MikroORM {
  if (!ormInstance) {
    throw new Error('ORM not initialised — call initOrm() during application bootstrap.');
  }
  return ormInstance;
}

export async function closeOrm(): Promise<void> {
  if (ormInstance) {
    await ormInstance.close(true);
    ormInstance = undefined;
  }
}
