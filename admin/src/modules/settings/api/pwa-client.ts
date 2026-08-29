import type {
  CreatePushMessageRequest,
  CreatePushMessageResponse,
  PwaAdminConfig,
  PwaIconUploadResponse,
  PushSubscriptionStats,
  UpdatePwaConfigRequest,
  VapidKeyPairResponse,
} from '@endora-commerce/contracts';
import { apiClient } from '@/lib/api-client';

/**
 * Typed wrapper around `/api/v1/admin/pwa/*` (feature 046). Source-of-truth
 * schemas live in `@endora-commerce/contracts`. Icon upload uses a raw `fetch` because the
 * shared JSON api-client does not send multipart bodies.
 */

const baseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

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
