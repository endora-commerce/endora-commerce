import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../modules/audit_logs/services/audit-log-service.js';
import { forkScopedEm } from '../tenancy/index.js';
import type { EventBus } from '../events/bus.js';
import { resolveCommandActor } from './actor.js';
import type { Command } from './command.js';

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
    private readonly audit: AuditLogService,
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
      return scoped.transactional(async (em) => {
        const before = command.capture ? await command.capture({ em, actor }) : null;
        const { result, after } = await command.run({ em, actor });

        this.audit.recordWithin(em, {
          action: command.action,
          objectType: command.objectType,
          objectId: command.objectId,
          actorAdminUserId: actor.actorAdminUserId,
          impersonatedCustomerAccountId: actor.impersonatedCustomerAccountId,
          stateBefore: before ?? null,
          stateAfter: after ?? null,
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
          requestId: meta.requestId ?? null,
        });

        const evt = command.event?.(result);
        if (evt) this.events.emit(evt.eventName, evt.payload);

        return result;
      });
    });
  }
}
