import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  OpportunityAverageValueRow,
  OpportunityHandlingTime,
  OpportunityRepEffectivenessRow,
  OpportunitySummary,
  OpportunityTimeInStatusRow,
} from '@endora-commerce/contracts';

/**
 * The five reads of the analytics screen
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12), each gated
 * `crm:analytics`.
 *
 * A file of its own beside `api.ts`: the screen is the only caller, and it is
 * the only CRM screen that opens on this permission.
 */

const BASE = '/api/v1/admin/crm/analytics';

/** What every figure is computed over. Dates are `YYYY-MM-DD`, both included. */
export interface AnalyticsFilters {
  from: string;
  to: string;
  salesChannelId: string | null;
  assignedAdminUserId: string | null;
}

export type TopOpportunitiesBasis = 'created' | 'closed';

function query(filters: AnalyticsFilters, extra: ReadonlyArray<readonly [string, string]> = []): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.salesChannelId) params.set('salesChannelId', filters.salesChannelId);
  if (filters.assignedAdminUserId) params.set('assignedAdminUserId', filters.assignedAdminUserId);
  for (const [key, value] of extra) params.append(key, value);
  return params.toString();
}

async function read<T>(path: string): Promise<T> {
  return (await apiClient.get<{ data: T }>(path)).data;
}

export const crmAnalyticsApi = {
  /** Creation to closing, over the Opportunities closed in the range. */
  handlingTime(filters: AnalyticsFilters): Promise<OpportunityHandlingTime> {
    return read(`${BASE}/handling-time?${query(filters)}`);
  },

  /** One row per status asked for — or per status of the workflow when none is. */
  timeInStatus(
    filters: AnalyticsFilters,
    statusCodes: readonly string[],
  ): Promise<OpportunityTimeInStatusRow[]> {
    return read(
      `${BASE}/time-in-status?${query(
        filters,
        statusCodes.map((code) => ['statusCode', code] as const),
      )}`,
    );
  },

  /** Won Opportunities per calendar month and assignee. */
  repEffectiveness(filters: AnalyticsFilters): Promise<OpportunityRepEffectivenessRow[]> {
    return read(`${BASE}/rep-effectiveness?${query(filters)}`);
  },

  /** The highest effective values, `limit` per currency, ordered by currency. */
  topOpportunities(
    filters: AnalyticsFilters,
    basis: TopOpportunitiesBasis,
    limit: number,
  ): Promise<OpportunitySummary[]> {
    return read(
      `${BASE}/top-opportunities?${query(filters, [
        ['basis', basis],
        ['limit', String(limit)],
      ])}`,
    );
  },

  /** Per currency, over the Opportunities created in the range. */
  averageValue(filters: AnalyticsFilters): Promise<OpportunityAverageValueRow[]> {
    return read(`${BASE}/average-value?${query(filters)}`);
  },
};
