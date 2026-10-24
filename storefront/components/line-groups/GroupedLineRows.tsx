import { Fragment, type ReactNode } from 'react';
import {
  arrangeLineGroups,
  lineAmountHalfUp,
  moneyDifference,
  moneySum,
  taxAmountHalfUp,
  type LineGroup,
} from '@endora-commerce/contracts';
import { tForLocale, type MessageKey } from '../../lib/i18n/messages';
import { formatMoney } from '../../lib/i18n/money';

/**
 * Feature 159 — a document's line groups, read-only, inside an existing
 * `<tbody>` (`specs/159-quote-request-item-groups/contracts/ui.md` §3).
 *
 * For each non-empty group, in order: a heading row, the page's own line rows
 * (`renderRow`), and a summary row; then the ungrouped lines under *Other
 * items*. With no non-empty group it renders the line rows alone, so a document
 * never grouped renders exactly the markup it always did (SC-004). A server
 * component: no control of any kind changes a group.
 */

export interface GroupableLine {
  readonly id: string;
  readonly groupId?: string | null;
  readonly position?: number;
}

/** A section's totals by a page's own rule; `null` = the rule cannot total it. */
export interface SectionTotals {
  readonly count: number;
  readonly net: number | null;
  readonly vat: number | null;
  readonly gross: number | null;
}

/** The quote page's rule: agreed prices on every line, else desired prices on every line, else none. */
export function quoteSectionTotals(
  lines: ReadonlyArray<{ quantity: number; agreedUnitPrice: number | null; desiredUnitPrice: number | null }>,
  taxRate: number,
): SectionTotals {
  // Exact decimal arithmetic (issue #417): the VAT on the net total, half-up.
  const sum = (pick: (line: (typeof lines)[number]) => number | null): string | null =>
    lines.every((line) => pick(line) !== null)
      ? moneySum(lines.map((line) => lineAmountHalfUp(pick(line)!, line.quantity)))
      : null;
  const net = sum((line) => line.agreedUnitPrice) ?? sum((line) => line.desiredUnitPrice);
  if (lines.length === 0 || net === null) return { count: lines.length, net: null, vat: null, gross: null };
  const vat = taxAmountHalfUp(net, taxRate, 'fraction');
  return { count: lines.length, net: Number(net), vat: Number(vat), gross: Number(moneySum([net, vat])) };
}

/**
 * The order page's rule (feature 159, FR-031): net from each line's unit price
 * and quantity, gross the sum of the line totals the page shows (`lineTotal` is
 * gross), VAT the difference — so a summary adds up the rows above it.
 */
export function orderSectionTotals(
  lines: ReadonlyArray<{ quantity: number; unitPrice: number; lineTotal: number }>,
): SectionTotals {
  if (lines.length === 0) return { count: 0, net: null, vat: null, gross: null };
  // Exact decimal arithmetic (issue #417).
  const net = moneySum(lines.map((line) => lineAmountHalfUp(line.unitPrice, line.quantity)));
  const gross = moneySum(lines.map((line) => line.lineTotal));
  return { count: lines.length, net: Number(net), vat: Number(moneyDifference(gross, net)), gross: Number(gross) };
}

/**
 * "3 items · net 120,00 zł · VAT 27,60 zł · gross 147,60 zł", in the page's
 * language. Amounts in the currency's own conventions unless the page formats
 * its money in a locale of its own (`moneyLocale`).
 */
export function sectionSummaryText(totals: SectionTotals, currency: string, locale: string, moneyLocale?: string): string {
  const t = tForLocale(locale);
  const form = new Intl.PluralRules(locale).select(totals.count);
  const itemsKey = `lineGroups.summary.items.${form}` as MessageKey;
  const parts = [t(itemsKey).replace('{count}', String(totals.count))];
  const money = (n: number): string => formatMoney(n, currency, moneyLocale);
  if (totals.net !== null) parts.push(t('lineGroups.summary.net').replace('{amount}', money(totals.net)));
  if (totals.vat !== null) parts.push(t('lineGroups.summary.vat').replace('{amount}', money(totals.vat)));
  if (totals.gross !== null) parts.push(t('lineGroups.summary.gross').replace('{amount}', money(totals.gross)));
  return parts.join(' · ');
}

export interface GroupedLineRowsProps<T extends GroupableLine> {
  readonly groups: readonly LineGroup[];
  /** The reply's lines, in its display order. */
  readonly lines: readonly T[];
  /** The table's column count, for the spanning rows. */
  readonly columnCount: number;
  readonly locale: string;
  readonly currency: string;
  readonly taxRate: number;
  readonly renderRow: (line: T) => ReactNode;
  /** A section's totals; the quote page's rule when absent. */
  readonly totals?: (lines: readonly T[]) => SectionTotals;
  /** The locale the page formats its money in; the currency's own when absent. */
  readonly moneyLocale?: string;
}

export function GroupedLineRows<T extends GroupableLine>(props: GroupedLineRowsProps<T>): ReactNode {
  const { groups, lines, columnCount, locale, currency, renderRow } = props;
  const sections = arrangeLineGroups(groups, lines);
  if (!sections.some((section) => section.kind === 'group')) {
    return <>{lines.map((line) => renderRow(line))}</>;
  }
  const t = tForLocale(locale);
  const totalsOf =
    props.totals ??
    ((sectionLines: readonly T[]): SectionTotals =>
      quoteSectionTotals(sectionLines as unknown as Parameters<typeof quoteSectionTotals>[0], props.taxRate));
  return (
    <>
      {sections.map((section) => (
        <Fragment key={section.group?.id ?? 'ungrouped'}>
          <tr className="line-group__heading">
            <th colSpan={columnCount} scope="colgroup" style={{ textAlign: 'left' }}>
              {section.group?.name ?? t('lineGroups.otherItems')}
            </th>
          </tr>
          {section.lines.map((line) => renderRow(line))}
          <tr className="line-group__summary">
            <td colSpan={columnCount} className="muted" style={{ fontSize: 12 }}>
              {sectionSummaryText(totalsOf(section.lines), currency, locale, props.moneyLocale)}
            </td>
          </tr>
        </Fragment>
      ))}
    </>
  );
}
