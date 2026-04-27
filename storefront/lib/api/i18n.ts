import type { I18nConfigResponse } from '@b2b/contracts';
import { apiGet, type RequestContext } from './client';

/**
 * Public i18n config. Cached aggressively because the admin rarely
 * changes the language pool; pages that mutate it should `revalidateTag`
 * after writing.
 */
export async function getI18nConfig(ctx: RequestContext = {}): Promise<I18nConfigResponse> {
  const res = await apiGet<{ data: I18nConfigResponse }>(
    '/api/v1/i18n/config',
    ctx,
    { revalidate: 600, tags: ['i18n:config'] },
  );
  return res.data;
}
