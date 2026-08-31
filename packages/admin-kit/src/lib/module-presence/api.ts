import type {
  AdminModulePresenceResponse,
  ModuleActivationResponse,
} from '@endora-commerce/contracts';
// `../api-client.js`, not the `./lib` barrel the P2 components take it from.
// That rule is about a collaborator a test outside the package substitutes, and
// it cannot reach a file the barrel itself exports: measured in P3, a member
// importing `../index.js` under a `vi.mock` factory that calls `importActual`
// resolves to the **real** module — the stub is bypassed and the request goes
// out for real. The seam for this provider is its `initial` prop instead.
import { apiClient } from '../api-client.js';

/**
 * The effective enabled-set, as the server computed it — feature 073.
 *
 * Deliberately a bare fetch, mirroring the admin-actions client: the provider
 * owns caching and refresh, and there is no React Query / SWR layer in this app.
 */
export async function getModulePresence(): Promise<AdminModulePresenceResponse> {
  return apiClient.get<AdminModulePresenceResponse>('/api/v1/admin/module-presence');
}

/**
 * Flip one module's operator activation. The audited Command behind this
 * endpoint is the only door: the ordinary settings write path refuses an
 * activation code.
 */
export async function setModuleActivation(
  moduleId: string,
  active: boolean,
): Promise<ModuleActivationResponse> {
  return apiClient.post<ModuleActivationResponse>(
    `/api/v1/admin/modules/${encodeURIComponent(moduleId)}/activation`,
    { active },
  );
}
