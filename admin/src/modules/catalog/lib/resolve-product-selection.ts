import { apiClient } from '@/lib/api-client';

export interface ListFilterSnapshot {
  status: 'all' | 'active' | 'draft' | 'inactive';
  type: 'all' | 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
  q: string;
}

interface ResolveProductIdsResponse {
  data: { productIds: string[]; total: number };
}

/**
 * Feature 033 — resolve all product ids for the frozen list filter snapshot.
 */
export async function resolveProductSelection(
  snapshot: ListFilterSnapshot,
): Promise<{ productIds: string[]; total: number }> {
  const body: Record<string, unknown> = { includeArchived: true };
  if (snapshot.status !== 'all') body['status'] = snapshot.status;
  if (snapshot.type !== 'all') body['type'] = snapshot.type;
  const trimmed = snapshot.q.trim();
  if (trimmed) body['q'] = trimmed;

  const res = await apiClient.post<ResolveProductIdsResponse>(
    '/api/v1/admin/catalog/products/resolve-ids',
    body,
  );
  return res.data;
}

export const BULK_EDIT_MAX_BATCH_SIZE = 200;
