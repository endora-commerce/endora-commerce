import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  BlogCategoryDetail,
  BlogCategoryTreeNode,
  BlogCategoryTreeMove,
  BlogPostDetail,
  BlogPostInboundReferencesResponse,
  BlogPostStatus,
  BlogPostSummary,
  BlogTagDetail,
  BlogTagInboundReferencesResponse,
  CreateBlogCategoryRequest,
  CreateBlogPostRequest,
  CreateBlogTagRequest,
  PatchBlogCategoryRequest,
  PatchBlogPostRequest,
  PatchBlogTagRequest,
  PutBlogCategoryDescriptionRequest,
  PutBlogPostContentRequest,
} from '@endora-commerce/contracts';

export type {
  BlogCategoryDetail,
  BlogCategoryTreeNode,
  BlogCategoryTreeMove,
  BlogPostDetail,
  BlogPostInboundReferencesResponse,
  BlogPostStatus,
  BlogPostSummary,
  BlogTagDetail,
  BlogTagInboundReferencesResponse,
  CreateBlogCategoryRequest,
  CreateBlogPostRequest,
  CreateBlogTagRequest,
  PatchBlogCategoryRequest,
  PatchBlogPostRequest,
  PatchBlogTagRequest,
  PutBlogCategoryDescriptionRequest,
  PutBlogPostContentRequest,
};

export interface ListBlogPostsQuery {
  q?: string;
  status?: BlogPostStatus;
  salesChannelId?: string;
  categoryId?: string;
  tagId?: string;
  language?: string;
  page?: number;
  perPage?: number;
}

export interface ListBlogPostsResponse {
  data: BlogPostSummary[];
  pagination: {
    page: number;
    perPage: number;
    totalPages: number;
    totalItems: number;
  };
}

export interface ListBlogTagsQuery {
  q?: string;
  page?: number;
  perPage?: number;
}

export interface ListBlogTagsResponse {
  data: BlogTagDetail[];
  pagination: {
    page: number;
    perPage: number;
    totalPages: number;
    totalItems: number;
  };
}

function postQueryString(query: ListBlogPostsQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.salesChannelId) params.set('salesChannelId', query.salesChannelId);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.tagId) params.set('tagId', query.tagId);
  if (query.language) params.set('language', query.language);
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.perPage !== undefined) params.set('perPage', String(query.perPage));
  const out = params.toString();
  return out ? `?${out}` : '';
}

function tagQueryString(query: ListBlogTagsQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.perPage !== undefined) params.set('perPage', String(query.perPage));
  const out = params.toString();
  return out ? `?${out}` : '';
}

export const blogClient = {
  // ── Posts ──────────────────────────────────────────────────────────

  listPosts(query: ListBlogPostsQuery = {}): Promise<ListBlogPostsResponse> {
    return apiClient.get<ListBlogPostsResponse>(
      `/api/v1/admin/blog/posts${postQueryString(query)}`,
    );
  },

  async createPost(body: CreateBlogPostRequest): Promise<BlogPostDetail> {
    const out = await apiClient.post<{ data: BlogPostDetail }>(
      '/api/v1/admin/blog/posts',
      body,
    );
    return out.data;
  },

  async getPost(id: string): Promise<BlogPostDetail> {
    const out = await apiClient.get<{ data: BlogPostDetail }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}`,
    );
    return out.data;
  },

  async patchPost(id: string, body: PatchBlogPostRequest): Promise<BlogPostDetail> {
    const out = await apiClient.patch<{ data: BlogPostDetail }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}`,
      body,
    );
    return out.data;
  },

  async putPostContent(
    id: string,
    body: PutBlogPostContentRequest,
  ): Promise<BlogPostDetail> {
    const out = await apiClient.put<{ data: BlogPostDetail }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}/content`,
      body,
    );
    return out.data;
  },

  async setPostTags(
    id: string,
    tagIds: string[],
    version: number,
  ): Promise<BlogPostDetail> {
    const out = await apiClient.put<{ data: BlogPostDetail }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}/tags`,
      { tagIds, version },
    );
    return out.data;
  },

  async setPostRelatedPosts(
    id: string,
    relatedPostIds: string[],
    version: number,
  ): Promise<BlogPostDetail> {
    const out = await apiClient.put<{ data: BlogPostDetail }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}/related-posts`,
      { relatedPostIds, version },
    );
    return out.data;
  },

  async setPostRelatedProducts(
    id: string,
    productIds: string[],
    version: number,
  ): Promise<BlogPostDetail> {
    const out = await apiClient.put<{ data: BlogPostDetail }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}/related-products`,
      { productIds, version },
    );
    return out.data;
  },

  async publishPost(id: string, version: number): Promise<BlogPostDetail> {
    const out = await apiClient.post<{ data: BlogPostDetail }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}/publish`,
      { version },
    );
    return out.data;
  },

  async unpublishPost(id: string, version: number): Promise<BlogPostDetail> {
    const out = await apiClient.post<{ data: BlogPostDetail }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}/unpublish`,
      { version },
    );
    return out.data;
  },

  async archivePost(id: string, version: number): Promise<BlogPostDetail> {
    const out = await apiClient.post<{ data: BlogPostDetail }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}/archive`,
      { version },
    );
    return out.data;
  },

  async deletePost(
    id: string,
    version: number,
  ): Promise<{ detachedFromParents: string[] }> {
    const out = await apiClient.delete<{ data: { detachedFromParents: string[] } }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}?version=${version}`,
    );
    return out.data;
  },

  async getPostInboundReferences(
    id: string,
  ): Promise<BlogPostInboundReferencesResponse> {
    const out = await apiClient.get<{ data: BlogPostInboundReferencesResponse }>(
      `/api/v1/admin/blog/posts/${encodeURIComponent(id)}/inbound-references`,
    );
    return out.data;
  },

  // ── Categories ─────────────────────────────────────────────────────

  async getCategoryTree(): Promise<{ tree: BlogCategoryTreeNode[] }> {
    return apiClient.get<{ tree: BlogCategoryTreeNode[] }>(
      '/api/v1/admin/blog/categories',
    );
  },

  async getCategory(id: string): Promise<BlogCategoryDetail> {
    const out = await apiClient.get<{ data: BlogCategoryDetail }>(
      `/api/v1/admin/blog/categories/${encodeURIComponent(id)}`,
    );
    return out.data;
  },

  async createCategory(body: CreateBlogCategoryRequest): Promise<BlogCategoryDetail> {
    const out = await apiClient.post<{ data: BlogCategoryDetail }>(
      '/api/v1/admin/blog/categories',
      body,
    );
    return out.data;
  },

  async patchCategory(
    id: string,
    body: PatchBlogCategoryRequest,
  ): Promise<BlogCategoryDetail> {
    const out = await apiClient.patch<{ data: BlogCategoryDetail }>(
      `/api/v1/admin/blog/categories/${encodeURIComponent(id)}`,
      body,
    );
    return out.data;
  },

  async putCategoryDescription(
    id: string,
    body: PutBlogCategoryDescriptionRequest,
  ): Promise<BlogCategoryDetail> {
    const out = await apiClient.put<{ data: BlogCategoryDetail }>(
      `/api/v1/admin/blog/categories/${encodeURIComponent(id)}/description`,
      body,
    );
    return out.data;
  },

  async applyCategoryTreeMoves(
    moves: BlogCategoryTreeMove[],
  ): Promise<{ tree: BlogCategoryTreeNode[] }> {
    return apiClient.put<{ tree: BlogCategoryTreeNode[] }>(
      '/api/v1/admin/blog/categories/tree',
      { moves },
    );
  },

  async deleteCategory(id: string, version: number): Promise<void> {
    await apiClient.delete(
      `/api/v1/admin/blog/categories/${encodeURIComponent(id)}?version=${version}`,
    );
  },

  // ── Tags ───────────────────────────────────────────────────────────

  listTags(query: ListBlogTagsQuery = {}): Promise<ListBlogTagsResponse> {
    return apiClient.get<ListBlogTagsResponse>(
      `/api/v1/admin/blog/tags${tagQueryString(query)}`,
    );
  },

  async getTag(id: string): Promise<BlogTagDetail> {
    const out = await apiClient.get<{ data: BlogTagDetail }>(
      `/api/v1/admin/blog/tags/${encodeURIComponent(id)}`,
    );
    return out.data;
  },

  async createTag(body: CreateBlogTagRequest): Promise<BlogTagDetail> {
    const out = await apiClient.post<{ data: BlogTagDetail }>(
      '/api/v1/admin/blog/tags',
      body,
    );
    return out.data;
  },

  async patchTag(id: string, body: PatchBlogTagRequest): Promise<BlogTagDetail> {
    const out = await apiClient.patch<{ data: BlogTagDetail }>(
      `/api/v1/admin/blog/tags/${encodeURIComponent(id)}`,
      body,
    );
    return out.data;
  },

  async deleteTag(id: string, version: number): Promise<void> {
    await apiClient.delete(
      `/api/v1/admin/blog/tags/${encodeURIComponent(id)}?version=${version}`,
    );
  },

  async getTagInboundReferences(
    id: string,
  ): Promise<BlogTagInboundReferencesResponse> {
    const out = await apiClient.get<{ data: BlogTagInboundReferencesResponse }>(
      `/api/v1/admin/blog/tags/${encodeURIComponent(id)}/inbound-references`,
    );
    return out.data;
  },
};
