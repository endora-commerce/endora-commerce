import {
  COMMAND_OBSERVE_MAX_IN_FLIGHT,
  commandActionFiltersOverlap,
  commandMiddlewareTimeoutMs,
  type CommandMiddlewareDeclaration,
  type CommandMiddlewarePhase,
  type ModuleOrigin,
} from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { moduleLogger, platformLogger, type PlatformLogger } from '../../kernel/logging.js';
import { orderByModuleGraph } from '../ordering.js';
import { withinBudget, type BudgetResult } from './budget.js';
import {
  CommandMiddlewareOrderContradictionError,
  CommandMiddlewareOriginError,
  CommandMiddlewarePhaseMismatchError,
  CommandRefusedError,
  DuplicateCommandMiddlewareError,
  StaleCommandMiddlewareOrderError,
  UndeclaredCommandMiddlewareError,
  UnorderedCommandMiddlewareError,
  UnregisteredCommandMiddlewareError,
  admissionFailed,
  admissionTimeout,
  middlewareLabel,
} from './errors.js';
import { compileActionFilter, type CompiledActionFilter } from './filter.js';
import { runWithCommandMiddlewareOrigin } from './origin.js';
import type {
  CommandAdmissionMeta,
  CommandAdmitHandler,
  CommandMiddlewareEntry,
  CommandObserveHandler,
  CommandRunOutcome,
} from './types.js';

/**
 * The command-middleware registry (`specs/189-command-middleware/` FR-002,
 * FR-004, FR-013, FR-020 – FR-023, FR-030 – FR-033;
 * `contracts/command-middleware-api.md` §4, §5).
 *
 * One per composed application, shared by the Command Bus and every
 * `ModuleContext`, exactly as the command-hook registry is. Modules register
 * through `ctx.commandMiddleware` while the composer runs them; the composer
 * **seals** it once the last module has registered, handing it the manifest
 * declarations, the dependency closure and each composed module's derived
 * origin as data. Sealing is where every composition refusal is raised and
 * where the `admit` order is fixed.
 *
 * Presence is **not** decided here: a middleware whose module is switched off
 * stays in the plan and is skipped per call, from the live effective state
 * (`isPresent`), so switching a module off needs no restart (FR-033).
 */

/** What the composer hands the registry when it seals it — data, derived by the root. */
export interface CommandMiddlewareCompositionInput {
  /** `commandMiddlewareFrom(manifests)`: every declaration, with its module id. */
  readonly declarations: readonly (CommandMiddlewareDeclaration & { readonly moduleId: string })[];
  /** Each module's transitive dependencies (`moduleDependencyClosureFrom`). */
  readonly moduleDependencies: Readonly<Record<string, readonly string[]>>;
  /**
   * Each composed module's derived origin (`contracts/module-origin.md` §2).
   * Supplied by the composer from its entries; a declaration whose module is
   * not in it is not composed here and is ignored.
   */
  readonly origins: Readonly<Record<string, ModuleOrigin>>;
  /** The deployment's tie-break, from its `divergence.ts`. */
  readonly commandMiddlewareOrder?: readonly string[] | undefined;
}

export interface CommandMiddlewareRegistryOptions {
  /**
   * Whether a middleware's module is present on the effective state, asked per
   * call. Both roots wire it to `effectiveState.isPresent`; it defaults to
   * always-present for unit tests and bare harnesses.
   */
  readonly isPresent?: (moduleId: string) => boolean;
  /** Where failures, timeouts and drops are logged. Defaults to the platform logger. */
  readonly log?: PlatformLogger;
}

/** One line of {@link CommandMiddlewareRegistry.plan}, and of the `kernel.command-middleware` boot line. */
export interface CommandMiddlewarePlanEntry {
  readonly moduleId: string;
  readonly id: string;
  readonly phase: CommandMiddlewarePhase;
  readonly origin: ModuleOrigin;
  /** 1-based position among the `admit` middlewares; `null` for `observe`, which is unordered. */
  readonly position: number | null;
  readonly actions: '*' | readonly string[];
}

/** The bus's answer from {@link CommandMiddlewareRegistry.admit}: who refused, and with what. */
export interface CommandAdmissionRefusal {
  readonly middleware: string;
  readonly error: HttpError;
}

interface Registration {
  readonly moduleId: string;
  readonly id: string;
  readonly phase: CommandMiddlewarePhase;
  readonly handler: CommandAdmitHandler | CommandObserveHandler;
  readonly seq: number;
}

interface Resolved {
  readonly moduleId: string;
  readonly id: string;
  readonly label: string;
  readonly origin: ModuleOrigin;
  readonly actions: '*' | readonly string[];
  readonly matches: CompiledActionFilter;
  readonly timeoutMs: number;
  readonly log: PlatformLogger;
}

interface ResolvedAdmit extends Resolved {
  readonly handler: CommandAdmitHandler;
}

interface ResolvedObserve extends Resolved {
  readonly handler: CommandObserveHandler;
  inFlight: number;
  dropped: number;
  lastDropLogAt: number | null;
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** At most one `command.observe.dropped` line per middleware per minute (FR-023). */
const DROP_LOG_INTERVAL_MS = 60_000;

export class CommandMiddlewareRegistry {
  readonly #isPresent: (moduleId: string) => boolean;
  readonly #log: PlatformLogger;
  readonly #registrations: Registration[] = [];
  readonly #keys = new Set<string>();
  #sealed = false;
  #seq = 0;
  #admits: readonly ResolvedAdmit[] = [];
  #observers: readonly ResolvedObserve[] = [];
  #plan: readonly CommandMiddlewarePlanEntry[] = [];
  readonly #pending = new Set<Promise<void>>();

  constructor(options: CommandMiddlewareRegistryOptions = {}) {
    this.#isPresent = options.isPresent ?? ((): boolean => true);
    this.#log = options.log ?? platformLogger();
  }

  get isSealed(): boolean {
    return this.#sealed;
  }

  /** Whether any `admit` is composed — the bus's one check per Command when none is (FR-035). */
  get hasAdmit(): boolean {
    return this.#admits.length > 0;
  }

  /** Whether any `observe` is composed — the bus keeps no run record when none is (FR-035). */
  get hasObserve(): boolean {
    return this.#observers.length > 0;
  }

  /** Register `moduleId`'s entries. Called by `ctx.commandMiddleware`, which stamps the id. */
  register(moduleId: string, entries: readonly CommandMiddlewareEntry[]): void {
    for (const entry of entries) {
      if (this.#sealed) {
        throw new Error(
          `[command-middleware] the registry is sealed — module '${moduleId}' tried to register command ` +
            `middleware '${entry.id}' after composition. Register from registerModule.`,
        );
      }
      if (!ID_RE.test(entry.id)) {
        throw new Error(
          `[command-middleware] module '${moduleId}' registers command middleware with id '${entry.id}'; ` +
            "a middleware id is kebab-case (e.g. 'legal-hold').",
        );
      }
      const key = `${moduleId}\0${entry.id}`;
      if (this.#keys.has(key)) throw new DuplicateCommandMiddlewareError(moduleId, entry.id);
      this.#keys.add(key);
      this.#seq += 1;
      this.#registrations.push({
        moduleId,
        id: entry.id,
        phase: entry.phase,
        handler: entry.phase === 'admit' ? entry.admit : entry.observe,
        seq: this.#seq,
      });
    }
  }

  /**
   * Validate every registration against the composition and fix the `admit`
   * order. Called once by `composeModules`, after the decoration drain and the
   * command-hook seal, before the boot phase. A second call throws.
   */
  seal(input: CommandMiddlewareCompositionInput): void {
    if (this.#sealed) throw new Error('[command-middleware] the registry is already sealed.');

    const composed = (moduleId: string): boolean => Object.prototype.hasOwnProperty.call(input.origins, moduleId);
    const declarations = new Map<string, CommandMiddlewareDeclaration & { readonly moduleId: string }>();
    for (const declaration of input.declarations) {
      if (!composed(declaration.moduleId)) continue;
      // D-296.3 — first, so a package declaring an `admit` hears the rule it
      // broke rather than a mismatch it could "fix" by registering it.
      if (declaration.phase === 'admit' && input.origins[declaration.moduleId] === 'package') {
        throw new CommandMiddlewareOriginError(declaration.moduleId, declaration.id);
      }
      declarations.set(`${declaration.moduleId}\0${declaration.id}`, declaration);
    }

    const registered = new Set<string>();
    for (const registration of this.#registrations) {
      const key = `${registration.moduleId}\0${registration.id}`;
      registered.add(key);
      const declaration = declarations.get(key);
      if (declaration === undefined) throw new UndeclaredCommandMiddlewareError(registration.moduleId, registration.id);
      if (declaration.phase !== registration.phase) {
        throw new CommandMiddlewarePhaseMismatchError(
          registration.moduleId,
          registration.id,
          declaration.phase,
          registration.phase,
        );
      }
      if (registration.phase === 'admit' && input.origins[registration.moduleId] === 'package') {
        throw new CommandMiddlewareOriginError(registration.moduleId, registration.id);
      }
    }
    for (const [key, declaration] of declarations) {
      if (!registered.has(key)) throw new UnregisteredCommandMiddlewareError(declaration.moduleId, declaration.id);
    }

    const resolve = (registration: Registration): Resolved => {
      const declaration = declarations.get(`${registration.moduleId}\0${registration.id}`)!;
      return {
        moduleId: registration.moduleId,
        id: registration.id,
        label: middlewareLabel(registration.moduleId, registration.id),
        origin: input.origins[registration.moduleId]!,
        actions: declaration.actions,
        matches: compileActionFilter(declaration.actions),
        timeoutMs: commandMiddlewareTimeoutMs(declaration),
        log: moduleLogger(registration.moduleId, this.#log),
      };
    };

    // ---- `admit` order (FR-030, FR-031) ----
    const admitRegistrations = this.#registrations.filter((registration) => registration.phase === 'admit');
    const order = input.commandMiddlewareOrder ?? [];
    const admitModules = new Set(admitRegistrations.map((registration) => registration.moduleId));
    const stale = order.filter((moduleId) => !admitModules.has(moduleId));
    if (stale.length > 0) throw new StaleCommandMiddlewareOrderError(order, stale);
    const filtersOf = (moduleId: string): Array<'*' | readonly string[]> =>
      admitRegistrations
        .filter((registration) => registration.moduleId === moduleId)
        .map((registration) => declarations.get(`${registration.moduleId}\0${registration.id}`)!.actions);
    const orderedAdmits = orderByModuleGraph(admitRegistrations, {
      dependencies: input.moduleDependencies,
      tieBreak: order,
      requiresOrder: (a, b) =>
        filtersOf(a).some((left) => filtersOf(b).some((right) => commandActionFiltersOverlap(left, right))),
      unordered: (a, b) =>
        new UnorderedCommandMiddlewareError(
          [a, b],
          admitRegistrations
            .filter((registration) => registration.moduleId === a || registration.moduleId === b)
            .sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.seq - right.seq)
            .map((registration) => middlewareLabel(registration.moduleId, registration.id)),
        ),
      contradiction: (before, after) => new CommandMiddlewareOrderContradictionError(order, { before, after }),
    });

    // ---- `observe`: unordered, listed deterministically (FR-032) ----
    const observeRegistrations = this.#registrations
      .filter((registration) => registration.phase === 'observe')
      .sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.seq - right.seq);

    this.#admits = Object.freeze(
      orderedAdmits.map((registration) => ({ ...resolve(registration), handler: registration.handler as CommandAdmitHandler })),
    );
    this.#observers = Object.freeze(
      observeRegistrations.map((registration) => ({
        ...resolve(registration),
        handler: registration.handler as CommandObserveHandler,
        inFlight: 0,
        dropped: 0,
        lastDropLogAt: null,
      })),
    );
    const planEntry = (entry: Resolved, phase: CommandMiddlewarePhase, position: number | null): CommandMiddlewarePlanEntry =>
      Object.freeze({ moduleId: entry.moduleId, id: entry.id, phase, origin: entry.origin, position, actions: entry.actions });
    this.#plan = Object.freeze([
      ...this.#admits.map((entry, index) => planEntry(entry, 'admit', index + 1)),
      ...this.#observers.map((entry) => planEntry(entry, 'observe', null)),
    ]);
    this.#sealed = true;
  }

  /** The composed list, for the boot log line `kernel.command-middleware`. Empty before sealing. */
  plan(): readonly CommandMiddlewarePlanEntry[] {
    return this.#plan;
  }

  /** Whether a middleware module is present on the effective state right now. */
  isPresent(moduleId: string): boolean {
    return this.#isPresent(moduleId);
  }

  /**
   * Ask every present `admit` whose filter matches `meta.action`, in composed
   * order (contract §4 step 2). Answers `null` when all let it through, or the
   * first refusal: a `CommandRefusedError` as thrown, anything else as
   * `COMMAND_ADMISSION_FAILED`, an overrun as `COMMAND_ADMISSION_TIMEOUT`.
   * Never throws. Synchronous while every handler it asks is.
   */
  admit(meta: CommandAdmissionMeta): CommandAdmissionRefusal | null | Promise<CommandAdmissionRefusal | null> {
    const admits = this.#admits;
    for (let index = 0; index < admits.length; index += 1) {
      const entry = admits[index]!;
      if (!entry.matches(meta.action) || !this.#isPresent(entry.moduleId)) continue;
      const result = this.#runAdmit(entry, meta);
      if (result instanceof Promise) {
        return result.then((settled) => this.#admitVerdict(entry, meta, settled) ?? this.#admitFrom(index + 1, meta));
      }
      const verdict = this.#admitVerdict(entry, meta, result);
      if (verdict !== null) return verdict;
    }
    return null;
  }

  async #admitFrom(start: number, meta: CommandAdmissionMeta): Promise<CommandAdmissionRefusal | null> {
    const admits = this.#admits;
    for (let index = start; index < admits.length; index += 1) {
      const entry = admits[index]!;
      if (!entry.matches(meta.action) || !this.#isPresent(entry.moduleId)) continue;
      const verdict = this.#admitVerdict(entry, meta, await this.#runAdmit(entry, meta));
      if (verdict !== null) return verdict;
    }
    return null;
  }

  #runAdmit(entry: ResolvedAdmit, meta: CommandAdmissionMeta): BudgetResult | Promise<BudgetResult> {
    return runWithCommandMiddlewareOrigin({ moduleId: entry.moduleId, id: entry.id, phase: 'admit' }, () =>
      withinBudget((signal) => entry.handler(meta, { module: { id: entry.moduleId }, log: entry.log, signal }), entry.timeoutMs),
    );
  }

  #admitVerdict(entry: ResolvedAdmit, meta: CommandAdmissionMeta, result: BudgetResult): CommandAdmissionRefusal | null {
    if (result.status === 'settled') return null;
    if (result.status === 'timeout') {
      this.#log.warn(
        { middleware: entry.label, action: meta.action, timeoutMs: entry.timeoutMs },
        'command.admit.timeout',
      );
      return { middleware: entry.label, error: admissionTimeout(entry.label, meta.action) };
    }
    if (result.error instanceof CommandRefusedError) return { middleware: entry.label, error: result.error };
    // Research R-5 (b): any other `HttpError` — a `ModuleDisabledError` from a
    // port the rule called — is not the rule's decision. The class is enough
    // to diagnose; a message or a value is never logged.
    this.#log.error(
      { middleware: entry.label, action: meta.action, errorClass: errorClassOf(result.error) },
      'command.admit.failed',
    );
    return { middleware: entry.label, error: admissionFailed(entry.label, meta.action) };
  }

  /**
   * Schedule `outcome` for every present `observe` whose filter matches any
   * Command in it (contract §4), detached: on a macrotask, so the caller's
   * promise has settled and its continuation has run before any observer is
   * called (FR-021). Runs in the caller's ambient tenant context (FR-024).
   */
  scheduleObserve(outcome: CommandRunOutcome): void {
    if (this.#observers.length === 0) return;
    const pending: Promise<void> = new Promise<void>((resolve) => {
      setImmediate(() => {
        this.#observe(outcome).then(resolve, resolve);
      });
    });
    this.#pending.add(pending);
    void pending.then(() => this.#pending.delete(pending));
  }

  async #observe(outcome: CommandRunOutcome): Promise<void> {
    let redacted: CommandRunOutcome | undefined;
    const calls: Promise<void>[] = [];
    for (const entry of this.#observers) {
      if (!this.#isPresent(entry.moduleId)) continue;
      if (!outcome.commands.some((command) => entry.matches(command.action))) continue;
      if (entry.inFlight >= COMMAND_OBSERVE_MAX_IN_FLIGHT) {
        this.#dropped(entry);
        continue;
      }
      // FR-022 — an installed package learns the request id, never the
      // client's IP address or user agent.
      const subject = entry.origin === 'package' ? (redacted ??= redactForPackage(outcome)) : outcome;
      entry.inFlight += 1;
      calls.push(this.#runObserve(entry, subject).finally(() => {
        entry.inFlight -= 1;
      }));
    }
    await Promise.allSettled(calls);
  }

  async #runObserve(entry: ResolvedObserve, outcome: CommandRunOutcome): Promise<void> {
    const result = await runWithCommandMiddlewareOrigin({ moduleId: entry.moduleId, id: entry.id, phase: 'observe' }, () =>
      withinBudget(() => entry.handler(outcome, { module: { id: entry.moduleId }, log: entry.log }), entry.timeoutMs),
    );
    if (result.status === 'timeout') {
      this.#log.warn({ middleware: entry.label, timeoutMs: entry.timeoutMs }, 'command.observe.timeout');
    } else if (result.status === 'threw') {
      this.#log.error({ middleware: entry.label, errorClass: errorClassOf(result.error) }, 'command.observe.failed');
    }
  }

  #dropped(entry: ResolvedObserve): void {
    entry.dropped += 1;
    const now = Date.now();
    if (entry.lastDropLogAt !== null && now - entry.lastDropLogAt < DROP_LOG_INTERVAL_MS) return;
    this.#log.warn(
      { middleware: entry.label, dropped: entry.dropped, maxInFlight: COMMAND_OBSERVE_MAX_IN_FLIGHT },
      'command.observe.dropped',
    );
    entry.lastDropLogAt = now;
    entry.dropped = 0;
  }

  /** Resolves when no observer is scheduled or in flight. For tests and graceful shutdown. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }
}

function errorClassOf(error: unknown): string {
  if (error instanceof Error) return error.constructor.name || error.name;
  return typeof error;
}

function redactForPackage(outcome: CommandRunOutcome): CommandRunOutcome {
  return Object.freeze({
    ...outcome,
    root: Object.freeze({ ...outcome.root, requestMeta: Object.freeze({ requestId: outcome.root.requestMeta.requestId }) }),
  });
}
