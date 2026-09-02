import type {
  CreatePushMessageRequest,
  CreatePushMessageResponse,
  PwaAdminConfig,
  PwaIconUploadResponse,
  PushSubscriptionStats,
  UpdatePwaConfigRequest,
  VapidKeyPairResponse,
} from '@endora-commerce/contracts';
import { apiBaseUrl, apiClient } from '@endora-commerce/admin-kit/lib';
/**
 * Typed wrapper around `/api/v1/admin/pwa/*` (feature 046). Source-of-truth
 * schemas live in `@endora-commerce/contracts`. Icon upload uses a raw `fetch` because the
 * shared JSON api-client does not send multipart bodies.
 */

/**
 * The API origin the multipart upload posts to.
 *
 * It read `import.meta.env.VITE_API_BASE_URL` with a `http://localhost:3001`
 * fallback until feature 091's batch 10 moved this file into the package —
 * a second copy of the two-branch resolution `apiClient` is already built from,
 * and one this package's `tsconfig.ui.json` cannot compile, because it carries
 * no `vite/client` types. Deliberately: a screen that reaches for the bundler's
 * environment is reaching past the seam. This is the same repair batch 8 made
 * to `SeoPage` and batch 9 to `AssetDetailDrawer`.
 */
const baseUrl = apiBaseUrl;

function channelQuery(salesChannelId: string | null): string {
  return salesChannelId ? `?salesChannelId=${encodeURIComponent(salesChannelId)}` : '';
}

export const pwaClient = {
  getConfig(salesChannelId: string | null = null): Promise<PwaAdminConfig> {
    return apiClient.get<PwaAdminConfig>(`/api/v1/admin/pwa/config${channelQuery(salesChannelId)}`);
  },

  updateConfig(body: UpdatePwaConfigRequest): Promise<{ updated: number }> {
    return apiClient.put<{ updated: number }>(`/api/v1/admin/pwa/config`, body);
  },

  resetConfig(salesChannelId: string): Promise<{ reset: number }> {
    return apiClient.post<{ reset: number }>(`/api/v1/admin/pwa/config/reset`, { salesChannelId });
  },

  generateVapid(): Promise<VapidKeyPairResponse> {
    return apiClient.post<VapidKeyPairResponse>(`/api/v1/admin/pwa/vapid/generate`, {});
  },

  getSubscriptionStats(salesChannelId: string | null = null): Promise<PushSubscriptionStats> {
    return apiClient.get<PushSubscriptionStats>(
      `/api/v1/admin/pwa/subscriptions${channelQuery(salesChannelId)}`,
    );
  },

  sendMessage(body: CreatePushMessageRequest): Promise<CreatePushMessageResponse> {
    return apiClient.post<CreatePushMessageResponse>(`/api/v1/admin/pwa/messages`, body);
  },

  async uploadIcon(file: File, salesChannelId: string | null = null): Promise<PwaIconUploadResponse> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${baseUrl}/api/v1/admin/pwa/icon${channelQuery(salesChannelId)}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `Icon upload failed (${res.status})`);
    }
    return (await res.json()) as PwaIconUploadResponse;
  },
};
