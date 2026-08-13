import type { ModuleEntry } from './kernel/compose.js';

/**
 * How a composition root walks the generated module list **while
 * `composition.ts` still exists** (feature 072, Phase 5).
 *
 * `composition.generated.ts` emits one ordered list, and the end state composes
 * it in one call. Today it cannot: 63 modules are still hand-wired, and that
 * hand-written code sits *between* the converted ones.
 *
 *  - `email` must be composed before the six senders below it resolve
 *    `emailMailer` (`composition.ts`, the `platformMailer` line).
 *  - `health_checks` must contribute its routes **before** the hand-wired auth
 *    plugin, because Fastify binds a route's hook chain when the route is
 *    registered — a liveness probe registered first is one no later
 *    `onRequest` hook can start authenticating.
 *  - Everything else must contribute its routes **after** that same auth
 *    plugin, or `requireAdmin` reads a `request.actor` nothing ever set.
 *
 * So the list is composed in two passes against one shared ownership ledger: a
 * duplicate registration still collides naming both modules, and each module's
 * relative order inside a pass is the generated one. The split is named here,
 * once, rather than being re-derived in each of the two composition roots — and
 * it disappears with `composition.ts` (T143), when there is nothing left to sit
 * between the passes.
 *
 * A newly converted module joins the late pass unless it is named here, which
 * is the safe default: late means "after auth, after the values the hand-wired
 * remainder registers".
 */
export const EARLY_PASS_MODULE_IDS: ReadonlySet<string> = new Set([
  'email',
  'health_checks',
  // Feature 072 (T078) — `auth` registers `sessionService` and the
  // `requireAdmin` port, and the whole hand-wired remainder resolves both. It
  // has to have registered before any of it is constructed.
  //
  // Its *plugin* is not affected by this list: it goes through
  // `ctx.rootPlugin`, so a root places it where the application needs
  // decorating rather than wherever this pass's route contributions land.
  // That separation is what lets `health_checks` keep contributing its probe
  // ahead of the auth hook while `auth` registers first.
  'auth',
  // `auth` resolves `permissionService` from it, and both roots resolve its
  // three services immediately after this pass. The generated order already
  // puts it ahead of `auth`, because `auth`'s manifest declares the dependency.
  'admin_roles',
  // `dictionaries` and `languages` are constructed well before the late pass
  // and both take `currencyService` as an argument now, so the registration has
  // to exist by then. It needs nothing but `emFactory`, the kernel audit writer
  // and a lazily-read invalidator, so composing it early costs nothing.
  'currencies',
  // Both roots resolve `adminNotificationService` immediately after this pass
  // and hand it to the four modules that write notifications.
  'admin_notifications',
  // `search`, `newsletter` and `prompt_actions` are hand-wired and take
  // `credentialsService` as an argument, so it has to be registered before
  // any of them is constructed.
  'credentials',
  // `orders` (as `commerceModule`) and `organizations` both take
  // `addressService` as an argument and are constructed well before the late
  // pass. The module needs nothing but `emFactory`, the kernel audit writer and
  // a lazily-read dictionary validator, so composing it early costs nothing.
  'addresses',
  // `orders` reads both method registries, both order-status registries and the
  // shipping eligibility service for placement dispatch, and it is constructed
  // before the late pass. Their *routes* are unaffected by joining early: a
  // root pushes the early pass's route plugins after `auth`'s root plugin, so
  // `requireAdmin` still reads an actor the auth hook has set.
  'delivery_methods',
  'payment_methods',
  // `customers` and `organizations` both take this module's services as
  // arguments and are constructed before the late pass. It needs only
  // `emFactory`, the kernel audit writer and `auth`'s `sessionService`, all of
  // which exist by then.
  'customer_accounts',
  // Both roots resolve its handle to contribute `catalog`, `cms` and
  // `megamenu` reference resolvers, well before the late pass. Named here from
  // the conversion diff rather than after a red run — see the predictor in the
  // note above this list.
  'assets_library',
  // Eight hand-wired modules take `customFieldValueService` or
  // `customFieldDefinitionService` as a constructor argument — `catalog`,
  // `orders`, `organizations`, `customers`, `quote_requests`, `product_feeds`
  // and the two catalog admin services — and every one of them is built before
  // the late pass. Named from the conversion diff, per the predictor above.
  'custom_fields',
  // I argued this one out of the list on the reasoning that its consumers sit
  // near the *end* of a root, and was wrong: `container.cradle` is read there,
  // but the read still has to find a registration, and the late pass composes
  // after the harness's read. Ninth of fourteen conversions to need this entry.
  //
  // Joining early does not disturb the reconcile-timing this module is careful
  // about (see `_i18n/backend.ts`): a pass decides when a module *registers*,
  // while its route plugin is attached from the `modules` array at the end of
  // `buildServer` either way.
  '_i18n',
]);

/** The converted modules that must be composed ahead of the hand-wired remainder. */
export function earlyPassModules(modules: readonly ModuleEntry[]): ModuleEntry[] {
  return modules.filter((m) => EARLY_PASS_MODULE_IDS.has(m.id));
}

/** Everything else, in the order the composer emitted it. */
export function latePassModules(modules: readonly ModuleEntry[]): ModuleEntry[] {
  return modules.filter((m) => !EARLY_PASS_MODULE_IDS.has(m.id));
}
