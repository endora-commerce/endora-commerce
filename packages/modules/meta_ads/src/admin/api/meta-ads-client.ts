import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CreateMetaCustomEventMapping,
  MetaCustomEventMapping,
  MetaTriggerAction,
  SalesChannelListResponse,
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

/**
 * The sales channels this module's two screens label a mapping's channel with.
 *
 * **This is a drained cross-module reach, not a convenience** (feature 091,
 * Phase 4 batch three). Both screens used to import `salesChannelsClient` from
 * `@/modules/sales_channels/api/sales-channels-client`, which
 * `backend/scripts/ledgers/cross-module-imports/meta_ads.ts` recorded as a
 * boundary reach before any admin directory moved. That entry named the exit
 * taken here: *"the reach is the client module, not the HTTP call — the request
 * and response shapes are already in `@endora-commerce/contracts`, which both
 * sides compile"*, so the caller builds the request itself and no module names
 * a file another module owns. Rewriting the specifier as a package subpath was
 * the exit the entry refuses: it is the same coupling under a supported name.
 *
 * It is duplicated in `linkedin_ads`' client rather than shared, and that is
 * the design and not an oversight. The only place two modules could share it is
 * `@endora-commerce/admin-kit`, and the kit holds no module knowledge (R6) —
 * `/api/v1/admin/sales-channels` is `sales_channels`' knowledge. Two callers of
 * one published HTTP route is what an API boundary is for.
 */
export const listSalesChannels = (): Promise<SalesChannelListResponse> =>
  apiClient.get<SalesChannelListResponse>(
    '/api/v1/admin/sales-channels?activeOnly=false&pageSize=100',
  );
