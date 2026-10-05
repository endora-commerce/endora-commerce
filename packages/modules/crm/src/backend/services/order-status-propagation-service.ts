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
 * The forward direction of status following: an Opportunity's transition asks
 * its linked Orders to move (`specs/143-crm-sales-opportunities/research.md`
 * R-4).
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
