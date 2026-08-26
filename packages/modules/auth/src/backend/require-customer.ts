import type { FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireCustomerGuard } from '@endora-commerce/platform/kernel';

/**
 * The customer guard (issue #43). **One implementation**, shared by production
 * and the test harness.
 *
 * Before this file there were two, and they disagreed on all three request
 * shapes that exist. `composition.ts` declared the guard inline and read
 * `request.actor`; `test/helpers/test-actors.ts` exported `requireTestCustomer()`
 * and read `request.testActor`:
 *
 * | request carries | inline copy | `requireTestCustomer()` |
 * | --- | --- | --- |
 * | `actor` only | allowed | refused 401 |
 * | `testActor` only | crashed (`TypeError` → 500) | allowed |
 * | neither | crashed (`TypeError` → 500) | refused 401 |
 *
 * Nothing caught it because the two never met: 16 route surfaces took the root's
 * copy and 11 the harness's, so every customer route was gated by one guard in
 * production and a different one under test.
 *
 * Two decisions, mirroring the ones `createRequireAdmin` already made:
 *
 *  1. **Read `request.actor`.** It is the decoration `auth`'s plugin sets, and
 *     the only one a deployment has. `testActor` is a harness decoration, and
 *     `registerTestAuth` mirrors every resolved actor onto both — so the
 *     production read is the one that answers correctly in either root.
 *  2. **A request with no resolved actor is refused, not crashed.** The
 *     harness's answer wins: a composition that mounts a route without an actor
 *     resolver should get a 401, not a 500 out of `undefined.kind`.
 *
 * `auth` owns it for the same reason it owns the admin guard — the actor shape
 * is this module's.
 */

/** The actor slice the guard reads. Kept structural — no import of the actor union. */
interface CustomerActorSlice {
  readonly kind: string;
}

/** Gate a route on an authenticated Customer session. */
export function createRequireCustomer(): RequireCustomerGuard {
  return async (request: FastifyRequest): Promise<void> => {
    // In production `actor` is a decorated getter that always answers. A
    // composition root that mounts a route without an actor resolver would
    // otherwise turn a 401 into a 500 — the same guard `createRequireAdmin`
    // puts in front of `promoteAdminActor`.
    const actor = (request as FastifyRequest & { actor?: CustomerActorSlice }).actor;
    if (actor?.kind !== 'customer') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
  };
}
