import { cookies, headers } from 'next/headers';
import type { I18nConfigResponse } from '@endora-commerce/contracts';
import { getI18nConfig } from './api/i18n';
import { getModulePresence, type ModulePresenceSet } from './api/module-presence';
import { resolveLocale } from './i18n/locale';
import { getSessionCookie } from './session';
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
  /**
   * The effective enabled-set (feature 073). A page renders a module's
   * contribution only when this says the module is there; it never infers
   * absence from the module's API answering 503, because nearly every
   * storefront fetch already swallows errors into defaults and would keep
   * rendering an empty surface.
   */
  modules: ModulePresenceSet;
}

export async function getServerContext(input?: { langOverride?: string | null }): Promise<ServerContext> {
  // Both resolve on every page. Fetched together rather than in sequence so
  // adding presence costs no extra round-trip latency (Constitution VII).
  const [config, modules] = await Promise.all([getI18nConfig(), getModulePresence()]);
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
  // Issue #265 — who is in front of the page, for the readers that carry a
  // price. Resolved once here rather than per call site so a page cannot ask
  // one surface as the buyer and the next as the public; `apiGetForViewer` is
  // the only reader that acts on it.
  const viewerSession = (await getSessionCookie()) ?? undefined;

  const locale = resolveLocale({
    acceptLanguage,
    langQuery: langCookie ?? input?.langOverride ?? null,
    config,
  });

  return {
    config,
    locale,
    currency,
    modules,
    ctx: {
      ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
      locale,
      ...(currency !== undefined ? { currency } : {}),
      ...(viewerSession !== undefined ? { viewerSession } : {}),
    },
  };
}
