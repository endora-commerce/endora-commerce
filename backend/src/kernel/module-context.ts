import {
  asClass,
  asFunction,
  asValue,
  Lifetime,
  type BuildResolver,
  type Constructor,
  type DisposableResolver,
  type Resolver,
} from 'awilix';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import type { ModuleInstallHook, ModuleUninstallHook } from '@b2b/contracts';
import type { ModulePlugin } from '../http/server.js';
import type { EventBus } from '../events/bus.js';
import type { ApiInterceptorRegistry } from '../http/interceptors/index.js';
import type { InterceptorRegistration } from '../http/interceptors/types.js';
import {
  defineModuleRoutes,
  defineModuleWorker,
  subscribeForModule,
  type DefineModuleWorkerOptions,
  type WorkerLogger,
} from '../modules/_lifecycle/plugin-helpers.js';
import type { KernelContainer, KernelCradle } from './container.js';
import { getCurrentPlatformScope } from './scope.js';

/**
 * `ModuleContext` — the only kernel surface a module sees (feature 072).
 *
 * A module's backend entry exports one `registerModule(ctx)` and its entity
 * list, and nothing about it appears anywhere else. Every surface it can
 * contribute goes through this object, which means the lifecycle gating of
 * Constitution XVII holds **by construction**: `routes`, `worker` and
 * `subscribe` are wrapped in the `_lifecycle` helpers here, so a module cannot
 * forget to wrap and cannot gate per handler.
 *
 * Modules never import `awilix`; `scripts/check-container-imports.ts` enforces
 * it, so the container stays swappable behind this seam.
 */

/** Structured logger a module gets for composition-time messages. */
export type ModuleLifecycleLogger = WorkerLogger;

/**
 * What `ctx.asClass` / `ctx.asFunction` / `ctx.asValue` produce.
 *
 * These are awilix's own types, re-exported under kernel names so a module
 * spells the container's vocabulary without importing `awilix` — that import is
 * forbidden by a static check (T041), which is what keeps the container
 * swappable behind `ModuleContext`.
 */
export type Registration<T = unknown> = Resolver<T>;

/** The lifetime-selecting builder returned by `ctx.asClass` / `ctx.asFunction`. */
export type RegistrationBuilder<T> = BuildResolver<T> & DisposableResolver<T>;

/**
 * A module's explicit boot phase (FR-021).
 *
 * Registration is lazy: a service nothing resolves is never constructed. Some
 * work genuinely has to run at boot anyway — pushing a descriptor into another
 * module's registry, seeding a system row, validating a cipher key — and it
 * needs to resolve things, which registration may not do. So it is a named
 * phase that runs **after every module has registered**, each hook inside its
 * own `enterSystemScope`, rather than a side effect smuggled into a factory or
 * into route attachment (where a `BACKEND_ROLE=worker` process would never
 * reach it).
 */
export type ModuleBootHook = () => void | Promise<void>;

/**
 * Which module owns which registration name (T042).
 *
 * A name is owned by exactly one module. Two modules registering the same name
 * is not "the later one wins" — it is a platform whose behaviour depends on
 * registration order, and the bug it produces is unfindable because both
 * modules look correct in isolation. Changing another module's registration is
 * `ctx.di.decorate`, which is a different, deliberate act and is not routed
 * through this ledger.
 */
export interface RegistrationOwnership {
  /** @throws {DuplicateRegistrationError} when another module already owns `name`. */
  claim(name: string, moduleId: string): void;
  ownerOf(name: string): string | undefined;
}

/** Two modules registered the same name. Names both, never just the loser. */
export class DuplicateRegistrationError extends Error {
  constructor(
    readonly registrationName: string,
    readonly owner: string,
    readonly claimant: string,
  ) {
    super(
      `[kernel] modules '${owner}' and '${claimant}' both register '${registrationName}'. ` +
        `A registration name is owned by exactly one module — otherwise which ` +
        `implementation the platform runs depends on registration order. To change ` +
        `another module's registration, decorate it: ctx.di.decorate('${registrationName}', …).`,
    );
    this.name = 'DuplicateRegistrationError';
  }
}

/** A module resolved something while it was still registering (T043). */
export class EagerResolutionError extends Error {
  constructor(
    readonly moduleId: string,
    readonly registrationName: string,
  ) {
    super(
      `[kernel] module '${moduleId}' resolved '${registrationName}' while registering. ` +
        `Registration declares; it never resolves — at registration time the modules ` +
        `after this one have not registered yet, so an eager resolution silently depends ` +
        `on registration order. Move the resolution into the closure that uses it: a ` +
        `route registrar, a worker processor, a subscriber, or ctx.onBoot().`,
    );
    this.name = 'EagerResolutionError';
  }
}

export function createRegistrationOwnership(): RegistrationOwnership {
  const owners = new Map<string, string>();
  return {
    claim(name, moduleId) {
      const owner = owners.get(name);
      if (owner !== undefined && owner !== moduleId) {
        throw new DuplicateRegistrationError(name, owner, moduleId);
      }
      owners.set(name, moduleId);
    },
    ownerOf: (name) => owners.get(name),
  };
}

export interface ModuleContext {
  readonly module: { readonly id: string; readonly version: string };

  readonly di: {
    register(registrations: Record<string, Registration>): void;
    /**
     * Wrap an existing registration (D-28: decoration, never replacement), so a
     * client override keeps delegating to core and core fixes keep flowing
     * through it.
     */
    decorate<T>(name: string, wrap: (inner: T, cradle: KernelCradle) => T): void;
  };

  asClass<T>(ctor: Constructor<T>): RegistrationBuilder<T>;
  /**
   * `C` is the cradle shape **this factory needs**, declared by the module and
   * defaulted to the kernel's. Annotate the parameter and it is inferred:
   *
   * ```ts
   * ctx.asFunction(({ emFactory, blogCacheService }: BlogCradle) => …)
   * ```
   *
   * Widening it to `KernelCradle` would make every dependency `unknown` at the
   * one place where naming the dependency is the point of the exercise.
   */
  asFunction<T, C = KernelCradle>(fn: (cradle: C) => T): RegistrationBuilder<T>;
  asValue<T>(value: T): Registration<T>;

  /**
   * The resolution surface, for **deferred** use only — inside a route
   * registrar, a worker processor, a subscriber or an `onBoot` hook. Reading a
   * name from it while `registerModule` is still running throws
   * {@link EagerResolutionError} (T043).
   *
   * Two things about it are load-bearing:
   *
   *  - **It follows the ambient scope.** Inside a request (or any
   *    `enterPlatformScope`) it resolves through that scope's child container,
   *    so a `scoped()` registration — the resolved sales channel, anything
   *    per-request — yields the current request's value. Outside one it
   *    resolves through the root. A closure that captures a value at route
   *    attachment therefore captures a **singleton**; if the registration is
   *    scoped, resolve inside the handler, not around it.
   *  - **`C` is asserted by the caller**, because the container is the runtime
   *    authority and an unknown name throws rather than yielding `undefined`.
   *    Declaring the narrow shape a module needs is the port rule of
   *    `contracts/module-context.md` spelled in types.
   */
  cradle<C extends object = KernelCradle>(): C;

  /** Wrapped in `defineModuleRoutes(module.id, …)` — gating holds at the registration seam. */
  routes(register: (app: FastifyInstance) => Promise<void> | void): void;

  /** Wrapped in `defineModuleWorker(module.id, …)`. Takes a **constructed** `Worker`. */
  worker<W extends Worker>(worker: W, options?: DefineModuleWorkerOptions): W;

  /**
   * Wrapped in `subscribeForModule(module.id, bus, …)`.
   *
   * The payload is `unknown` because that is what the `EventBus` hands a
   * subscriber: its `Events` map defaults to `Record<string, EventBase>`, so no
   * name-to-payload mapping exists to narrow from. Every subscriber in the tree
   * already takes `(p: unknown)` and parses — see `ksef/plugin.ts`. A typed
   * subscription needs the event catalogue that F3 introduces, not a cast here.
   */
  subscribe(event: string, handler: (payload: unknown) => void | Promise<void>): void;

  /** API interceptors owned by this module; `module` is stamped from `module.id`. */
  interceptors(entries: readonly Omit<InterceptorRegistration, 'module'>[]): void;

  onInstall(hook: ModuleInstallHook): void;
  onUninstall(hook: ModuleUninstallHook): void;

  /**
   * The explicit boot phase (FR-021). Runs once every module has registered,
   * inside `enterSystemScope('boot: <module id>')`, so it may resolve.
   *
   * Not the same thing as `onInstall`: install runs once in the orchestrator's
   * transaction when the module is installed; this runs on every boot of every
   * process, including `BACKEND_ROLE=worker`.
   */
  onBoot(hook: ModuleBootHook): void;

  readonly log: ModuleLifecycleLogger;
}

/**
 * What one module contributed. The composer owns the sink and decides when to
 * attach the plugins, so `registerModule` stays a pure declaration.
 */
export interface ModuleRegistrationSink {
  readonly plugins: ModulePlugin[];
  readonly workers: Worker[];
  readonly unsubscribes: Array<() => void>;
  readonly installHooks: ModuleInstallHook[];
  readonly uninstallHooks: ModuleUninstallHook[];
  readonly bootHooks: ModuleBootHook[];
}

export function createModuleRegistrationSink(): ModuleRegistrationSink {
  return {
    plugins: [],
    workers: [],
    unsubscribes: [],
    installHooks: [],
    uninstallHooks: [],
    bootHooks: [],
  };
}

export interface ModuleContextOptions {
  readonly module: { readonly id: string; readonly version: string };
  readonly container: KernelContainer;
  readonly eventBus: EventBus;
  readonly sink: ModuleRegistrationSink;
  readonly log: ModuleLifecycleLogger;
  /** Absent in composition roots that mount no interceptor surface (unit tests). */
  readonly interceptorRegistry?: ApiInterceptorRegistry;
  /**
   * Shared across every module of one composition, so a name registered twice
   * is caught naming both modules (T042). Absent for a hand-built context — a
   * single module cannot collide with itself.
   */
  readonly ownership?: RegistrationOwnership;
  /**
   * Whether `registerModule` is still running for this composition. While it
   * is, `ctx.cradle()` refuses to resolve (T043). Defaults to "no", so a
   * context built by hand in a unit test resolves freely.
   */
  readonly isRegistering?: () => boolean;
}

export function createModuleContext(options: ModuleContextOptions): ModuleContext {
  const { module, container, eventBus, sink, log, interceptorRegistry, ownership } = options;
  const isRegistering = options.isRegistering ?? ((): boolean => false);
  let decorationDepth = 0;

  /**
   * One proxy per context, resolving through the ambient scope when there is
   * one. It is stable across calls so a module that captures `ctx.cradle()`
   * during registration still hits the phase guard when it later reads a name
   * off the captured object.
   */
  const cradleProxy = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, property): unknown {
      // A symbol here is the runtime probing the object (`Symbol.toPrimitive`,
      // `then` on an accidental await); no registration can carry that name.
      if (typeof property === 'symbol') return undefined;
      if (isRegistering()) throw new EagerResolutionError(module.id, property);
      return (getCurrentPlatformScope()?.cradle ?? container.cradle)[property];
    },
    has(_target, property): boolean {
      return typeof property === 'string' && container.hasRegistration(property);
    },
  });

  return {
    module,

    di: {
      register(registrations) {
        for (const name of Object.keys(registrations)) ownership?.claim(name, module.id);
        container.register(registrations);
      },

      decorate<T>(name: string, wrap: (inner: T, cradle: KernelCradle) => T): void {
        if (!container.hasRegistration(name)) {
          throw new Error(
            `[kernel] module '${module.id}' cannot decorate '${name}': nothing is registered ` +
              `under that name. Decoration wraps an existing registration; register order is ` +
              `topological, so the owning module must come first.`,
          );
        }
        const inner = container.getRegistration(name) as Resolver<T>;
        // Re-registering the previous resolver under a private name keeps the
        // inner instance resolving through the SAME container or scope, so its
        // lifetime is preserved and a chain of decorations composes cleanly.
        const innerName = `${name}$undecorated$${(decorationDepth += 1)}`;
        container.register({ [innerName]: inner });
        container.register({
          [name]: asFunction((cradle: KernelCradle) =>
            wrap(cradle[innerName] as T, cradle),
            // Preserve the inner registration's lifetime, so decorating does
            // not silently turn a singleton into a per-resolution instance.
            // An `asValue` resolver carries none; awilix treats that as
            // transient at resolution, so the wrapper must too.
          ).setLifetime(inner.lifetime ?? Lifetime.TRANSIENT),
        });
      },
    },

    asClass: <T,>(ctor: Constructor<T>): RegistrationBuilder<T> => asClass(ctor),
    asFunction: <T, C = KernelCradle>(fn: (cradle: C) => T): RegistrationBuilder<T> =>
      asFunction(fn as (...args: unknown[]) => T),
    asValue: <T,>(value: T): Registration<T> => asValue(value) as Registration<T>,

    cradle: <C extends object = KernelCradle,>(): C => cradleProxy as C,

    routes(register) {
      sink.plugins.push(defineModuleRoutes(module.id, register));
    },

    worker(worker, workerOptions) {
      const registered = defineModuleWorker(module.id, worker, workerOptions);
      sink.workers.push(registered);
      return registered;
    },

    subscribe(event, handler) {
      sink.unsubscribes.push(subscribeForModule(module.id, eventBus, event, handler));
    },

    interceptors(entries) {
      if (!interceptorRegistry) {
        throw new Error(
          `[kernel] module '${module.id}' registered an API interceptor, but this composition ` +
            `root mounts no interceptor registry.`,
        );
      }
      for (const entry of entries) {
        interceptorRegistry.register({ ...entry, module: module.id } as InterceptorRegistration);
      }
    },

    onInstall(hook) {
      sink.installHooks.push(hook);
    },

    onUninstall(hook) {
      sink.uninstallHooks.push(hook);
    },

    onBoot(hook) {
      sink.bootHooks.push(hook);
    },

    log,
  };
}
