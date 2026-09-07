import { apiClient } from '../api-client.js';
import type { GetAdminActionsResponse, SupportedAdminLanguage } from '@endora-commerce/contracts';

/**
 * Fetch the operator-visible action list for the requested language.
 *
 * Mirrors feature 019's bare-fetch helper — no React Query / SWR
 * wrapper at this layer; the AdminActionsProvider owns caching and
 * lifecycle invalidation.
 */
export async function getAdminActions(
  language: SupportedAdminLanguage,
): Promise<GetAdminActionsResponse> {
  const res = await apiClient.get<{ data: GetAdminActionsResponse }>(
    `/api/v1/admin/admin-actions?language=${encodeURIComponent(language)}`,
  );
  return res.data;
}
