import type { FastifyRequest } from 'fastify';
// The `request.actor` augmentation, which is the platform's own since
// `specs/110-instance-repository/` T118b — a side-effect import of the `./http`
// barrel is how the `declare module 'fastify'` block reaches this package's
// program, and reaching a published barrel is not a `whole-file-reach`.
import '@endora-commerce/platform/http';

/**
 * The signed-in customer behind a storefront request, or `null`.
 *
 * A push subscription is legitimately anonymous — the same browser can register
 * a device with nobody signed in — so this narrows rather than refuses, and it
 * is deliberately **not** the platform's `customerAccountIdResolver`, which
 * throws 401 for a caller who is not a customer. Feature 087 Group B / D-187
 * turns the answer into the row's attribution: an owned device carries its
 * account and that account's organisation, and an ownerless one carries
 * neither.
 *
 * It reads `request.actor` directly, which is the drain of a
 * `resolveCustomerAccountId` option both composition roots supplied
 * (`specs/110-instance-repository/` T118c). That option was the older shape,
 * from when the augmentation was `auth`'s and a packaged module could not name
 * it; a knob a root fills on a module's behalf is a knob that drifts between the
 * two roots, and this one had — production read `request.actor` and the harness
 * `request.testActor`. `registerTestAuth` mirrors each resolved actor onto both
 * properties, so one read answers correctly under either composition.
 */
export function callingCustomerAccountId(request: FastifyRequest): string | null {
  return request.actor.kind === 'customer' ? request.actor.customerAccountId : null;
}
