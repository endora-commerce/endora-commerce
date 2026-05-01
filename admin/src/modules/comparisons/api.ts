import { apiClient } from '@/lib/api-client';
import type {
  ComparisonAdminDetail,
  ComparisonAdminListItem,
  ComparisonAdminListQuery,
} from '@b2b/contracts';

/**
 * Admin client helpers for the Comparisons overview (feature 007 / US5
 * / T066). Maps query filters to the backend's GET surface and unwraps
 * the standard `{ data, meta }` envelope.
 */

export interface ListResult {
  data: ComparisonAdminListItem[];
  meta: { limit: number; nextCursor: string | null };
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
