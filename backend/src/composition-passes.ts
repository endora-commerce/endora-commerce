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
]);

/** The converted modules that must be composed ahead of the hand-wired remainder. */
export function earlyPassModules(modules: readonly ModuleEntry[]): ModuleEntry[] {
  return modules.filter((m) => EARLY_PASS_MODULE_IDS.has(m.id));
}

/** Everything else, in the order the composer emitted it. */
export function latePassModules(modules: readonly ModuleEntry[]): ModuleEntry[] {
  return modules.filter((m) => !EARLY_PASS_MODULE_IDS.has(m.id));
}
