import { apiClient } from '@endora-commerce/admin-kit/lib';
import { scopeNoticeOf, type ScopeNoticeCode } from '@endora-commerce/contracts';
import type {
  AutomationDetail,
  AutomationSummary,
  CampaignDetail,
  CampaignStats,
  CampaignSummary,
  CreateAutomationRequest,
  CreateCampaignRequest,
  CreateNewsletterCustomFieldRequest,
  CreateNewsletterEmailBlockRequest,
  CreateNewsletterTagRequest,
  NewsletterCustomField,
  NewsletterEmailBlockDetail,
  NewsletterEmailBlockSummary,
  NewsletterTag,
  UpdateNewsletterEmailBlockRequest,
  ProviderConfig,
  PutProviderRequest,
  RenderedEmail,
  SubscriberDetail,
  SubscriberListQuery,
  SubscriberListResponse,
  TestProviderResponse,
  UpdateAutomationRequest,
  UpdateCampaignRequest,
  UpdateNewsletterCustomFieldRequest,
  UpdateNewsletterTagRequest,
} from '@endora-commerce/contracts';

type Wrap<T> = { data: T };
const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);

/**
 * A page plus the reason it might be empty (feature 087). `unwrap` throws the
 * envelope away, and the envelope is where the server explains itself, so the
 * subscriber listing keeps it — the notice rides beside the page rather than
 * being fetched separately, because it is a property of *this* answer.
 */
export type SubscriberListPage = SubscriberListResponse & {
  scopeNotice: ScopeNoticeCode | null;
};
const BASE = '/api/v1/admin/newsletter';

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Typed admin client for the newsletter module (feature 048). */
export const newsletterClient = {
  // Subscribers
  listSubscribers: (q: Partial<SubscriberListQuery>): Promise<SubscriberListPage> =>
    apiClient
      .get<Wrap<SubscriberListResponse>>(`${BASE}/subscribers${qs(q as Record<string, string | number | undefined>)}`)
      .then((r) => ({ ...r.data, scopeNotice: scopeNoticeOf(r) })),
  getSubscriber: (id: string): Promise<SubscriberDetail> =>
    unwrap(apiClient.get<Wrap<SubscriberDetail>>(`${BASE}/subscribers/${id}`)),
  unsubscribe: (id: string, expectedVersion: number, reason?: string): Promise<SubscriberDetail> =>
    unwrap(apiClient.post<Wrap<SubscriberDetail>>(`${BASE}/subscribers/${id}/unsubscribe`, { expectedVersion, reason })),
  deactivate: (id: string, expectedVersion: number): Promise<SubscriberDetail> =>
    unwrap(apiClient.post<Wrap<SubscriberDetail>>(`${BASE}/subscribers/${id}/deactivate`, { expectedVersion })),
  deleteSubscriber: (id: string): Promise<void> => apiClient.delete(`${BASE}/subscribers/${id}`).then(() => undefined),
  subscribersExportUrl: (q: Partial<SubscriberListQuery>): string =>
    `${BASE}/subscribers/export${qs(q as Record<string, string | number | undefined>)}`,

  // Tags
  listTags: (): Promise<{ items: NewsletterTag[] }> => unwrap(apiClient.get<Wrap<{ items: NewsletterTag[] }>>(`${BASE}/tags`)),
  createTag: (body: CreateNewsletterTagRequest): Promise<NewsletterTag> =>
    unwrap(apiClient.post<Wrap<NewsletterTag>>(`${BASE}/tags`, body)),
  updateTag: (id: string, body: UpdateNewsletterTagRequest): Promise<NewsletterTag> =>
    unwrap(apiClient.patch<Wrap<NewsletterTag>>(`${BASE}/tags/${id}`, body)),
  deleteTag: (id: string): Promise<void> => apiClient.delete(`${BASE}/tags/${id}`).then(() => undefined),

  // Custom fields
  listCustomFields: (): Promise<{ items: NewsletterCustomField[] }> =>
    unwrap(apiClient.get<Wrap<{ items: NewsletterCustomField[] }>>(`${BASE}/custom-fields`)),
  createCustomField: (body: CreateNewsletterCustomFieldRequest): Promise<NewsletterCustomField> =>
    unwrap(apiClient.post<Wrap<NewsletterCustomField>>(`${BASE}/custom-fields`, body)),
  updateCustomField: (id: string, body: UpdateNewsletterCustomFieldRequest): Promise<NewsletterCustomField> =>
    unwrap(apiClient.patch<Wrap<NewsletterCustomField>>(`${BASE}/custom-fields/${id}`, body)),
  deleteCustomField: (id: string): Promise<void> => apiClient.delete(`${BASE}/custom-fields/${id}`).then(() => undefined),

  // Campaigns
  listCampaigns: (): Promise<{ items: CampaignSummary[] }> =>
    unwrap(apiClient.get<Wrap<{ items: CampaignSummary[] }>>(`${BASE}/campaigns`)),
  getCampaign: (id: string): Promise<CampaignDetail> =>
    unwrap(apiClient.get<Wrap<CampaignDetail>>(`${BASE}/campaigns/${id}`)),
  createCampaign: (body: CreateCampaignRequest): Promise<CampaignDetail> =>
    unwrap(apiClient.post<Wrap<CampaignDetail>>(`${BASE}/campaigns`, body)),
  updateCampaign: (id: string, body: UpdateCampaignRequest): Promise<CampaignDetail> =>
    unwrap(apiClient.put<Wrap<CampaignDetail>>(`${BASE}/campaigns/${id}`, body)),
  setCampaignGroup: (id: string, subscriberIds: string[]): Promise<CampaignDetail> =>
    unwrap(apiClient.put<Wrap<CampaignDetail>>(`${BASE}/campaigns/${id}/group`, { subscriberIds })),
  previewCampaign: (id: string, subscriberId?: string): Promise<RenderedEmail> =>
    unwrap(apiClient.post<Wrap<RenderedEmail>>(`${BASE}/campaigns/${id}/preview`, { subscriberId })),
  sendCampaign: (id: string, expectedVersion: number, scheduledAt?: string): Promise<CampaignDetail> =>
    unwrap(apiClient.post<Wrap<CampaignDetail>>(`${BASE}/campaigns/${id}/send`, { expectedVersion, scheduledAt })),
  cancelCampaign: (id: string, expectedVersion: number): Promise<CampaignDetail> =>
    unwrap(apiClient.post<Wrap<CampaignDetail>>(`${BASE}/campaigns/${id}/cancel`, { expectedVersion })),
  campaignStats: (id: string): Promise<CampaignStats> =>
    unwrap(apiClient.get<Wrap<CampaignStats>>(`${BASE}/campaigns/${id}/stats`)),

  // Automations
  listAutomations: (): Promise<{ items: AutomationSummary[] }> =>
    unwrap(apiClient.get<Wrap<{ items: AutomationSummary[] }>>(`${BASE}/automations`)),
  getAutomation: (id: string): Promise<AutomationDetail> =>
    unwrap(apiClient.get<Wrap<AutomationDetail>>(`${BASE}/automations/${id}`)),
  createAutomation: (body: CreateAutomationRequest): Promise<AutomationDetail> =>
    unwrap(apiClient.post<Wrap<AutomationDetail>>(`${BASE}/automations`, body)),
  updateAutomation: (id: string, body: UpdateAutomationRequest): Promise<AutomationDetail> =>
    unwrap(apiClient.put<Wrap<AutomationDetail>>(`${BASE}/automations/${id}`, body)),
  activateAutomation: (id: string, expectedVersion: number): Promise<AutomationDetail> =>
    unwrap(apiClient.post<Wrap<AutomationDetail>>(`${BASE}/automations/${id}/activate`, { expectedVersion })),
  pauseAutomation: (id: string, expectedVersion: number): Promise<AutomationDetail> =>
    unwrap(apiClient.post<Wrap<AutomationDetail>>(`${BASE}/automations/${id}/pause`, { expectedVersion })),

  // Email blocks
  listBlocks: (): Promise<{ items: NewsletterEmailBlockSummary[] }> =>
    unwrap(apiClient.get<Wrap<{ items: NewsletterEmailBlockSummary[] }>>(`${BASE}/blocks`)),
  getBlock: (id: string): Promise<NewsletterEmailBlockDetail> =>
    unwrap(apiClient.get<Wrap<NewsletterEmailBlockDetail>>(`${BASE}/blocks/${id}`)),
  createBlock: (body: CreateNewsletterEmailBlockRequest): Promise<NewsletterEmailBlockDetail> =>
    unwrap(apiClient.post<Wrap<NewsletterEmailBlockDetail>>(`${BASE}/blocks`, body)),
  updateBlock: (id: string, body: UpdateNewsletterEmailBlockRequest): Promise<NewsletterEmailBlockDetail> =>
    unwrap(apiClient.put<Wrap<NewsletterEmailBlockDetail>>(`${BASE}/blocks/${id}`, body)),
  deleteBlock: (id: string): Promise<void> => apiClient.delete(`${BASE}/blocks/${id}`).then(() => undefined),

  // Provider
  getProvider: (): Promise<ProviderConfig> => unwrap(apiClient.get<Wrap<ProviderConfig>>(`${BASE}/provider`)),
  putProvider: (body: PutProviderRequest): Promise<ProviderConfig> =>
    unwrap(apiClient.put<Wrap<ProviderConfig>>(`${BASE}/provider`, body)),
  testProvider: (): Promise<TestProviderResponse> =>
    unwrap(apiClient.post<Wrap<TestProviderResponse>>(`${BASE}/provider/test`, {})),
};

/** Build a minimal email-safe content tree from a plain-text body (one EmailText block). */
export function textContentTree(text: string): Record<string, unknown> {
  return {
    root: { props: {} },
    content: [{ type: 'EmailText', props: { id: 'body', text } }],
    zones: {},
  };
}
