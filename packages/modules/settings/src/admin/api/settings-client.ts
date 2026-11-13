import type {
  CacheNamespacesResponse,
  ClearCacheRequest,
  ClearCacheResult,
  SearchReindexResponse,
  SetValueRequest,
  SettingDto,
  SettingGroupRowsResponse,
  SettingGroupSummaryDto,
  SettingsListResponse,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
/**
 * Typed wrapper around `/api/v1/admin/settings/*`.
 * Source-of-truth schemas live in `@endora-commerce/contracts`.
 */

export const settingsClient = {
  list(filter?: { groupCode?: string }): Promise<SettingsListResponse> {
    const qs = filter?.groupCode ? `?groupCode=${encodeURIComponent(filter.groupCode)}` : '';
    return apiClient.get<SettingsListResponse>(`/api/v1/admin/settings${qs}`);
  },

  getByCode(code: string): Promise<SettingDto> {
    return apiClient.get<SettingDto>(`/api/v1/admin/settings/${encodeURIComponent(code)}`);
  },

  setValue(code: string, body: SetValueRequest & { expectedVersion?: string }): Promise<SettingDto> {
    return apiClient.put<SettingDto>(
      `/api/v1/admin/settings/${encodeURIComponent(code)}/value`,
      body,
    );
  },

  resetValues(code: string, channelCodes?: string[]): Promise<SettingDto> {
    const qs = channelCodes && channelCodes.length > 0
      ? `?salesChannelCodes=${encodeURIComponent(channelCodes.join(','))}`
      : '';
    return apiClient.delete<SettingDto>(
      `/api/v1/admin/settings/${encodeURIComponent(code)}/values${qs}`,
    );
  },

  listGroupsOnly(): Promise<SettingGroupRowsResponse> {
    return apiClient.get<SettingGroupRowsResponse>('/api/v1/admin/settings/groups');
  },

  createGroup(input: {
    code: string;
    name: string;
    salesChannelCodes?: string[];
  }): Promise<SettingGroupSummaryDto> {
    return apiClient.post<SettingGroupSummaryDto>('/api/v1/admin/settings/groups', input);
  },

  updateGroup(
    code: string,
    patch: { name?: string; salesChannelCodes?: string[]; expectedVersion?: string },
  ): Promise<SettingGroupSummaryDto> {
    return apiClient.patch<SettingGroupSummaryDto>(
      `/api/v1/admin/settings/groups/${encodeURIComponent(code)}`,
      patch,
    );
  },

  deleteGroup(code: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/admin/settings/groups/${encodeURIComponent(code)}`);
  },

  listCacheNamespaces(): Promise<CacheNamespacesResponse> {
    return apiClient.get<CacheNamespacesResponse>('/api/v1/admin/cache/namespaces');
  },

  clearCache(body: ClearCacheRequest): Promise<ClearCacheResult> {
    return apiClient.post<ClearCacheResult>('/api/v1/admin/cache/clear', body);
  },

  reindexSearch(): Promise<SearchReindexResponse> {
    return apiClient.post<SearchReindexResponse>('/api/v1/admin/search/reindex', {});
  },
};
