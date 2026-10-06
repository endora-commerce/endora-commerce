import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type OpportunityStatusActor,
  type OpportunityTransitionCause,
  type OrderStatusActor,
  type PropagationOutcome,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { CrmOpportunityStatus } from '../entities/crm-opportunity-status.entity.js';
import { CrmOpportunityStatusHistory } from '../entities/crm-opportunity-status-history.entity.js';
import { CrmStatusPropagation } from '../entities/crm-status-propagation.entity.js';
import {
  buildOpportunityStatusEvent,
  emitOpportunityStatusAfter,
  emitOpportunityStatusBefore,
  type OpportunityEventSink,
} from '../events/opportunity-status-events.js';
import { effectiveOpportunityValue, loadOpportunity } from './opportunity-access.js';
import type { OpportunityTransitionGuardRegistry } from './opportunity-transition-guard-registry.js';
import type { OrderStatusPropagationService } from './order-status-propagation-service.js';
import type { WorkflowReadService } from './workflow-read-service.js';

export interface OpportunityTransitionServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  events: OpportunityEventSink;
  workflowRead: WorkflowReadService;
  guards: OpportunityTransitionGuardRegistry;
  propagation: OrderStatusPropagationService;
}

export interface OpportunityTransitionRequest {
  reason?: string | null | undefined;
  /** Why the Opportunity is moving. `manual` unless a subscriber says otherwise. */
  cause?: OpportunityTransitionCause | undefined;
  /** The Order whose status caused the move, when `cause` is `order_status`. */
  causeOrderId?: string | undefined;
  /** Defaults to the ambient actor: the acting administrator, or the system. */
  actor?: OpportunityStatusActor | undefined;
}

export interface AppliedOpportunityTransition {
  opportunityId: string;
  from: string;
  to: string;
  /** `false` when the Opportunity was already at `to` — nothing was written or announced. */
  changed: boolean;
  /** One outcome per linked Order that was asked to follow. */
  propagation: PropagationOutcome[];
}

/**
 * How often a transition is evaluated again when the Opportunity moved between
 * the read and the locked write. Once: a second concurrent mover in the same
 * instant is refused rather than chased.
 */
const MAX_REEVALUATIONS = 1;

function ambientActor(): OpportunityStatusActor {
  const actor = getTenantContext()?.actor;
  return actor?.kind === 'admin' && actor.id ? { kind: 'admin', adminUserId: actor.id } : { kind: 'system' };
}


/**
 * The refusal of an Order-caused move of a closed Opportunity. `details.closed`
 * is what lets the reverse direction tell it from a missing edge: it is not a
 * skipped change to record, it is nothing to do.
 */
export function closedToOrderCausedMove(from: string, to: string): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.CRM_INVALID_TRANSITION,
    `A closed opportunity is not moved from "${from}" to "${to}" by an order.`,
    { from, to, closed: true },
  );
}

/** Whether `error` is {@link closedToOrderCausedMove}'s refusal. */
export function isClosedToOrderCausedMove(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.code === ERROR_CODES.CRM_INVALID_TRANSITION &&
    (error.details as { closed?: unknown } | undefined)?.closed === true
  );
}

/**
 * Moves an Opportunity along its workflow
 * (`specs/143-crm-sales-opportunities/research.md` R-3).
 *
 * Five steps, in this order, and **every refusal happens before anything is
 * written**:
 *
 * 1. load the Opportunity through the tenant-scoped EntityManager — absent or
 *    out of scope is the same 404; already at the target answers unchanged;
 * 2. consult the workflow — an unknown status is 422, a missing edge is 409
 *    `CRM_INVALID_TRANSITION`;
 * 3. run the registered guards — a veto is 409 `CRM_TRANSITION_VETOED` carrying
 *    the guard's sentence — then announce the two passive `.before` events;
 * 4. one Command: lock the row, re-check the status that was read, write the
 *    new status with `closedAt` / `closedKind`, append the history row, bump
 *    the version, and plan what the linked Orders are owed;
 * 5. after the commit: ask the Orders, then announce.
 *
 * **Order matters at step 5.** The after-events are emitted once the Orders
 * have been asked, so a subscriber that reads a linked Order sees its new
 * status — and they are emitted from a `finally`, so a failure while asking
 * does not suppress the announcement of a transition that did commit.
 *
 * A transition caused by an Order's own status (`cause: 'order_status'`) asks
 * no Order to follow: a change that came from an Order never pushes others.
 */
export class OpportunityTransitionService {
  constructor(private readonly deps: OpportunityTransitionServiceDeps) {}

  async apply(
    opportunityId: string,
    to: string,
    request: OpportunityTransitionRequest = {},
  ): Promise<AppliedOpportunityTransition> {
    const actor = request.actor ?? ambientActor();
    const cause = request.cause ?? 'manual';
    const reason = request.reason?.trim() ? request.reason.trim() : null;

    for (let evaluation = 0; ; evaluation += 1) {
      // --- 1. the Opportunity, as the caller may see it -----------------------
      const opportunity = await loadOpportunity(this.deps.emFactory(), opportunityId);
      const from = opportunity.statusCode;
      if (from === to) {
        return { opportunityId: opportunity.id, from, to, changed: false, propagation: [] };
      }

      // --- 2. the workflow ----------------------------------------------------
      const graph = await this.deps.workflowRead.loadGraph();
      const toKind = graph.kindOf(to);
      if (toKind === undefined) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, `Unknown opportunity status "${to}".`);
      }
      // A closed Opportunity is never reopened on an Order's behalf — asked on
      // every evaluation, so it also holds for one that was closed between the
      // caller's own look and the lock below (which sends the request back here).
      if (cause === 'order_status' && (graph.kindOf(from) ?? 'open') !== 'open') {
        throw closedToOrderCausedMove(from, to);
      }
      if (!graph.canTransition(from, to)) {
        throw new HttpError(
          409,
          ERROR_CODES.CRM_INVALID_TRANSITION,
          `Cannot move an opportunity from "${from}" to "${to}".`,
          { from, to },
        );
      }

      const event = buildOpportunityStatusEvent({
        opportunityId: opportunity.id,
        organizationId: opportunity.organizationId,
        salesChannelId: opportunity.salesChannelId ?? null,
        from,
        to,
        // A status an Opportunity is in but the workflow no longer holds cannot
        // be created through the configuration endpoints; `open` is the reading
        // that closes nothing.
        fromKind: graph.kindOf(from) ?? 'open',
        toKind,
        actor,
        cause,
        causeOrderId: request.causeOrderId,
        reason,
      });

      // --- 3. guards may refuse; the before-events may only observe -----------
      await this.deps.guards.run(event);
      emitOpportunityStatusBefore(this.deps.events, event);

      // --- 4. the write --------------------------------------------------------
      const applied = await this.deps.commandBus.run({
        action: 'crm.opportunity.transition',
        objectType: 'crm_opportunity',
        objectId: opportunity.id,
        run: async ({ em }) => {
          const locked = await loadOpportunity(em, opportunity.id, {
            lockMode: LockMode.PESSIMISTIC_WRITE,
          });
          // Somebody moved the Opportunity between the read above and this
          // lock. Nothing is written; the caller is evaluated again from the top.
          if (locked.statusCode !== from) return { result: null, skipAudit: true };
          // The target, as it is now, held until this commits: a configuration
          // write that deletes the status or changes what it means takes the
          // row for itself first, so it either waits for this and finds the
          // status in use, or has finished — and then the workflow read above
          // is stale and the caller is evaluated again (research N-R12).
          const target = await em.findOne(
            CrmOpportunityStatus,
            { code: to },
            { lockMode: LockMode.PESSIMISTIC_READ },
          );
          if (!target || target.kind !== toKind) return { result: null, skipAudit: true };
          // Under the lock, by the row's own account of itself.
          if (cause === 'order_status' && (locked.closedKind || locked.closedAt)) {
            throw closedToOrderCausedMove(from, to);
          }

          locked.statusCode = to;
          locked.closedAt = toKind === 'open' ? null : new Date();
          locked.closedKind = toKind === 'open' ? null : toKind;
          locked.version += 1;
          const history = em.create(CrmOpportunityStatusHistory, {
            opportunityId: locked.id,
            fromStatusCode: from,
            toStatusCode: to,
            actorAdminUserId: actor.kind === 'admin' ? (actor.adminUserId ?? null) : null,
            cause,
            causeOrderId: request.causeOrderId ?? null,
            reason,
          });
          // What the linked Orders are owed, written `pending` here so it
          // commits with the status change or not at all. A change that came
          // from an Order pushes no Order.
          const targets =
            cause === 'order_status'
              ? []
              : await this.deps.propagation.forwardTargets(em, {
                  opportunityId: locked.id,
                  opportunityStatusCode: to,
                });
          const pending = targets.map(
            (target) =>
              em.create(CrmStatusPropagation, {
                opportunityId: locked.id,
                orderId: target.orderId,
                direction: 'opportunity_to_order',
                opportunityStatusCode: to,
                orderStatusCode: target.orderStatusCode,
                outcome: 'pending',
                statusHistoryId: history.id,
              }).id,
          );
          return {
            result: {
              number: locked.number,
              value: effectiveOpportunityValue(locked),
              currency: locked.currency,
              pending,
            },
            before: { status: from },
            // The Order that caused the move is named in the audit entry too:
            // the Opportunity's change history is read from the audit trail.
            after: {
              status: to,
              cause,
              ...(request.causeOrderId ? { causeOrderId: request.causeOrderId } : {}),
              ...(reason ? { reason } : {}),
            },
          };
        },
      });

      if (applied === null) {
        if (evaluation < MAX_REEVALUATIONS) continue;
        throw new HttpError(
          409,
          ERROR_CODES.CRM_TRANSITION_CONFLICT,
          'The opportunity changed status while this transition was being applied. Retry.',
        );
      }

      // --- 5. after the commit: ask the Orders, then announce ------------------
      let propagation: PropagationOutcome[] = [];
      try {
        const orderActor: OrderStatusActor =
          actor.kind === 'admin' && actor.adminUserId
            ? { kind: 'admin', adminUserId: actor.adminUserId }
            : { kind: 'system' };
        propagation = await this.deps.propagation.resolve(opportunity.id, applied.pending, {
          actor: orderActor,
          reason,
        });
      } finally {
        emitOpportunityStatusAfter(this.deps.events, event, applied);
      }

      return { opportunityId: opportunity.id, from, to, changed: true, propagation };
    }
  }
}
