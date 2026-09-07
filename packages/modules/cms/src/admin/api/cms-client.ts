import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CmsPageBuilderDescriptor,
  CmsBlockDetail,
  CmsBlockSummary,
  CmsHookDetail,
  CmsHookSummary,
  CmsPageDetail,
  CmsPageSummary,
  CmsTemplateDetail,
  CmsTemplateSummary,
  CmsHookAttachmentRequest,
  CreateCmsBlockRequest,
  CreateCmsHookRequest,
  CreateCmsPageRequest,
  CreateCmsTemplateRequest,
  PatchCmsBlockRequest,
  PatchCmsHookRequest,
  PatchCmsPageRequest,
  PatchCmsTemplateRequest,
  PutCmsPageContentRequest,
  PutCmsColorPaletteRequest,
  CmsColorPaletteEntry,
  CmsReservedSegmentsResponse,
} from '@endora-commerce/contracts';

export type {
  CmsPageBuilderDescriptor,
  CmsBlockDetail,
  CmsBlockSummary,
  CmsHookDetail,
  CmsHookSummary,
  CmsPageDetail,
  CmsPageSummary,
  CmsTemplateDetail,
  CmsTemplateSummary,
  CmsHookAttachmentRequest,
  CreateCmsBlockRequest,
  CreateCmsHookRequest,
  CreateCmsPageRequest,
  CreateCmsTemplateRequest,
  PatchCmsBlockRequest,
  PatchCmsHookRequest,
  PatchCmsPageRequest,
  PatchCmsTemplateRequest,
  PutCmsPageContentRequest,
  PutCmsColorPaletteRequest,
  CmsColorPaletteEntry,
  CmsReservedSegmentsResponse,
};

export interface ListPagesQuery {
  q?: string;
  salesChannelId?: string;
  language?: string;
  status?: 'draft' | 'published' | 'archived';
  active?: boolean;
  cursor?: string;
  limit?: number;
}

export interface ListPagesResponse {
  data: CmsPageSummary[];
  nextCursor: string | null;
}

export interface ListBlocksResponse {
  data: CmsBlockSummary[];
  nextCursor: string | null;
}

export interface ListHooksResponse {
  data: CmsHookSummary[];
  nextCursor: string | null;
}

export interface ListTemplatesResponse {
  data: CmsTemplateSummary[];
  nextCursor: string | null;
}

function pageQuery(query: ListPagesQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.salesChannelId) params.set('salesChannelId', query.salesChannelId);
  if (query.language) params.set('language', query.language);
  if (query.status) params.set('status', query.status);
  if (query.active !== undefined) params.set('active', String(query.active));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const out = params.toString();
  return out ? `?${out}` : '';
}

export const cmsClient = {
  listPages(query: ListPagesQuery = {}): Promise<ListPagesResponse> {
    return apiClient.get<ListPagesResponse>(`/api/v1/admin/cms/pages${pageQuery(query)}`);
  },

  async createPage(body: CreateCmsPageRequest): Promise<CmsPageDetail> {
    const out = await apiClient.post<{ data: CmsPageDetail }>('/api/v1/admin/cms/pages', body);
    return out.data;
  },

  async getPage(id: string): Promise<CmsPageDetail> {
    const out = await apiClient.get<{ data: CmsPageDetail }>(
      `/api/v1/admin/cms/pages/${encodeURIComponent(id)}`,
    );
    return out.data;
  },

  async patchPage(id: string, body: PatchCmsPageRequest): Promise<CmsPageDetail> {
    const out = await apiClient.patch<{ data: CmsPageDetail }>(
      `/api/v1/admin/cms/pages/${encodeURIComponent(id)}`,
      body,
    );
    return out.data;
  },

  async putPageContent(
    id: string,
    language: string,
    body: PutCmsPageContentRequest,
  ): Promise<CmsPageDetail> {
    const out = await apiClient.put<{ data: CmsPageDetail }>(
      `/api/v1/admin/cms/pages/${encodeURIComponent(id)}/content/${encodeURIComponent(language)}`,
      body,
    );
    return out.data;
  },

  async publishPage(id: string): Promise<CmsPageDetail> {
    const out = await apiClient.post<{ data: CmsPageDetail }>(
      `/api/v1/admin/cms/pages/${encodeURIComponent(id)}/publish`,
      {},
    );
    return out.data;
  },

  async archivePage(id: string): Promise<CmsPageDetail> {
    const out = await apiClient.post<{ data: CmsPageDetail }>(
      `/api/v1/admin/cms/pages/${encodeURIComponent(id)}/archive`,
      {},
    );
    return out.data;
  },

  async unarchivePage(id: string): Promise<CmsPageDetail> {
    const out = await apiClient.post<{ data: CmsPageDetail }>(
      `/api/v1/admin/cms/pages/${encodeURIComponent(id)}/unarchive`,
      {},
    );
    return out.data;
  },

  async deletePage(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/admin/cms/pages/${encodeURIComponent(id)}`);
  },

  /**
   * The deployment's reserved first path segments (feature 105, FR-033).
   *
   * The **same** value the backend's save-time refusal enforces, read through
   * this module's own endpoint rather than the settings API, which is gated
   * `settings:read`: a content editor who holds `cms.write` and not that would
   * otherwise get a warning that silently never fires.
   */
  async getReservedSlugSegments(): Promise<string[]> {
    const out = await apiClient.get<{ data: CmsReservedSegmentsResponse }>(
      '/api/v1/admin/cms/pages/reserved-segments',
    );
    return out.data.segments;
  },

  async getPageBuilderConfig(): Promise<CmsPageBuilderDescriptor> {
    const out = await apiClient.get<{ data: CmsPageBuilderDescriptor }>(
      '/api/v1/admin/cms/page-builder/config',
    );
    return out.data;
  },

  async putColorPalette(body: PutCmsColorPaletteRequest): Promise<{ entries: CmsColorPaletteEntry[] }> {
    const out = await apiClient.put<{ data: { entries: CmsColorPaletteEntry[] } }>(
      '/api/v1/admin/cms/page-builder/color-palette',
      body,
    );
    return out.data;
  },

  listBlocks(): Promise<ListBlocksResponse> {
    return apiClient.get<ListBlocksResponse>('/api/v1/admin/cms/blocks');
  },

  async createBlock(body: CreateCmsBlockRequest): Promise<CmsBlockDetail> {
    const out = await apiClient.post<{ data: CmsBlockDetail }>('/api/v1/admin/cms/blocks', body);
    return out.data;
  },

  async getBlock(id: string): Promise<CmsBlockDetail> {
    const out = await apiClient.get<{ data: CmsBlockDetail }>(
      `/api/v1/admin/cms/blocks/${encodeURIComponent(id)}`,
    );
    return out.data;
  },

  async patchBlock(id: string, body: PatchCmsBlockRequest): Promise<CmsBlockDetail> {
    const out = await apiClient.patch<{ data: CmsBlockDetail }>(
      `/api/v1/admin/cms/blocks/${encodeURIComponent(id)}`,
      body,
    );
    return out.data;
  },

  async putBlockContent(
    id: string,
    language: string,
    body: PutCmsPageContentRequest,
  ): Promise<CmsBlockDetail> {
    const out = await apiClient.put<{ data: CmsBlockDetail }>(
      `/api/v1/admin/cms/blocks/${encodeURIComponent(id)}/content/${encodeURIComponent(language)}`,
      body,
    );
    return out.data;
  },

  async deleteBlock(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/admin/cms/blocks/${encodeURIComponent(id)}`);
  },

  listTemplates(query: { salesChannelId?: string } = {}): Promise<ListTemplatesResponse> {
    const params = new URLSearchParams();
    if (query.salesChannelId) params.set('salesChannelId', query.salesChannelId);
    const qs = params.toString();
    return apiClient.get<ListTemplatesResponse>(
      `/api/v1/admin/cms/templates${qs ? `?${qs}` : ''}`,
    );
  },

  async createTemplate(body: CreateCmsTemplateRequest): Promise<CmsTemplateDetail> {
    const out = await apiClient.post<{ data: CmsTemplateDetail }>(
      '/api/v1/admin/cms/templates',
      body,
    );
    return out.data;
  },

  async getTemplate(id: string): Promise<CmsTemplateDetail> {
    const out = await apiClient.get<{ data: CmsTemplateDetail }>(
      `/api/v1/admin/cms/templates/${encodeURIComponent(id)}`,
    );
    return out.data;
  },

  async patchTemplate(id: string, body: PatchCmsTemplateRequest): Promise<CmsTemplateDetail> {
    const out = await apiClient.patch<{ data: CmsTemplateDetail }>(
      `/api/v1/admin/cms/templates/${encodeURIComponent(id)}`,
      body,
    );
    return out.data;
  },

  async putTemplateContent(
    id: string,
    language: string,
    body: PutCmsPageContentRequest,
  ): Promise<CmsTemplateDetail> {
    const out = await apiClient.put<{ data: CmsTemplateDetail }>(
      `/api/v1/admin/cms/templates/${encodeURIComponent(id)}/content/${encodeURIComponent(language)}`,
      body,
    );
    return out.data;
  },

  async deleteTemplate(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/admin/cms/templates/${encodeURIComponent(id)}`);
  },

  listHooks(query: { salesChannelId?: string } = {}): Promise<ListHooksResponse> {
    const params = new URLSearchParams();
    if (query.salesChannelId) params.set('salesChannelId', query.salesChannelId);
    const qs = params.toString();
    return apiClient.get<ListHooksResponse>(`/api/v1/admin/cms/hooks${qs ? `?${qs}` : ''}`);
  },

  async createHook(body: CreateCmsHookRequest): Promise<CmsHookDetail> {
    const out = await apiClient.post<{ data: CmsHookDetail }>('/api/v1/admin/cms/hooks', body);
    return out.data;
  },

  async getHook(id: string): Promise<CmsHookDetail> {
    const out = await apiClient.get<{ data: CmsHookDetail }>(
      `/api/v1/admin/cms/hooks/${encodeURIComponent(id)}`,
    );
    return out.data;
  },

  async patchHook(id: string, body: PatchCmsHookRequest): Promise<CmsHookDetail> {
    const out = await apiClient.patch<{ data: CmsHookDetail }>(
      `/api/v1/admin/cms/hooks/${encodeURIComponent(id)}`,
      body,
    );
    return out.data;
  },

  async deleteHook(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/admin/cms/hooks/${encodeURIComponent(id)}`);
  },

  async listHookAttachments(id: string): Promise<CmsHookDetail['attachments']> {
    const out = await apiClient.get<{ data: CmsHookDetail['attachments'] }>(
      `/api/v1/admin/cms/hooks/${encodeURIComponent(id)}/attachments`,
    );
    return out.data;
  },

  async addHookAttachment(
    id: string,
    body: CmsHookAttachmentRequest,
  ): Promise<CmsHookDetail['attachments']> {
    const out = await apiClient.post<{ data: CmsHookDetail['attachments'] }>(
      `/api/v1/admin/cms/hooks/${encodeURIComponent(id)}/attachments`,
      body,
    );
    return out.data;
  },

  async reorderHookAttachment(
    id: string,
    blockId: string,
    position: number,
  ): Promise<CmsHookDetail['attachments']> {
    const out = await apiClient.patch<{ data: CmsHookDetail['attachments'] }>(
      `/api/v1/admin/cms/hooks/${encodeURIComponent(id)}/attachments/${encodeURIComponent(blockId)}`,
      { position },
    );
    return out.data;
  },

  async removeHookAttachment(id: string, blockId: string): Promise<void> {
    await apiClient.delete(
      `/api/v1/admin/cms/hooks/${encodeURIComponent(id)}/attachments/${encodeURIComponent(blockId)}`,
    );
  },
};
