import type { CmsPage } from '@b2b/contracts';
import { apiGet, type RequestContext } from './client';

/**
 * Fetch a published CMS page by its kebab-case path. Returns null on 404
 * so caller pages can render a 404 in place of throwing.
 */
export async function getCmsPage(
  path: string,
  ctx: RequestContext,
): Promise<CmsPage | null> {
  try {
    const res = await apiGet<{ data: CmsPage }>(`/api/v1/cms/pages/${path}`, ctx, {
      revalidate: 300,
      tags: ['cms:page', `cms:page:${path}`],
    });
    return res.data;
  } catch (err) {
    if (err instanceof Error && (err as { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}
