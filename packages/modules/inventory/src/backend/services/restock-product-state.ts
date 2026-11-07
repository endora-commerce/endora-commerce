import { isInsideWindow, type CatalogProductRecord } from '@endora-commerce/contracts';

/** The product fields a restock reads to decide what a queued subscription gets. */
export type RestockProductState = Pick<
  CatalogProductRecord,
  'status' | 'archivedAt' | 'deletedAt' | 'publishFrom' | 'publishUntil'
>;

/**
 * What a restock does with the queued back-in-stock subscriptions of a product.
 *
 * - `send`: mail every queued subscriber and mark the rows notified.
 * - `hold`: send nothing and leave the rows queued.
 * - `cancel`: send nothing and cancel the rows.
 */
export type RestockDisposition = 'send' | 'hold' | 'cancel';

/**
 * Issue #468 (product owner ruling, 2026-11-07). The answer comes from the product's global
 * state only:
 *
 * - Deleted, or not found: `cancel`. A delete cannot be undone, so the product is not coming back.
 * - Archived, globally `inactive`, or outside the global publication window: `hold`. Each of
 *   these can be reversed (`/restore`, switching the product back on, the window opening), and
 *   the subscriber asked to be told when they can buy the product.
 * - Otherwise: `send`.
 *
 * Per-channel, per-language and per-audience availability is not asked: a subscription records
 * no channel and no language to ask it at (#696).
 */
export function restockDisposition(
  product: RestockProductState | null,
  now: Date,
): RestockDisposition {
  if (product === null || product.deletedAt) return 'cancel';
  if (product.archivedAt || product.status !== 'active') return 'hold';
  const window = { from: product.publishFrom ?? null, until: product.publishUntil ?? null };
  if (!isInsideWindow(window, now)) return 'hold';
  return 'send';
}
