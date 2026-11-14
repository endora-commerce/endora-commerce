import type { ConvertToRfqResult } from '../api/shopping-lists';
import { encodeConversionSkips } from '../batchReport';

/**
 * Where a list → quote-request conversion lands — the counterpart of the cart
 * conversion's redirect. The counts are always carried; the quote request's id
 * only when there is one: `rfqId` is `null` when nothing converted and no quote
 * request was created (issue #1159), and the string `null` must never reach
 * the URL.
 *
 * Issue #1161 — the skipped rows travel too, as the cart conversion's do
 * (`rfqSkips`: ids, reason codes and minimums, never a name), so the page names
 * each with its own reason instead of calling every skip archived.
 */
export function rfqConversionRedirect(
  listId: string,
  result: Pick<ConvertToRfqResult, 'rfqId' | 'added' | 'skipped'>,
): string {
  const params = new URLSearchParams();
  if (result.rfqId !== null) params.set('rfqId', result.rfqId);
  params.set('rfqAdded', String(result.added));
  params.set('rfqSkipped', String(result.skipped.length));
  if (result.skipped.length > 0) params.set('rfqSkips', encodeConversionSkips(result.skipped));
  return `/shopping-lists/${listId}?${params.toString()}`;
}
