import type { CmsResolvedBlock, CmsResolvedHook, CmsResolvedPage } from '@endora-commerce/contracts';
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
 * A published CMS slug is lowercase (`cmsSlugRe` in `packages/contracts`).
 * A URL bar and a hand-written link may use different casing; normalize before
 * calling the API, so one row is asked for under one key and one cache tag.
 */
export function normalizeCmsUrlPath(path: string): string {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase())
    .join('/');
}

/**
 * Fetch a published CMS page by its slug, resolved for the request's sales
 * channel and language
 * (`specs/105-cms-root-page-urls/contracts/cms-page-url.md` §3.1).
 * Returns `null` on 404, so a caller can render a 404 in place of throwing.
 *
 * This is the only CMS page reader. A `path`-addressed one stood here until
 * feature 105 and called an endpoint no module has ever registered, so every
 * URL under it resolved to a 404 indistinguishable from an empty CMS; §3.2 is
 * why that endpoint is not built rather than that caller repaired.
 */
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
