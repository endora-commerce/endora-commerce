import type {
  ModuleListResponse,
  RecentActivityVisibilityList,
  RecentActivityVisibilityResponse,
} from '@endora-commerce/contracts';
import { apiClient } from '@/lib/api-client';

/**
 * The platform axis, as the lifecycle orchestrator sees it — registered vs
 * on-disk version, registry state, dependency and orphan flags.
 *
 * Gated on `platform.modules.read`. The effective projection this screen pairs
 * it with (`/admin/module-presence`) carries no permission code, because every
 * admin needs that one to render their own navigation.
 */
export async function listModules(): Promise<ModuleListResponse> {
  return apiClient.get<ModuleListResponse>('/api/v1/admin/modules');
}

/**
 * The second per-module operator axis this screen carries — feature 080, T042j
 * / D-163.1: which eligible modules' entries reach the home dashboard's Recent
 * Activity card.
 *
 * It is a different question from activation ("does this client want this
 * capability at all") and it lives here for the reason D-163.1 gives: the
 * switch is the operator's and belongs in the surface they already use for
 * per-module choices. Only modules whose manifest declares eligibility appear
 * — a module author declares, an operator decides.
 *
 * Gated on `platform.modules.activate`, the same code as the activation write,
 * so an admin who sees one control sees both or neither.
 */
export async function listRecentActivityVisibility(): Promise<RecentActivityVisibilityList> {
  return apiClient.get<RecentActivityVisibilityList>(
    '/api/v1/admin/audit-log/recent-activity/visibility',
  );
}

export async function setRecentActivityVisibility(
  moduleId: string,
  visible: boolean,
): Promise<RecentActivityVisibilityResponse> {
  return apiClient.post<RecentActivityVisibilityResponse>(
    `/api/v1/admin/audit-log/recent-activity/visibility/${encodeURIComponent(moduleId)}`,
    { visible },
  );
}
