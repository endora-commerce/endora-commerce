import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { AuditPort } from '../kernel/ports/audit.js';
import { currentRequestMeta } from '../kernel/scope.js';
import { forkScopedEm } from '../tenancy/scoped-em.js';
import { getTenantContext } from '../tenancy/tenant-context.js';
import { HttpError } from '../http/error-envelope.js';
import type { EventBus } from '../events/bus.js';
import { COMMAND_HOOK_MAX_DEPTH, outboxDataViolations } from '@endora-commerce/contracts';
import { resolveCommandActor } from './actor.js';
import type { AuditState, Command, CommandActor, CommandContext } from './command.js';
import { extensionUnclaimed, hookCycle, hookDataMissing } from './hooks/errors.js';
import { runWithCommandHookOrigin } from './hooks/origin.js';
import type { CommandHookRegistry } from './hooks/registry.js';
import { middlewareLabel, middlewareReentry } from './middleware/errors.js';
import { currentCommandMiddlewareOrigin } from './middleware/origin.js';
import type { CommandMiddlewareRegistry } from './middleware/registry.js';
import type { CommandAdmissionMeta, CommandRunEntry, CommandRunOutcome } from './middleware/types.js';
import { CommandOutboxEntry } from './outbox/command-outbox-entry.entity.js';
import type { OutboxWakePort } from './outbox/wake.js';

/**
 * CommandBus (feature 054 — Constitution Principle XIII).
 *
 * The single, guaranteed audit-writing path for sensitive writes. `run`:
 *  1. resolves the actor from the ambient TenantContext (fail-closed);
 *  2. opens ONE `EventBus.run` scope so any emitted event is buffered;
 *  3. forks the scoped EM and runs the whole command inside `em.transactional`;
 *  4. captures before-state, performs the write, records exactly one audit entry
 *     on the same transactional em, and buffers the domain event;
 *  5. on commit, the buffered event dispatches exactly once; on rollback, the
 *     audit row and the event are both gone (FR-003).
 *
 * A Command may run **child** Commands through `ctx.run(child)` (feature 170,
 * research R-22): steps 4 and 5 apply to each child on the parent's `em`, actor
 * and event scope, so every Command records its own entry and all of them
 * commit or roll back together.
 *
 * **`beforeCommit` command hooks** (`specs/176-command-hooks-outbox/` P2,
 * `contracts/command-hooks-api.md` §4) run between the write and the audit
 * entry, for a Command whose action an owner declared hookable:
 * `capture → run → hooks → audit entry → event → commit`. Each present hook
 * (its module switched on, asked per call) runs in order on the same `em` and
 * actor, may run children through its own `ctx.run`, and vetoes by throwing —
 * the bus does not catch, so the whole Command rolls back. What a hook noted
 * it wrote lands in the owner's one entry as names under
 * `stateAfter.extensions.<moduleId>.changedFields`.
 *
 * **`afterCommit` handlers** (P3, FR-030 – FR-033) are not run here at all.
 * After the audit entry and the buffered event, the bus persists one
 * `command_outbox` row per present handler on the same `em`, from the owner's
 * `outboxData` held to `audit-state.md` list 1 — so the rows commit with the
 * write or not at all — and once the transaction has committed, it asks the
 * injected wake-up to enqueue the drain, without waiting and without failing
 * the write if Redis does not answer. The drain delivers each row at least
 * once, in a scope pinned to the row's Organization.
 *
 * **Command middleware** (`specs/189-command-middleware/` P1,
 * `contracts/command-middleware-api.md` §4) runs inside the bus, so it sees
 * every Command, children included — which a wrap of the public object never
 * could. Each present `admit` whose filter matches is asked before the Command
 * does anything: the root after the actor is resolved and before the
 * transaction opens, a child at `execute` entry after the hook-cycle check and
 * before the `extensions` check. A refusal is thrown like any child failure,
 * so the refused Command wrote nothing and recorded nothing. After the run
 * settles — committed, rolled back or refused — every present `observe` whose
 * filter matches any attempted Command receives a names-only summary,
 * detached from the caller. A middleware that runs a Command is refused
 * (`COMMAND_MIDDLEWARE_REENTRY`). With no middleware composed, none of this
 * allocates or awaits anything (FR-035).
 */

/** Optional per-request metadata (correlation id + client info) stamped onto audit rows. */
export interface CommandRequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CommandBusOptions {
  /**
   * Resolves ambient request metadata (X-Request-Id, client IP/UA) for the audit
   * row, when a Command runs inside an HTTP request. Returns `undefined` for
   * worker/system runs.
   *
   * Defaults to the metadata of the current platform scope (issue #997), which
   * the request-scope hook fills from the request and every non-HTTP scope
   * leaves empty. Both composition roots rely on that default; a bus composed
   * without it recorded every entry with no IP, user agent or request id.
   * Injectable only so a test can supply its own.
   */
  getRequestMeta?: () => CommandRequestMeta | undefined;
  /**
   * The composed command-hook registry (176 P2). Both composition roots pass
   * the one they hand `composeModules`; a bus without one runs no hooks and
   * refuses every `extensions` key, since nothing can claim it.
   */
  hooks?: CommandHookRegistry;
  /**
   * The drain's post-commit wake-up (176 P3), called once after a commit that
   * wrote outbox rows. Both composition roots pass one built on their Redis
   * connection; without one the rows still commit and the scheduled tick
   * delivers them.
   */
  outboxWake?: OutboxWakePort;
  /**
   * The composed command-middleware registry (189 P1). Both composition roots
   * pass the one they hand `composeModules`; a bus without one, or with a
   * sealed one holding no entries, runs exactly as it did before middleware
   * existed.
   */
  middleware?: CommandMiddlewareRegistry;
}

/**
 * The platform's recovery path is never subject to `admit` (FR-014, research
 * R-14): an admission rule that refuses everything must not be able to refuse
 * the Command that switches its own module off. Still observed.
 * `lifecycle/commands/activation.commands.ts` owns the action.
 */
export const ADMISSION_EXEMPT_ACTIONS: readonly string[] = Object.freeze(['module.activation.set']);
const EXEMPT = new Set(ADMISSION_EXEMPT_ACTIONS);

/** One attempted Command, as the run record accumulates it (FR-020). */
interface RunEntryDraft {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly depth: number;
  readonly viaHook: boolean;
  refused: boolean;
  recorded: boolean;
  notedFields: Readonly<Record<string, readonly string[]>>;
}

/** What `observe` will be told about one run; kept only when an observer is composed. */
interface RunRecord {
  readonly entries: RunEntryDraft[];
  /** The last refusal thrown, so the outcome can tell a refusal that ended the run from a caught one. */
  refusal: { readonly error: unknown; readonly middleware: string; readonly code: string } | null;
}

/** What one `CommandBus.run` accumulates across its parent and children. */
interface RunState {
  outboxRows: number;
  /** Present only on a run with middleware composed. */
  readonly middleware?: CommandMiddlewareRegistry;
  readonly record?: RunRecord;
  rootEntry?: RunEntryDraft | undefined;
}

/**
 * Where a Command sits in its chain: the actions of every Command above it,
 * and whether the chain passed through a hook. Cycles and depth are bounded
 * only for hook-induced nesting (FR-022) — an owner's own children are its
 * business, as they were before hooks existed.
 */
interface Lineage {
  readonly ancestors: readonly string[];
  readonly viaHook: boolean;
}

const ROOT_LINEAGE: Lineage = { ancestors: [], viaHook: false };

/** A noted change is a field name: list 1 of `audit-state.md`, never a value. */
const NOTED_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export class CommandBus {
  constructor(
    private readonly orm: MikroORM,
    private readonly audit: AuditPort,
    private readonly events: EventBus,
    private readonly options: CommandBusOptions = {},
  ) {}

  /** Execute a command: one scoped-fork transaction, exactly one audit row, ≤1 buffered event. */
  async run<TResult>(command: Command<TResult>): Promise<TResult> {
    // Fail-closed: no ambient TenantContext ⇒ throws before any write (Principle XI).
    const actor = resolveCommandActor();
    // 189 FR-035 — with no middleware composed this is the whole difference
    // from the bus before middleware existed: one check, no allocation.
    const middleware = this.options.middleware;
    if (middleware !== undefined && (middleware.hasAdmit || middleware.hasObserve)) {
      return this.runWithMiddleware(middleware, command, actor);
    }
    const meta = (this.options.getRequestMeta ?? currentRequestMeta)() ?? {};

    const state: RunState = { outboxRows: 0 };
    const result = await this.events.run(async () => {
      const scoped: EntityManager = forkScopedEm(this.orm);
      return scoped.transactional(async (em) => this.execute(command, em, actor, meta, state));
    });
    this.wakeOutbox(state);
    return result;
  }

  /**
   * Committed. A wake-up for rows that might still have rolled back would send
   * the drain looking for nothing, so it is asked for only after the commit —
   * and neither awaited nor allowed to fail the write: the rows are in
   * Postgres, and the scheduled tick delivers them if this never reaches Redis.
   */
  private wakeOutbox(state: RunState): void {
    if (state.outboxRows > 0 && this.options.outboxWake) {
      const wake = this.options.outboxWake;
      void Promise.resolve()
        .then(() => wake.wake())
        .catch(() => undefined);
    }
  }

  /**
   * `run` with middleware composed: the root is admitted before the
   * transaction opens (research R-3), and the run is observed once it settled,
   * whichever way (FR-020, FR-021).
   */
  private async runWithMiddleware<TResult>(
    middleware: CommandMiddlewareRegistry,
    command: Command<TResult>,
    actor: CommandActor,
  ): Promise<TResult> {
    // FR-015 — an admission rule running a matching Command would be admitted
    // again without end, and an observer running one is a writer.
    const origin = currentCommandMiddlewareOrigin();
    if (origin !== undefined) throw middlewareReentry(middlewareLabel(origin.moduleId, origin.id), command.action);
    const meta = (this.options.getRequestMeta ?? currentRequestMeta)() ?? {};
    const record: RunRecord | undefined = middleware.hasObserve ? { entries: [], refusal: null } : undefined;
    const state: RunState = { outboxRows: 0, middleware, ...(record ? { record } : {}) };
    const started = record ? performance.now() : 0;
    const rootMeta = admissionMeta(command, actor, meta, ROOT_LINEAGE);
    let committed = false;
    let thrown: unknown;
    try {
      state.rootEntry = await this.admit(command, rootMeta, ROOT_LINEAGE, state);
      const result = await this.events.run(async () => {
        const scoped: EntityManager = forkScopedEm(this.orm);
        return scoped.transactional(async (em) => this.execute(command, em, actor, meta, state, ROOT_LINEAGE, true));
      });
      committed = true;
      this.wakeOutbox(state);
      return result;
    } catch (err) {
      thrown = err;
      throw err;
    } finally {
      if (record) middleware.scheduleObserve(runOutcome(rootMeta, record, committed, thrown, performance.now() - started));
    }
  }

  /**
   * Ask the present, matching `admit` middlewares about one Command and record
   * the attempt. Throws the first refusal, so a refused child fails its parent
   * as any child failure does. Returns the Command's run-record entry.
   */
  private async admit<TResult>(
    command: Command<TResult>,
    meta: CommandAdmissionMeta | (() => CommandAdmissionMeta),
    lineage: Lineage,
    state: RunState,
  ): Promise<RunEntryDraft | undefined> {
    const middleware = state.middleware!;
    const entry: RunEntryDraft | undefined = state.record
      ? {
          action: command.action,
          objectType: command.objectType,
          objectId: command.objectId,
          depth: lineage.ancestors.length,
          viaHook: lineage.viaHook,
          refused: false,
          recorded: false,
          notedFields: NO_NOTES,
        }
      : undefined;
    if (entry) state.record!.entries.push(entry);
    if (!middleware.hasAdmit || EXEMPT.has(command.action)) return entry;
    const answer = middleware.admit(typeof meta === 'function' ? meta() : meta);
    const refusal = answer instanceof Promise ? await answer : answer;
    if (refusal === null) return entry;
    if (entry) entry.refused = true;
    if (state.record) {
      state.record.refusal = { error: refusal.error, middleware: refusal.middleware, code: refusal.error.code };
    }
    throw refusal.error;
  }

  /**
   * One Command on an open transaction and event scope: capture, run, its one
   * audit entry, its buffered event. The parent and each child it runs through
   * `ctx.run` take this same path on the same `em`, actor and metadata.
   */
  private async execute<TResult>(
    command: Command<TResult>,
    em: EntityManager,
    actor: CommandActor,
    meta: CommandRequestMeta,
    state: RunState,
    lineage: Lineage = ROOT_LINEAGE,
    isRoot = false,
  ): Promise<TResult> {
    const hooks = this.options.hooks;
    if (lineage.viaHook && (lineage.ancestors.includes(command.action) || lineage.ancestors.length >= COMMAND_HOOK_MAX_DEPTH)) {
      throw hookCycle(command.action, lineage.ancestors);
    }
    // 189 FR-010 — a child is admitted after the hook-cycle check and before
    // anything else; the root was admitted before its transaction opened.
    const entry = isRoot
      ? state.rootEntry
      : state.middleware
        ? await this.admit(command, () => admissionMeta(command, actor, meta, lineage), lineage, state)
        : undefined;
    // FR-019 — before capture, so a refused extension costs no write.
    this.assertExtensionsClaimed(command);

    const below: Lineage = { ancestors: [...lineage.ancestors, command.action], viaHook: lineage.viaHook };
    const ctx: CommandContext = {
      em,
      actor,
      run: (child) => this.execute(child, em, actor, meta, state, below),
    };
    const captured = command.capture ? await command.capture(ctx) : null;
    const { result, before, after, skipAudit } = await command.run(ctx);

    const noted = hooks
      ? await this.runBeforeCommitHooks(hooks, command, result, em, actor, meta, state, below)
      : undefined;

    // A hook's noted write is a write, and an entry names it even when the owner
    // decided its own part was a no-op (`skipAudit`): then the entry is the
    // hooks' alone — no owner state, only `{ extensions }`, names only.
    const anyNotes = [...(noted?.values() ?? [])].some((fields) => fields.size > 0);
    if (!skipAudit || anyNotes) {
      this.audit.recordWithin(em, {
        action: command.action,
        objectType: command.objectType,
        objectId: command.objectId,
        actorAdminUserId: actor.actorAdminUserId,
        impersonatedCustomerAccountId: actor.impersonatedCustomerAccountId,
        actorCustomerAccountId: actor.actorCustomerAccountId ?? null,
        stateBefore: skipAudit ? null : (before ?? captured ?? null),
        stateAfter: withNotedChanges(skipAudit ? null : (after ?? null), noted),
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: meta.requestId ?? null,
      });
      if (entry) entry.recorded = true;
    }
    if (entry && anyNotes) entry.notedFields = notedFieldNames(noted!);

    const evt = command.event?.(result);
    if (evt) this.events.emit(evt.eventName, evt.payload);

    if (hooks) state.outboxRows += this.writeOutboxRows(hooks, command, result, em, actor, meta);

    return result;
  }

  /**
   * One `command_outbox` row per present `afterCommit` handler of `command`'s
   * action, persisted on the Command's `em` (FR-030). The data is the owner's
   * `outboxData`, refused unless it is `audit-state.md` list 1 (FR-031) — the
   * refusal names the keys and never their values, and rolls the Command back.
   * Returns how many rows it persisted.
   */
  private writeOutboxRows<TResult>(
    hooks: CommandHookRegistry,
    command: Command<TResult>,
    result: TResult,
    em: EntityManager,
    actor: CommandActor,
    meta: CommandRequestMeta,
  ): number {
    const present = hooks.afterCommit(command.action).filter((handler) => hooks.isPresent(handler.moduleId));
    if (present.length === 0) return 0;
    if (!command.outboxData) throw hookDataMissing(command.action, 'outboxData');
    const data = command.outboxData(result);
    const violations = outboxDataViolations(data);
    if (violations.length > 0) {
      throw new Error(
        `[command-hooks] the owner of '${command.action}' returned outbox data that is not audit-state.md list 1: ` +
          violations.map((violation) => `'${violation.key}' (${violation.issue})`).join(', ') +
          '. An outbox row is platform-global and stores ids, codes, booleans, counts, dates and field names ' +
          'only; a handler re-reads anything else through the owner after the commit.',
      );
    }
    const organizationId = typeof data.organizationId === 'string' ? data.organizationId : null;
    for (const handler of present) {
      const row = new CommandOutboxEntry();
      row.action = command.action;
      row.objectType = command.objectType;
      row.objectId = command.objectId;
      row.organizationId = organizationId;
      row.hookModule = handler.moduleId;
      row.hookId = handler.id;
      row.data = data;
      row.actorKind = actor.kind;
      row.actorAdminUserId = actor.actorAdminUserId;
      row.impersonatedCustomerAccountId = actor.impersonatedCustomerAccountId;
      row.actorCustomerAccountId = actor.actorCustomerAccountId ?? null;
      row.requestId = meta.requestId ?? null;
      em.persist(row);
    }
    return present.length;
  }

  /** Every `extensions` key belongs to a present hook module on this action, or 422. */
  private assertExtensionsClaimed<TResult>(command: Command<TResult>): void {
    const keys = Object.keys(command.extensions ?? {});
    if (keys.length === 0) return;
    const hooks = this.options.hooks;
    const claimants = hooks?.claimants(command.action) ?? new Set<string>();
    const unclaimed = keys
      .filter((key) => !(claimants.has(key) && hooks!.isPresent(key)))
      .sort();
    if (unclaimed.length > 0) throw extensionUnclaimed(command.action, unclaimed);
  }

  /**
   * The present `beforeCommit` hooks of `command`'s action, in order, each with
   * its origin set. Returns what they noted, per module.
   */
  private async runBeforeCommitHooks<TResult>(
    hooks: CommandHookRegistry,
    command: Command<TResult>,
    result: TResult,
    em: EntityManager,
    actor: CommandActor,
    meta: CommandRequestMeta,
    state: RunState,
    below: Lineage,
  ): Promise<ReadonlyMap<string, ReadonlySet<string>> | undefined> {
    const present = hooks.beforeCommit(command.action).filter((hook) => hooks.isPresent(hook.moduleId));
    if (present.length === 0) return undefined;
    if (!command.hookData) throw hookDataMissing(command.action);
    const data = command.hookData(result);
    const noted = new Map<string, Set<string>>();
    const viaHook: Lineage = { ancestors: below.ancestors, viaHook: true };
    for (const hook of present) {
      await runWithCommandHookOrigin({ moduleId: hook.moduleId, hookId: hook.id, action: command.action }, () =>
        hook.handler({
          action: command.action,
          objectType: command.objectType,
          objectId: command.objectId,
          data,
          extension: command.extensions?.[hook.moduleId],
          em,
          actor,
          module: { id: hook.moduleId },
          run: (child) => this.execute(child, em, actor, meta, state, viaHook),
          noteAuditChanges: (fields) => {
            for (const field of fields) {
              if (typeof field !== 'string' || !NOTED_FIELD_RE.test(field)) {
                throw new Error(
                  `[command-hooks] hook '${hook.moduleId}#${hook.id}' noted ${JSON.stringify(field)} on ` +
                    `'${command.action}', which is not a field name. noteAuditChanges takes the names ` +
                    'of the fields a hook wrote, never their values (specs/conventions/audit-state.md).',
                );
              }
            }
            const set = noted.get(hook.moduleId) ?? new Set<string>();
            for (const field of fields) set.add(field);
            noted.set(hook.moduleId, set);
          },
        }),
      );
    }
    return noted;
  }
}

const NO_NOTES: Readonly<Record<string, readonly string[]>> = Object.freeze({});

/** What `admit` sees of one Command (FR-011): metadata only, frozen, no data and no `em`. */
function admissionMeta<TResult>(
  command: Command<TResult>,
  actor: CommandActor,
  meta: CommandRequestMeta,
  lineage: Lineage,
): CommandAdmissionMeta {
  const tenant = getTenantContext();
  return Object.freeze({
    action: command.action,
    objectType: command.objectType,
    objectId: command.objectId,
    actor: Object.freeze({ ...actor }),
    organizationId: tenant?.mode === 'single-org' ? (tenant.organizationId ?? null) : null,
    requestMeta: Object.freeze({
      requestId: meta.requestId ?? null,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    }),
    lineage: Object.freeze({
      ancestors: Object.freeze([...lineage.ancestors]),
      depth: lineage.ancestors.length,
      viaHook: lineage.viaHook,
    }),
  });
}

/** Per hook module, the sorted names it noted — `audit-state.md` list 1, never a value. */
function notedFieldNames(noted: ReadonlyMap<string, ReadonlySet<string>>): Readonly<Record<string, readonly string[]>> {
  const names: Record<string, readonly string[]> = {};
  for (const [moduleId, fields] of [...noted].sort(([a], [b]) => a.localeCompare(b))) {
    if (fields.size > 0) names[moduleId] = Object.freeze([...fields].sort());
  }
  return Object.freeze(names);
}

/** The frozen summary `observe` receives (FR-020). */
function runOutcome(
  root: CommandAdmissionMeta,
  record: RunRecord,
  committed: boolean,
  thrown: unknown,
  durationMs: number,
): CommandRunOutcome {
  const refusal = !committed && record.refusal !== null && record.refusal.error === thrown ? record.refusal : null;
  const commands: CommandRunEntry[] = record.entries.map((entry) =>
    Object.freeze({
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      depth: entry.depth,
      viaHook: entry.viaHook,
      refused: entry.refused,
      audited: committed && entry.recorded,
      notedFields: entry.notedFields,
    }),
  );
  return Object.freeze({
    root,
    committed,
    refusal: refusal === null ? null : Object.freeze({ middleware: refusal.middleware, code: refusal.code }),
    errorCode: committed ? null : thrown instanceof HttpError ? thrown.code : 'INTERNAL_ERROR',
    durationMs,
    commands: Object.freeze(commands),
  });
}

/**
 * The owner's after-state with the hooks' noted fields merged in, as names:
 * `extensions.<moduleId>.changedFields`, sorted. Unchanged when nothing was
 * noted; a `null` after-state becomes `{ extensions }`.
 */
function withNotedChanges(
  after: AuditState,
  noted: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): AuditState {
  const entries = [...(noted ?? new Map<string, ReadonlySet<string>>())].filter(([, fields]) => fields.size > 0);
  if (entries.length === 0) return after;
  const base = after ?? {};
  const existing = (base['extensions'] ?? {}) as Record<string, unknown>;
  const extensions: Record<string, unknown> = { ...existing };
  for (const [moduleId, fields] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    extensions[moduleId] = { changedFields: [...fields].sort() };
  }
  return { ...base, extensions };
}
