import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartPreviousRejection } from '@endora-commerce/contracts';
import { Cart } from '../entities/cart.entity.js';

/**
 * The basket a cart answer describes, as far as {@link previousRejectionOf}
 * needs it — the fields of the answer itself, so no second read of it.
 */
export interface AnsweredBasket {
  id: string | null;
  customerAccountId: string | null;
  salesChannelId: string | null;
  approvalStatus: string;
}

/**
 * The rejection of the buyer's previous basket on the channel (issue #650), or
 * `null`.
 *
 * A rejection closes the basket (`status = 'rejected'`), so the buyer's next
 * read is a new active basket that cannot itself say it was rejected. This is
 * what tells them: the most recent rejected basket of theirs on the channel,
 * while
 *
 *  - the basket being answered has not been sent for approval since
 *    (`not_required`) — once it has, the new decision is the one that matters;
 *  - no basket of theirs on the channel was completed after the rejection —
 *    an order placed, or a quote request made, since is the answer to it.
 *    `completed` with `createdAt` after the rejection, so the rejected basket
 *    itself, created before it, never counts.
 *
 * Only the buyer's own baskets are read, under their customer filter; an
 * anonymous basket has no owner to have been rejected and reads `null`.
 */
export async function previousRejectionOf(
  em: EntityManager,
  basket: AnsweredBasket,
): Promise<CartPreviousRejection | null> {
  const { customerAccountId, salesChannelId } = basket;
  if (!customerAccountId || !salesChannelId) return null;
  if (basket.approvalStatus !== 'not_required') return null;

  const rejected = await em.findOne(
    Cart,
    {
      customerAccountId,
      salesChannelId,
      status: 'rejected',
      rejectedAt: { $ne: null },
      ...(basket.id ? { id: { $ne: basket.id } } : {}),
    },
    { orderBy: { rejectedAt: 'desc' } },
  );
  if (!rejected?.rejectedAt) return null;

  const orderedSince = await em.count(Cart, {
    customerAccountId,
    salesChannelId,
    status: 'completed',
    createdAt: { $gt: rejected.rejectedAt },
  });
  if (orderedSince > 0) return null;

  return {
    cartId: rejected.id,
    rejectedAt: rejected.rejectedAt.toISOString(),
    reason: rejected.rejectedReason ?? null,
  };
}
