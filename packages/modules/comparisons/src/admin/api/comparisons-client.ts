import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  ComparisonAdminDetail,
  ComparisonAdminListItem,
  ComparisonAdminListQuery,
  ScopeNoticeCode,
} from '@endora-commerce/contracts';

/**
 * Admin client helpers for the Comparisons overview (feature 007 / US5
 * / T066). Maps query filters to the backend's GET surface and unwraps
 * the standard `{ data, meta }` envelope.
 */

export interface ListResult {
  data: ComparisonAdminListItem[];
  meta: {
    limit: number;
    nextCursor: string | null;
    /**
     * Present only when the server refused every row for want of an
     * organization on the record (feature 087). Read it with `scopeNoticeOf`
     * rather than by hand — the shape is the contract's, not this screen's.
     */
    scopeNotice?: ScopeNoticeCode;
  };
}

export async function listComparisons(
  filters: Partial<ComparisonAdminListQuery>,
): Promise<ListResult> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return apiClient.get<ListResult>(
    `/api/v1/admin/comparisons${qs ? `?${qs}` : ''}`,
  );
}

export async function getComparisonDetail(
  id: string,
): Promise<{ data: ComparisonAdminDetail }> {
  return apiClient.get<{ data: ComparisonAdminDetail }>(
    `/api/v1/admin/comparisons/${encodeURIComponent(id)}`,
  );
}
