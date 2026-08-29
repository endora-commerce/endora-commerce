import type { FastifyInstance } from 'fastify';
import type { PublicSalesChannel } from '@endora-commerce/contracts';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';

/**
 * Public read of the resolved sales channel.
 *
 *   GET /api/v1/storefront/sales-channel
 *
 * `PublicSalesChannelSchema` has existed since feature `005-sales-channels`
 * and its own doc block describes this endpoint as "what the storefront app
 * fetches on first paint to know its theme / language / currency". The schema
 * shipped; the route did not. Measured on 2026-08-29: the path appeared in the
 * repository exactly twice, in that comment and in the 005 prose contract, and
 * in no route registration anywhere — so `theme_code`, `logoAssetId`, and the
 * per-channel language and currency scopes had no way of reaching the buyer's
 * first paint at all.
 *
 * ## Channel resolution
 *
 * `getResolvedChannel()` — the sanctioned accessor (Constitution XII). The
 * resolver middleware has already filled the request scope from the api-key
 * binding, the `X-Sales-Channel` header, `?salesChannel`, the host map or the
 * system default, in that order; re-deriving any of that here would be a second
 * answer to a question the platform has already answered, and would be the
 * hand-rolled query Principle XII refuses. Nothing in this file reads
 * `sales_channels` or any bridge table.
 *
 * ## Why the module gate is not a hazard here
 *
 * `sales_channels` declares `activation.nonDeactivatable`, so the seam
 * `ctx.routes` wraps this registration in has no off state to take the
 * storefront's first paint down with. The route would still be the wrong place
 * for a fallback if it did: a buyer-facing page that cannot learn its channel
 * is answered by the storefront's own default theme, not by a backend that
 * invents a channel.
 */
export async function registerSalesChannelsStorefrontRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/storefront/sales-channel', async () => {
    const channel = getResolvedChannel();
    const data: PublicSalesChannel = {
      code: channel.code,
      name: channel.name,
      defaultLanguage: channel.defaultLanguage,
      defaultCurrency: channel.defaultCurrency,
      languages: [...channel.languages],
      currencies: [...channel.currencies],
      themeCode: channel.themeCode,
      // Null for the same reason the admin detail returns null: resolving an
      // asset id to an absolute URL needs the assets module, and this route is
      // not the merge request that adds that edge. `logoAssetId` is on the
      // admin shapes and the public schema deliberately carries a URL rather
      // than an id, so the two are answered together or not at all. Recorded
      // here rather than left to be rediscovered — the theme half of this
      // schema is the half this change makes true.
      logoUrl: null,
    };
    return { data };
  });
}
