import { headers } from 'next/headers';
import type { I18nConfigResponse } from '@b2b/contracts';
import { getI18nConfig } from './api/i18n';
import { resolveLocale } from './i18n/locale';
import type { RequestContext } from './api/client';

/**
 * Per-request context resolution. Pages call `getRequestContext()` once
 * and pass the result down into `lib/api/*` calls so every backend
 * request carries the same Sales Channel + locale.
 *
 * The Sales Channel header is read from `X-Sales-Channel` so a reverse
 * proxy / multi-storefront deployment can stamp it per-host.
 */
export interface ServerContext {
  config: I18nConfigResponse;
  locale: string;
  ctx: RequestContext;
}

export async function getServerContext(input?: { langOverride?: string | null }): Promise<ServerContext> {
  const config = await getI18nConfig();
  const h = await headers();
  const acceptLanguage = h.get('accept-language');
  const salesChannelCode = h.get('x-sales-channel') ?? undefined;

  const locale = resolveLocale({
    acceptLanguage,
    langQuery: input?.langOverride ?? null,
    config,
  });

  return {
    config,
    locale,
    ctx: {
      ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
      locale,
    },
  };
}
