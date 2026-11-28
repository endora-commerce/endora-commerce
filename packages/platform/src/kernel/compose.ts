import type { EventBus } from '../events/bus.js';
import type { ApiInterceptorRegistry } from '../http/interceptors/index.js';
import type { ModuleOrigin } from '@endora-commerce/contracts';
import type { CommandHookCompositionInput, CommandHookRegistry } from '../commands/hooks/registry.js';
import type { RecordMergeRegistry } from './merge/registry.js';
import type { MergeCompositionDeclarations } from './merge/declarations.js';
import type { CommandMiddlewareCompositionInput, CommandMiddlewareRegistry } from '../commands/middleware/registry.js';
import type { EntityExtensionLoaderRegistry } from './entity-extensions/registry.js';
import type { FormRegistry } from './forms/registry.js';
import type { FormDeclarationsInput } from './forms/seal.js';
import { moduleOriginOf } from '../lifecycle/services/module-origin.js';
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
   *
   * D-156.4, narrowed by D-296: the narrowing covers the four guard seams only
   * (`GUARD_SEAM_REGISTRATIONS`: `commandBus`, `auditLogService`, `eventBus`,
   * `emFactory`). An overlay's decoration of one is deprecated in 0.113.0 — it
   * composes, warns and is flagged `deprecated` on `kernel.decorations` — and is
   * refused from 0.114.0. Every other name the exemption reaches is unchanged.
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
  /**
   * The module's trust tier (`specs/189-command-middleware/contracts/module-origin.md`
   * §2): **set by the loader from where it found the module, never by the
   * module**, through `moduleOriginOf`. Absent from the generated composer's
   * entries, which are `core`; {@link composeModules} reads an absent value off
   * `overlay` and `installedPackage` by the same table.
   *
   * It does not touch decoration: `overlay` and `installedPackage` keep their
   * meaning and are not derived from it (§3). Read only by the contribution
   * registries that ask for a tier — command middleware today.
   */
  readonly origin?: ModuleOrigin;
  /**
   * The `name` in the installed package's own `package.json` — not the
   * dependency key it was installed under, so an npm alias shows its real
   * name (`contracts/module-origin.md` §2). Set by the package loader only;
   * absent for core and overlay entries. What a per-point grant is matched
   * against (§5 item 3).
   */
  readonly installedPackageName?: string;
}

export interface ComposeModulesOptions {
  readonly container: KernelContainer;
  readonly eventBus: EventBus;
  readonly log: PlatformLogger;
  /** Absent in composition roots that mount no interceptor surface. */
  readonly interceptorRegistry?: ApiInterceptorRegistry | undefined;
  /**
   * The command-hook registry the root also handed its `CommandBus`
   * (`specs/176-command-hooks-outbox/` P2). Every module's `ctx.commandHooks`
   * registers into it, and this call **seals** it once the last module has
   * registered — after the decoration drain, before the boot phase — which is
   * where every composition refusal of FR-012 is raised. Absent in a
   * composition root that wires no hooks; `ctx.commandHooks` then refuses.
   */
  readonly commandHookRegistry?: CommandHookRegistry | undefined;
  /**
   * What the registry is sealed against, as data the root derives — the same
   * shape `requiredModules` has, for the same reason: the composer may not read
   * a manifest. `hookableActionsFrom(manifests)` and
   * `moduleDependencyClosureFrom(manifests)`, plus the deployment's
   * `commandHookOrder` from its `divergence.ts`.
   *
   * Omitted with a registry present, the registry is sealed against nothing:
   * no action is hookable, so any registered hook refuses the composition.
   */
  readonly commandHooks?: CommandHookCompositionInput | undefined;
  /**
   * The composition's record-merge registry (`specs/192-organization-merge/`).
   * Every module's `ctx.merge` registers into it, and this call **seals** it
   * once the last module has registered, against {@link mergeDeclarations}.
   * Absent in a composition root that runs no merge; `ctx.merge` is then a no-op.
   */
  readonly mergeRegistry?: RecordMergeRegistry | undefined;
  /**
   * What the merge registry is sealed against — `mergeDeclarationsFrom(manifests)`,
   * derived by the root from the same manifest set as `commandHooks`. Omitted
   * with a registry present, it is sealed against nothing: a registration then
   * refuses for want of a declaration.
   */
  readonly mergeDeclarations?: MergeCompositionDeclarations | undefined;
  /**
   * The command-middleware registry the root also handed its `CommandBus`
   * (`specs/189-command-middleware/` P1). Every module's `ctx.commandMiddleware`
   * registers into it, and this call seals it after the command-hook registry
   * and before the boot phase, with the origin of each entry — which the
   * composer derives and nothing else may supply (`contracts/module-origin.md`
   * §2). Absent in a root that wires no middleware; `ctx.commandMiddleware`
   * then refuses.
   */
  readonly commandMiddlewareRegistry?: CommandMiddlewareRegistry | undefined;
  /**
   * What the middleware registry is sealed against, as data the root derives:
   * `commandMiddlewareFrom(manifests)`, `moduleDependencyClosureFrom(manifests)`
   * and the deployment's `commandMiddlewareOrder`. Omitted with a registry
   * present, nothing is declared, so any registered middleware refuses.
   */
  readonly commandMiddleware?: Omit<CommandMiddlewareCompositionInput, 'origins'> | undefined;
  /**
   * The side-table loader registry the root also hands `entityExtensionReads`
   * (`specs/187-side-table-extensions/` B1). Every module's
   * `ctx.entityExtensionLoaders` registers into it — judged against the
   * declarations the root built it with — and this call seals it after the
   * middleware registry, before the boot phase. Absent in a root that serves
   * no extension includes; `ctx.entityExtensionLoaders` then refuses.
   */
  readonly entityExtensionLoaderRegistry?: EntityExtensionLoaderRegistry | undefined;
  /**
   * The form registry (`specs/193-admin-form-extensions/` WP-B). Every
   * module's `ctx.fieldSets` and `ctx.fieldFormats` register into it, and this
   * call seals it after the side-table loader registry and before the boot
   * phase — with the origin map and the installed package names, which only
   * the composer derives — then attaches it to the command-hook registry as
   * the field-rule check source. Absent in a root that composes no form
   * extensions; `ctx.fieldSets` then refuses.
   */
  readonly formRegistry?: FormRegistry | undefined;
  /**
   * What the form registry is sealed against, as data the root derives
   * (`formDeclarationsFrom(manifests)`) plus the deployment's
   * `formOverrideGrants`. Omitted with a registry present, nothing is
   * declared, so any registered field set refuses.
   */
  readonly forms?: FormDeclarationsInput | undefined;
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
   * **Both composition roots pass it**, from the deployment's own
   * `backend/src/apps/<deployment>/divergence.ts` (feature 107, FR-040/FR-041).
   * The declaration is a hand-written, reviewed file in the deployment's tree;
   * `loadDivergenceDeclaration` reads it and each root hands the field over as
   * data, in the shape `requiredModules` and `activationDeclarations` already
   * have — the composer is given the answer and never reads a file.
   *
   * It was a seam with **no** supply until then (D-156.7): the field was written
   * against `endora.config.ts`'s `overrides.order` (D-28), an instance-repository
   * artefact scheduled for F11 that the owner has since ruled will not be built,
   * so a deployment shipping two overlay modules that decorate one name got
   * `AmbiguousDecorationError` and could not declare its way out. That failed
   * closed, so nothing was unsafe; it was a dead end wearing an instruction, and
   * this paragraph carried the coupling — *"the day a root starts passing this,
   * that message is what has to change with it"*. It changed with it:
   * `AmbiguousDecorationError` now names this field and that file.
   *
   * Three shapes the *report's* check refuses, because they describe nothing and
   * will describe the wrong thing later: an entry for a name no two overlay
   * modules decorate, an entry naming a module that is not one of this
   * deployment's, and an entry naming fewer modules than decorate that name.
   * They are `check:divergence`'s and not this composer's, because a stale
   * ordering is a merge-request question while an ambiguity is a correctness one.
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

/** A composition that declares no form extensions. */
const EMPTY_FORM_DECLARATIONS: FormDeclarationsInput = {
  fieldSets: [],
  adminForms: [],
  formOverrides: [],
  inputControls: [],
  hookableActions: [],
  moduleDependencies: {},
  permissionCodes: [],
};

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
        ...(options.commandHookRegistry
          ? { commandHookRegistry: options.commandHookRegistry }
          : {}),
        ...(options.mergeRegistry ? { mergeRegistry: options.mergeRegistry } : {}),
        ...(options.commandMiddlewareRegistry
          ? { commandMiddlewareRegistry: options.commandMiddlewareRegistry }
          : {}),
        ...(options.entityExtensionLoaderRegistry
          ? { entityExtensionLoaderRegistry: options.entityExtensionLoaderRegistry }
          : {}),
        ...(options.formRegistry ? { formRegistry: options.formRegistry } : {}),
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

  // ---- Sealing the command-hook registry (176 P2) ------------------------
  //
  // After the drain for the drain's own reason: registration order is
  // meaningless, so what a hook may attach to is decided only once every
  // module has registered. Before the boot phase, so a composition that hooks
  // an undeclared action, or that cannot order two hook modules, refuses
  // before any hook resolves anything. The errors name the modules, the hook
  // and the action already, so they propagate unwrapped.
  if (options.commandHookRegistry) {
    options.commandHookRegistry.seal(
      options.commandHooks ?? { hookableActions: [], moduleDependencies: {}, commandHookOrder: {} },
    );
  }

  // ---- Sealing the record-merge registry (`specs/192-organization-merge/`) --
  //
  // At the same point and for the same reason as the command hooks: every
  // module has registered, and nothing has resolved yet.
  if (options.mergeRegistry) {
    options.mergeRegistry.seal({
      declarations: options.mergeDeclarations ?? { hosts: [], participations: [] },
    });
  }

  // ---- Sealing the command-middleware registry (189 P1) -------------------
  //
  // After the hook seal, before the boot phase, for the hook seal's reasons.
  // The origin map is the composer's to build: from each entry's loader-stamped
  // `origin`, or — for an entry no loader stamped — from the two flags by the
  // same table (`contracts/module-origin.md` §2). One map, handed to every
  // registry that reads a tier, and to nothing else.
  const origins: Record<string, ModuleOrigin> = {};
  for (const entry of entries) {
    origins[entry.id] =
      entry.origin ??
      moduleOriginOf(entry.overlay === true ? 'overlay' : entry.installedPackage === true ? 'package' : 'core', false);
  }
  if (options.commandMiddlewareRegistry) {
    options.commandMiddlewareRegistry.seal({
      declarations: options.commandMiddleware?.declarations ?? [],
      moduleDependencies: options.commandMiddleware?.moduleDependencies ?? {},
      commandMiddlewareOrder: options.commandMiddleware?.commandMiddlewareOrder,
      origins,
    });
    // FR-034 — once at boot, beside `kernel.decorations`: what runs on every
    // Command should be readable from the build.
    const plan = options.commandMiddlewareRegistry.plan();
    if (plan.length > 0) {
      options.log.info(
        {
          middleware: plan.map((entry) => ({
            module: entry.moduleId,
            id: entry.id,
            phase: entry.phase,
            origin: entry.origin,
            position: entry.position,
            actions: entry.actions,
          })),
        },
        'kernel.command-middleware',
      );
    }
  }

  // ---- Sealing the side-table loader registry (187 B1) --------------------
  //
  // Every refusal of a loader (L1, L2) is raised at its registration, so the
  // seal decides nothing but L3: from here on a loader registered from a
  // command's context refuses rather than appearing in a running process.
  options.entityExtensionLoaderRegistry?.seal();

  // ---- Sealing the form registry (193 WP-B) --------------------------------
  //
  // After the hook seal, because the writers it judges are hookable actions
  // the hook seal has already validated, and before the boot phase, so a
  // deployment override that loosens a rule or targets a field nobody
  // declared refuses before anything resolves. The same origin map the
  // middleware registry reads, and the installed package names a grant is
  // matched against (`contracts/module-origin.md` §5). Then the bus finds each
  // writer's field-rule check through the hook registry it already has.
  if (options.formRegistry) {
    const installedPackageNames: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.installedPackageName !== undefined) installedPackageNames[entry.id] = entry.installedPackageName;
    }
    const warnings = options.formRegistry.seal({
      ...(options.forms ?? EMPTY_FORM_DECLARATIONS),
      origins,
      installedPackageNames,
    });
    for (const warning of warnings) {
      options.log.warn(
        { code: warning.code, module: warning.moduleId, fieldSet: warning.fieldSet, field: warning.field },
        warning.message,
      );
    }
    options.commandHookRegistry?.useFieldRuleCheck(options.formRegistry);
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
          // 189 FR-050 — a guard-seam wrap by an overlay (D-296), on its way out.
          ...(entry.deprecated === true ? { deprecated: true } : {}),
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
        // Sealed by now, so a hook registered from a command's context refuses
        // with the registry's own message rather than "no registry mounted".
        ...(options.commandHookRegistry
          ? { commandHookRegistry: options.commandHookRegistry }
          : {}),
        ...(options.mergeRegistry ? { mergeRegistry: options.mergeRegistry } : {}),
        ...(options.commandMiddlewareRegistry
          ? { commandMiddlewareRegistry: options.commandMiddlewareRegistry }
          : {}),
        ...(options.entityExtensionLoaderRegistry
          ? { entityExtensionLoaderRegistry: options.entityExtensionLoaderRegistry }
          : {}),
        ...(options.formRegistry ? { formRegistry: options.formRegistry } : {}),
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
