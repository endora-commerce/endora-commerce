import type { PublicSalesChannel, PublicSalesChannelResponse } from '@endora-commerce/contracts';
import { apiGet, type RequestContext } from './client';

/**
 * The resolved sales channel for this request — `GET
 * /api/v1/storefront/sales-channel` (feature `005-sales-channels`, section C.1).
 *
 * The backend resolves the channel from the api-key binding, the
 * `X-Sales-Channel` header this client already threads, `?salesChannel`, the
 * host map or the system default. This read is what brings the *answer* back:
 * before it existed the storefront knew a channel **code** (whatever the proxy
 * stamped) and none of the channel's identity — not its theme, not its language
 * or currency scopes, not its logo.
 *
 * Cached under the `channel:<code>` tag with a 5-minute window, matching the
 * other chrome reads. Channel identity changes at operator speed, and a
 * per-request round trip on the critical path of every page would be paid by
 * every buyer.
 */
export const SALES_CHANNEL_TAG = 'channel:identity';

/**
 * `null` when the channel cannot be read.
 *
 * Never throws: this is on the render path of every page through the root
 * layout, and an unreachable backend must not blank the shop. The caller's
 * answer to `null` is the storefront's own default theme — see
 * `lib/theme/theme.ts` — which is the same answer a channel that names no
 * theme gets, and is visibly the reference brand rather than a guess.
 */
export async function getPublicSalesChannel(
  ctx: RequestContext = {},
): Promise<PublicSalesChannel | null> {
  try {
    const res = await apiGet<PublicSalesChannelResponse>(
      '/api/v1/storefront/sales-channel',
      ctx,
      {
        revalidate: 300,
        tags: [SALES_CHANNEL_TAG, `channel:${ctx.salesChannelCode ?? 'default'}`],
      },
    );
    return res.data;
  } catch {
    return null;
  }
}
