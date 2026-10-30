import {
  AdminSearchCapabilitySchema,
  AdminSearchResponseSchema,
  type AdminSearchCapability,
  type AdminSearchResponse,
  type SupportedAdminLanguage,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * The admin global search endpoints (`specs/150-admin-global-search/`), as the
 * shell's palette reads them. Module-agnostic on purpose: the shell names an
 * endpoint and parses a contract, and holds no module id and no module bundle
 * — group titles, results and statuses arrive resolved in the admin's
 * language (research R-8). A failed or refused probe (503 while global search
 * is switched off, 404 where it is not installed) is the caller's answer to
 * "no records in this open".
 */
const BASE = '/api/v1/admin/global-search';

export async function getAdminSearchCapability(
  language: SupportedAdminLanguage,
  signal?: AbortSignal,
): Promise<AdminSearchCapability> {
  const res = await apiClient.get<{ data: unknown }>(
    `${BASE}/capability?language=${encodeURIComponent(language)}`,
    signal ? { signal } : {},
  );
  return AdminSearchCapabilitySchema.parse(res.data);
}

export interface AdminSearchRecordsQuery {
  readonly q: string;
  readonly language: SupportedAdminLanguage;
  readonly limit?: number;
  readonly entityTypes?: readonly string[];
}

export async function searchAdminRecords(
  query: AdminSearchRecordsQuery,
  signal?: AbortSignal,
): Promise<AdminSearchResponse> {
  const params = new URLSearchParams({ q: query.q, language: query.language });
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.entityTypes && query.entityTypes.length > 0) params.set('entityTypes', query.entityTypes.join(','));
  const res = await apiClient.get<unknown>(`${BASE}?${params.toString()}`, signal ? { signal } : {});
  return AdminSearchResponseSchema.parse(res);
}
