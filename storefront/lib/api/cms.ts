import type { CmsPage, CmsResolvedBlock, CmsResolvedHook, CmsResolvedPage } from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';

/**
 * Fetch a published CMS block by its code (per the request's sales channel +
 * language). Returns null on 404 so callers can fall back to default content.
 */
export async function getCmsBlockByCode(
  code: string,
  ctx: RequestContext,
): Promise<CmsResolvedBlock | null> {
  const qs = new URLSearchParams({ code });
  if (ctx.locale) qs.set('language', ctx.locale);
  try {
    const res = await apiGet<{ data: CmsResolvedBlock }>(
      `/api/v1/cms/blocks/by-code?${qs.toString()}`,
      ctx,
      { revalidate: 60, tags: ['cms:block', `cms:block:${code}`] },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Public CMS paths must match `cmsPagePathSchema` (lowercase kebab segments).
 * URL bar and links may use different casing; normalize before calling the API.
 */
export function normalizeCmsUrlPath(path: string): string {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase())
    .join('/');
}

/**
 * Fetch a published CMS page by its kebab-case path. Returns null on 404
 * so caller pages can render a 404 in place of throwing.
 */
export async function getCmsPage(
  path: string,
  ctx: RequestContext,
): Promise<CmsPage | null> {
  const canonical = normalizeCmsUrlPath(path);
  try {
    const res = await apiGet<{ data: CmsPage }>(`/api/v1/cms/pages/${canonical}`, ctx, {
      revalidate: 300,
      tags: ['cms:page', `cms:page:${canonical}`],
    });
    return res.data;
  } catch (err) {
    if (err instanceof Error && (err as { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

export async function getCmsPageBySlug(
  slug: string,
  ctx: RequestContext,
): Promise<CmsResolvedPage | null> {
  const canonical = normalizeCmsUrlPath(slug);
  const qs = new URLSearchParams({ slug: canonical });
  if (ctx.locale) qs.set('language', ctx.locale);
  try {
    const res = await apiGet<{ data: CmsResolvedPage }>(
      `/api/v1/cms/pages/by-slug?${qs.toString()}`,
      ctx,
      {
        revalidate: 60,
        tags: ['cms:page', `cms:page:${canonical}`],
      },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function getCmsHookByCode(
  code: string,
  ctx: RequestContext,
): Promise<CmsResolvedHook | null> {
  const qs = new URLSearchParams({ code });
  if (ctx.locale) qs.set('language', ctx.locale);
  try {
    const res = await apiGet<{ data: CmsResolvedHook }>(
      `/api/v1/cms/hooks/by-code?${qs.toString()}`,
      ctx,
      {
        revalidate: 60,
        tags: ['cms:hook', `cms:hook:${code}`],
      },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}
