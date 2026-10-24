import { useMemo, type ReactNode } from 'react';
import type { LineGroupsEditorLabels, SplitLineDialogLabels } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { compareDecimals, moneyDifference, moneySum, taxAmountHalfUp } from '@endora-commerce/contracts';
import { useRfqNumberFormat } from './number-format.js';

/**
 * Feature 159 — what the quote request screens share about line groups: the
 * editor's labels from this module's bundle (the kit carries no strings), and
 * a section's summary by the screens' own totals rule (research R-15).
 */

/** The `LineGroupsEditor` labels, in the admin language. */
export function useQuoteLineGroupLabels(): LineGroupsEditorLabels {
  const t = useTranslation('quote_requests');
  return useMemo(() => {
    const g = (key: string, params?: Record<string, string | number>): string => t(`lineGroups.${key}`, params);
    return {
      addGroup: g('addGroup'),
      groupName: g('groupName'),
      groupNamePlaceholder: g('groupNamePlaceholder'),
      nameRequired: g('nameRequired'),
      deleteGroup: ({ name }) => g('deleteGroup', { name }),
      deletedAnnouncement: ({ name }) => g('deletedAnnouncement', { name }),
      ungrouped: g('ungrouped'),
      emptyGroup: g('emptyGroup'),
      moveToGroup: ({ name }) => g('moveToGroup', { name }),
      moveGroupUp: ({ name }) => g('moveUp', { name }),
      moveGroupDown: ({ name }) => g('moveDown', { name }),
      limitReached: ({ max }) => g('limitReached', { max }),
      instructions: g('instructions'),
      reorder: {
        itemGrabbed: (c) => g('announce.grabbed', { ...c }),
        itemMoved: (c) => g('announce.moved', { ...c }),
        itemDropped: (c) => g('announce.dropped', { ...c }),
        itemCancelled: (c) => g('announce.cancelled', { ...c }),
        groupGrabbed: (c) => g('announce.groupGrabbed', { ...c }),
        groupMoved: (c) => g('announce.groupMoved', { ...c }),
        groupDropped: (c) => g('announce.groupDropped', { ...c }),
        groupCancelled: (c) => g('announce.groupCancelled', { ...c }),
        atStart: ({ name }) => g('announce.atStart', { name }),
        atEnd: ({ name }) => g('announce.atEnd', { name }),
        itemHandle: ({ name }) => g('announce.handle', { name }),
        groupHandle: ({ name }) => g('announce.groupHandle', { name }),
      },
    };
  }, [t]);
}

/** One line as a section summary counts it. */
export interface SummaryLine {
  /** Net line total by the screen's rule; `null` = not priced. */
  readonly net: number | null;
  /** The line's reference total (list price × quantity); `null` = none. */
  readonly reference: number | null;
}

export interface SectionTotals {
  readonly count: number;
  /** `null` unless every line is priced — the screen's own "every line or none". */
  readonly net: number | null;
  readonly vat: number | null;
  readonly gross: number | null;
  /** Only when every line is priced and has a reference, and the difference is positive. */
  readonly discount: number | null;
}


/** `taxRate: null` — a screen that shows no VAT (the create screen): net only. */
export function sectionTotals(lines: readonly SummaryLine[], taxRate: number | null): SectionTotals {
  const count = lines.length;
  if (count === 0 || lines.some((line) => line.net === null)) {
    return { count, net: null, vat: null, gross: null, discount: null };
  }
  // Exact decimal arithmetic (issue #417).
  const net = moneySum(lines.map((line) => line.net!));
  // The section's VAT from its net, as the PDF computes it; the document total
  // stays authoritative (a section may differ from it by a cent).
  const vat = taxRate === null ? null : taxAmountHalfUp(net, taxRate, 'fraction');
  const everyReference = lines.every((line) => line.reference !== null);
  const reference = everyReference ? moneySum(lines.map((line) => line.reference!)) : null;
  const discount =
    reference !== null && compareDecimals(reference, net) > 0 ? Number(moneyDifference(reference, net)) : null;
  return {
    count,
    net: Number(net),
    vat: vat === null ? null : Number(vat),
    gross: vat === null ? null : Number(moneySum([net, vat])),
    discount,
  };
}

/** "3 items · Net 300.00 PLN · VAT 69.00 PLN · Gross 369.00 PLN · Discount 12.00 PLN". */
export function useSectionSummaryText(): (totals: SectionTotals, currency: string | null) => string {
  const t = useTranslation('quote_requests');
  const { language } = useTranslationContext();
  const format = useRfqNumberFormat();
  return useMemo(() => {
    const plural = new Intl.PluralRules(language);
    return (totals, currency) => {
      const form = plural.select(totals.count);
      const itemsKey = `lineGroups.summary.items.${form}`;
      const items = t(itemsKey, { count: totals.count });
      const parts = [items.startsWith('quote_requests.') ? t('lineGroups.summary.items.other', { count: totals.count }) : items];
      const money = (n: number): string => (currency === null ? format.amount(n) : format.money(n, currency));
      if (totals.net !== null) parts.push(t('lineGroups.summary.net', { amount: money(totals.net) }));
      if (totals.vat !== null) parts.push(t('lineGroups.summary.vat', { amount: money(totals.vat) }));
      if (totals.gross !== null) parts.push(t('lineGroups.summary.gross', { amount: money(totals.gross) }));
      if (totals.discount !== null) parts.push(t('lineGroups.summary.discount', { amount: money(totals.discount) }));
      return parts.join(' · ');
    };
  }, [t, language, format]);
}

export function SectionSummary(props: { text: string }): ReactNode {
  return <p className="text-xs tabular-nums text-muted-foreground">{props.text}</p>;
}

/**
 * The *Split line* labels (research N-33), in the admin language, and the
 * accessible name of the button that opens it.
 */
export function useQuoteSplitLineLabels(): SplitLineDialogLabels & { action: (context: { name: string }) => string } {
  const t = useTranslation('quote_requests');
  return useMemo(() => {
    const g = (key: string, params?: Record<string, string | number>): string => t(`lineGroups.split.${key}`, params);
    return {
      action: ({ name }) => g('action', { name }),
      title: ({ name }) => g('title', { name }),
      quantity: g('quantity'),
      quantityHelp: (c) => g('quantityHelp', { ...c }),
      quantityInvalid: (c) => g('quantityInvalid', { ...c }),
      target: g('target'),
      confirm: g('confirm'),
      cancel: g('cancel'),
    };
  }, [t]);
}
