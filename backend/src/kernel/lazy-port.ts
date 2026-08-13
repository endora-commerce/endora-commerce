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
 *  2. **Ordering.** A name a composition root registers may not exist yet when
 *     a module composes. The early pass runs long before most of a root's
 *     `registerValues` calls, and joining that pass is a decision made *later*,
 *     for unrelated reasons — so a capture that works today breaks when
 *     somebody adds an `EARLY_PASS_MODULE_IDS` entry for a different reason
 *     entirely. That happened twice.
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
