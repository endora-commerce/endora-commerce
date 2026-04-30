import type {
  SalesChannelCreateBody,
  SalesChannelDetail,
  SalesChannelListResponse,
  SalesChannelUpdateBody,
} from '@b2b/contracts';
import { apiClient } from '@/lib/api-client';

/**
 * Typed wrapper around `/api/v1/admin/sales-channels/*` — feature 005 / T038.
 * Source-of-truth schemas live in `@b2b/contracts`.
 *
 * Optimistic concurrency for PATCH rides on the body's `expectedVersion`
 * field (matches feature 003/004); the response's ETag is also exposed
 * for completeness so a future refactor to `If-Match` is one-line away.
 */

export interface ListOptions {
  page?: number;
  pageSize?: number;
  activeOnly?: boolean;
}

export const salesChannelsClient = {
  list(options: ListOptions = {}): Promise<SalesChannelListResponse> {
    const qs = new URLSearchParams();
    if (options.page !== undefined) qs.set('page', String(options.page));
    if (options.pageSize !== undefined) qs.set('pageSize', String(options.pageSize));
    if (options.activeOnly !== undefined) qs.set('activeOnly', String(options.activeOnly));
    const tail = qs.toString();
    return apiClient.get<SalesChannelListResponse>(
      `/api/v1/admin/sales-channels${tail ? `?${tail}` : ''}`,
    );
  },

  getByCode(code: string): Promise<SalesChannelDetail> {
    return apiClient.get<SalesChannelDetail>(
      `/api/v1/admin/sales-channels/${encodeURIComponent(code)}`,
    );
  },

  create(body: SalesChannelCreateBody): Promise<SalesChannelDetail> {
    return apiClient.post<SalesChannelDetail>('/api/v1/admin/sales-channels', body);
  },

  update(
    code: string,
    body: SalesChannelUpdateBody & { expectedVersion: number },
  ): Promise<SalesChannelDetail> {
    return apiClient.patch<SalesChannelDetail>(
      `/api/v1/admin/sales-channels/${encodeURIComponent(code)}`,
      body,
    );
  },

  deactivate(code: string): Promise<SalesChannelDetail> {
    return apiClient.post<SalesChannelDetail>(
      `/api/v1/admin/sales-channels/${encodeURIComponent(code)}/deactivate`,
      {},
    );
  },

  activate(code: string): Promise<SalesChannelDetail> {
    return apiClient.post<SalesChannelDetail>(
      `/api/v1/admin/sales-channels/${encodeURIComponent(code)}/activate`,
      {},
    );
  },

  delete(code: string, options: { fallbackToDefault?: boolean } = {}): Promise<void> {
    const qs = options.fallbackToDefault
      ? `?fallbackToDefault=true`
      : '';
    return apiClient.delete<void>(
      `/api/v1/admin/sales-channels/${encodeURIComponent(code)}${qs}`,
    );
  },
};
