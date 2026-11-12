import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { AuditPort } from '../kernel/ports/audit.js';
import { currentRequestMeta } from '../kernel/scope.js';
import { forkScopedEm } from '../tenancy/scoped-em.js';
import type { EventBus } from '../events/bus.js';
import { COMMAND_HOOK_MAX_DEPTH } from '@endora-commerce/contracts';
import { resolveCommandActor } from './actor.js';
import type { AuditState, Command, CommandActor, CommandContext } from './command.js';
import { extensionUnclaimed, hookCycle, hookDataMissing } from './hooks/errors.js';
import { runWithCommandHookOrigin } from './hooks/origin.js';
import type { CommandHookRegistry } from './hooks/registry.js';

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
    const meta = (this.options.getRequestMeta ?? currentRequestMeta)() ?? {};

    return this.events.run(async () => {
      const scoped: EntityManager = forkScopedEm(this.orm);
      return scoped.transactional(async (em) => this.execute(command, em, actor, meta));
    });
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
    lineage: Lineage = ROOT_LINEAGE,
  ): Promise<TResult> {
    const hooks = this.options.hooks;
    if (lineage.viaHook && (lineage.ancestors.includes(command.action) || lineage.ancestors.length >= COMMAND_HOOK_MAX_DEPTH)) {
      throw hookCycle(command.action, lineage.ancestors);
    }
    // FR-019 — before capture, so a refused extension costs no write.
    this.assertExtensionsClaimed(command);

    const below: Lineage = { ancestors: [...lineage.ancestors, command.action], viaHook: lineage.viaHook };
    const ctx: CommandContext = {
      em,
      actor,
      run: (child) => this.execute(child, em, actor, meta, below),
    };
    const captured = command.capture ? await command.capture(ctx) : null;
    const { result, before, after, skipAudit } = await command.run(ctx);

    const noted = hooks ? await this.runBeforeCommitHooks(hooks, command, result, em, actor, meta, below) : undefined;

    if (!skipAudit) {
      this.audit.recordWithin(em, {
        action: command.action,
        objectType: command.objectType,
        objectId: command.objectId,
        actorAdminUserId: actor.actorAdminUserId,
        impersonatedCustomerAccountId: actor.impersonatedCustomerAccountId,
        actorCustomerAccountId: actor.actorCustomerAccountId ?? null,
        stateBefore: before ?? captured ?? null,
        stateAfter: withNotedChanges(after ?? null, noted),
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: meta.requestId ?? null,
      });
    }

    const evt = command.event?.(result);
    if (evt) this.events.emit(evt.eventName, evt.payload);

    return result;
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
          run: (child) => this.execute(child, em, actor, meta, viaHook),
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
