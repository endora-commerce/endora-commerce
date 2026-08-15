import type { EventBus } from '../events/bus.js';
import type { ApiInterceptorRegistry } from '../http/interceptors/index.js';
import type { KernelContainer } from './container.js';
import { enterSystemScope } from './scope.js';
import {
  AmbiguousDecorationError,
  DuplicateRegistrationError,
  EagerResolutionError,
  createDecorationLedger,
  createModuleContext,
  createModuleRegistrationSink,
  createRegistrationOwnership,
  type DecorationLedger,
  type DecorationRecord,
  type ModuleBootHook,
  type ModuleContext,
  type ModuleLifecycleLogger,
  type ModuleRegistrationSink,
  type RegistrationOwnership,
} from './module-context.js';

export {
  AmbiguousDecorationError,
  type DecorationLedger,
  type DecorationRecord,
} from './module-context.js';

/**
 * The composition seam (feature 072, T042/T043).
 *
 * `registerModule` is what a module writes; this is what runs it. Everything a
 * composition root needs to know about a module is the three fields of
 * {@link ModuleEntry} — which is what makes the list generatable in Phase 5,
 * and what makes removing a module a deletion rather than an archaeology
 * exercise.
 *
 * Two invariants are enforced here rather than left to review, because both
 * fail silently otherwise:
 *
 *  1. **One owner per registration name.** Otherwise which implementation the
 *     platform runs depends on the order the composer happens to emit.
 *  2. **Registration resolves nothing.** At the moment a module registers, the
 *     modules after it have not registered yet, so an eager resolution either
 *     throws or — worse — succeeds today and breaks when the topological order
 *     changes for an unrelated reason.
 */

/**
 * A module failed while the composer was running it (T053).
 *
 * The composer is the only place that knows *which* module is executing, so it
 * is the only place that can say so. Without this, a boot failure reads
 * `AwilixResolutionError: Could not resolve 'assetReferenceRegistry'` — a name,
 * with no indication of which of the modules wanted it — and the operator's
 * first move is to grep for a string that appears in six files.
 *
 * The kernel's own composition errors ({@link DuplicateRegistrationError},
 * {@link EagerResolutionError}) already name the module (and, for a collision,
 * both of them), so they propagate untouched rather than being wrapped twice.
 */
export class ModuleCompositionError extends Error {
  constructor(
    readonly moduleId: string,
    readonly phase: 'register' | 'boot',
    readonly cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      phase === 'register'
        ? `[kernel] module '${moduleId}' failed while registering: ${detail}`
        : `[kernel] module '${moduleId}' failed in its boot hook: ${detail}`,
    );
    this.name = 'ModuleCompositionError';
  }
}

/** Both already carry the module id; wrapping them would only bury it. */
function alreadyNamesTheModule(error: unknown): boolean {
  return (
    error instanceof DuplicateRegistrationError ||
    error instanceof EagerResolutionError ||
    error instanceof AmbiguousDecorationError
  );
}

/** What the composer knows about one module. Nothing else about it is reachable. */
export interface ModuleEntry {
  /** The manifest id. Injected here, never hard-coded inside the module (FR-031). */
  readonly id: string;
  /** The manifest version. */
  readonly version: string;
  readonly registerModule: (ctx: ModuleContext) => void;
}

export interface ComposeModulesOptions {
  readonly container: KernelContainer;
  readonly eventBus: EventBus;
  readonly log: ModuleLifecycleLogger;
  /** Absent in composition roots that mount no interceptor surface. */
  readonly interceptorRegistry?: ApiInterceptorRegistry | undefined;
  /**
   * Share one ledger across several `composeModules` calls — which is what a
   * root does while modules are converted one batch at a time, so a converted
   * module still collides with a converted module composed in another call.
   */
  readonly ownership?: RegistrationOwnership | undefined;
  /**
   * Share one decoration ledger across several `composeModules` calls, for the
   * same reason `ownership` is shared: a client module composed in a later call
   * still wraps a registration an earlier call decorated.
   */
  readonly decorations?: DecorationLedger | undefined;
  /**
   * Declared wrapping order per registration name — `endora.config.ts`'s
   * `overrides.order` (D-28), reaching the composer as data.
   *
   * Only needed where **two different modules** decorate one name; below that
   * there is nothing to decide. It is checked rather than applied: the composer
   * emits modules in topological order, so the declaration's job is to say that
   * this order is the intended one, and composition fails when the two
   * disagree.
   */
  readonly decorationOrder?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface ComposedModules {
  /** Everything the modules contributed, in registration order. */
  readonly sink: ModuleRegistrationSink;
  /** Which module registered `name`, for diagnostics and for the duplicate report. */
  ownerOf(name: string): string | undefined;
  /**
   * The override report (T065): every decoration this composition applied, in
   * application order, innermost first.
   *
   * A build's customisations should be readable from the build, not inferred
   * from which files happen to exist on disk. Empty means a bare-core build,
   * and it means it explicitly.
   */
  readonly decorations: readonly DecorationRecord[];
  /**
   * Run the explicit boot phase (FR-021): every module's `onBoot` hook, in
   * registration order, each inside its own `enterSystemScope`.
   *
   * A boot hook is the one place a module may do composition-time work that
   * resolves — so it runs after **every** module has registered, and never as a
   * side effect of route attachment, which a `BACKEND_ROLE=worker` process
   * would never reach.
   */
  runBootHooks(): Promise<void>;
}

export function composeModules(
  entries: readonly ModuleEntry[],
  options: ComposeModulesOptions,
): ComposedModules {
  const combined = createModuleRegistrationSink();
  const ownership = options.ownership ?? createRegistrationOwnership();
  const decorations =
    options.decorations ?? createDecorationLedger(options.decorationOrder ?? {});
  const bootHooks: Array<{ moduleId: string; hook: ModuleBootHook }> = [];

  // Read by every context this call creates, so the phase guard covers the
  // whole pass rather than one module at a time: module A resolving something
  // module B registers is exactly the order-dependence being forbidden.
  let registering = true;
  try {
    for (const entry of entries) {
      const sink = createModuleRegistrationSink();
      const ctx = createModuleContext({
        module: { id: entry.id, version: entry.version },
        container: options.container,
        eventBus: options.eventBus,
        sink,
        log: options.log,
        ownership,
        decorations,
        isRegistering: () => registering,
        ...(options.interceptorRegistry
          ? { interceptorRegistry: options.interceptorRegistry }
          : {}),
      });

      try {
        entry.registerModule(ctx);
      } catch (err) {
        if (alreadyNamesTheModule(err)) throw err;
        throw new ModuleCompositionError(entry.id, 'register', err);
      }

      combined.plugins.push(...sink.plugins);
      combined.rootPlugins.push(...sink.rootPlugins);
      combined.workers.push(...sink.workers);
      combined.unsubscribes.push(...sink.unsubscribes);
      for (const hook of sink.bootHooks) bootHooks.push({ moduleId: entry.id, hook });
    }
  } finally {
    registering = false;
  }

  // The report is emitted, not merely available: a deployment running a client
  // override should say so once at boot, in the same place the operator already
  // reads what the platform composed.
  if (decorations.entries.length > 0) {
    options.log.info(
      {
        overrides: decorations.entries.map((entry) => ({
          registration: entry.name,
          decoratedBy: entry.moduleId,
          owner: entry.owner ?? null,
          depth: entry.depth,
        })),
      },
      'kernel.decorations',
    );
  }

  return {
    sink: combined,
    ownerOf: (name) => ownership.ownerOf(name),
    decorations: decorations.entries,
    async runBootHooks(): Promise<void> {
      for (const { moduleId, hook } of bootHooks) {
        await enterSystemScope(
          `boot: ${moduleId}`,
          async () => {
            try {
              await hook();
            } catch (err) {
              if (alreadyNamesTheModule(err)) throw err;
              throw new ModuleCompositionError(moduleId, 'boot', err);
            }
          },
          // Branch the scope off the container these modules registered into,
          // not off the process-wide default. `ctx.cradle()` resolves through
          // the ambient scope when there is one, so a boot hook opened against
          // the wrong root would fail to resolve the module's own services —
          // in a composition root that never called `setRootContainer`, which
          // is every unit test that composes its own container.
          { entryPoint: 'boot', container: options.container },
        );
      }
    },
  };
}
