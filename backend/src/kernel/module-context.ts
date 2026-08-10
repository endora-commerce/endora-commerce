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
 * Modules never import `awilix`; a static check enforces it (T041).
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
  asFunction<T>(fn: (cradle: KernelCradle) => T): RegistrationBuilder<T>;
  asValue<T>(value: T): Registration<T>;

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
}

export function createModuleRegistrationSink(): ModuleRegistrationSink {
  return { plugins: [], workers: [], unsubscribes: [], installHooks: [], uninstallHooks: [] };
}

export interface ModuleContextOptions {
  readonly module: { readonly id: string; readonly version: string };
  readonly container: KernelContainer;
  readonly eventBus: EventBus;
  readonly sink: ModuleRegistrationSink;
  readonly log: ModuleLifecycleLogger;
  /** Absent in composition roots that mount no interceptor surface (unit tests). */
  readonly interceptorRegistry?: ApiInterceptorRegistry;
}

export function createModuleContext(options: ModuleContextOptions): ModuleContext {
  const { module, container, eventBus, sink, log, interceptorRegistry } = options;
  let decorationDepth = 0;

  return {
    module,

    di: {
      register(registrations) {
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
    asFunction: <T,>(fn: (cradle: KernelCradle) => T): RegistrationBuilder<T> =>
      asFunction(fn as (...args: unknown[]) => T),
    asValue: <T,>(value: T): Registration<T> => asValue(value) as Registration<T>,

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

    log,
  };
}
