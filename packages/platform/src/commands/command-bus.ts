import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { AuditPort } from '../kernel/ports/audit.js';
import { forkScopedEm } from '../tenancy/scoped-em.js';
import type { EventBus } from '../events/bus.js';
import { resolveCommandActor } from './actor.js';
import type { Command, CommandActor, CommandContext } from './command.js';

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
   * worker/system runs. Kept injectable so the core layer imports no HTTP code.
   */
  getRequestMeta?: () => CommandRequestMeta | undefined;
}

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
    const meta = this.options.getRequestMeta?.() ?? {};

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
  ): Promise<TResult> {
    const ctx: CommandContext = {
      em,
      actor,
      run: (child) => this.execute(child, em, actor, meta),
    };
    const captured = command.capture ? await command.capture(ctx) : null;
    const { result, before, after, skipAudit } = await command.run(ctx);

    if (!skipAudit) {
      this.audit.recordWithin(em, {
        action: command.action,
        objectType: command.objectType,
        objectId: command.objectId,
        actorAdminUserId: actor.actorAdminUserId,
        impersonatedCustomerAccountId: actor.impersonatedCustomerAccountId,
        actorCustomerAccountId: actor.actorCustomerAccountId ?? null,
        stateBefore: before ?? captured ?? null,
        stateAfter: after ?? null,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: meta.requestId ?? null,
      });
    }

    const evt = command.event?.(result);
    if (evt) this.events.emit(evt.eventName, evt.payload);

    return result;
  }
}
