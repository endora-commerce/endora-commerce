import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type OrderReadPort,
  type OrderStatusActor,
  type OrderTransitionPort,
  type PropagationOutcome,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import { CrmOrderStatusMapping } from '../entities/crm-order-status-mapping.entity.js';
import {
  CrmStatusPropagation,
  type CrmPropagationOutcome,
} from '../entities/crm-status-propagation.entity.js';
import { isUuid, loadOpportunity } from './opportunity-access.js';

export interface OrderStatusPropagationServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** `orders`' ports — lazy, resolved per call, never captured. */
  orderTransitions: OrderTransitionPort;
  orders: OrderReadPort;
}

const FORWARD = 'opportunity_to_order' as const;
const REVERSE = 'order_to_opportunity' as const;

/** `order.status_changed.v1`, as much of it as the reverse direction reads. */
export interface OrderStatusChange {
  orderId: string;
  organizationId: string;
  to: string;
}

/**
 * Moves an Opportunity on an Order's behalf. Handed in by the composition
 * rather than held: the transition service already depends on this one for the
 * forward direction, and the reverse direction must go through that same
 * service — its graph, its guards, its events — rather than around it.
 */
export type ApplyOrderCausedTransition = (
  opportunityId: string,
  to: string,
  causeOrderId: string,
) => Promise<unknown>;

/** What became of one Order status change, for the caller's log and the tests. */
export type ReverseMappingResult =
  | { kind: 'echo' }
  | { kind: 'ignored'; why: 'not_linked' | 'not_following' | 'closed' | 'no_mapping' | 'already_there' | 'waiting_for_orders' }
  | { kind: 'moved'; opportunityId: string; to: string }
  | { kind: 'skipped'; opportunityId: string; to: string; detail: string };

/**
 * The refusals of the Opportunity's own workflow. An Order-caused move that
 * meets one is recorded as `skipped`; anything else is a defect and is thrown.
 */
const WORKFLOW_REFUSALS: readonly string[] = [
  ERROR_CODES.CRM_INVALID_TRANSITION,
  ERROR_CODES.CRM_TRANSITION_VETOED,
  ERROR_CODES.CRM_TRANSITION_CONFLICT,
  ERROR_CODES.VALIDATION_FAILED,
];

/** The answers that leave an Order where it was and want somebody's attention. */
const REFUSALS: readonly CrmPropagationOutcome[] = [
  'not_found',
  'unknown_status',
  'not_permitted',
  'vetoed',
  'failed',
];

/**
 * How long a row may stay `pending` before it is read as an attempt that never
 * finished. A row is pending for the length of one port call in the normal
 * course; one this old was left by a process that stopped between the
 * Opportunity's commit and the Order's answer.
 */
const STALE_PENDING_MS = 60_000;

function outcomeNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This outcome does not belong to this opportunity.');
}

function settled(message: string): HttpError {
  return new HttpError(409, ERROR_CODES.VERSION_CONFLICT, message);
}

function isStalePending(row: CrmStatusPropagation, now = Date.now()): boolean {
  return row.outcome === 'pending' && now - row.createdAt.getTime() > STALE_PENDING_MS;
}

/** Whether a forward row still wants attention: refused, or never finished, and not dismissed. */
function isUnresolved(row: CrmStatusPropagation): boolean {
  if (row.direction !== FORWARD || row.dismissedAt) return false;
  return REFUSALS.includes(row.outcome) || isStalePending(row);
}

/**
 * Status following across the Opportunity ↔ Order link, in both directions.
 *
 * **Forward** — an Opportunity's transition asks its linked Orders to move
 * (`specs/143-crm-sales-opportunities/research.md` R-4). **Reverse** — an
 * Order's status moves its Opportunity (R-5): {@link onOrderStatusChanged},
 * which carries its own account. The rest of this header is the forward
 * direction's.
 *
 * Three steps, on three different footings:
 *
 * 1. **Plan** — inside the transition's own Command, one `pending` row per
 *    following Order ({@link forwardTargets} says which). The rows commit with
 *    the status change or not at all, so there is never a moved Opportunity
 *    with no record of what it owes.
 * 2. **Ask** — after that commit and outside any transaction, each Order is
 *    asked through `orderTransitionPort.applyStatus`. That is `orders`' own
 *    seam: the Order workflow's graph, its guards, its audit entry and its
 *    follow-ups all apply, and a refusal comes back as a value.
 * 3. **Record** — the answer is written onto the row and returned.
 *
 * **The Opportunity's transition stands whatever an Order answers** (owner's
 * decision). A refusal is shown and can be retried or dismissed; it is never an
 * HTTP error and never undoes the Opportunity. Every following Order is asked
 * independently — one refusal does not stop the others.
 */
export class OrderStatusPropagationService {
  constructor(private readonly deps: OrderStatusPropagationServiceDeps) {}

  /**
   * Step 1, the read half: which Orders a transition into `opportunityStatusCode`
   * owes a change, and to which Order status — one entry per Order link that
   * follows the Opportunity, when the status has a forward mapping.
   *
   * It reads on the EntityManager it is handed and writes nothing. **The
   * `pending` rows are written by the caller, inside its own Command**
   * (`OpportunityTransitionService`), so the write sits where the Command that
   * audits it is — and commits with the status change or not at all.
   */
  async forwardTargets(
    em: EntityManager,
    input: { opportunityId: string; opportunityStatusCode: string },
  ): Promise<Array<{ orderId: string; orderStatusCode: string }>> {
    const mapping = await em.findOne(CrmOrderStatusMapping, {
      direction: FORWARD,
      opportunityStatusCode: input.opportunityStatusCode,
    });
    if (!mapping) return [];
    const links = await em.find(
      CrmOpportunityLink,
      { opportunityId: input.opportunityId, documentKind: 'order', syncStatus: true },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return links.map((link) => ({ orderId: link.documentId, orderStatusCode: mapping.orderStatusCode }));
  }

  /**
   * Steps 2 and 3, for rows already committed as `pending`. **Call it after the
   * commit that wrote them, never inside a transaction** — the Orders port
   * obtains its own EntityManager and says so in its contract.
   */
  async resolve(
    opportunityId: string,
    propagationIds: readonly string[],
    request: { actor: OrderStatusActor; reason: string | null },
  ): Promise<PropagationOutcome[]> {
    const resolved: CrmStatusPropagation[] = [];
    for (const id of propagationIds) {
      const row = await this.deps.emFactory().findOne(CrmStatusPropagation, { id, opportunityId });
      if (!row || row.outcome !== 'pending') continue;
      const answer = await this.#ask(row, request);
      resolved.push(await this.#record(opportunityId, row.id, answer));
    }
    return this.#render(resolved);
  }

  /** Refused changes of this Opportunity's Orders that nobody has retried or dismissed. */
  async listUnresolved(opportunityId: string): Promise<PropagationOutcome[]> {
    const em = this.deps.emFactory();
    const opportunity = await loadOpportunity(em, opportunityId);
    const rows = await em.find(
      CrmStatusPropagation,
      { opportunityId: opportunity.id, direction: FORWARD, dismissedAt: null },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return this.#render(rows.filter(isUnresolved));
  }

  /**
   * The reverse direction: an Order changed status, whoever changed it
   * (`specs/143-crm-sales-opportunities/research.md` R-5).
   *
   * **Runs with no request behind it** — the caller has entered a system scope,
   * so nothing here is narrowed by an ambient tenant. The Opportunity is found
   * through the Order's link, and the link is honoured only when the
   * Opportunity belongs to the Organization the event names.
   *
   * In this order, each step able to end the matter:
   *
   * 1. **Echo.** A forward row asked this Order for exactly this status and has
   *    not seen its echo yet: the change is CRM's own. The row is marked and
   *    nothing moves — the first half of the one-hop rule.
   * 2. The Order is linked to an Opportunity and follows it; the Opportunity is
   *    open. **A closed Opportunity is never reopened by a mapping.**
   * 3. The Order status has a reverse mapping.
   * 4. A mapping marked "every Order" waits until every following Order is in a
   *    status whose reverse mapping names the same Opportunity status. Waiting
   *    is not recorded — it would be a row per Order event.
   * 5. The move goes through the transition service, as the system, with the
   *    Order as its cause: the workflow's graph and its guards apply, and a
   *    refusal by either is recorded as a `skipped` outcome with the reason.
   *    The transition service asks no Order to follow a move with this cause —
   *    the second half of the one-hop rule.
   */
  async onOrderStatusChanged(
    change: OrderStatusChange,
    apply: ApplyOrderCausedTransition,
  ): Promise<ReverseMappingResult> {
    const em = this.deps.emFactory();

    // --- 1. our own echo ---------------------------------------------------------
    const asked = await em.findOne(
      CrmStatusPropagation,
      {
        orderId: change.orderId,
        direction: FORWARD,
        orderStatusCode: change.to,
        outcome: { $in: ['pending', 'applied'] },
        echoed: false,
      },
      { orderBy: { createdAt: 'desc' } },
    );
    if (asked) {
      await this.deps.commandBus.run({
        action: 'crm.opportunity.propagation_echo',
        objectType: 'crm_opportunity',
        objectId: asked.opportunityId,
        run: async ({ em: tx }) => {
          const row = await tx.findOneOrFail(CrmStatusPropagation, {
            id: asked.id,
            opportunityId: asked.opportunityId,
          });
          row.echoed = true;
          // Bookkeeping on a row whose transition is already audited; an entry
          // of its own would say "CRM noticed what CRM did".
          return { result: undefined, skipAudit: true };
        },
      });
      return { kind: 'echo' };
    }

    // --- 2. the link, and the Opportunity behind it ------------------------------
    const link = await em.findOne(CrmOpportunityLink, { documentKind: 'order', documentId: change.orderId });
    if (!link) return { kind: 'ignored', why: 'not_linked' };
    if (!link.syncStatus) return { kind: 'ignored', why: 'not_following' };
    const opportunity = await em.findOne(CrmOpportunity, {
      id: link.opportunityId,
      organizationId: change.organizationId,
    });
    if (!opportunity) return { kind: 'ignored', why: 'not_linked' };
    if (opportunity.closedKind || opportunity.closedAt) return { kind: 'ignored', why: 'closed' };

    // --- 3. the mapping -----------------------------------------------------------
    const mapping = await em.findOne(CrmOrderStatusMapping, {
      direction: REVERSE,
      orderStatusCode: change.to,
    });
    if (!mapping) return { kind: 'ignored', why: 'no_mapping' };
    const target = mapping.opportunityStatusCode;
    if (opportunity.statusCode === target) return { kind: 'ignored', why: 'already_there' };

    // --- 4. "only when every linked Order is there" -------------------------------
    if (mapping.requireAllOrders && !(await this.#everyFollowingOrderLeadsTo(em, opportunity.id, target))) {
      return { kind: 'ignored', why: 'waiting_for_orders' };
    }

    // --- 5. the move, through the workflow ----------------------------------------
    try {
      await apply(opportunity.id, target, change.orderId);
      return { kind: 'moved', opportunityId: opportunity.id, to: target };
    } catch (error) {
      // Narrow on purpose: only the workflow's own refusals become an outcome.
      // A switched-off module, a failed write or a throwing guard stay errors.
      rethrowIfModuleDisabled(error);
      if (!(error instanceof HttpError) || !WORKFLOW_REFUSALS.includes(error.code)) throw error;
      const reason = (error.details as { reason?: unknown } | undefined)?.reason;
      const detail = typeof reason === 'string' && reason ? reason : error.message;
      await this.#recordSkipped(opportunity.id, {
        orderId: change.orderId,
        orderStatusCode: change.to,
        opportunityStatusCode: target,
        from: opportunity.statusCode,
        detail,
      });
      return { kind: 'skipped', opportunityId: opportunity.id, to: target, detail };
    }
  }

  /**
   * Whether every Order that follows the Opportunity is in a status whose
   * reverse mapping names `target`. The statuses are read through `orders`'
   * own port, as they are now; an Order that cannot be read does not qualify.
   */
  async #everyFollowingOrderLeadsTo(em: EntityManager, opportunityId: string, target: string): Promise<boolean> {
    const links = await em.find(CrmOpportunityLink, { opportunityId, documentKind: 'order', syncStatus: true });
    if (links.length === 0) return false;
    const [orders, mappings] = await Promise.all([
      this.deps.orders.findByIds(links.map((link) => link.documentId)),
      em.find(CrmOrderStatusMapping, { direction: REVERSE, opportunityStatusCode: target }),
    ]);
    const qualifying = new Set(mappings.map((mapping) => mapping.orderStatusCode));
    const statusByOrder = new Map(orders.map((order) => [order.id, order.status]));
    return links.every((link) => {
      const status = statusByOrder.get(link.documentId);
      return status !== undefined && qualifying.has(status);
    });
  }

  /**
   * An Order asked for a move the Opportunity's workflow refused. Recorded on
   * the Opportunity twice over, in one Command: as a `skipped` outcome row,
   * and as an audit entry — the Opportunity's history is the audit trail, and
   * "the Order was completed and this did not follow, because …" is something
   * the person working the Opportunity is owed.
   */
  async #recordSkipped(
    opportunityId: string,
    skipped: { orderId: string; orderStatusCode: string; opportunityStatusCode: string; from: string; detail: string },
  ): Promise<void> {
    await this.deps.commandBus.run({
      action: 'crm.opportunity.propagation_skip',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const row = em.create(CrmStatusPropagation, {
          opportunityId,
          orderId: skipped.orderId,
          direction: REVERSE,
          opportunityStatusCode: skipped.opportunityStatusCode,
          orderStatusCode: skipped.orderStatusCode,
          outcome: 'skipped',
          detail: skipped.detail,
          resolvedAt: new Date(),
        });
        return {
          result: undefined,
          before: { status: skipped.from },
          after: {
            status: skipped.from,
            propagationId: row.id,
            orderId: skipped.orderId,
            orderStatusCode: skipped.orderStatusCode,
            skippedStatus: skipped.opportunityStatusCode,
            reason: skipped.detail,
          },
        };
      },
    });
  }

  /**
   * Ask the Order again. The old row is retired and a new one is written
   * `pending` in one Command; the Order is asked after it commits.
   *
   * The Order is asked for what the Opportunity's status maps to **now** — a
   * retry usually follows somebody correcting the mapping or the Order — and
   * for what the retired row asked when the mapping has since been removed.
   */
  async retry(opportunityId: string, propagationId: string): Promise<PropagationOutcome> {
    const freshId = await this.deps.commandBus.run({
      action: 'crm.opportunity.propagation_retry',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, opportunityId);
        const row = await this.#loadRow(em, opportunity.id, propagationId);
        if (!isUnresolved(row)) {
          throw settled('This outcome is already settled and cannot be retried.');
        }
        if (opportunity.statusCode !== row.opportunityStatusCode) {
          throw settled('The opportunity has moved on since this outcome was recorded. Dismiss it instead.');
        }
        const link = await em.findOne(CrmOpportunityLink, {
          opportunityId: opportunity.id,
          documentKind: 'order',
          documentId: row.orderId,
        });
        if (!link || !link.syncStatus) {
          throw settled('The order no longer follows this opportunity. Dismiss this outcome instead.');
        }
        const mapping = await em.findOne(CrmOrderStatusMapping, {
          direction: FORWARD,
          opportunityStatusCode: row.opportunityStatusCode,
        });
        row.dismissedAt = new Date();
        const fresh = em.create(CrmStatusPropagation, {
          opportunityId: opportunity.id,
          orderId: row.orderId,
          direction: FORWARD,
          opportunityStatusCode: row.opportunityStatusCode,
          orderStatusCode: mapping?.orderStatusCode ?? row.orderStatusCode,
          outcome: 'pending',
          statusHistoryId: row.statusHistoryId ?? null,
        });
        return {
          result: fresh.id,
          before: { propagationId: row.id, orderId: row.orderId, outcome: row.outcome },
          after: { propagationId: fresh.id, orderId: fresh.orderId, orderStatusCode: fresh.orderStatusCode },
        };
      },
    });

    const context = getTenantContext();
    const actor: OrderStatusActor =
      context?.actor.kind === 'admin' && context.actor.id
        ? { kind: 'admin', adminUserId: context.actor.id }
        : { kind: 'system' };
    const [outcome] = await this.resolve(opportunityId, [freshId], { actor, reason: null });
    if (!outcome) throw new Error('crm: a retried propagation produced no outcome.');
    return outcome;
  }

  /** Acknowledge a refusal: it stays recorded and stops asking for attention. */
  async dismiss(opportunityId: string, propagationId: string): Promise<void> {
    await this.deps.commandBus.run({
      action: 'crm.opportunity.propagation_dismiss',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, opportunityId);
        const row = await this.#loadRow(em, opportunity.id, propagationId);
        if (!isUnresolved(row)) throw settled('This outcome is already settled.');
        row.dismissedAt = new Date();
        return {
          result: undefined,
          before: { propagationId: row.id, orderId: row.orderId, outcome: row.outcome, dismissed: false },
          after: { propagationId: row.id, orderId: row.orderId, outcome: row.outcome, dismissed: true },
        };
      },
    });
  }

  /** The parent was loaded through the scoped EntityManager; the child is addressed under it. */
  async #loadRow(em: EntityManager, opportunityId: string, propagationId: string): Promise<CrmStatusPropagation> {
    if (!isUuid(propagationId)) throw outcomeNotFound();
    const row = await em.findOne(CrmStatusPropagation, { id: propagationId, opportunityId });
    if (!row) throw outcomeNotFound();
    return row;
  }

  /** Step 2: one Order, asked through `orders`' own transition seam. */
  async #ask(
    row: CrmStatusPropagation,
    request: { actor: OrderStatusActor; reason: string | null },
  ): Promise<{ outcome: CrmPropagationOutcome; detail: string | null }> {
    try {
      const answer = await this.deps.orderTransitions.applyStatus({
        orderId: row.orderId,
        to: row.orderStatusCode,
        actor: request.actor,
        reason: request.reason,
      });
      if (answer.applied) return { outcome: 'applied', detail: null };
      if (answer.reason === 'already_there') return { outcome: 'already_there', detail: null };
      return { outcome: answer.reason, detail: answer.detail };
    } catch (error) {
      // A module switched off is a statement about the platform, never an
      // outcome: it surfaces as the 503 it is, and the row stays `pending` for
      // a retry to consume.
      rethrowIfModuleDisabled(error);
      // Everything else is tolerated narrowly and on purpose. The Opportunity
      // has already committed and the other Orders are still owed their turn,
      // so a call that did not return an answer is recorded as `failed`, with
      // what it said, and shown — the alternative is a moved Opportunity whose
      // Orders were never asked and nothing saying so.
      return { outcome: 'failed', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Step 3. A Command, so the write is on the one audited path; not audited as
   * an entry of its own, because it is the second half of a transition (or of a
   * retry) that already has one, and `orders` audits the Order's own change.
   */
  async #record(
    opportunityId: string,
    propagationId: string,
    answer: { outcome: CrmPropagationOutcome; detail: string | null },
  ): Promise<CrmStatusPropagation> {
    return this.deps.commandBus.run({
      action: 'crm.opportunity.propagation_record',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const row = await em.findOneOrFail(CrmStatusPropagation, { id: propagationId, opportunityId });
        row.outcome = answer.outcome;
        row.detail = answer.detail;
        row.resolvedAt = new Date();
        return { result: row, skipAudit: true };
      },
    });
  }

  async #render(rows: readonly CrmStatusPropagation[]): Promise<PropagationOutcome[]> {
    if (rows.length === 0) return [];
    const orders = await this.deps.orders.findByIds([...new Set(rows.map((row) => row.orderId))]);
    const numbers = new Map(orders.map((order) => [order.id, order.businessId]));
    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNumber: numbers.get(row.orderId) ?? null,
      direction: row.direction,
      orderStatusCode: row.orderStatusCode,
      // A row still `pending` here is one that never finished: it is shown as
      // the failure it is, and a retry consumes it.
      outcome: row.outcome === 'pending' ? 'failed' : row.outcome,
      detail: row.detail ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
