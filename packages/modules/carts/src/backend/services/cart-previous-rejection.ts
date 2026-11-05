import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartPreviousRejection } from '@endora-commerce/contracts';
import { Cart } from '../entities/cart.entity.js';
import { CartAuditEntry } from '../entities/cart-audit-entry.entity.js';
import type { CartDroppedLine } from './cart-conversion-service.js';

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
 * Issue #755 — the audit action of a restore, on the basket the lines were
 * restored into. Its metadata is {@link RestoredFromRejection}, and it is what
 * the rejection notice reads back to say what was restored and what was not.
 */
export const LINES_RESTORED_FROM_REJECTION = 'lines_restored_from_rejection' as const;

/** The metadata of a {@link LINES_RESTORED_FROM_REJECTION} audit row. */
export interface RestoredFromRejection {
  fromCartId: string;
  restoredLineCount: number;
  skippedLines: CartDroppedLine[];
}

/**
 * The rejected basket the rejection of {@link previousRejectionOf} answers,
 * loaded, or `null` — shared by the notice and by the restore.
 */
async function rejectionInForce(em: EntityManager, basket: AnsweredBasket): Promise<Cart | null> {
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
  return rejected;
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
 * Issue #755 — with what was restored from it into the basket answered, read
 * from the restore's audit row on that basket: none, when nothing was.
 *
 * Only the buyer's own baskets are read, under their customer filter; an
 * anonymous basket has no owner to have been rejected and reads `null`.
 */
export async function previousRejectionOf(
  em: EntityManager,
  basket: AnsweredBasket,
): Promise<CartPreviousRejection | null> {
  const rejected = await rejectionInForce(em, basket);
  if (!rejected?.rejectedAt) return null;
  const restored = basket.id ? await restoredInto(em, basket.id, rejected.id) : null;
  return {
    cartId: rejected.id,
    rejectedAt: rejected.rejectedAt.toISOString(),
    reason: rejected.rejectedReason ?? null,
    restoredLineCount: restored?.restoredLineCount ?? 0,
    skippedLines: restored?.skippedLines ?? [],
  };
}

/** What a restore from `fromCartId` put into `cartId`, as its audit row recorded it. */
async function restoredInto(
  em: EntityManager,
  cartId: string,
  fromCartId: string,
): Promise<RestoredFromRejection | null> {
  const entry = await em.findOne(CartAuditEntry, { cartId, action: LINES_RESTORED_FROM_REJECTION });
  const metadata = entry?.metadata as Partial<RestoredFromRejection> | undefined;
  if (!metadata || metadata.fromCartId !== fromCartId) return null;
  return {
    fromCartId,
    restoredLineCount: metadata.restoredLineCount ?? 0,
    skippedLines: metadata.skippedLines ?? [],
  };
}

/**
 * Issue #755 (owner ruling 2026-11-05) — the rejected basket whose lines go
 * into `basket`, a basket just opened for its owner, or `null`.
 *
 * The rejection must still be in force ({@link previousRejectionOf}), and the
 * rejected basket must be the owner's most recent on the channel: no basket of
 * theirs there other than `basket` was opened after the rejection. That second
 * rule is what makes the restore happen once — the basket it restores into is
 * itself opened after the rejection, so once it exists no later basket can
 * qualify, whether it was emptied, abandoned or ordered. A working basket
 * (#169) is no basket of the buyer's and does not count.
 */
export async function rejectedBasketToRestore(
  em: EntityManager,
  basket: { id: string; customerAccountId: string; salesChannelId: string },
): Promise<Cart | null> {
  const rejected = await rejectionInForce(em, { ...basket, approvalStatus: 'not_required' });
  if (!rejected?.rejectedAt) return null;
  const openedSince = await em.count(Cart, {
    customerAccountId: basket.customerAccountId,
    salesChannelId: basket.salesChannelId,
    id: { $ne: basket.id },
    status: { $ne: 'working' },
    createdAt: { $gt: rejected.rejectedAt },
  });
  return openedSince > 0 ? null : rejected;
}
