/**
 * The in-process event bus' published surface. Peer of `kernel/`, `http/`,
 * `tenancy/`, `commands/`; becomes the `./events` subpath of
 * `@endora-commerce/platform` (feature 080, D-160.1/D-160.7), and that subpath
 * is the boundary a future `@endora-commerce/events` would take (D-160.6).
 *
 * **This barrel is a package boundary in waiting, so it carries this
 * directory's symbols and nothing else.**
 *
 * The `eventBus` **singleton** is deliberately absent. A module registers its
 * subscriptions through `ctx.subscribe`, which gates them on the module's
 * effective state (Principle XVII); a bare `eventBus.on` in a module is what
 * `check:subscribe-seam` refuses, and publishing the instance here would
 * re-open by bare specifier the seam that check closed by relative path. The
 * class travels because a composition root constructs one and the type is what
 * a module's own declarations name.
 */
export { EventBus, type EventBase } from './bus.js';
