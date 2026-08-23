import type { ModuleContext } from './module-context.js';

/**
 * A stand-in that resolves `name` from the container on **every method call**
 * rather than once, when the holder is constructed.
 *
 * This exists because feature 072 kept producing the same two failures, and
 * neither is visible at the call site or caught by `tsc`:
 *
 *  1. **Lifetime.** A name registered with `providePort` is a transient gate
 *     that consults its module's effective state. Awilix's strict mode refuses
 *     a singleton that captures one — correctly, because a captured gate goes
 *     on answering after an operator switches the module off.
 *  2. **Ordering.** A name a composition root registers does not exist yet when
 *     a module composes — that is the whole shape of a composition since D-45:
 *     `composeModules(MODULES, …)` runs first and every root contribution lands
 *     after it. A capture taken during registration therefore captures nothing,
 *     or, worse, captures the module's own default and never sees the root's
 *     value. That happened twice.
 *
 * The rule `scripts/check-port-dependencies.ts` enforces is therefore blunt: a
 * module may capture only names it owns and the handful of eagerly-registered
 * kernel ones. Everything else goes through the cradle at the point of use, and
 * this is the ergonomic way to spell that when a constructor wants an object
 * rather than a getter.
 *
 * ```ts
 * new GaConfigService(lazyPort<SettingsService>(ctx, 'settingsReadPort'), …)
 * ```
 *
 * **Methods only.** The proxy forwards calls; it does not forward property
 * reads, because a property read cannot be deferred — there is nothing to
 * defer it to. A collaborator exposing data rather than behaviour is not a
 * candidate for this, and should be read from the cradle explicitly where it
 * is used.
 *
 * **And therefore: never feature-detect through one** (D-97.3). The `get` trap
 * below answers *every* non-symbol property with a function, so `x.maybe`,
 * `!x.maybe` and `typeof x.maybe === 'function'` are all truthy whatever is
 * registered, and `x.maybe?.()` always calls — into a provider that may not
 * implement it, where the forward throws "is not a function". This is not a
 * sharp edge to be careful around, it is impossible by construction, and the
 * trap **cannot be fixed** to answer honestly: making the property read tell
 * the truth means resolving the name at access time to look at the real object,
 * and for a gated port that turns a `typeof` probe into a `ModuleDisabledError`
 * — a presence check that throws when the module is absent, which is worse than
 * the hazard it repairs. Deferring resolution to the call is the whole reason
 * this function exists (items 1 and 2 above).
 *
 * So the rule is at the type level instead: **no published port, and no
 * interface extending one, may declare an optional method.** Optional
 * parameters and optional data properties on record types are untouched. The
 * one occurrence in the tree — `catalog` widening the custom-field read port
 * with `publishInvalidate?` — fired its recovery branch on every integrity
 * error and turned a self-healing cache window into a 500 on the attribute
 * screens; D-97.1 replaced it with a required method that answers the
 * consumer's actual question. `check:port-shape` refuses the shape.
 */
export function lazyPort<T extends object>(ctx: ModuleContext, name: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      if (typeof property === 'symbol') return undefined;
      return (...args: unknown[]): unknown => {
        const resolved = ctx.cradle<Record<string, unknown>>()[name] as
          | Record<string, (...a: unknown[]) => unknown>
          | undefined;
        if (resolved === undefined) {
          throw new Error(
            `[kernel] '${name}' is not registered in this composition — ` +
              `${ctx.module.id} resolved it lazily and found nothing.`,
          );
        }
        const method = resolved[property];
        if (typeof method !== 'function') {
          throw new Error(
            `[kernel] '${name}.${property}' is not a function — ` +
              `\`lazyPort\` forwards method calls only (see its note on property reads).`,
          );
        }
        return method.apply(resolved, args);
      };
    },
  });
}
