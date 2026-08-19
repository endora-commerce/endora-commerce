import type { FastifyRequest } from 'fastify';
import { ANONYMOUS_PRODUCT_AUDIENCE, type ProductAudience } from '@b2b/contracts';

/**
 * The {@link ProductAudience} of a request, off the actor the auth plugin
 * resolved (issue #227).
 *
 * Three actor kinds can reach a catalogue read, and each answers differently:
 *
 *  - **`customer`** — a signed-in buyer. `organizationId` is stamped on the
 *    actor by the auth plugin and is `null` for the guest-style accounts
 *    feature 026 allows, which is exactly the caller `logged_in_only` exists
 *    to distinguish from the public.
 *  - **`api_key`** — an integration. A *bound* distributor key carries the
 *    organisation it acts for and gets that organisation's answer; an unbound
 *    key carries none. Both are authenticated: an unbound key is a caller the
 *    platform has identified, so it sees `logged_in_only` rows and no
 *    allow-listed ones. That is the same answer the buyer whose session has no
 *    Organization gets, and it is deliberate — a key that should see a
 *    distributor's restricted assortment is a key that should be bound to that
 *    distributor.
 *  - **`admin`** and **`anonymous`** — the public answer. An admin reading the
 *    *storefront* API is shopping, not administering; the surfaces whose job is
 *    to show every product are the `/api/v1/admin/*` ones, and they are gated
 *    by `requireAdmin` rather than by this.
 *
 * A request with no actor at all — a composition that mounted these routes
 * without the auth plugin — reads as anonymous, which is the fail-closed end.
 */
export function productAudienceOf(request: FastifyRequest): ProductAudience {
  const actor = request.actor as
    | { kind: string; organizationId?: string | null }
    | undefined;
  if (!actor) return ANONYMOUS_PRODUCT_AUDIENCE;
  if (actor.kind === 'customer') {
    return { organizationId: actor.organizationId ?? null, authenticated: true };
  }
  if (actor.kind === 'api_key') {
    return { organizationId: actor.organizationId ?? null, authenticated: true };
  }
  return ANONYMOUS_PRODUCT_AUDIENCE;
}
