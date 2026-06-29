import { apiClient } from '@/lib/api-client';
import type {
  CreateEmailBlockRequest,
  CreateEmailTemplateRequest,
  EmailBlockDetail,
  EmailBlockSummary,
  EmailBranding,
  EmailPageBuilderDescriptor,
  EmailTemplateDetail,
  EmailTemplateSummary,
  PatchEmailBlockRequest,
  PatchEmailTemplateRequest,
  PreviewEmailResponse,
  PutEmailBlockContentRequest,
  PutEmailContentRequest,
  ResolvedEmailContent,
  TransactionalEmailDetail,
  TransactionalEmailSummary,
} from '@b2b/contracts';

type Wrap<T> = { data: T };
const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);

const BASE = '/api/v1/admin/transactional-emails';

function scopeQs(salesChannelId: string | null, language?: string): string {
  const params = new URLSearchParams();
  if (salesChannelId) params.set('salesChannelId', salesChannelId);
  if (language) params.set('language', language);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Typed admin client for the transactional_emails module (feature 047). */
export const transactionalEmailsClient = {
  pageBuilderConfig: (): Promise<EmailPageBuilderDescriptor> =>
    unwrap(apiClient.get<Wrap<EmailPageBuilderDescriptor>>(`${BASE}/page-builder/config`)),

  // Definitions
  list: (): Promise<{ items: TransactionalEmailSummary[] }> =>
    unwrap(apiClient.get<Wrap<{ items: TransactionalEmailSummary[] }>>(BASE)),

  get: (code: string, salesChannelId: string | null, language?: string): Promise<TransactionalEmailDetail> =>
    unwrap(apiClient.get<Wrap<TransactionalEmailDetail>>(`${BASE}/${encodeURIComponent(code)}${scopeQs(salesChannelId, language)}`)),

  saveContent: (
    code: string,
    salesChannelId: string | null,
    language: string,
    body: PutEmailContentRequest,
  ): Promise<ResolvedEmailContent> =>
    unwrap(
      apiClient.put<Wrap<ResolvedEmailContent>>(
        `${BASE}/${encodeURIComponent(code)}/content${scopeQs(salesChannelId, language)}`,
        body,
      ),
    ),

  resetContent: (code: string, salesChannelId: string | null, language: string): Promise<ResolvedEmailContent> =>
    unwrap(
      apiClient.delete<Wrap<ResolvedEmailContent>>(
        `${BASE}/${encodeURIComponent(code)}/content${scopeQs(salesChannelId, language)}`,
      ),
    ),

  preview: (
    code: string,
    body: { salesChannelId?: string; language?: string; draftSubject?: string; draftContent?: unknown },
  ): Promise<PreviewEmailResponse> =>
    unwrap(apiClient.post<Wrap<PreviewEmailResponse>>(`${BASE}/${encodeURIComponent(code)}/preview`, body)),

  // Branding (read)
  branding: (salesChannelId: string | null): Promise<EmailBranding> =>
    unwrap(apiClient.get<Wrap<EmailBranding>>(`${BASE}/branding${scopeQs(salesChannelId)}`)),

  // Blocks
  listBlocks: (salesChannelId?: string): Promise<{ items: EmailBlockSummary[] }> =>
    unwrap(apiClient.get<Wrap<{ items: EmailBlockSummary[] }>>(`${BASE}/blocks${scopeQs(salesChannelId ?? null)}`)),
  getBlock: (id: string): Promise<EmailBlockDetail> =>
    unwrap(apiClient.get<Wrap<EmailBlockDetail>>(`${BASE}/blocks/${encodeURIComponent(id)}`)),
  createBlock: (body: CreateEmailBlockRequest): Promise<EmailBlockDetail> =>
    unwrap(apiClient.post<Wrap<EmailBlockDetail>>(`${BASE}/blocks`, body)),
  patchBlock: (id: string, body: PatchEmailBlockRequest): Promise<EmailBlockDetail> =>
    unwrap(apiClient.patch<Wrap<EmailBlockDetail>>(`${BASE}/blocks/${encodeURIComponent(id)}`, body)),
  putBlockContent: (id: string, language: string, body: PutEmailBlockContentRequest): Promise<EmailBlockDetail> =>
    unwrap(apiClient.put<Wrap<EmailBlockDetail>>(`${BASE}/blocks/${encodeURIComponent(id)}/content/${language}`, body)),
  deleteBlock: (id: string): Promise<void> =>
    apiClient.delete(`${BASE}/blocks/${encodeURIComponent(id)}`).then(() => undefined),

  // Templates
  listTemplates: (salesChannelId?: string): Promise<{ items: EmailTemplateSummary[] }> =>
    unwrap(apiClient.get<Wrap<{ items: EmailTemplateSummary[] }>>(`${BASE}/templates${scopeQs(salesChannelId ?? null)}`)),
  getTemplate: (id: string): Promise<EmailTemplateDetail> =>
    unwrap(apiClient.get<Wrap<EmailTemplateDetail>>(`${BASE}/templates/${encodeURIComponent(id)}`)),
  createTemplate: (body: CreateEmailTemplateRequest): Promise<EmailTemplateDetail> =>
    unwrap(apiClient.post<Wrap<EmailTemplateDetail>>(`${BASE}/templates`, body)),
  patchTemplate: (id: string, body: PatchEmailTemplateRequest): Promise<EmailTemplateDetail> =>
    unwrap(apiClient.patch<Wrap<EmailTemplateDetail>>(`${BASE}/templates/${encodeURIComponent(id)}`, body)),
  putTemplateContent: (id: string, language: string, body: PutEmailBlockContentRequest): Promise<EmailTemplateDetail> =>
    unwrap(apiClient.put<Wrap<EmailTemplateDetail>>(`${BASE}/templates/${encodeURIComponent(id)}/content/${language}`, body)),
  deleteTemplate: (id: string): Promise<void> =>
    apiClient.delete(`${BASE}/templates/${encodeURIComponent(id)}`).then(() => undefined),
};
