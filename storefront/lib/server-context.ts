import { cookies, headers } from 'next/headers';
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
 * proxy / multi-storefront deployment can stamp it per-host. When no proxy
 * stamps the header (local dev, single-channel deployment), the code is
 * left undefined and the backend resolves its system-default channel.
 */
export interface ServerContext {
  config: I18nConfigResponse;
  locale: string;
  /** Buyer-selected display currency (from the `currency` cookie), or undefined. */
  currency: string | undefined;
  ctx: RequestContext;
}

export async function getServerContext(input?: { langOverride?: string | null }): Promise<ServerContext> {
  const config = await getI18nConfig();
  const h = await headers();
  const jar = await cookies();
  const acceptLanguage = h.get('accept-language');
  const salesChannelCode = h.get('x-sales-channel') ?? undefined;

  // The header language/currency switchers persist the buyer's choice in
  // cookies (the root layout that renders the header can't read `?lang`
  // query params). The cookie-set language takes priority over the explicit
  // override and the Accept-Language header.
  const langCookie = jar.get('lang')?.value ?? null;
  const currency = jar.get('currency')?.value || undefined;

  const locale = resolveLocale({
    acceptLanguage,
    langQuery: langCookie ?? input?.langOverride ?? null,
    config,
  });

  return {
    config,
    locale,
    currency,
    ctx: {
      ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
      locale,
      ...(currency !== undefined ? { currency } : {}),
    },
  };
}
