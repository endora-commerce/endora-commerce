import type { SalesChannelMembershipPort } from '../ports/sales-channel.js';
import { currentSalesChannel } from './sales-channel-resolver.middleware.js';

/**
 * The assortment gate the **product acquisition seams** owe (issue #259,
 * Constitution XII).
 *
 * ## What was wrong
 *
 * Issue #227 taught every buyer-facing product path to ask
 * `isProductVisibleTo(product, audience)`, and that predicate says in writing
 * that it is *not* the channel answer — the channel is "a second filter every
 * buyer-facing path owes on top of this one". The view side pays it: a listing
 * page and a product detail both narrow to
 * `sales_channel_products` before they answer. The **acquisition** side did
 * not. A product published on one channel only was still reachable by id and by
 * SKU through cart add, comparison add, a quote-request line, a saved list and
 * a pasted quick-order SKU list — every one of them holding an identifier the
 * caller supplied, and every one of them applying the audience filter and no
 * channel test at all.
 *
 * ## Why this is not folded into `isProductVisibleTo`
 *
 * Owner ruling, 2026-08-21. The channel is a property of the **request**, not
 * of the viewer's relationship to the product: `isProductVisibleTo(product,
 * audience)` answers "may this audience see this product at all", and it is
 * pure, synchronous and shared by two SQL restatements with derived parity
 * tests. Folding an asynchronous membership read into it would merge two
 * questions, change a published contract shape and rewrite every parity test to
 * answer for a dimension neither SQL site has. The two filters stay separate
 * and every seam applies both.
 *
 * ## `null` is a real answer, and it is not "no channel"
 *
 * The resolver middleware runs as an `onRequest` hook on every `/api/v1/*` path
 * and falls back to the system-default channel, so **inside a request there is
 * always a channel** — including an anonymous one, including an admin one. The
 * scope slot is empty only where there is no request at all: a CLI entry point,
 * a BullMQ worker, a seed, a fixture calling the service directly. There, the
 * honest answer is that this acquisition is happening on no channel, so there
 * is nothing to narrow against — and {@link productIdsInRequestChannel} says so
 * with `null` rather than with an empty set or with a channel it made up.
 *
 * Narrowing against the system-default channel instead would be the fabrication
 * D-47…D-51 drained under four spellings (`'default'`, the nil UUID, the empty
 * string, `randomUUID()`): it would refuse an operator's own action because a
 * channel nobody named happens not to publish the row. The return type is what
 * keeps the two apart — `ReadonlySet` and `null` are different types, so a
 * caller cannot mistake "the channel publishes none of these" for "there was no
 * channel to ask about", which is the mistake an empty set invites. It is the
 * same shape, and for the same reason, as `allowedIdsFor(): Promise<string[] |
 * null>`.
 *
 * ## The read itself
 *
 * Through {@link SalesChannelMembershipPort.filterEntityIdsInChannel} — the
 * sanctioned bridge accessor (Constitution XII), the same one
 * `catalog.filterByChannel` narrows a listing page with. No statement against
 * `sales_channel_products` is written here; `check:module-boundary`'s SQL
 * predicate would be right to report one.
 */
export async function productIdsInRequestChannel(
  membership: SalesChannelMembershipPort,
  productIds: readonly string[],
): Promise<ReadonlySet<string> | null> {
  const channel = currentSalesChannel();
  if (!channel) return null;
  if (productIds.length === 0) return new Set<string>();
  const published = await membership.filterEntityIdsInChannel(
    channel.id,
    'product',
    Array.from(new Set(productIds)),
  );
  return new Set(published);
}

/**
 * `true` when the request's channel does **not** publish `productId` — the
 * single-product spelling of {@link productIdsInRequestChannel}, for the seams
 * that acquire one product at a time.
 *
 * Reads as the refusal it guards (`if (await outOfRequestChannel(…)) throw`),
 * which is what keeps the `null` arm from being written as a silent `true` at
 * five call sites: outside a request there is no channel to be out of, so the
 * answer is `false` and the seam proceeds on the audience filter alone.
 */
export async function outOfRequestChannel(
  membership: SalesChannelMembershipPort,
  productId: string,
): Promise<boolean> {
  const published = await productIdsInRequestChannel(membership, [productId]);
  return published !== null && !published.has(productId);
}
