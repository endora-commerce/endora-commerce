import type {
  BlogBySlugResponse,
  BlogIndexResponse,
  BlogTagByCodeResponse,
} from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';

export type {
  BlogBySlugResponse,
  BlogIndexResponse,
  BlogTagByCodeResponse,
};

/**
 * Fetch the blog index payload (latest posts + first-level categories
 * + resolved url prefix) for the active channel + locale.
 */
export async function getBlogIndex(
  ctx: RequestContext,
): Promise<BlogIndexResponse | null> {
  try {
    const res = await apiGet<{ data: BlogIndexResponse }>(
      '/api/v1/blog/by-channel',
      ctx,
      {
        revalidate: 300,
        tags: ['blog:index'],
      },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Resolve a single blog slug to either a Category (with paginated posts)
 * or a Post. Returns null on 404 so the caller renders a 404 instead of
 * throwing.
 */
export async function getBlogBySlug(
  slug: string,
  ctx: RequestContext,
  page: number | undefined,
): Promise<BlogBySlugResponse | null> {
  const qs = new URLSearchParams({ slug });
  if (page !== undefined) qs.set('page', String(page));
  try {
    const res = await apiGet<{ data: BlogBySlugResponse }>(
      `/api/v1/blog/by-slug?${qs.toString()}`,
      ctx,
      {
        revalidate: 60,
        tags: ['blog:by-slug', `blog:slug:${slug}`],
      },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Fetch the paginated tag view payload for `<prefix>/tag/<code>`.
 */
export async function getBlogTagByCode(
  code: string,
  ctx: RequestContext,
  page: number | undefined,
): Promise<BlogTagByCodeResponse | null> {
  const qs = new URLSearchParams({ code });
  if (page !== undefined) qs.set('page', String(page));
  try {
    const res = await apiGet<{ data: BlogTagByCodeResponse }>(
      `/api/v1/blog/tag-by-code?${qs.toString()}`,
      ctx,
      {
        revalidate: 60,
        tags: ['blog:tag', `blog:tag:${code}`],
      },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    throw err;
  }
}
