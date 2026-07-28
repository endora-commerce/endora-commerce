import { apiClient } from '@/lib/api-client';
import type {
  CreateLinkedInConversionMapping,
  LinkedInConversionMapping,
  LinkedInTriggerAction,
  UpdateLinkedInConversionMapping,
} from '@b2b/contracts';

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
