/**
 * The HTTP layer's published surface. Peer of `kernel/`, `events/`, `tenancy/`,
 * `commands/`; becomes the `./http` subpath of `@endora-commerce/platform`
 * (feature 080, D-160.1/D-160.7), and that subpath is the boundary a future
 * `@endora-commerce/http` would take (D-160.6).
 *
 * **This barrel is a package boundary in waiting, so it carries this
 * directory's symbols and nothing else.** Re-exporting a kernel or tenancy
 * symbol here to save a consumer one import line spends the split option for a
 * convenience.
 *
 * What is deliberately absent, and why — `contracts/host-package.md` §1.3/§1.4
 * classifies each of these as host-internal reach that no packaged module may
 * have:
 *
 *  - `registerErrorEnvelope` / `ErrorEnvelopeOptions` (`error-envelope.ts`) — a
 *    composition root calls the registrar once and no module calls it at all.
 *    The file is deliberately **not** split: `ErrorEnvelopeOptions` is the
 *    injection seam D-52/D-53 cite for a platform file that needs something a
 *    module owns, and separating it from its handler would break that pattern.
 *  - `ModulePlugin` (`server.ts`) — a composed module ships `backend.ts` and
 *    uses `ctx.routes` (D-103). A module still carrying a `plugin.ts` converts
 *    before it can be packaged.
 *  - `testAdminUserId` / `TestActorCarrier` (`test-actor-carrier.ts`) — the file
 *    exists to narrow this repository's test-harness Fastify augmentation. An
 *    installed package has no relationship to that harness.
 *  - `ApiInterceptorRegistry` (`interceptors/`) — `ctx.interceptors` is the
 *    composed seam.
 */
export { HttpError } from './error-envelope.js';
export { productAudienceOf, markPersonalisedPricing } from './product-audience.js';
export { StorefrontRevalidator } from './storefront-revalidator.js';
export { encodeCursor, decodeCursor } from './cursor.js';
