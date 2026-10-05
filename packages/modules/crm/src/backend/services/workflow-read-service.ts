import type { EntityManager } from '@mikro-orm/postgresql';
import type { OpportunityWorkflow } from '@endora-commerce/contracts';
import { orgConstraintFor } from '@endora-commerce/platform/tenancy';
import { OpportunityStatusGraph } from '../domain/opportunity-status-graph.js';
import { CrmOpportunityStatus } from '../entities/crm-opportunity-status.entity.js';
import { CrmOpportunityStatusTransition } from '../entities/crm-opportunity-status-transition.entity.js';
import { CrmOrderStatusMapping } from '../entities/crm-order-status-mapping.entity.js';
import { CrmValueCountingStatus } from '../entities/crm-value-counting-status.entity.js';
import { opportunityStatusUsageQuery } from './opportunity-status-usage.js';

/**
 * Reads of the configured Opportunity workflow.
 *
 * **No cache.** The graph is loaded per operation — two small queries, at
 * hundreds of Opportunities per month. The Order lifecycle caches its graph in
 * process and its own header records cross-process invalidation as unpaid
 * work; loading every time means there is no invalidation to design.
 */
export class WorkflowReadService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /** The configured statuses and transitions, as the pure graph. */
  async loadGraph(em: EntityManager = this.emFactory()): Promise<OpportunityStatusGraph> {
    const [statuses, transitions] = await Promise.all([
      em.find(CrmOpportunityStatus, {}, { orderBy: { weight: 'asc', code: 'asc' } }),
      em.find(CrmOpportunityStatusTransition, {}, {
        orderBy: { fromStatusCode: 'asc', toStatusCode: 'asc' },
      }),
    ]);
    return new OpportunityStatusGraph(
      statuses.map((status) => ({
        code: status.code,
        name: status.name,
        defaultName: status.defaultName,
        kind: status.kind,
        isInitial: status.isInitial,
        weight: status.weight,
        color: status.color,
      })),
      transitions.map((transition) => ({
        fromStatusCode: transition.fromStatusCode,
        toStatusCode: transition.toStatusCode,
      })),
    );
  }

  /** The whole workflow configuration, with each status's in-use count. */
  async getWorkflow(): Promise<OpportunityWorkflow> {
    const em = this.emFactory();
    const graph = await this.loadGraph(em);
    const [counts, unknownOrderStatuses, mappings, counting] = await Promise.all([
      this.statusUsageCounts(em),
      this.orderStatusesRefusedAsUnknown(em),
      em.find(CrmOrderStatusMapping, {}, {
        orderBy: { direction: 'asc', opportunityStatusCode: 'asc', orderStatusCode: 'asc' },
      }),
      em.find(CrmValueCountingStatus, {}, { orderBy: { statusCode: 'asc' } }),
    ]);
    return {
      statuses: graph.statuses.map((status) => ({
        ...status,
        inUseCount: counts.get(status.code) ?? 0,
      })),
      transitions: graph.transitions.map((transition) => ({ ...transition })),
      orderStatusMappings: mappings.map((mapping) => ({
        direction: mapping.direction,
        opportunityStatusCode: mapping.opportunityStatusCode,
        orderStatusCode: mapping.orderStatusCode,
        requireAllOrders: mapping.requireAllOrders,
        orderStatusKnown: !unknownOrderStatuses.has(mapping.orderStatusCode),
      })),
      valueCountingStatuses: {
        order: counting.filter((row) => row.documentKind === 'order').map((row) => row.statusCode),
        quoteRequest: counting
          .filter((row) => row.documentKind === 'quote_request')
          .map((row) => row.statusCode),
      },
    };
  }

  /**
   * The Order status codes the Orders module itself has most recently refused
   * as unknown — which is everything this module can truthfully say about
   * `orderStatusKnown`.
   *
   * `orders` publishes no read that lists or tests a configured status code,
   * and its tables are not this module's to read. What CRM does hold is the
   * Orders transition port's own answers, one per Order it asked: for each
   * Order status a forward mapping requested, the latest answer that says
   * anything about the *status* (`not_found` and `failed` are about the Order
   * or the call) is either `unknown_status` or evidence that the status
   * exists. A code nobody has asked for yet is taken as known; the admin
   * screen, which fetches the Orders API's own status list for its picker, can
   * tell sooner (`specs/143-crm-sales-opportunities/research.md`, N-B1).
   *
   * Platform-wide on purpose, and raw for that reason: the answer is a fact
   * about the Order workflow, which is not any Organization's, and it carries
   * nothing of the Opportunity that produced it.
   */
  private async orderStatusesRefusedAsUnknown(em: EntityManager): Promise<Set<string>> {
    const rows = (await em.execute(
      `select distinct on ("order_status_code") "order_status_code", "outcome"
         from "crm_status_propagations"
        where "direction" = 'opportunity_to_order'
          and "outcome" in ('applied', 'already_there', 'not_permitted', 'vetoed', 'unknown_status')
        order by "order_status_code", "created_at" desc`,
    )) as Array<{ order_status_code: string; outcome: string }>;
    return new Set(rows.filter((row) => row.outcome === 'unknown_status').map((row) => row.order_status_code));
  }

  /**
   * Opportunities per status, confined to the Organizations the reader
   * reaches: the statement is raw, so the entity filter does not apply to it
   * (`opportunity-status-usage.ts`). `em.execute`, not a knex handle — a knex
   * handle takes its own pooled connection and would read from outside a
   * transaction the caller holds open.
   */
  private async statusUsageCounts(em: EntityManager): Promise<Map<string, number>> {
    const query = opportunityStatusUsageQuery(orgConstraintFor());
    if (query === null) return new Map();
    const rows = (await em.execute(query.sql, query.params)) as Array<{
      status_code: string;
      count: string;
    }>;
    return new Map(rows.map((row) => [row.status_code, Number(row.count)]));
  }
}
