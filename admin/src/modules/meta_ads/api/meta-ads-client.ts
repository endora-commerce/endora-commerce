import { apiClient } from '@/lib/api-client';
import type {
  CreateMetaCustomEventMapping,
  MetaCustomEventMapping,
  MetaTriggerAction,
  UpdateMetaCustomEventMapping,
} from '@endora-commerce/contracts';

type Wrap<T> = { data: T };
const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);
const BASE = '/api/v1/admin/meta-ads';

/** Typed admin client for the Meta Ads module (feature 064). */
export const metaAdsClient = {
  actionCatalogue: (): Promise<MetaTriggerAction[]> =>
    unwrap(apiClient.get<Wrap<MetaTriggerAction[]>>(`${BASE}/action-catalogue`)),

  list: (): Promise<MetaCustomEventMapping[]> =>
    unwrap(apiClient.get<Wrap<MetaCustomEventMapping[]>>(`${BASE}/custom-events`)),

  get: (id: string): Promise<MetaCustomEventMapping> =>
    unwrap(apiClient.get<Wrap<MetaCustomEventMapping>>(`${BASE}/custom-events/${id}`)),

  create: (body: CreateMetaCustomEventMapping): Promise<MetaCustomEventMapping> =>
    unwrap(apiClient.post<Wrap<MetaCustomEventMapping>>(`${BASE}/custom-events`, body)),

  update: (id: string, body: UpdateMetaCustomEventMapping): Promise<MetaCustomEventMapping> =>
    unwrap(apiClient.patch<Wrap<MetaCustomEventMapping>>(`${BASE}/custom-events/${id}`, body)),

  remove: (id: string): Promise<void> => apiClient.delete<void>(`${BASE}/custom-events/${id}`),
};
