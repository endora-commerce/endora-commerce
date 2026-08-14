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
  // `search` and `prompt_actions` are hand-wired and take `credentialsService`
  // as an argument, so it has to be registered before either is constructed.
  // (`newsletter` converted in T114 and now resolves it lazily, but the two
  // remaining hand-wired callers keep this entry necessary.)
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
  // `megamenu` cross-registers into this module's reference registry, and the
  // root resolves that registry before the late pass. Named from the diff.
  'cms',
  // Both roots read `mfaLoginPort` well before the late pass, to contribute the
  // `mfaLoginPortGetter` that `customer_accounts` resolves at login.
  'mfa',
  // Wave 2. Both roots resolve `languageService` where this module used to be
  // constructed, well before the late pass.
  //
  // An entry here is **not** free, which is a correction to what this comment
  // said when `meta_ads` and `linkedin_ads` were briefly listed. The early pass
  // composes before the hand-wired `settings` module, so an entry moves that
  // module's EventBus subscribers ahead of the settings cache's own
  // invalidation subscriber — and `subscribeForModule`'s state check awaits, so
  // the invalidation lands a tick later and a synchronous read serves the
  // pre-write value. Add an entry only when a root actually reads the module's
  // registration, and prefer modules that register no subscriber. `languages`
  // registers none.
  'languages',
  // Both roots resolve `creditLimitService` where this module used to be
  // constructed — `orders` takes it and the credit-topup payment provider wraps
  // it — well before the late pass. Registers no subscriber, so no ordering
  // hazard (see the note above).
  'credit_limits',
  // `addresses` builds the one `AddressService` from `dictionaryValidator`, and
  // both roots resolve that immediately after the early pass. Its subscribers
  // are on `currencies.changed` / `languages.changed`, not `settings.value_changed`,
  // so composing early cannot defer the settings-cache drop (see the note above).
  'dictionaries',
  // Both roots resolve `megamenuReferenceRegistry` to cross-register it with
  // `cms`', before the late pass. Composing early also puts this module's own
  // `megamenuCacheOptions` default ahead of the harness's contribution, which
  // is the order a contribution point needs — the module declares the default,
  // the root overrides it.
  'megamenu',
  // `orders` takes `promotionService` for cart pricing and both roots resolve
  // it before the late pass. Registers no subscriber, so no ordering hazard;
  // composing early also puts its own `promotionRuleTargets` default ahead of
  // the root's contribution, which is the order a contribution point needs.
  'promotions',
  // `auth` resolves `apiKeyResolver` in its request hook, and `catalog`'s
  // external namespace takes both gates as constructor arguments before the
  // late pass. The task note asks that this module compose "first"; what
  // actually matters is that the names exist before a request arrives, and an
  // entry here says that structurally rather than by line position.
  'api_keys',
  // Both roots read `pricingService` while building `commerceModule`, which is
  // hundreds of lines before the late pass. The factory itself still runs on
  // first resolution, so the three composition values registered beside the old
  // `priceListsModule` call are in place by then (T127).
  'price_lists',
  // Both roots read `cartService` off the cradle where they build
  // `commerceModule`, hundreds of lines before the late pass. `carts` registers
  // no EventBus subscriber, so the hazard this list warns about below does not
  // apply to it (T136).
  'carts',
]);

/** The converted modules that must be composed ahead of the hand-wired remainder. */
export function earlyPassModules(modules: readonly ModuleEntry[]): ModuleEntry[] {
  return modules.filter((m) => EARLY_PASS_MODULE_IDS.has(m.id));
}

/** Everything else, in the order the composer emitted it. */
export function latePassModules(modules: readonly ModuleEntry[]): ModuleEntry[] {
  return modules.filter((m) => !EARLY_PASS_MODULE_IDS.has(m.id));
}
