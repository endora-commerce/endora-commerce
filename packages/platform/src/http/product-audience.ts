import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  type Actor,
  type ProductAudience,
} from '@endora-commerce/contracts';

/**
 * The {@link ProductAudience} of a request, off the actor the auth plugin
 * resolved (issue #227).
 *
 * It lives beside {@link testAdminUserId} rather than in `catalog`, for the
 * reason that helper does: it reads a `FastifyRequest` decoration and nothing
 * else, and six modules serve a product to a buyer. A copy per module is six
 * chances to answer "is an unbound API key authenticated?" differently, and the
 * answer is not obvious enough to be re-derived six times.
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
 *
 * The actor used to be read through a **local** inline shape rather than off the
 * `fastify` module augmentation, because that augmentation was declared in
 * `modules/auth/plugin.ts` — so a platform file depending on it depended on a
 * module (D-52/D-53), and it did not compile at all once these directories were
 * compiled as `@endora-commerce/platform`, where no module is in the program.
 * T118b moved the declaration here (`./request-actor.js`) and the shape to
 * `@endora-commerce/contracts`, so the restatement is gone and this reads the
 * type every other consumer reads.
 *
 * The **widening** stays and is this site's own: `request.actor` is decorated
 * by `auth`'s `onRequest` hook, and these routes can be mounted by a
 * composition that never mounted the plugin. `undefined` was already the
 * answer for such a request and is still the fail-closed one.
 */
export function productAudienceOf(request: FastifyRequest): ProductAudience {
  const actor = request.actor as Actor | undefined;
  if (!actor) return ANONYMOUS_PRODUCT_AUDIENCE;
  if (actor.kind === 'customer') {
    return { organizationId: actor.organizationId ?? null, authenticated: true };
  }
  if (actor.kind === 'api_key') {
    return { organizationId: actor.organizationId ?? null, authenticated: true };
  }
  return ANONYMOUS_PRODUCT_AUDIENCE;
}

/**
 * Marks a response whose prices were resolved for a specific buying
 * organisation as private and unstorable.
 *
 * The catalogue's public reads are the platform's most cacheable responses:
 * before this existed, `GET /api/v1/catalog/products` and the product detail
 * carried **no** `Cache-Control` at all, and their representation was a pure
 * function of `(channel, currency, locale)`. Making the price depend on the
 * caller makes the priced part of that response *private*, and a shared cache
 * holding one would hand one buyer's negotiated figure to the next caller of
 * the same URL — a worse defect than quoting everybody the channel price.
 *
 * So the header is set on **exactly** the responses that changed, and the
 * anonymous one is left byte-for-byte and header-for-header as it was: it is
 * still the canonical answer a crawler indexes and the one the storefront's ISR
 * window caches (Principle VII). `no-store` rather than `private, max-age=0`
 * because there is no revalidation story here worth the ambiguity — a
 * personalised price is re-resolved per request, and `price_lists`' own
 * in-process LRU is what keeps that cheap.
 *
 * `Vary` is deliberately not set. The credential here is a cookie, and `Vary:
 * Cookie` is not a usable cache key (every unrelated cookie changes it); the
 * leak direction — a personalised representation entering a shared cache — is
 * closed by `no-store` alone, and the remaining direction, a shared cache
 * answering a signed-in buyer with the stored *public* price, discloses nothing
 * and is exactly the behaviour that shipped before this change.
 */
export function markPersonalisedPricing(
  reply: FastifyReply,
  audience: ProductAudience,
): void {
  if (audience.organizationId === null) return;
  reply.header('cache-control', 'private, no-store');
}
