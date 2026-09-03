import { cookies, headers } from 'next/headers';
import type { I18nConfigResponse } from '@endora-commerce/contracts';
import { getI18nConfig } from './api/i18n';
import { getPublicSalesChannel } from './api/sales-channel';
import { themeForChannel, type ResolvedStorefrontTheme } from './theme/theme';
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
  /**
   * The token set this request renders in, resolved from the channel's
   * `themeCode` (feature `005-sales-channels`). Stamped onto `<html
   * data-theme>` by the root layout, server-side, so the first paint already
   * carries the channel's brand.
   *
   * The whole decision rather than the code alone: `unknownRequest` is what the
   * document element stamps as `data-theme-requested` when the channel named a
   * theme this storefront does not have (feature 102).
   */
  theme: ResolvedStorefrontTheme;
}

export async function getServerContext(input?: { langOverride?: string | null }): Promise<ServerContext> {
  const h = await headers();
  const jar = await cookies();
  const acceptLanguage = h.get('accept-language');
  const salesChannelCode = h.get('x-sales-channel') ?? undefined;

  // All three resolve on every page. Fetched together rather than in sequence
  // so neither presence nor the channel identity costs a round-trip on the
  // critical path (Constitution VII). The header read moved above this call
  // because the channel read is the one that has to carry `X-Sales-Channel` —
  // asking the backend which channel this is, without telling it, would get the
  // system default on every host.
  const [config, modules, channel] = await Promise.all([
    getI18nConfig(),
    getModulePresence(),
    getPublicSalesChannel(
      salesChannelCode !== undefined ? { salesChannelCode } : {},
    ),
  ]);
  // A channel that could not be read is not a channel with no theme, but the
  // buyer-facing answer is the same one: the reference token set. See
  // `lib/theme/theme.ts` for what "refuses rather than guesses" means here.
  const theme = themeForChannel(channel?.themeCode ?? null, channel?.code ?? salesChannelCode);

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
    theme,
    ctx: {
      ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
      locale,
      ...(currency !== undefined ? { currency } : {}),
      ...(viewerSession !== undefined ? { viewerSession } : {}),
    },
  };
}
