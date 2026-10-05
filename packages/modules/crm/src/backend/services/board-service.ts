import { raw, type FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type OpportunityBoard,
  type OpportunityBoardColumn,
  type OpportunityBoardQuery,
  type OpportunityCurrencyTotal,
  type OpportunityListQuery,
  type OpportunitySummary,
  type OrganizationDetailsPort,
  type Pagination,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { resolveOpportunityStatusName } from '../domain/opportunity-status-graph.js';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import type { WorkflowReadService } from './workflow-read-service.js';

export interface BoardServiceDeps {
  emFactory: () => EntityManager;
  workflowRead: WorkflowReadService;
  /**
   * The list, asked once per column for that status's first cards. The board
   * does not render an Opportunity itself: a card is the list's own summary, in
   * the list's own order, which is what lets the Admin UI continue a column
   * from the list endpoint.
   */
  listOpportunities: (
    query: OpportunityListQuery,
  ) => Promise<{ data: OpportunitySummary[]; pagination: Pagination }>;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  organizations: OrganizationDetailsPort;
  adminUsers: AdminUserReadPort;
}

const FALLBACK_LANGUAGE = 'en';

/** The effective value of a row, as the list's `sort=value` computes it. */
const VALUE_EXPRESSION = (alias: string): string =>
  `case when ${alias}."value_mode" = 'manual' then ${alias}."manual_value" else ${alias}."computed_value" end`;

interface ColumnAggregateRow {
  status_code: string;
  currency: string;
  count: number | string;
  total: string;
}

/**
 * The board (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §10):
 * one column per status of the workflow, in the workflow's order, with the
 * number of Opportunities in it, their value per currency and its first cards.
 *
 * **Two reads per answer, on purpose.** The cards of a column come from the
 * list (one call per status, `perColumn` cards each); the count and the totals
 * of *every* column come from one grouped statement, because a column's figures
 * are about all of its Opportunities and not about the cards on screen.
 *
 * **Tenant scope is the entity filter's, in both.** The list reads through the
 * scoped EntityManager. The grouped statement is a QueryBuilder over
 * `CrmOpportunity`, which the filter does not reach by itself — so
 * `applyFilters()` is called on it, and the predicate is the platform's, never
 * one written here. An Opportunity the caller cannot reach is in no column and
 * in no count.
 *
 * **The filters are stated twice** — in the list for the cards and here for the
 * figures — and the contract test holds the two to the same answers. The
 * assignee and tag filters are refused here as the list refuses them
 * (`research.md` N-18): the stories that teach the list to apply them add them
 * to {@link BoardService.conditions} in the same change.
 */
export class BoardService {
  constructor(private readonly deps: BoardServiceDeps) {}

  async get(query: OpportunityBoardQuery): Promise<OpportunityBoard> {
    if (query.assignedAdminUserId !== undefined || (query.tagId && query.tagId.length > 0)) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Filtering opportunities by assignee or by tag is not available yet.',
      );
    }
    const em = this.deps.emFactory();
    const { perColumn, ...filters } = query;
    const [graph, conditions, language] = await Promise.all([
      this.deps.workflowRead.loadGraph(em),
      this.conditions(query),
      this.viewerLanguage(),
    ]);
    const figures = await this.figures(em, conditions);

    const columns: OpportunityBoardColumn[] = [];
    // One status after another: a board is a handful of columns, and asking for
    // all of them at once would take that many connections from the pool for
    // one request.
    for (const status of [...graph.statuses].sort(
      (a, b) => a.weight - b.weight || a.code.localeCompare(b.code),
    )) {
      const page = await this.deps.listOpportunities({
        ...filters,
        statusCode: [status.code],
        limit: perColumn,
      });
      const figure = figures.get(status.code);
      columns.push({
        status: {
          code: status.code,
          name:
            status.name[language] ??
            resolveOpportunityStatusName(status, language.split('-')[0] ?? language),
          color: status.color,
          kind: status.kind,
        },
        count: figure?.count ?? 0,
        valueTotals: figure?.valueTotals ?? [],
        items: page.data,
        hasMore: page.pagination.hasMore,
      });
    }
    return { columns };
  }

  /**
   * The board's filters as conditions on `CrmOpportunity` — the same five the
   * list applies, in the same terms.
   */
  private async conditions(query: OpportunityBoardQuery): Promise<FilterQuery<CrmOpportunity>[]> {
    const conditions: FilterQuery<CrmOpportunity>[] = [];
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
      const organizationIds = await this.deps.organizations.searchIdsByName(query.q);
      conditions.push({
        $or: [
          { title: { $ilike: like } },
          { number: { $ilike: like } },
          ...(organizationIds.length > 0 ? [{ organizationId: { $in: organizationIds } }] : []),
        ],
      });
    }
    if (query.organizationId) conditions.push({ organizationId: query.organizationId });
    if (query.salesChannelId) conditions.push({ salesChannelId: query.salesChannelId });
    if (query.createdFrom) {
      conditions.push({ createdAt: { $gte: new Date(`${query.createdFrom}T00:00:00.000Z`) } });
    }
    if (query.createdTo) {
      // Inclusive of the whole day named.
      const end = new Date(`${query.createdTo}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      conditions.push({ createdAt: { $lt: end } });
    }
    return conditions;
  }

  /** Per status: how many Opportunities match, and what they are worth per currency. */
  private async figures(
    em: EntityManager,
    conditions: FilterQuery<CrmOpportunity>[],
  ): Promise<Map<string, { count: number; valueTotals: OpportunityCurrencyTotal[] }>> {
    const qb = em
      .createQueryBuilder(CrmOpportunity, 'o')
      .select([
        'o.statusCode',
        'o.currency',
        raw('count(*)::int as "count"'),
        raw(`coalesce(sum(${VALUE_EXPRESSION('o')}), 0)::numeric(16,2)::text as "total"`),
      ])
      .where(conditions.length > 0 ? { $and: conditions } : {})
      .groupBy(['o.statusCode', 'o.currency'])
      .orderBy({ statusCode: 'asc', currency: 'asc' });
    // The tenant predicate. A QueryBuilder does not take the entity filters on
    // its own; without this line the figures would be platform-wide.
    await qb.applyFilters();
    const rows = (await qb.execute('all', false)) as ColumnAggregateRow[];

    const figures = new Map<string, { count: number; valueTotals: OpportunityCurrencyTotal[] }>();
    for (const row of rows) {
      const figure = figures.get(row.status_code) ?? { count: 0, valueTotals: [] };
      const count = Number(row.count);
      figure.count += count;
      // A currency whose Opportunities carry no value yet has nothing to total.
      if (Number(row.total) !== 0)
        figure.valueTotals.push({ currency: row.currency, total: row.total });
      figures.set(row.status_code, figure);
    }
    return figures;
  }

  /**
   * The language a column's name is resolved in — the acting administrator's
   * stored preference, as the list resolves a card's status name.
   */
  private async viewerLanguage(): Promise<string> {
    const actor = getTenantContext()?.actor;
    if (actor?.kind !== 'admin' || !actor.id) return FALLBACK_LANGUAGE;
    const admin = await this.deps.adminUsers.findById(actor.id);
    return admin?.preferredLanguage ?? FALLBACK_LANGUAGE;
  }
}
