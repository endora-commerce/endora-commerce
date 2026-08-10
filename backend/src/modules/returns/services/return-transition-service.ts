import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type { EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { ReturnCase } from '../entities/return-case.entity.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import {
  emitReturnStatusAfter,
  returnStatusBeforeEventNames,
  ReturnTransitionVetoError,
  type ReturnStatusActor,
  type ReturnStatusEvent,
} from '../events/return-status-events.js';

type TransitionGuard = (e: ReturnStatusEvent) => void | Promise<void>;
interface GuardEntry {
  match: { from?: string; to?: string };
  guard: TransitionGuard;
}

/** Side-effects applied within the transition, before the after-events fire. */
export type ReturnTransitionSideEffects = (e: {
  returnCase: ReturnCase;
  from: string;
  to: string;
  em: EntityManager;
}) => Promise<void>;

/**
 * ReturnTransitionService — feature 046 (US3).
 *
 * Applies a status transition against the configurable graph and emits the four
 * templated business events. The `.before` events run through a veto-capable
 * guard registry; the `.after` events fire on the EventBus once the write has
 * flushed. Mirrors `OrderTransitionService`.
 */
export class ReturnTransitionService {
  private readonly guards: GuardEntry[] = [];

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: EventBus,
    private readonly graphService: ReturnStatusGraphService,
    private readonly auditLog?: AuditLogService,
  ) {}

  onReturnTransitionGuard(match: { from?: string; to?: string }, guard: TransitionGuard): () => void {
    const entry: GuardEntry = { match, guard };
    this.guards.push(entry);
    return () => {
      const idx = this.guards.indexOf(entry);
      if (idx >= 0) this.guards.splice(idx, 1);
    };
  }

  /**
   * Transition `returnCaseId` to status code `to`. Throws 404 if the case is
   * missing, 422 for an unknown target, 409 if the transition is not permitted
   * by the graph or a guard vetoes it. `mutate` runs after the graph check and
   * before the status flush (e.g. assign RMA number, set rejection reason).
   */
  async apply(
    returnCaseId: string,
    to: string,
    actor: ReturnStatusActor,
    opts?: {
      reason?: string | null;
      mutate?: (rc: ReturnCase, em: EntityManager) => void | Promise<void>;
      sideEffects?: ReturnTransitionSideEffects;
    },
  ): Promise<ReturnCase> {
    const em = this.emFactory();
    const rc = await em.findOne(ReturnCase, { id: returnCaseId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');

    const from = rc.statusCode;
    if (from === to) return rc;

    const graph = await this.graphService.loadGraph();
    if (!graph.has(to)) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, `Unknown return status "${to}".`);
    }
    if (!graph.canTransition(from, to)) {
      throw new HttpError(
        409,
        ERROR_CODES.INVALID_TRANSITION,
        `Cannot transition from "${from}" to "${to}".`,
      );
    }

    const event: ReturnStatusEvent = {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      returnCaseId: rc.id,
      orderId: rc.orderId,
      organizationId: rc.organizationId ?? null,
      salesChannelId: rc.salesChannelId,
      from,
      to,
      actor,
      reason: opts?.reason ?? null,
    };

    await this.runBeforeGuards(event);
    for (const name of returnStatusBeforeEventNames(from, to)) {
      this.events.emit(name, event);
    }

    if (opts?.mutate) await opts.mutate(rc, em);
    rc.statusCode = to;
    await em.flush();
    if (opts?.sideEffects) await opts.sideEffects({ returnCase: rc, from, to, em });

    emitReturnStatusAfter(this.events, event);

    // Audit the status change (FR-041); best-effort, never blocks the transition.
    if (this.auditLog) {
      try {
        await this.auditLog.record({
          actorAdminUserId: actor.kind === 'admin' ? (actor.adminUserId ?? null) : null,
          impersonatedCustomerAccountId:
            actor.kind === 'customer' ? (actor.customerAccountId ?? null) : null,
          action: 'return.status_changed',
          objectType: 'return_case',
          objectId: rc.id,
          stateBefore: { statusCode: from },
          stateAfter: { statusCode: to, reason: opts?.reason ?? null },
        });
      } catch {
        // ignore audit failures
      }
    }

    return rc;
  }

  private async runBeforeGuards(event: ReturnStatusEvent): Promise<void> {
    for (const entry of this.guards) {
      if (entry.match.from !== undefined && entry.match.from !== event.from) continue;
      if (entry.match.to !== undefined && entry.match.to !== event.to) continue;
      try {
        await entry.guard(event);
      } catch (err) {
        if (err instanceof ReturnTransitionVetoError) {
          throw new HttpError(409, ERROR_CODES.INVALID_TRANSITION, err.message);
        }
        throw err;
      }
    }
  }
}
