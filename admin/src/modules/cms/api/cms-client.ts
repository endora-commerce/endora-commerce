import { apiClient } from '@/lib/api-client';
import type {
  CmsPageBuilderDescriptor,
  CmsBlockDetail,
  CmsBlockSummary,
  CmsPageDetail,
  CmsPageSummary,
  CreateCmsBlockRequest,
  CreateCmsPageRequest,
  PatchCmsBlockRequest,
  PatchCmsPageRequest,
  PutCmsPageContentRequest,
} from '@b2b/contracts';

export type {
  CmsPageBuilderDescriptor,
  CmsBlockDetail,
  CmsBlockSummary,
  CmsPageDetail,
  CmsPageSummary,
  CreateCmsBlockRequest,
  CreateCmsPageRequest,
  PatchCmsBlockRequest,
  PatchCmsPageRequest,
  PutCmsPageContentRequest,
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

  async getPageBuilderConfig(): Promise<CmsPageBuilderDescriptor> {
    const out = await apiClient.get<{ data: CmsPageBuilderDescriptor }>(
      '/api/v1/admin/cms/page-builder/config',
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
};
