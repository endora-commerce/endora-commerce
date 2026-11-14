import type { ConvertToRfqResult } from '../api/shopping-lists';

/**
 * Where a list → quote-request conversion lands — the counterpart of the cart
 * conversion's redirect. The counts are always carried; the quote request's id
 * only when there is one: `rfqId` is `null` when nothing converted and no quote
 * request was created (issue #1159), and the string `null` must never reach
 * the URL.
 */
export function rfqConversionRedirect(
  listId: string,
  result: Pick<ConvertToRfqResult, 'rfqId' | 'added' | 'skipped'>,
): string {
  const params = new URLSearchParams();
  if (result.rfqId !== null) params.set('rfqId', result.rfqId);
  params.set('rfqAdded', String(result.added));
  params.set('rfqSkipped', String(result.skipped.length));
  return `/shopping-lists/${listId}?${params.toString()}`;
}
