import type {
  CommandHookPhase,
  CommandHookPlanResponse,
  HookableActionDeclaration,
} from '@endora-commerce/contracts';
import {
  DuplicateCommandHookError,
  DuplicateHookableActionError,
  HookOwnerNotDependedOnError,
  HookPhaseNotOfferedError,
  UndeclaredHookableActionError,
  hookLabel,
} from './errors.js';
import { orderCommandHooks, type CommandHookRegistration } from './ordering.js';
import type { OutboxData } from '@endora-commerce/contracts';
import type { AfterCommitHandler, BeforeCommitHook, CommandHookEntry } from './types.js';

/**
 * The command-hook registry (`specs/176-command-hooks-outbox/` FR-011 –
 * FR-014, FR-017; `contracts/command-hooks-api.md` §3, §4).
 *
 * One per composed application, shared by the Command Bus and every
 * `ModuleContext`. Modules register through `ctx.commandHooks` while the
 * composer runs them; the composer **seals** the registry once the last module
 * has registered, handing it the declarations and the dependency closure as
 * data (it never reads a manifest). Sealing is where every composition refusal
 * is raised and where each action's order is fixed. After it, a registration
 * throws — as an interceptor does after `ready` — and the bus reads a frozen
 * plan.
 *
 * Presence is **not** decided here: a hook whose module is switched off stays
 * in the plan and is skipped per call, from the live effective state
 * (`isPresent`), so switching a module off needs no restart (R-10).
 */

/** A declaration with the module that owns the action. */
export interface HookableActionOwnership extends HookableActionDeclaration {
  readonly moduleId: string;
}

/** What the composer hands the registry when it seals it — data, derived by the root. */
export interface CommandHookCompositionInput {
  /** Every composed module's `hookableActions`, with its owner (`hookableActionsFrom`). */
  readonly hookableActions: readonly HookableActionOwnership[];
  /** Each module's **transitive** manifest dependencies (`moduleDependencyClosureFrom`). */
  readonly moduleDependencies: Readonly<Record<string, readonly string[]>>;
  /** The deployment's tie-break, from its `divergence.ts` (OD-1). */
  readonly commandHookOrder?: Readonly<Record<string, readonly string[]>> | undefined;
}

/** A registered `beforeCommit` hook, as the bus runs it. */
export interface ResolvedBeforeCommitHook extends CommandHookRegistration {
  readonly phase: 'beforeCommit';
  readonly handler: BeforeCommitHook<unknown>;
}

/**
 * A registered `afterCommit` handler, as the bus writes rows for it and the
 * outbox drain delivers to it (176 P3).
 */
export interface ResolvedAfterCommitHandler extends CommandHookRegistration {
  readonly phase: 'afterCommit';
  readonly handler: AfterCommitHandler<OutboxData>;
}

export interface CommandHookRegistryOptions {
  /**
   * Whether a hook module is present on the effective state, asked per call.
   * Composition wires it to `effectiveState.isPresent`; it defaults to
   * always-present for unit tests and bare harnesses.
   */
  readonly isPresent?: (moduleId: string) => boolean;
}

const HOOK_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMPTY: readonly ResolvedBeforeCommitHook[] = Object.freeze([]);
const EMPTY_AFTER: readonly ResolvedAfterCommitHandler[] = Object.freeze([]);

export class CommandHookRegistry {
  readonly #isPresent: (moduleId: string) => boolean;
  readonly #registrations: CommandHookRegistration[] = [];
  readonly #keys = new Map<string, string>();
  #sealed = false;
  #declarations = new Map<string, HookableActionOwnership>();
  #beforeCommit = new Map<string, readonly ResolvedBeforeCommitHook[]>();
  #afterCommit = new Map<string, readonly ResolvedAfterCommitHandler[]>();
  #afterCommitByKey = new Map<string, ResolvedAfterCommitHandler>();
  #claimants = new Map<string, ReadonlySet<string>>();
  #seq = 0;

  constructor(options: CommandHookRegistryOptions = {}) {
    this.#isPresent = options.isPresent ?? ((): boolean => true);
  }

  get isSealed(): boolean {
    return this.#sealed;
  }

  /** Register `moduleId`'s entries. Called by `ctx.commandHooks`, which stamps the id. */
  register(moduleId: string, entries: readonly CommandHookEntry[]): void {
    for (const entry of entries) {
      if (this.#sealed) {
        throw new Error(
          `[command-hooks] the registry is sealed — module '${moduleId}' tried to register hook ` +
            `'${entry.id}' after composition. Register from registerModule.`,
        );
      }
      if (!HOOK_ID_RE.test(entry.id)) {
        throw new Error(
          `[command-hooks] module '${moduleId}' registers a hook with id '${entry.id}' on ` +
            `'${entry.on.action}'; a hook id is kebab-case (e.g. 'refuse-unserved-country').`,
        );
      }
      const key = `${moduleId}\0${entry.id}`;
      if (this.#keys.has(key)) {
        throw new DuplicateCommandHookError(moduleId, entry.id, entry.on.action);
      }
      this.#keys.set(key, entry.on.action);
      this.#seq += 1;
      this.#registrations.push({
        moduleId,
        id: entry.id,
        action: entry.on.action,
        phase: entry.phase,
        handler: entry.handler as CommandHookRegistration['handler'],
        seq: this.#seq,
      });
    }
  }

  /**
   * Validate every registration against the composition and fix each action's
   * order. Called once by `composeModules`, after the decoration drain and
   * before the boot phase. Idempotent only in the sense that a second call
   * throws: a composition seals once.
   */
  seal(input: CommandHookCompositionInput): void {
    if (this.#sealed) throw new Error('[command-hooks] the registry is already sealed.');

    const declarations = new Map<string, HookableActionOwnership>();
    const owners = new Map<string, string[]>();
    for (const declaration of input.hookableActions) {
      const list = owners.get(declaration.action) ?? [];
      list.push(declaration.moduleId);
      owners.set(declaration.action, list);
      if (!declarations.has(declaration.action)) declarations.set(declaration.action, declaration);
    }
    for (const [action, list] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
      if (list.length > 1) {
        const hooks = this.#registrations
          .filter((registration) => registration.action === action)
          .map((registration) => hookLabel(registration.moduleId, registration.id));
        throw new DuplicateHookableActionError(action, [...list].sort(), hooks);
      }
    }

    for (const registration of this.#registrations) {
      const declaration = declarations.get(registration.action);
      if (declaration === undefined) {
        throw new UndeclaredHookableActionError(registration.moduleId, registration.id, registration.action);
      }
      if (!declaration.phases.includes(registration.phase)) {
        throw new HookPhaseNotOfferedError(
          registration.moduleId,
          registration.id,
          registration.action,
          registration.phase,
          declaration.moduleId,
          declaration.phases,
        );
      }
      const reaches =
        registration.moduleId === declaration.moduleId ||
        (input.moduleDependencies[registration.moduleId] ?? []).includes(declaration.moduleId);
      if (!reaches) {
        throw new HookOwnerNotDependedOnError(
          registration.moduleId,
          registration.id,
          registration.action,
          declaration.moduleId,
        );
      }
    }

    const order = input.commandHookOrder ?? {};
    const beforeCommit = new Map<string, readonly ResolvedBeforeCommitHook[]>();
    const afterCommit = new Map<string, readonly ResolvedAfterCommitHandler[]>();
    const afterCommitByKey = new Map<string, ResolvedAfterCommitHandler>();
    const claimants = new Map<string, Set<string>>();
    for (const action of new Set(this.#registrations.map((registration) => registration.action))) {
      const onAction = this.#registrations.filter((registration) => registration.action === action);
      const set = new Set<string>();
      for (const registration of onAction) set.add(registration.moduleId);
      claimants.set(action, set);
      const ordered = orderCommandHooks(
        action,
        'beforeCommit',
        onAction.filter((registration) => registration.phase === 'beforeCommit'),
        input.moduleDependencies,
        order[action],
      ) as ResolvedBeforeCommitHook[];
      beforeCommit.set(action, Object.freeze(ordered));
      // `afterCommit` handlers are not ordered against each other: each one is a
      // row of its own, delivered on its own, and the outbox promises no order
      // across rows (contracts/outbox-and-admin-api.md). Asking two independent
      // modules to rank handlers whose order nothing observes would be a
      // refusal with no effect. The list is deterministic — module id, then
      // registration order — only so the bus writes rows and the plan lists
      // them the same way every boot.
      const handlers = onAction
        .filter((registration) => registration.phase === 'afterCommit')
        .sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.seq - right.seq) as ResolvedAfterCommitHandler[];
      afterCommit.set(action, Object.freeze(handlers));
      for (const handler of handlers) afterCommitByKey.set(`${handler.moduleId}\0${handler.id}`, handler);
    }

    this.#declarations = declarations;
    this.#beforeCommit = beforeCommit;
    this.#afterCommit = afterCommit;
    this.#afterCommitByKey = afterCommitByKey;
    this.#claimants = claimants;
    this.#sealed = true;
  }

  /** The declaration of `action`, with its owner, or `undefined` when nothing declares it. */
  declaration(action: string): HookableActionOwnership | undefined {
    return this.#declarations.get(action);
  }

  /** `action`'s `beforeCommit` hooks in execution order, presence not applied. Empty before sealing. */
  beforeCommit(action: string): readonly ResolvedBeforeCommitHook[] {
    return this.#beforeCommit.get(action) ?? EMPTY;
  }

  /**
   * `action`'s `afterCommit` handlers, presence not applied: the bus writes one
   * outbox row per present one. Empty before sealing.
   */
  afterCommit(action: string): readonly ResolvedAfterCommitHandler[] {
    return this.#afterCommit.get(action) ?? EMPTY_AFTER;
  }

  /**
   * The registered `afterCommit` handler `moduleId#hookId`, whatever its
   * action — the drain's lookup for a row, which records both. `undefined`
   * when the module no longer registers it (the row is then dead-lettered
   * `hook-unregistered`).
   */
  afterCommitHandler(moduleId: string, hookId: string): ResolvedAfterCommitHandler | undefined {
    return this.#afterCommitByKey.get(`${moduleId}\0${hookId}`);
  }

  /** The modules with any hook on `action` (either phase), presence not applied. */
  claimants(action: string): ReadonlySet<string> {
    return this.#claimants.get(action) ?? new Set<string>();
  }

  /** Whether a hook module is present on the effective state right now. */
  isPresent(moduleId: string): boolean {
    return this.#isPresent(moduleId);
  }

  /**
   * The execution plan (FR-026): every declared action, and every registered
   * hook at its position, with its module's live presence. Serves the
   * read-only `GET /api/v1/admin/command-hooks`.
   */
  plan(): CommandHookPlanResponse {
    const actions = [...this.#declarations.values()]
      .map((declaration) => ({
        action: declaration.action,
        objectType: declaration.objectType,
        owner: declaration.moduleId,
        phases: [...declaration.phases] as CommandHookPhase[],
      }))
      .sort((left, right) => left.action.localeCompare(right.action));
    // A `beforeCommit` hook has a position: the hooks run in that order. An
    // `afterCommit` handler has none — each is an outbox row delivered on its
    // own, and the module-id order they are listed in is for a stable screen,
    // not a sequence anything observes (176 P4 architect ruling).
    const position = <H extends CommandHookRegistration>(action: string, list: readonly H[]) =>
      list.map((hook, index) => ({
        action,
        phase: hook.phase,
        position: hook.phase === 'beforeCommit' ? index + 1 : null,
        module: hook.moduleId,
        id: hook.id,
        moduleEnabled: this.#isPresent(hook.moduleId),
      }));
    const hooked = [...new Set([...this.#beforeCommit.keys(), ...this.#afterCommit.keys()])].sort();
    const items = hooked.flatMap((action) => [
      ...position(action, this.beforeCommit(action)),
      ...position(action, this.afterCommit(action)),
    ]);
    return { actions, items };
  }
}
