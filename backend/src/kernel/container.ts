import {
  asFunction,
  asValue,
  createContainer as createAwilixContainer,
  InjectionMode,
  type AwilixContainer,
} from 'awilix';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { forkScopedEm } from '../tenancy/scoped-em.js';

/**
 * The kernel's root container (feature 072).
 *
 * `composition.ts` hand-wires 3144 lines and therefore imports every module by
 * name. The container replaces that with registrations, so a module set becomes
 * a build-time variable. Modules never see this file — they see `ModuleContext`,
 * so the container stays swappable behind that seam.
 *
 * Two construction options are load-bearing:
 *
 *  - **`InjectionMode.PROXY`** — a registration receives one `cradle` argument
 *    and destructures the names it needs, so adding a dependency is not a
 *    positional-argument change at every call site.
 *  - **`strict: true`** — awilix refuses a lifetime mismatch (a singleton
 *    capturing a scoped registration) at resolution rather than silently
 *    pinning the first request's value for the life of the process. Given that
 *    the one scoped value is the resolved sales channel, a silent capture would
 *    be a Constitution XII violation with no test to catch it.
 *
 * In both modes an unknown name **throws** `AwilixResolutionError`; it never
 * resolves `undefined`. That is the property `composition.ts` could not offer —
 * a missing option object key there is `undefined` reaching business logic.
 */

/**
 * The resolution surface. Module registrations are added at composition time,
 * so the index signature is the honest static type: the container is the
 * runtime authority, and a miss throws.
 */
export interface KernelCradle {
  /**
   * The closure ~59 module factories take today as `emFactory`. Calling it
   * always forks; see the note on `em` below.
   */
  readonly emFactory: () => EntityManager;
  /**
   * A fresh `EntityManager` fork per resolution — **transient**, matching
   * `composition.ts:282`'s `em = () => forkScopedEm(orm)` called once per
   * service method (research R-1b). There is deliberately no request-scoped
   * EntityManager: introducing one would change identity-map sharing, flush
   * ordering and transaction nesting for every service in the codebase.
   */
  readonly em: EntityManager;
  readonly [name: string]: unknown;
}

export type KernelContainer = AwilixContainer<KernelCradle>;

/** Build a root container. One per process; scopes are children of it. */
export function createRootContainer(): KernelContainer {
  return createAwilixContainer<KernelCradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });
}

/**
 * Register the ORM-derived names.
 *
 * `emFactory` keeps today's exact semantics — it is the closure, and every call
 * forks. `em` is the container-native spelling of the same thing: **transient**,
 * so each resolution yields its own fork with its own identity map. Neither is
 * scoped, and that is the invariant the whole request seam rests on: the tenant
 * filter reads `AsyncLocalStorage` at query-build time (`tenancy/filters.ts`),
 * which is what makes a bare fork correct.
 */
export function registerOrm(container: KernelContainer, orm: MikroORM): void {
  container.register({
    orm: asValue(orm),
    emFactory: asValue((): EntityManager => forkScopedEm(orm)),
    em: asFunction((): EntityManager => forkScopedEm(orm)).transient(),
  });
}

/**
 * Register plain values a composition root already owns — the Redis client, the
 * `requireAdmin` factory, a port implementation a not-yet-converted module
 * exposes through its handle.
 *
 * It exists so a composition root spells the container's vocabulary without
 * importing `awilix` either. Modules are *forbidden* to import it
 * (`scripts/check-container-imports.ts`); a root importing it would still be
 * one more file to touch the day the container is swapped.
 */
export function registerValues(
  container: KernelContainer,
  values: Readonly<Record<string, unknown>>,
): void {
  for (const [name, value] of Object.entries(values)) {
    container.register({ [name]: asValue(value) });
  }
}

let currentRoot: KernelContainer | undefined;

/**
 * The process-wide root container, created on first use. `enterPlatformScope`
 * falls back to it so a CLI script or an interval sweep needs no wiring to open
 * a scope.
 */
export function getRootContainer(): KernelContainer {
  currentRoot ??= createRootContainer();
  return currentRoot;
}

/** Install a composed root. Used by the composer, and by tests that build their own. */
export function setRootContainer(container: KernelContainer): void {
  currentRoot = container;
}

/**
 * Dispose the root container and forget it. Runs every registration's
 * `.disposer(...)` — Redis clients, queue connections, the ORM — so a composed
 * process tears down through one call instead of a hand-maintained list.
 */
export async function disposeRootContainer(): Promise<void> {
  const root = currentRoot;
  currentRoot = undefined;
  if (root) await root.dispose();
}

/**
 * Dispose `container` when the process is asked to stop. Returns a detach
 * function so a test (or a second composition in the same process) does not
 * leak signal handlers.
 *
 * Not installed automatically: importing the kernel must not attach global
 * signal handlers, or 900 test files would each add a set.
 */
export function installShutdownDisposal(
  container: KernelContainer,
  signals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'],
): () => void {
  let disposed = false;
  const handler = (): void => {
    if (disposed) return;
    disposed = true;
    void container.dispose();
  };
  for (const signal of signals) process.once(signal, handler);
  return () => {
    for (const signal of signals) process.off(signal, handler);
  };
}
