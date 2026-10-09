/**
 * The seam that lets a whole demo **reset** be one database transaction
 * (issue #143).
 *
 * ## Why a reset is one transaction and a seed is not
 *
 * A reset is the composition's withdrawal, then every module's own, then the
 * foundation's — a dozen bodies, any of which a foreign key can refuse. Run one
 * after another on their own connections, a refusal at the tenth leaves the
 * first nine committed: the instance has lost its demo payment methods and its
 * demo buyer and kept the demo organisation, which is a shop nobody can check
 * out of. That is not a property a careful ordering of steps can buy, because
 * the refusing constraint may belong to a table nobody here has heard of — an
 * installed module's, a deployment's own.
 *
 * So the entry point opens **one** transaction for the run and every body
 * writes inside it: the reset either completes or leaves the instance exactly
 * as it found it. A seed needs no such thing — it is idempotent by contract
 * (§2.4), so a seed that stopped part-way is repaired by running it again.
 *
 * ## How a module's body ends up inside it
 *
 * A demo body takes its `EntityManager` from its own cradle —
 * `context.ctx.cradle().emFactory()` — which hands out a fresh fork on a pooled
 * connection, outside any transaction. {@link demoContextWithin} gives each
 * body the same context with that one registration answered by the run's
 * transactional `EntityManager` instead. Nothing else of the cradle is touched.
 *
 * **What a `reset` body owes in return**: it writes through the
 * `EntityManager` it was handed — `em.nativeDelete`, `em.execute` — and never
 * through `em.getConnection().execute(…)` without a transaction context, which
 * takes a second connection, cannot see what the run has already deleted, and
 * waits on the rows the run has locked.
 */
import type { EntityManager } from '@mikro-orm/postgresql';

/** The part of a module context this file reads. */
interface CradleCarrier {
  cradle(): object;
}

/**
 * `contextFor`, with every module's `emFactory` answering `em`.
 *
 * The context is copied rather than proxied: it is a plain object of closures,
 * and a copy with one property replaced is a thing a debugger can read.
 */
export function demoContextWithin(
  em: EntityManager,
  contextFor: (moduleId: string) => unknown,
): (moduleId: string) => unknown {
  return (moduleId) => {
    const context = contextFor(moduleId) as CradleCarrier;
    const within = (): object =>
      new Proxy(context.cradle(), {
        get: (cradle, property) =>
          property === 'emFactory' ? () => em : Reflect.get(cradle, property),
      });
    return Object.create(Object.getPrototypeOf(context) as object | null, {
      ...Object.getOwnPropertyDescriptors(context),
      cradle: { value: within, enumerable: true },
    }) as unknown;
  };
}
