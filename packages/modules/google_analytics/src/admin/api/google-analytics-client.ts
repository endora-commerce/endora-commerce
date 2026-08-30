import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  GaCustomEventCreate,
  GaCustomEventResponse,
  GaCustomEventUpdate,
  GaTriggerAction,
} from '@endora-commerce/contracts';

type Wrap<T> = { data: T };
const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);
const BASE = '/api/v1/admin/google-analytics';

export type GaActionCatalogue = Record<GaTriggerAction, { static: string[] | null }>;

/** Typed admin client for the Google Analytics module (feature 049). */
export const googleAnalyticsClient = {
  actionCatalogue: (): Promise<GaActionCatalogue> =>
    unwrap(apiClient.get<Wrap<GaActionCatalogue>>(`${BASE}/action-catalogue`)),

  list: (query: { salesChannelCode?: string; triggerAction?: GaTriggerAction } = {}): Promise<
    GaCustomEventResponse[]
  > => {
    const sp = new URLSearchParams();
    if (query.salesChannelCode) sp.set('salesChannelCode', query.salesChannelCode);
    if (query.triggerAction) sp.set('triggerAction', query.triggerAction);
    const tail = sp.toString();
    return unwrap(
      apiClient.get<Wrap<GaCustomEventResponse[]>>(`${BASE}/custom-events${tail ? `?${tail}` : ''}`),
    );
  },

  get: (id: string): Promise<GaCustomEventResponse> =>
    unwrap(apiClient.get<Wrap<GaCustomEventResponse>>(`${BASE}/custom-events/${id}`)),

  create: (body: GaCustomEventCreate): Promise<GaCustomEventResponse> =>
    unwrap(apiClient.post<Wrap<GaCustomEventResponse>>(`${BASE}/custom-events`, body)),

  update: (id: string, body: GaCustomEventUpdate): Promise<GaCustomEventResponse> =>
    unwrap(apiClient.patch<Wrap<GaCustomEventResponse>>(`${BASE}/custom-events/${id}`, body)),

  remove: (id: string): Promise<void> =>
    apiClient.delete<void>(`${BASE}/custom-events/${id}`).then(() => undefined),
};
