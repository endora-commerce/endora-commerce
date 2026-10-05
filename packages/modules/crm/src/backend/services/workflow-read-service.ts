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
    const [counts, mappings, counting] = await Promise.all([
      this.statusUsageCounts(em),
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
        // Whether the Order status still exists is the reverse-mapping story's
        // to answer (tasks.md T059). No mapping can exist before the
        // configuration endpoints land, so nothing reads this value yet.
        orderStatusKnown: true,
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
