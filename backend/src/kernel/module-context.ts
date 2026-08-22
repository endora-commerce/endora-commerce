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
} from './lifecycle/plugin-helpers.js';
import type { KernelContainer, KernelCradle } from './container.js';
import { moduleLogger } from './logging.js';
import { registerPort } from './ports/provide.js';

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
        `implementation the platform runs depends on registration order. One of them ` +
        `owns it and the other resolves it; a deployment that needs to change what ` +
        `'${owner}' registers wraps it from its own overlay module, with ` +
        `ctx.di.decorate('${registrationName}', …).`,
    );
    this.name = 'DuplicateRegistrationError';
  }
}

/**
 * A module registered over a name a composition root supplies (D-156.6).
 *
 * This is the door beside the one {@link ForeignDecorationError} guards, and it
 * stood open while that one was locked. `registerValues` claims no ownership,
 * and `claim` threw only when a *different module* already owned the name — so for a
 * root-registered name there was no prior owner, the claim succeeded, and
 * awilix's `register` overwrote the entry. Any module could take `commandBus`,
 * become its owner, and thereafter decorate it legally, because
 * `ForeignDecorationError` fires only for a name someone else owns.
 *
 * Refusing the **wrap** while permitting the **replacement** is not a boundary:
 * it reads as one and is not, and D-28 is explicit that replacement must be *a
 * distinct, more explicit act* than decoration. Today it is the less explicit
 * one, which is what this closes.
 *
 * The refused set is derived, never listed (D-100, D-156.5): a name the
 * container already holds that no module claimed is exactly a name a
 * composition root supplied — `registerValues` above the compose call, or
 * `contribute()` in D-45's window. A root that starts or stops supplying a name
 * changes the answer in the same run, and nothing has to be kept true by hand.
 *
 * There is no overlay exemption here, and that is not an oversight. A
 * deployment's way to change what a root-supplied name resolves to is
 * `ctx.di.decorate`, which it may do and which keeps core delegating; taking
 * the name outright severs that, for every consumer at once, with nothing
 * declared and nothing reported.
 */
export class ForeignRegistrationError extends Error {
  constructor(
    readonly registrationName: string,
    readonly moduleId: string,
  ) {
    super(
      `[kernel] module '${moduleId}' cannot register '${registrationName}': a composition ` +
        `root supplies it, so no module owns it. Registering over it replaces what every ` +
        `consumer of that name resolves — for the platform's own names that is the audit ` +
        `path, the transaction boundary, the event bus and the tenant-scoped EntityManager ` +
        `factory — and it does so with nothing declared in any manifest and nothing in the ` +
        `override report. Reach for a seam that exists instead: subscribe to the events the ` +
        `owner emits (ctx.subscribe), run before or after another module's endpoint ` +
        `(ctx.interceptors), or ask the owner to publish a strategy port with a default and ` +
        `register your implementation behind it (ctx.di.providePort, resolved through ` +
        `lazyPort). If this is a per-deployment customisation, write it as an overlay module ` +
        `under backend/src/apps/<deployment>/modules/ and wrap the registration with ` +
        `ctx.di.decorate('${registrationName}', …), which keeps core delegating through it.`,
    );
    this.name = 'ForeignRegistrationError';
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

/**
 * One applied decoration, as the override report lists it (T065).
 *
 * "Who is overriding what" is two questions, so the record answers both: the
 * module that wrote the wrap, and the module that owns the registration being
 * wrapped. A report that answers only the first sends its reader back to grep
 * for the second, which is the state this replaces — a client override was
 * discoverable by noticing a file existed under `apps/<deployment>/`.
 */
export interface DecorationRecord {
  readonly name: string;
  readonly moduleId: string;
  /** The module that registered `name`; `undefined` if a composition root did. */
  readonly owner: string | undefined;
  /** 1-based position in the wrapping chain for this name; innermost first. */
  readonly depth: number;
}

/**
 * Two modules decorate one name and nothing says which wraps which (T064).
 *
 * Decoration order is not a formatting question: `beta(acme(core))` and
 * `acme(beta(core))` are different implementations, and a platform that picks
 * between them by package load order picks by accident. The failure is loud at
 * composition rather than deferred to whichever behaviour shows up in
 * production.
 *
 * A module decorating the same name twice is *not* ambiguous — it wrote both
 * wraps, in the order it wrote them — so this fires only across modules.
 *
 * **The remedy is the one that exists today, not the one that is designed**
 * (D-156.7, D-156.11 item 2). This message used to send its reader to
 * `decorationOrder`, which is a real field on `ComposeModulesOptions` and is
 * passed by no composition root — its declared source, `endora.config.ts`, is
 * an F11 artefact and no file of that name exists anywhere in the repository.
 * So the instruction was unfollowable: an author could satisfy it only by
 * editing core's own `composition.ts`, which is the one thing an overlay is
 * built to avoid. What an author can actually do is make both wraps one
 * module's — which is exactly the case this error already exempts, for the
 * reason the paragraph above gives.
 */
export class AmbiguousDecorationError extends Error {
  constructor(
    readonly registrationName: string,
    readonly modules: readonly string[],
    detail: string,
  ) {
    super(
      `[kernel] modules ${modules.map((m) => `'${m}'`).join(' and ')} both decorate ` +
        `'${registrationName}', and ${detail} Which override wraps which decides what the ` +
        `platform runs, so it cannot be left to the order the modules happen to compose in. ` +
        `There is no way to declare that order today: no composition root passes ` +
        `\`decorationOrder\`, and the instance-owned configuration that would supply one is ` +
        `planned (F11) rather than built — so this composition refuses, deliberately. ` +
        `What works now: make both wraps one module's. A module decorating the same name ` +
        `more than once is not ambiguous — it wraps in the order it writes the calls — so ` +
        `merge the two decorations of '${registrationName}' into a single overlay module ` +
        `under backend/src/apps/<deployment>/modules/, which puts the order in the code that ` +
        `depends on it. If the two wraps genuinely belong to different owners, one of them ` +
        `is asking for a seam rather than a wrap: ask that owner for a strategy port.`,
    );
    this.name = 'AmbiguousDecorationError';
  }
}

/**
 * A module decorated a registration it does not own (issue #203).
 *
 * `decorate` used to check only that *something* was registered under the name.
 * Both halves of the answer were already in hand at the call site — the
 * decorating module's id, and the owner from the ownership ledger — and the
 * record kept both while comparing neither, so any module could wrap any entry
 * in the container: `commandBus` to observe every audited write,
 * `auditLogService` to change what the audit records, another module's read
 * port to sit between a consumer and its owner with nothing declared anywhere.
 *
 * Refused rather than ledgered. A ledger makes the platform's answer "we will
 * notice", and what is at stake here is not a coupling to drain but the
 * integrity of the audit path.
 *
 * The exemption is the **deployment's own** overlay module, which is a
 * different act: core wrapping core is a coupling nothing declares, while a
 * deployment wrapping core is the sanctioned per-deployment customisation seam
 * (feature 072 replaced file shadowing with it). It is not a claim a module can
 * make about itself — the generated composer sets it from the root the module
 * was discovered under, `backend/src/apps/<deployment>/modules/`.
 */
export class ForeignDecorationError extends Error {
  constructor(
    readonly registrationName: string,
    readonly moduleId: string,
    /** The registering module, or `undefined` when a composition root registered it. */
    readonly owner: string | undefined,
  ) {
    const owned =
      owner === undefined
        ? `a composition root registers it, so no module owns it`
        : `'${owner}' registers it`;
    super(
      `[kernel] module '${moduleId}' cannot decorate '${registrationName}': ${owned}. ` +
        `Decoration rewrites what every consumer of that name resolves, so it is the ` +
        `owner's to do — reaching into another module's registration is a coupling ` +
        `nothing declares and nothing reports. Ask ` +
        `${owner === undefined ? 'the composition root' : `'${owner}'`} for the seam you ` +
        `need (a port, a contribution point, an event), or, if this is a per-deployment ` +
        `customisation, write it as an overlay module under ` +
        `backend/src/apps/<deployment>/modules/ — that is the one decoration across ` +
        `owners the platform sanctions.`,
    );
    this.name = 'ForeignDecorationError';
  }
}

/**
 * The composition-wide record of decorations, shared by every module context of
 * one composition.
 *
 * It is shared for two reasons and both are defects if it is not. The private
 * name a decoration parks its inner resolver under must be unique **per
 * container**: a per-context counter gives the first decoration of two
 * different modules the same private name, so the second overwrites the first's
 * inner registration with the first's own wrapper and the chain resolves into
 * itself. And the ambiguity check is by definition cross-module, so it cannot
 * live in anything a single module owns.
 */
export interface DecorationLedger {
  /** @throws {AmbiguousDecorationError} when two modules decorate `name` unordered. */
  record(name: string, moduleId: string, owner: string | undefined): DecorationRecord;
  /** A private name for the resolver being wrapped, unique across the container. */
  innerNameFor(name: string): string;
  readonly entries: readonly DecorationRecord[];
}

export function createDecorationLedger(
  decorationOrder: Readonly<Record<string, readonly string[]>> = {},
): DecorationLedger {
  const entries: DecorationRecord[] = [];
  let counter = 0;

  return {
    entries,

    innerNameFor(name) {
      counter += 1;
      return `${name}$undecorated$${counter}`;
    },

    record(name, moduleId, owner) {
      const prior = entries.filter((entry) => entry.name === name);
      const priorModules = [...new Set(prior.map((entry) => entry.moduleId))];

      if (priorModules.some((id) => id !== moduleId)) {
        const applied = [...new Set([...priorModules, moduleId])];
        const declared = decorationOrder[name];

        if (declared === undefined) {
          throw new AmbiguousDecorationError(name, applied, 'no order is declared for it.');
        }

        const missing = applied.filter((id) => !declared.includes(id));
        if (missing.length > 0) {
          throw new AmbiguousDecorationError(
            name,
            applied,
            `the declared order omits ${missing.map((id) => `'${id}'`).join(', ')}.`,
          );
        }

        // A declaration that does not bind is worse than none: it reads as a
        // decision and behaves as a comment.
        for (let i = 1; i < applied.length; i += 1) {
          if (declared.indexOf(applied[i] as string) < declared.indexOf(applied[i - 1] as string)) {
            throw new AmbiguousDecorationError(
              name,
              applied,
              `they compose in the order ${applied.map((id) => `'${id}'`).join(' → ')}, which ` +
                `contradicts the declared ${declared.map((id) => `'${id}'`).join(' → ')}.`,
            );
          }
        }
      }

      const entry: DecorationRecord = { name, moduleId, owner, depth: prior.length + 1 };
      entries.push(entry);
      return entry;
    },
  };
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
     * Register a name **other modules resolve** — a port (FR-040).
     *
     * The difference from `register` is fail-closed cross-module resolution:
     * resolving a port while this module is not effectively present throws
     * `ModuleDisabledError` (503 `MODULE_DISABLED`, with `Retry-After`) rather
     * than handing a consumer a live service belonging to a module the
     * operator switched off (Constitution XVII).
     *
     * A module's *internal* registrations stay on `register`: gating those
     * would break the one surface that must answer while its module is
     * absent — `ctx.ungatedRoutes`, i.e. the liveness probe.
     */
    providePort<T>(name: string, registration: Registration<T>): void;
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
   *  - **It resolves through the container this module registered into**, and
   *    never through the ambient request scope. That makes what a name resolves
   *    to a property of the composition rather than of where the call happens,
   *    and it is why the module's registrations must be `singleton()` or
   *    `transient()`. Per-request state is read through its own accessor —
   *    `getResolvedChannel()` for the sales channel, `getTenantContext()` for
   *    tenancy — not through this cradle. Resolving `scoped()` registrations
   *    from a module belongs to Phase 5, where the generated composer owns the
   *    whole boot and one container is unambiguously *the* root.
   *  - **`C` is asserted by the caller**, because the container is the runtime
   *    authority and an unknown name throws rather than yielding `undefined`.
   *    Declaring the narrow shape a module needs is the port rule of
   *    `contracts/module-context.md` spelled in types.
   */
  cradle<C extends object = KernelCradle>(): C;

  /** Wrapped in `defineModuleRoutes(module.id, …)` — gating holds at the registration seam. */
  routes(register: (app: FastifyInstance) => Promise<void> | void): void;

  /**
   * Routes registered **outside** the module gate (D-36b). The exemption is
   * narrow and structural: a surface that *reports on the platform* cannot be
   * gated on a part of the platform without becoming circular. `_lifecycle`
   * already registers its presence projection this way by hand
   * (`routes.admin.ts:102-107`); a liveness or readiness probe is the same
   * shape, and the failure it prevents is unrecoverable — a probe answering
   * 503 because its module is off makes the orchestrator restart the
   * container, get 503 again, and repeat, so nothing stays up long enough to
   * serve the surface that would switch the module back on.
   *
   * `reason` is required and non-empty because that is the whole difference
   * between an exemption and a way around the gate: it appears in the code
   * next to the routes it covers, so the next reader can judge it.
   */
  ungatedRoutes(
    reason: string,
    register: (app: FastifyInstance) => Promise<void> | void,
  ): void;

  /**
   * A plugin registered on the **root** Fastify instance, uncapsulated (T078).
   *
   * `ctx.routes` and `ctx.ungatedRoutes` both register into an encapsulated
   * child context, which is right for routes and wrong for a decoration every
   * other module reads: a `decorateRequest` applied inside a child context is
   * invisible to that context's siblings, so `auth` decorating `request.actor`
   * through either of them would leave every other module's guards with no
   * actor to read.
   *
   * The difference from `ungatedRoutes` is not one of degree. That one is about
   * **the gate** — a surface that must answer while its module is off. This one
   * is about **encapsulation** — a contribution that must apply to the whole
   * application. A module can need either without the other.
   *
   * `reason` is required and non-empty: this is the one seam that can affect
   * every module in a deployment, so its justification lives beside it.
   */
  rootPlugin(reason: string, plugin: ModulePlugin): void;

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

  /**
   * The explicit boot phase (FR-021). Runs once every module has registered,
   * inside `enterSystemScope('boot: <module id>')`, so it may resolve.
   *
   * This is the only lifecycle hook a `ModuleContext` carries, and it runs on
   * every boot of every process, including `BACKEND_ROLE=worker`. Install-time
   * work belongs to the **other** lifecycle: a module that needs it exports
   * `installHook` / `uninstallHook` from its `manifest.ts`, which the composer
   * generator wires into the generated manifest index and the lifecycle
   * orchestrator runs. There is deliberately no container-side equivalent
   * (D-46) — `module:install` runs in a process that composes nothing, so a
   * hook collected by the composition sink would never fire.
   */
  onBoot(hook: ModuleBootHook): void;

  /**
   * The platform's logger, bound to this module (issue #269).
   *
   * Every line it writes carries `module: '<this module's id>'`, and carries
   * `reqId` when it is written during a request — neither of which the author
   * names. The destination is whatever the composition root passed, which for
   * every root that builds a server is the application's own pino instance from
   * the moment `buildServer` returns; see `kernel/logging.ts` for what a line
   * emitted before that, or from a process that builds no server, reaches.
   *
   * It is safe to keep: four modules hand it to a service that holds it for the
   * life of the process, and both the destination and the request correlation
   * are read per line rather than captured.
   */
  readonly log: ModuleLifecycleLogger;
}

/**
 * What one module contributed. The composer owns the sink and decides when to
 * attach the plugins, so `registerModule` stays a pure declaration.
 */
export interface ModuleRegistrationSink {
  readonly plugins: ModulePlugin[];
  /**
   * Plugins a composition root registers on the **root** Fastify instance,
   * uncapsulated (T078). Kept apart from `plugins` because a root places them
   * at a different point: a module's routes go with its own surface, a root
   * plugin goes where the whole application needs decorating.
   */
  readonly rootPlugins: ModulePlugin[];
  readonly workers: Worker[];
  readonly unsubscribes: Array<() => void>;
  readonly bootHooks: ModuleBootHook[];
}

export function createModuleRegistrationSink(): ModuleRegistrationSink {
  return {
    plugins: [],
    rootPlugins: [],
    workers: [],
    unsubscribes: [],
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
   * Shared across every module of one composition, so the private name a
   * decoration parks its inner resolver under is unique per container and the
   * cross-module ambiguity check can see every decoration (T064/T065). Absent
   * for a hand-built context — one module's decorations are ordered by the
   * order it wrote them.
   */
  readonly decorations?: DecorationLedger;
  /**
   * Whether `registerModule` is still running for this composition. While it
   * is, `ctx.cradle()` refuses to resolve (T043). Defaults to "no", so a
   * context built by hand in a unit test resolves freely.
   */
  readonly isRegistering?: () => boolean;
  /**
   * This module belongs to the active **deployment**, not to core — it was
   * discovered under `backend/src/apps/<deployment>/modules/` (issue #203).
   *
   * The one thing it buys is the exemption from the ownership rule on
   * `ctx.di.decorate`: a deployment may wrap a core registration, because that
   * is the customisation seam feature 072 put in place of file shadowing. It
   * is set by the generated composer from the module's location, never by the
   * module, so core cannot assert it.
   */
  readonly overlay?: boolean;
}

export function createModuleContext(options: ModuleContextOptions): ModuleContext {
  const { module, container, eventBus, sink, log, interceptorRegistry, ownership } = options;
  const isRegistering = options.isRegistering ?? ((): boolean => false);
  const isDeploymentOverlay = options.overlay === true;
  /**
   * Every name **this context** registered (issue #203).
   *
   * The ownership ledger is the composition's record and the authority
   * wherever there is one, but a context built by hand carries none — and
   * "no ledger" must not read as "no owner to compare", which would make the
   * decoration rule off by construction for exactly the contexts a test
   * builds. This answers the same question locally, and it cannot drift from
   * the ledger: with a ledger present, every name in here is already claimed
   * in it, so the fallback is unreachable.
   */
  const ownRegistrations = new Set<string>();
  const decorations = options.decorations ?? createDecorationLedger();

  /**
   * Who owns `name` right now, as `decorate` has always asked it.
   *
   * `undefined` has two readings and only one of them is a hole: the name is
   * not in the container at all (nobody owns it, and registering it is the
   * ordinary case), or the container holds it and no module claimed it — which
   * happens exactly when a composition root registered it. The callers below
   * discriminate; this function does not, because the two questions share this
   * one answer and duplicating it is how they would drift.
   */
  const ownerOf = (name: string): string | undefined =>
    ownership?.ownerOf(name) ?? (ownRegistrations.has(name) ? module.id : undefined);

  /**
   * The registration half of the ownership rule (D-156.6).
   *
   * Three outcomes, and the order is the point:
   *
   *  - another **module** owns the name — untouched, `claim` still throws
   *    `DuplicateRegistrationError`, which names both modules and tells the
   *    loser to decorate. That error can say things this one cannot;
   *  - a composition **root** supplies it — refused here, because there is no
   *    owner to ask for a seam and the names in that set are the platform's own;
   *  - nobody holds it — the ordinary case, and the one every registration in a
   *    bare-core composition takes: all 291 of them, against 17 root-supplied
   *    names, with an empty intersection measured in both roots.
   *
   * Asked before anything is claimed or written, so a refused batch leaves the
   * container and the ownership ledger exactly as they were.
   */
  const assertRegistrable = (name: string): void => {
    if (ownerOf(name) === undefined && container.hasRegistration(name)) {
      throw new ForeignRegistrationError(name, module.id);
    }
  };

  /**
   * One proxy per context, over this module's own container. It is stable
   * across calls so a module that captures `ctx.cradle()` during registration
   * still hits the phase guard when it later reads a name off the captured
   * object.
   */
  const cradleProxy = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, property): unknown {
      // A symbol here is the runtime probing the object (`Symbol.toPrimitive`,
      // `then` on an accidental await); no registration can carry that name.
      if (typeof property === 'symbol') return undefined;
      if (isRegistering()) throw new EagerResolutionError(module.id, property);
      return container.cradle[property];
    },
    has(_target, property): boolean {
      return typeof property === 'string' && container.hasRegistration(property);
    },
  });

  return {
    module,

    di: {
      register(registrations) {
        // Two passes: every name is checked before any is claimed, so a batch
        // holding one refused name registers none of the others.
        for (const name of Object.keys(registrations)) assertRegistrable(name);
        for (const name of Object.keys(registrations)) {
          ownership?.claim(name, module.id);
          ownRegistrations.add(name);
        }
        container.register(registrations);
      },

      providePort(name, registration) {
        // The same claim, so the same guard: a port registration that skipped
        // it would be the side door beside the side door.
        assertRegistrable(name);
        ownership?.claim(name, module.id);
        ownRegistrations.add(name);
        registerPort(container, module.id, name, registration);
      },

      decorate<T>(name: string, wrap: (inner: T, cradle: KernelCradle) => T): void {
        if (!container.hasRegistration(name)) {
          throw new Error(
            `[kernel] module '${module.id}' cannot decorate '${name}': nothing is registered ` +
              `under that name. Decoration wraps an existing registration; register order is ` +
              `topological, so the owning module must come first.`,
          );
        }
        // Whose registration is this? Asked before anything is written, for
        // the same reason the ambiguity check is: a refused decoration must
        // leave the container as it was rather than half-wrapped.
        //
        // An owner of `undefined` means nobody claimed the name — a
        // composition root registered it (`commandBus`, `auditLogService`,
        // `redis`) — and that is refused like any other foreign registration.
        // Reading "unowned" as "fair game" would leave the highest-value
        // targets in the platform the only undefended ones.
        const owner = ownerOf(name);
        if (owner !== module.id && !isDeploymentOverlay) {
          throw new ForeignDecorationError(name, module.id, owner);
        }
        decorations.record(name, module.id, owner);
        const inner = container.getRegistration(name) as Resolver<T>;
        // Re-registering the previous resolver under a private name keeps the
        // inner instance resolving through the SAME container or scope, so its
        // lifetime is preserved and a chain of decorations composes cleanly.
        // The name comes from the composition-wide ledger: a per-context
        // counter would hand two modules' first decorations the same private
        // name, and the second would overwrite the first's inner registration
        // with the first's own wrapper — a chain that resolves into itself.
        const innerName = decorations.innerNameFor(name);
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

    ungatedRoutes(reason, register) {
      if (reason.trim().length === 0) {
        throw new Error(
          `[kernel] module '${module.id}' registered ungated routes without a reason. ` +
            `Gating is the default; the exemption exists for surfaces that report on the ` +
            `platform itself (liveness and readiness probes, module presence), which cannot ` +
            `be gated on a part of the platform without becoming circular. State which one ` +
            `this is, or use ctx.routes().`,
        );
      }
      // The same encapsulated child context `defineModuleRoutes` uses, minus
      // the `onRequest` gate — so the only difference between the two seams is
      // the one this exemption is about.
      sink.plugins.push(async (app: FastifyInstance) => {
        await app.register(async (scoped) => {
          await register(scoped);
        });
      });
    },

    rootPlugin(reason, plugin) {
      if (reason.trim().length === 0) {
        throw new Error(
          `[kernel] module '${module.id}' registered a root plugin without a reason. ` +
            `This is the one seam that reaches every other module, so it states what it ` +
            `decorates and why that cannot live inside the module's own context.`,
        );
      }
      sink.rootPlugins.push(plugin);
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

    onBoot(hook) {
      sink.bootHooks.push(hook);
    },

    // Issue #269 — attribution and request correlation are applied here, over
    // whatever destination the root passed, so they hold for every root and for
    // a context built by hand in a test. The composer's own lines (the
    // decoration report) are the composition's, not a module's, and go to the
    // unwrapped `log`.
    log: moduleLogger(module.id, log),
  };
}
