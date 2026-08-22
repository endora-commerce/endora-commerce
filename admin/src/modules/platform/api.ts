import type { ModuleListResponse } from '@endora-commerce/contracts';
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
