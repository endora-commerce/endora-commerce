import type {
  ChannelMemberEntityType,
  SalesChannelCreateBody,
  SalesChannelDetail,
  SalesChannelListResponse,
  SalesChannelSummary,
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

  // -- Membership routes (Phase 5b) ---------------------------------------

  /** List entity ids of `entityType` that belong to `code`. */
  listEntitiesInChannel(
    code: string,
    entityType: ChannelMemberEntityType,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{
    salesChannelCode: string;
    entityType: ChannelMemberEntityType;
    entityIds: string[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const qs = new URLSearchParams();
    if (options.page !== undefined) qs.set('page', String(options.page));
    if (options.pageSize !== undefined) qs.set('pageSize', String(options.pageSize));
    const tail = qs.toString();
    return apiClient.get(
      `/api/v1/admin/sales-channels/${encodeURIComponent(code)}/${entityType}${tail ? `?${tail}` : ''}`,
    );
  },

  /** List the channels an entity belongs to. */
  listChannelsForEntity(
    entityType: ChannelMemberEntityType,
    entityId: string,
  ): Promise<{
    entityType: ChannelMemberEntityType;
    entityId: string;
    channels: SalesChannelSummary[];
  }> {
    return apiClient.get(
      `/api/v1/admin/sales-channels/by-entity/${entityType}/${encodeURIComponent(entityId)}`,
    );
  },

  /** Idempotent — re-adding an existing membership returns `changed: false`. */
  addEntityToChannel(
    code: string,
    entityType: ChannelMemberEntityType,
    entityId: string,
  ): Promise<{ changed: boolean }> {
    return apiClient.put(
      `/api/v1/admin/sales-channels/${encodeURIComponent(code)}/${entityType}/${encodeURIComponent(entityId)}`,
      {},
    );
  },

  /**
   * Remove a membership. With `fallbackToDefault=false` (default), removing
   * the entity's last channel returns 422 ENTITY_WOULD_HAVE_ZERO_CHANNELS;
   * with `true`, the entity is rebound to the system default in one
   * transaction.
   */
  removeEntityFromChannel(
    code: string,
    entityType: ChannelMemberEntityType,
    entityId: string,
    options: { fallbackToDefault?: boolean } = {},
  ): Promise<{ changed: boolean; fallbackAppliedToDefault: boolean }> {
    const qs = options.fallbackToDefault ? `?fallbackToDefault=true` : '';
    return apiClient.delete(
      `/api/v1/admin/sales-channels/${encodeURIComponent(code)}/${entityType}/${encodeURIComponent(entityId)}${qs}`,
    );
  },
};
