import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CreateLinkedInConversionMapping,
  LinkedInConversionMapping,
  LinkedInTriggerAction,
  SalesChannelListResponse,
  UpdateLinkedInConversionMapping,
} from '@endora-commerce/contracts';

type Wrap<T> = { data: T };
const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);
const BASE = '/api/v1/admin/linkedin-ads';

/** Typed admin client for the LinkedIn Ads module (feature 063). */
export const linkedInAdsClient = {
  actionCatalogue: (): Promise<LinkedInTriggerAction[]> =>
    unwrap(apiClient.get<Wrap<LinkedInTriggerAction[]>>(`${BASE}/action-catalogue`)),

  list: (): Promise<LinkedInConversionMapping[]> =>
    unwrap(apiClient.get<Wrap<LinkedInConversionMapping[]>>(`${BASE}/conversion-mappings`)),

  get: (id: string): Promise<LinkedInConversionMapping> =>
    unwrap(apiClient.get<Wrap<LinkedInConversionMapping>>(`${BASE}/conversion-mappings/${id}`)),

  create: (body: CreateLinkedInConversionMapping): Promise<LinkedInConversionMapping> =>
    unwrap(
      apiClient.post<Wrap<LinkedInConversionMapping>>(`${BASE}/conversion-mappings`, body),
    ),

  update: (
    id: string,
    body: UpdateLinkedInConversionMapping,
  ): Promise<LinkedInConversionMapping> =>
    unwrap(
      apiClient.patch<Wrap<LinkedInConversionMapping>>(
        `${BASE}/conversion-mappings/${id}`,
        body,
      ),
    ),

  remove: (id: string): Promise<void> => apiClient.delete<void>(`${BASE}/conversion-mappings/${id}`),
};

/**
 * The sales channels this module's two screens label a mapping's channel with.
 *
 * **This is a drained cross-module reach, not a convenience** (feature 091,
 * Phase 4 batch three). Both screens used to import `salesChannelsClient` from
 * `@/modules/sales_channels/api/sales-channels-client`, which
 * `backend/scripts/ledgers/cross-module-imports/linkedin_ads.ts` recorded as a
 * boundary reach before any admin directory moved. That entry named the exit
 * taken here: *"the reach is the client module, not the HTTP call — the request
 * and response shapes are already in `@endora-commerce/contracts`, which both
 * sides compile"*, so the caller builds the request itself and no module names
 * a file another module owns. Rewriting the specifier as a package subpath was
 * the exit the entry refuses: it is the same coupling under a supported name.
 *
 * It is duplicated in `meta_ads`' client rather than shared, and that is the
 * design and not an oversight. The only place two modules could share it is
 * `@endora-commerce/admin-kit`, and the kit holds no module knowledge (R6) —
 * `/api/v1/admin/sales-channels` is `sales_channels`' knowledge. Two callers of
 * one published HTTP route is what an API boundary is for.
 */
export const listSalesChannels = (): Promise<SalesChannelListResponse> =>
  apiClient.get<SalesChannelListResponse>(
    '/api/v1/admin/sales-channels?activeOnly=false&pageSize=100',
  );
