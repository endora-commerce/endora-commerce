import { asFunction, Lifetime, type Resolver } from 'awilix';
import { ModuleDisabledError } from '../../modules/_lifecycle/plugin-helpers.js';
import { effectiveState } from '../lifecycle/effective-state.js';
import type { KernelContainer, KernelCradle } from '../container.js';

/**
 * Registering a **port** — a name the owning module publishes for other modules
 * to resolve (feature 072, T059; `contracts/module-context.md` §Ports).
 *
 * An ordinary registration and a port differ in exactly one way, and it is not
 * cosmetic: a port is resolved by *another* module, so its availability is a
 * cross-module question and the answer has to be the module's **effective**
 * state (Constitution XVII). Resolving a port from a module that is not
 * effectively present throws {@link ModuleDisabledError} — 503
 * `MODULE_DISABLED` with `Retry-After` — instead of handing back a live service
 * belonging to a module the operator switched off.
 *
 * Fail closed, because the alternative is a half-executed operation: a consumer
 * that gets the service anyway writes rows, emits events and charges cards on
 * behalf of a capability that is supposed to be absent.
 *
 * Kernel-owned ports (`settingsReadPort`, the sales-channel ports) are **not**
 * registered through here and never gate: the kernel is the part every
 * deployment has, so there is no state in which it is absent, and a gate that
 * can never close is a gate nobody can reason about.
 */

/** The private name the ungated resolver keeps, so the gate wraps rather than replaces. */
function ungatedNameFor(name: string): string {
  return `${name}$ungated$`;
}

/**
 * Register `name` as a port owned by `moduleId`.
 *
 * The gate is a **transient** wrapper over the original resolver, which keeps
 * its own lifetime. That split is load-bearing: a singleton port registered
 * with the check inside its factory would run the check exactly once — at first
 * resolution — and every later resolution would return the cached instance
 * without asking, so switching the module off would stop nothing that had
 * already been resolved once.
 */
export function registerPort<T>(
  container: KernelContainer,
  moduleId: string,
  name: string,
  resolver: Resolver<T>,
): void {
  const ungated = ungatedNameFor(name);
  container.register({ [ungated]: resolver });
  container.register({
    [name]: asFunction((cradle: KernelCradle): T => {
      if (!effectiveState.isPresent(moduleId)) throw new ModuleDisabledError(moduleId);
      return cradle[ungated] as T;
    }).setLifetime(Lifetime.TRANSIENT),
  });
}
