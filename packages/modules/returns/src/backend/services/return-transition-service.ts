import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { ReturnCase } from '../entities/return-case.entity.js';
import { RETURN_STATUS_AUTHORIZED, RETURN_STATUS_REJECTED, RETURN_STATUS_RESOLVED } from '../domain/return-status-graph.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { RmaNumberGenerator } from './rma-number-generator.js';
import type { ReturnEmailResult } from './return-email-notifier.js';
import type { ReturnsNotificationJob } from './notifications/dispatch.js';
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
 * Best-effort customer notifications on authorize/reject (FR-017).
 *
 * Each answers whether the message went out and, when it did not, why (issue
 * #78). `Promise<void>` said nothing, and the transition is the caller that could
 * not tell a delivered notification from a deactivated template.
 */
export interface ReturnNotifier {
  authorized(rc: ReturnCase): Promise<ReturnEmailResult>;
  rejected(rc: ReturnCase): Promise<ReturnEmailResult>;
}

/**
 * What entering a status does beyond moving the case
 * (`specs/180-off-platform-complaints/` research R-7.3, repairing F3).
 *
 * Entering `authorized` assigns the RMA number, stamps `authorizedAt` and the
 * authorizing administrator, and sends the *authorized* e-mail; entering
 * `rejected` sends the *rejected* e-mail. These used to be
 * `ReturnAuthorizationService`'s, so the generic and the bulk transition moved a
 * case into `authorized` with no RMA, no time and no e-mail. They belong to the
 * status now, so every path into it has them.
 */
export interface ReturnStatusEntryEffects {
  rmaGenerator?: RmaNumberGenerator;
  notifier?: ReturnNotifier;
  /**
   * `specs/180-off-platform-complaints/` FR-A31 — hand `status_entered` to the
   * notification queue after the write. Never throws.
   */
  enqueueNotification?: (job: ReturnsNotificationJob) => Promise<void>;
}

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
    private readonly auditLog?: AuditPort,
    private readonly entryEffects: ReturnStatusEntryEffects = {},
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
      /**
       * `specs/180-off-platform-complaints/` research R-19 (D-5): a case without a
       * platform order settled outside the platform enters `resolved` from any open
       * status after authorization — the shipped graph has no `authorized → resolved`
       * edge, and adding one would let any case be resolved by a plain transition. Only
       * `ReturnSettlementService`'s outside settlement passes it, and only for
       * `resolved`; the before-guards, the events, the audit and the status effects
       * still run.
       */
      viaOutsideSettlement?: boolean;
    },
  ): Promise<ReturnCase> {
    const em = this.emFactory();
    if (!isUuidShape(returnCaseId)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, { id: returnCaseId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');

    const from = rc.statusCode;
    if (from === to) return rc;

    const graph = await this.graphService.loadGraph();
    if (!graph.has(to)) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, `Unknown return status "${to}".`);
    }
    const outside = opts?.viaOutsideSettlement === true && to === RETURN_STATUS_RESOLVED && !graph.isTerminal(from);
    if (!outside && !graph.canTransition(from, to)) {
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
      orderId: rc.orderId ?? null,
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
    await this.enter(rc, to, actor, em, opts?.reason ?? null);
    rc.statusCode = to;
    // `specs/181-guest-complaints/` research R-9 (owner ruling 3): a case *closes* when
    // it enters a terminal status, recorded in this flush. A terminal status has no exit,
    // so this is written once; the guest link's expiry and data retention count from it.
    if (graph.isTerminal(to)) rc.closedAt = new Date();
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
          // That there was a reason, never its text (#470, D-288): free text is the
          // Organization's, and the audit log is read without its reach.
          stateAfter: { statusCode: to, hasReason: Boolean(opts?.reason) },
        });
      } catch {
        // ignore audit failures
      }
    }

    // The dedicated e-mail of the entered status, after the write (FR-A32: the
    // only e-mail of this transition). Never undoes it.
    if (to === RETURN_STATUS_AUTHORIZED) {
      await this.notifySafely(rc, 'return_authorized', () => this.entryEffects.notifier?.authorized(rc));
    } else if (to === RETURN_STATUS_REJECTED) {
      await this.notifySafely(rc, 'return_rejected', () => this.entryEffects.notifier?.rejected(rc));
    } else if (graph.get(to)?.notifyCustomerOnEntry && actor.kind !== 'customer') {
      // FR-A31 — the status e-mail, for an entry an operator or the platform made;
      // never for the customer's own transition (D-13). Filing creates a case in the
      // initial status without coming through here, so it never sends this (D-2).
      await this.entryEffects.enqueueNotification?.({
        kind: 'status_entered',
        returnCaseId: rc.id,
        statusCode: to,
        eventId: event.eventId,
      });
    }

    return rc;
  }

  /**
   * The mutation of entering `to`, in the same flush as the status
   * (research R-7.3). The authorizer is the acting administrator — `null` for a
   * customer or the system, which no graph lets authorize today.
   */
  private async enter(
    rc: ReturnCase,
    to: string,
    actor: ReturnStatusActor,
    em: EntityManager,
    reason: string | null,
  ): Promise<void> {
    if (to === RETURN_STATUS_AUTHORIZED) {
      if (!rc.rmaNumber && this.entryEffects.rmaGenerator) {
        rc.rmaNumber = await this.entryEffects.rmaGenerator.generate(em, rc.salesChannelId);
      }
      rc.authorizedAt = new Date();
      rc.authorizedByAdminUserId = actor.kind === 'admin' ? (actor.adminUserId ?? null) : null;
    } else if (to === RETURN_STATUS_REJECTED && reason && !rc.rejectionReason) {
      // The generic transition's reason is the rejection's: the e-mail names it.
      rc.rejectionReason = reason;
    }
  }

  /**
   * The outer net for a notification that must not undo the transition it
   * announces.
   *
   * The notifier itself names every non-sent path in its result and writes it to
   * the log (issue #78), so what reaches here is the residue: a throw the
   * notifier deliberately let travel. That includes a `ModuleDisabledError`,
   * which this `catch` still absorbs — re-throwing it would answer 503 to a
   * transition that has already committed. What it no longer does is absorb it
   * in silence.
   */
  private async notifySafely(
    rc: ReturnCase,
    kind: string,
    fn: () => Promise<ReturnEmailResult> | undefined,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      // Notifications are best-effort; never block the workflow transition.
      console.warn('[returns] the return e-mail was not sent', {
        returnCaseId: rc.id,
        kind,
        reason: 'failed',
        error: error instanceof Error ? error.message : error,
      });
    }
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
