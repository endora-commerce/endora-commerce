import { unitPriceDisplayText } from '@endora-commerce/contracts';
import type { RfqDiffEntry } from '../api/rfq';
import { format } from '../i18n/format';
import { tForLocale } from '../i18n/messages';

/**
 * One entry of the customer's comparison with the last revision they saw, as
 * a sentence. Moved out of the quote request page so it can be asserted; the
 * line and note sentences read as they did. Feature 159 adds the grouping
 * notice, which names nothing: the arrangement of the lines changed; and, for a
 * product on several lines, the group of the line an entry is about (research
 * N-32) — *Other items* for an ungrouped one.
 */
export function describeRfqDiff(d: RfqDiffEntry, locale: string): string {
  const t = tForLocale(locale);
  const line = (entry: { productName: string; groupName?: string | null }): string =>
    entry.groupName === undefined
      ? entry.productName
      : `${entry.productName} (${entry.groupName ?? t('lineGroups.otherItems')})`;
  const price = (value: number | null): string =>
    value !== null ? unitPriceDisplayText(value) : '\u2014';
  switch (d.kind) {
    case 'header_note':
      return format(t('quoteRequest.diff.headerNote'), {
        before: d.before ?? '\u2014',
        after: d.after ?? '\u2014',
      });
    case 'line_added':
      return d.agreedUnitPrice !== null
        ? format(t('quoteRequest.diff.lineAddedAt'), {
            line: line(d),
            quantity: String(d.quantity),
            price: unitPriceDisplayText(d.agreedUnitPrice),
          })
        : format(t('quoteRequest.diff.lineAdded'), { line: line(d), quantity: String(d.quantity) });
    case 'line_removed':
      return format(t('quoteRequest.diff.lineRemoved'), { line: line(d) });
    case 'line_quantity':
      return format(t('quoteRequest.diff.lineQuantity'), {
        line: line(d),
        before: String(d.before),
        after: String(d.after),
      });
    case 'line_agreed_unit_price':
      // Unit prices, at their significant places up to four (owner ruling of 2026-10-25).
      return format(t('quoteRequest.diff.linePrice'), {
        line: line(d),
        before: price(d.before),
        after: price(d.after),
      });
    case 'grouping':
      return t('quoteRequest.diff.grouping');
  }
}
