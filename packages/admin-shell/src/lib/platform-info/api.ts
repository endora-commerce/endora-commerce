import type { PlatformInfo } from '@endora-commerce/contracts';
import { apiClient } from '../api-client.js';

/**
 * Which Endora Commerce release the API is — the version of the
 * `@endora-commerce/platform` package the serving process loaded.
 *
 * Any signed-in admin may read it; there is no permission code. A bare fetch,
 * like the other clients in this application: the hook owns the state.
 */
export async function getPlatformInfo(): Promise<PlatformInfo> {
  return apiClient.get<PlatformInfo>('/api/v1/admin/platform-info');
}
