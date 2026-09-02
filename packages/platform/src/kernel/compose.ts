import type { EventBus } from '../events/bus.js';
import type { ApiInterceptorRegistry } from '../http/interceptors/index.js';
import { registerValues, type KernelContainer } from './container.js';
import { effectiveState } from './lifecycle/effective-state.js';
import {
  assertRequiredModulesPresent,
  type RequiredModule,
} from './lifecycle/required-modules.js';
import { assertUniqueModuleIds } from './lifecycle/unique-module-ids.js';
import { enterSystemScope } from './scope.js';
import {
  AmbiguousDecorationError,
  DuplicateRegistrationError,
  EagerResolutionError,
  ForeignDecorationError,
  PackageDecorationNotOfferedError,
  createDecorationLedger,
  createDecorationQueue,
  createModuleContext,
  createModuleRegistrationSink,
  createRegistrationOwnership,
  type DecorationLedger,
  type DecorationRecord,
  type ModuleBootHook,
  type ModuleContext,
  type ModuleRegistrationSink,
  type RegistrationOwnership,
} from './module-context.js';
import type { PlatformLogger } from './logging.js';

export {
  AmbiguousDecorationError,
  ForeignDecorationError,
  PackageDecorationNotOfferedError,
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
    readonly phase: 'register' | 'decorate' | 'boot',
    readonly cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      phase === 'register'
        ? `[kernel] module '${moduleId}' failed while registering: ${detail}`
        : phase === 'decorate'
          ? // D-176 — a decoration is applied at the drain, after the last
            // module has registered, so a failure in one is no longer inside
            // the decorating module's `registerModule`. The phase says so
            // rather than borrowing 'register', which would attribute the
            // failure to a call that had already returned.
            `[kernel] module '${moduleId}' failed while its decoration was applied: ${detail}`
          : `[kernel] module '${moduleId}' failed in its boot hook: ${detail}`,
    );
    this.name = 'ModuleCompositionError';
  }
}

/**
 * A root contributed outside the contribution window (issue #52).
 *
 * The window is the single slot between `composeModules(MODULES, …)` and
 * `runBootHooks()` (D-45), and both of its edges used to be a convention two
 * composition roots had to remember identically. {@link ComposedModules.contribute}
 * makes the early edge structural — there is nothing to call the method on until
 * the registration pass is over — and this makes the late edge loud.
 */
export class ContributionWindowClosedError extends Error {
  constructor(readonly names: readonly string[]) {
    super(
      `[kernel] contribution outside the window: ${names.join(', ')}. ` +
        'A root contribution over a name a module defaults goes between ' +
        '`composeModules(MODULES, …)` and `runBootHooks()` (D-45). The boot phase has ' +
        'already started, so a hook may have read the default this was meant to replace ' +
        '— move the `contribute(…)` call above `runBootHooks()`.',
    );
    this.name = 'ContributionWindowClosedError';
  }
}

/** Both already carry the module id; wrapping them would only bury it. */
function alreadyNamesTheModule(error: unknown): boolean {
  return (
    error instanceof DuplicateRegistrationError ||
    error instanceof EagerResolutionError ||
    error instanceof AmbiguousDecorationError ||
    error instanceof ForeignDecorationError ||
    error instanceof PackageDecorationNotOfferedError
  );
}

/** What the composer knows about one module. Nothing else about it is reachable. */
export interface ModuleEntry {
  /** The manifest id. Injected here, never hard-coded inside the module (FR-031). */
  readonly id: string;
  /** The manifest version. */
  readonly version: string;
  readonly registerModule: (ctx: ModuleContext) => void;
  /**
   * This entry is one of the active **deployment's** overlay modules, found
   * under `backend/src/apps/<deployment>/modules/` (issue #203).
   *
   * Absent for every core module, and the generated composer is what sets it —
   * from the root the module was discovered under, never from anything the
   * module says about itself. It exempts the module from the ownership rule on
   * `ctx.di.decorate`, which is why it is a location and not a declaration.
   */
  readonly overlay?: boolean;
  /**
   * This entry came from an **installed extension package**, not from this
   * repository's tree (D-176 Q3).
   *
   * Set by the host's package loader from where it found the package, never by
   * the package — the same rule `overlay` follows, and for the mirror-image
   * purpose: `overlay` grants the decoration exemption, this **withholds** one.
   * A deployment's overlay may wrap anything core registers and not a
   * registration a package owns, because nothing in a package's `exports` map
   * publishes the container names it registers internally. See
   * {@link PackageDecorationNotOfferedError}.
   *
   * It is a separate field rather than `overlay` widened to an origin enum
   * (D-156.4): one flag that both grants and refuses is one flag away from
   * granting a stranger the audit path.
   */
  readonly installedPackage?: boolean;
}

export interface ComposeModulesOptions {
  readonly container: KernelContainer;
  readonly eventBus: EventBus;
  readonly log: PlatformLogger;
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
   * Declared wrapping order per registration name, reaching the composer as
   * data.
   *
   * Only needed where **two different modules** decorate one name; below that
   * there is nothing to decide. It is checked rather than applied: the composer
   * emits modules in topological order, so the declaration's job is to say that
   * this order is the intended one, and composition fails when the two
   * disagree.
   *
   * **No composition root passes this, and nothing an author can edit supplies
   * it** (D-156.7). The field was written against `endora.config.ts`'s
   * `overrides.order` (D-28) — an instance-repository artefact specified in
   * `specs/071-modular-packaging/contracts/instance-and-distribution.md` and
   * scheduled for F11, which **does not exist as a file anywhere in this
   * repository**. Both roots omit the option; every other reference to it is in
   * `test/integration/kernel/decoration.test.ts`.
   *
   * So today this is a seam with no supply, and the consequence is reachable
   * without any package: a deployment shipping two overlay modules that decorate
   * one name gets `AmbiguousDecorationError` and cannot declare its way out. That
   * fails closed, so nothing is unsafe — and the error says what an author can do
   * instead rather than naming this field. Keep the two in step: the day a root
   * starts passing this, that message is what has to change with it.
   */
  readonly decorationOrder?: Readonly<Record<string, readonly string[]>> | undefined;
  /**
   * The modules this composition is required to have — issue #258, and see
   * `lifecycle/required-modules.ts` for the whole reasoning.
   *
   * A root derives it with `requiredModulesFrom(manifests)` and hands it over as
   * data, for the same reason `activationDeclarationsFrom` exists: the composer
   * is given three fields per module and may not read a manifest. Deriving it is
   * the root's job; there is no list anywhere, so withdrawing a lock changes
   * this refusal in the same run (D-100).
   *
   * Omitting it means *this composition requires nothing*, which is the honest
   * answer for a fixture composing two modules that do not exist. Every root
   * that composes the platform passes it, and `harness-parity.test.ts` is what
   * keeps the two from drifting apart on it.
   */
  readonly requiredModules?: readonly RequiredModule[] | undefined;
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
   * The **contribution window** (D-45, issue #52): the one slot where a root
   * may write a name a module has defaulted.
   *
   * Register it earlier and the module's own registration overwrites it;
   * register it later and a boot hook has already read the default. Both edges
   * are enforced by the shape rather than remembered: the early one because
   * this object does not exist until every module has registered, the late one
   * because the method refuses once {@link runBootHooks} has started
   * ({@link ContributionWindowClosedError}).
   *
   * Host values **no module defaults** — the Redis client, the EventBus, a
   * deployment flag — have no window at all and are registered with
   * `registerValues` where they come into existence. The window is about
   * overwriting, and there is nothing to overwrite.
   */
  contribute(values: Readonly<Record<string, unknown>>): void;
  /**
   * A **post-registration** `ModuleContext` for one composed module — D-157.7,
   * beside `ownerOf` and `contribute`, which are the two accessors this object
   * already exists to provide.
   *
   * It exists for the host's CLI runner (D-160.9): a module-declared command
   * receives a `ModuleContext`, not a cradle, so its body resolves with
   * `lazyPort<T>(ctx, 'literalName')` — character-for-character what
   * `backend.ts` writes, which is what keeps `check:port-dependencies` able to
   * see the edge. A `scope.cradle.someForeignPort` read would be an undeclared
   * port edge that reports clean.
   *
   * Two properties of the context it returns, both deliberate:
   *
   *  - `isRegistering` is **false**, so the phase guard permits resolution.
   *    That is the whole difference from the context `registerModule` was
   *    given, and it is correct here: every module has registered.
   *  - its registration **sink is a throwaway**. A command is invoked after the
   *    composition is built, so a route or a worker pushed into it is read by
   *    nobody. The sink is not shared with the composition's, so a command
   *    cannot half-register a surface into a running platform either.
   *
   * @throws {Error} when `moduleId` is not one of the composed entries — a
   * caller asking for a context by id has to be told the id is wrong, rather
   * than handed a context for a module that is not there.
   */
  contextFor(moduleId: string): ModuleContext;
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
  // T030c / D-155.7 — module id uniqueness, in the same slot and for the same
  // reason as the refusal below: both answers exist already, and a composition
  // that is going to be refused must not half-run first. Unconditional, because
  // there is no composition in which two entries claiming one id is a coherent
  // request — see `lifecycle/unique-module-ids.ts` for what used to happen
  // instead.
  assertUniqueModuleIds(entries.map((entry) => entry.id));

  // Issue #258 — before the first module registers, because both answers this
  // needs exist already and nothing it could refuse is worth half-doing. It has
  // to land ahead of the boot phase, which is where the failure it prevents
  // surfaces (as `invoices` failing in a hook, naming the wrong module and no
  // remedy); ahead of the *registration* phase is simply the earliest point
  // that is still ahead of it.
  //
  // A composition passing no `requiredModules` requires nothing and is left
  // alone: the presence singleton is process-wide and has nothing to do with a
  // fixture composing two modules that do not exist.
  if (options.requiredModules && options.requiredModules.length > 0) {
    assertRequiredModulesPresent(
      options.requiredModules,
      new Set(entries.map((entry) => entry.id)),
      effectiveState,
    );
  }

  const combined = createModuleRegistrationSink();
  const ownership = options.ownership ?? createRegistrationOwnership();
  const decorations =
    options.decorations ?? createDecorationLedger(options.decorationOrder ?? {});
  const bootHooks: Array<{ moduleId: string; hook: ModuleBootHook }> = [];
  // D-176 — every `ctx.di.decorate` of this pass lands here and is applied
  // below, once the last module has registered.
  const decorationQueue = createDecorationQueue();
  // D-176 Q3 — which of these entries a stranger shipped. Derived from the
  // entries the root handed over, so a package cannot answer for itself, and
  // read only by the decoration guard.
  const installedPackageModuleIds = new Set(
    entries.filter((entry) => entry.installedPackage === true).map((entry) => entry.id),
  );

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
        decorationQueue,
        installedPackageModuleIds,
        isRegistering: () => registering,
        ...(entry.overlay === undefined ? {} : { overlay: entry.overlay }),
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

  // ---- The decoration drain (D-176) ---------------------------------------
  //
  // One registration pass, then one drain. Every `ctx.di.decorate` of the pass
  // above was queued rather than applied, so what a decoration can reach no
  // longer depends on where its module sat in the array — which is what makes
  // D-45's sentence true of this seam as well: registration order is
  // meaningless, and `decorate` was the one operation that read and rewrote the
  // container without resolving anything, so the `registering` guard never saw
  // the dependency it created.
  //
  // In the queue's own order, deliberately. `AmbiguousDecorationError` exempts
  // a module that decorates one name twice because it wrote both wraps in the
  // order it wrote them, and a queue keeps that for free.
  //
  // Nothing is sorted and nothing is grouped: the drain removes the
  // *dependency* on order, not the order. Two different modules decorating one
  // name is still refused unless the composition declares which wraps which.
  for (const pending of decorationQueue.pending) {
    try {
      pending.apply();
    } catch (err) {
      // The kernel's own decoration refusals name the module already; anything
      // else — a wrap that threw while building — is attributed to the module
      // that wrote it, which is the fact the queued entry carries for exactly
      // this reason.
      if (alreadyNamesTheModule(err)) throw err;
      throw new ModuleCompositionError(pending.moduleId, 'decorate', err);
    }
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

  // Closed by the boot phase rather than by the end of it: hooks run in
  // registration order, so a contribution made from inside one is already
  // invisible to every hook that ran before it.
  let contributionWindowOpen = true;

  return {
    sink: combined,
    ownerOf: (name) => ownership.ownerOf(name),
    decorations: decorations.entries,
    contextFor(moduleId: string): ModuleContext {
      const entry = entries.find((candidate) => candidate.id === moduleId);
      if (entry === undefined) {
        throw new Error(
          `[kernel] no module '${moduleId}' in this composition, so there is no context to ` +
            `build for it. Composed: ${entries.map((e) => e.id).join(', ')}.`,
        );
      }
      return createModuleContext({
        module: { id: entry.id, version: entry.version },
        container: options.container,
        eventBus: options.eventBus,
        // Throwaway — see the interface comment. Nothing reads it, and that is
        // better than handing over the composition's, which a command could
        // push a route into after the server was built.
        sink: createModuleRegistrationSink(),
        log: options.log,
        ownership,
        decorations,
        // No queue, and that is the honest shape: the drain has already run, so
        // a decoration written from a command's context applies at the call —
        // which is what it did before D-176 and what it must keep doing, since
        // queueing it would be a wrap nobody ever applies. The guards are
        // unchanged either way, `installedPackageModuleIds` included.
        installedPackageModuleIds,
        // The one difference from the registration pass: every module has
        // registered, so resolving is exactly what this context is for.
        isRegistering: () => false,
        ...(entry.overlay === undefined ? {} : { overlay: entry.overlay }),
        ...(options.interceptorRegistry
          ? { interceptorRegistry: options.interceptorRegistry }
          : {}),
      });
    },
    contribute(values: Readonly<Record<string, unknown>>): void {
      if (!contributionWindowOpen) {
        throw new ContributionWindowClosedError(Object.keys(values));
      }
      registerValues(options.container, values);
    },
    async runBootHooks(): Promise<void> {
      contributionWindowOpen = false;
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
