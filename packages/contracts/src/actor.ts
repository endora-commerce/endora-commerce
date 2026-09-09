/**
 * The **actor** a request carries: who is asking, as four kinds and nothing
 * else (`specs/110-instance-repository/` T118b).
 *
 * ## Why it is here rather than in `@endora-commerce/mod-auth`
 *
 * `auth` resolves the actor and writes it onto the request, so the shape lived
 * beside that implementation — and the Fastify augmentation that puts it on
 * `FastifyRequest` lived there with it. That made every reader of
 * `request.actor` a consumer of a module: `backend/src/composition.ts` named
 * `@endora-commerce/mod-auth/backend` for a type it erases at build time, the
 * platform restated the shape structurally in four places because D-52/D-53
 * forbids it the import, and a packaged module read it through a hand-written
 * cast per module.
 *
 * The blocker on relocating it was believed to be `Session`: `auth`'s own
 * barrel said moving the augmentation *"would take `Session` with it"*, because
 * `ActorCustomer` and `ActorAdmin` each carried the ORM entity. Measured across
 * `packages/`, `backend/`, `admin/` and `storefront/`, **no file outside
 * `packages/modules/auth/` ever read `actor.session`** — `composition.ts` alone
 * reads `kind`, `adminUserId`, `organizationId`, `customerAccountId`,
 * `impersonatorAdminUserId` and `apiKeyId`, and `.session` not once. So the
 * field was written by the auth plugin on every request and read by nobody, and
 * dropping it is what lets the vocabulary sit in a package that imports neither
 * Fastify nor the ORM.
 *
 * A consumer that needs the *session* asks `auth` for it — `AuthSessionPort`
 * and `AuthSessionReadPort` in `./auth.js` are that surface, and they carry
 * `AuthSessionRecord` rather than the entity.
 *
 * ## Where the Fastify augmentation lives
 *
 * Not here. `@endora-commerce/contracts` declares no dependency on Fastify, for
 * the reason `RequireCustomerGuard` and `AdminActorPromotion` are in the
 * platform's `kernel/ports/require-admin.ts` rather than in this package. The
 * `declare module 'fastify'` block that adds `actor` and `adminActor` to
 * `FastifyRequest` is `@endora-commerce/platform`'s
 * (`src/http/request-actor.ts`), on the `./http` subpath.
 */

/** No identified caller. The fail-closed end of every audience question. */
export interface ActorAnonymous {
  kind: 'anonymous';
}

export interface ActorCustomer {
  kind: 'customer';
  customerAccountId: string;
  /**
   * The buyer's Organization (Principle XI). Nullable at this seam rather than
   * by design: every transacting customer has one — `organization_id` is
   * `NOT NULL` and an individual is backed by a personal organisation — but the
   * auth plugin stamps `''` when no resolver is wired, and a guest-style
   * account predating feature 026 can still present without one. A consumer
   * that requires an Organization asserts it (`customerContextResolver`).
   */
  organizationId: string | null;
  /** Non-null when a Supplier employee is acting on behalf of this Customer. */
  impersonatorAdminUserId: string | null;
}

export interface ActorAdmin {
  kind: 'admin';
  adminUserId: string;
}

/**
 * An integration authenticated by a bearer key (feature 062). All three binding
 * fields are set for a **bound** distributor key and absent for a legacy
 * unbound one: the tenant-context mapping derives single-org scope from them
 * and the sales-channel resolver pins the channel, failing closed on a header
 * that names a different one.
 */
export interface ActorApiKey {
  kind: 'api_key';
  apiKeyId: string;
  scopes: string[];
  organizationId?: string | null;
  salesChannelId?: string | null;
  customerAccountId?: string | null;
}

export type Actor = ActorAnonymous | ActorCustomer | ActorAdmin | ActorApiKey;
