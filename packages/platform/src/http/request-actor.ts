import type { Actor, ActorAdmin } from '@endora-commerce/contracts';

/**
 * `request.actor` and `request.adminActor`, declared once
 * (`specs/110-instance-repository/` T118b).
 *
 * ## What this file is, and why it is the platform's
 *
 * An ambient augmentation reaches a consumer's program only if the file
 * declaring it is *in* that program. This block used to live in
 * `packages/modules/auth/src/backend/plugin.ts`, which made "may I read
 * `request.actor`?" a question about whether the reader could name a **module**
 * — and the four answers the tree gave were all bad ones:
 *
 *  - `backend/src/composition.ts` kept a type-only import of
 *    `@endora-commerce/mod-auth/backend` whose only job was to drag the
 *    augmentation into its program. It had been arriving incidentally through a
 *    *value* import until feature 117 retired that, at which point thirty reads
 *    of `request.actor` stopped compiling at once.
 *  - Three platform files restated the shape structurally, because D-52/D-53
 *    refuses the kernel an import of a module — `request-language.ts`'
 *    `ActorSlice`, `product-audience.ts`' inline cast and
 *    `sales-channel-resolver.middleware.ts`' `ApiKeyActorSlice`. Each carried a
 *    comment naming the prohibition as the reason. They are the same shape
 *    written three times and checked against nothing.
 *  - A packaged module wrote a cast of its own, one per module, because `auth`
 *    publishes nothing a package's own program can name.
 *
 * The vocabulary itself is `@endora-commerce/contracts`' {@link Actor}; what is
 * here is the Fastify half, because that package declares no dependency on
 * Fastify. It is the same split, and the same reason, as
 * `RequireCustomerGuard` and `AdminActorPromotion` in the platform's
 * `kernel/ports/require-admin.ts`.
 *
 * ## `auth` still resolves it
 *
 * Only the *declaration* moved. `auth` owns the session table, the cookies, the
 * `onRequest` hook that decides which of the four kinds a request carries, and
 * the two `decorateRequest` slots these names read from. A composition that
 * mounts no auth plugin leaves both undecorated — see the note on
 * {@link FastifyRequest.actor} below, which is the one thing a platform-side
 * reader has to know that a module-side one did not.
 *
 * ## It is carried by the `./http` barrel and exports nothing
 *
 * `http/index.ts` imports this file for its side effect. That is what puts the
 * augmentation in the program of every consumer of `@endora-commerce/platform/http`
 * without any of them naming it — a module writing
 * `import '@endora-commerce/platform/http/request-actor.js'` would be a
 * `whole-file-reach` under `check:platform-surface`, and there is no subpath to
 * write it with anyway.
 */
declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Who is asking, resolved by `auth`'s `onRequest` hook.
     *
     * **Typed non-optional and decorated only where `auth` is composed.** The
     * hook seeds `{ kind: 'anonymous' }` before any branch runs, so within a
     * composition that mounts the auth plugin this is total and every consumer
     * may read it as written. Outside one — a composition that mounts a
     * module's routes without the plugin, or a reply Fastify is serialising
     * before the hook has run — the decoration is simply absent, and a platform
     * file that runs in that window says so at its own site rather than by
     * widening this declaration. `request-language.ts` and
     * `product-audience.ts` are the two that do; both answer the anonymous
     * result, which is the fail-closed end.
     */
    actor: Actor;
    /**
     * The admin session resolved from the dedicated admin cookie, independently
     * of {@link actor}, so an admin signed in to the Admin UI and a customer
     * signed in to the storefront can coexist in one browser. `null` when the
     * request carries no admin cookie.
     *
     * `promoteAdminActor` — `auth`'s implementation of the platform's
     * `AdminActorPromotion` port — is what moves this into {@link actor} for an
     * admin route whose ambient actor is a customer.
     */
    adminActor: ActorAdmin | null;
  }
}
