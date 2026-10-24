import { useMemo, type ReactNode } from 'react';
import type { LineGroupsEditorLabels, SplitLineDialogLabels } from '@endora-commerce/admin-kit/components';
import { formatMoney } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { moneyDifference, moneySum, vatByRate } from '@endora-commerce/contracts';

/**
 * Feature 159 — what the order screens share about line groups: the editor's
 * labels from this module's bundle (the kit carries no strings), and a
 * section's summary — item count, net, VAT and gross of its lines (FR-008,
 * FR-060, FR-031). The order's delivery, surcharge and discounts stay in the
 * order's own totals (US5 #3).
 */

/** The `LineGroupsEditor` labels, in the admin language. */
export function useOrderLineGroupLabels(): LineGroupsEditorLabels {
  const t = useTranslation('orders');
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

/** One line as a section summary counts it: its net total and its tax rate, `null` while unknown. */
export interface OrderSummaryLine {
  /** A two-place decimal: a number, or the string the exact arithmetic answers. */
  readonly net: number | string | null;
  readonly taxRate: number | null;
  /**
   * The line's stored gross total, when it has one (a placed order's
   * `lineTotal`): the summary's gross is then the sum of what the lines show,
   * and its VAT the difference.
   */
  readonly gross?: number | string | null;
}

export interface OrderSectionTotals {
  readonly count: number;
  /** All three are `null` unless every line of the section is priced. */
  readonly net: number | null;
  readonly vat: number | null;
  readonly gross: number | null;
}

/**
 * The section's totals by the order's own rule: net is the sum of the lines'
 * net totals, VAT per rate on the sum of the nets at that rate (`vatByRate`).
 * The order's totals stay authoritative — a section may differ from them by a
 * rounding cent. Exact decimal arithmetic (issue #417): the binary sum made
 * 0.70 at 5 % the VAT 0.03.
 */
export function orderSectionTotals(lines: readonly OrderSummaryLine[]): OrderSectionTotals {
  const count = lines.length;
  if (count === 0 || lines.some((line) => line.net === null || line.taxRate === null)) {
    return { count, net: null, vat: null, gross: null };
  }
  const net = moneySum(lines.map((line) => line.net!));
  if (lines.every((line) => line.gross != null)) {
    const gross = moneySum(lines.map((line) => line.gross!));
    return { count, net: Number(net), vat: Number(moneyDifference(gross, net)), gross: Number(gross) };
  }
  // The one VAT method (owner ruling of 2026-10-24): per rate, on the sum of the nets.
  const totals = vatByRate(
    lines.map((line) => ({ net: line.net!, rate: line.taxRate! })),
    'fraction',
  );
  return { count, net: Number(totals.net), vat: Number(totals.vat), gross: Number(totals.gross) };
}

/** "3 items · Net 300,00 zł · VAT 69,00 zł · Gross 369,00 zł". */
export function useOrderSectionSummaryText(): (totals: OrderSectionTotals, currency: string) => string {
  const t = useTranslation('orders');
  const { language } = useTranslationContext();
  return useMemo(() => {
    const plural = new Intl.PluralRules(language);
    return (totals, currency) => {
      const itemsKey = `lineGroups.summary.items.${plural.select(totals.count)}`;
      const items = t(itemsKey, { count: totals.count });
      // A language shipping no form for this count answers the key back: fall back to `other`.
      const parts = [items === itemsKey || items.startsWith('orders.') ? t('lineGroups.summary.items.other', { count: totals.count }) : items];
      if (totals.net !== null) parts.push(t('lineGroups.summary.net', { amount: formatMoney(totals.net, currency) }));
      if (totals.vat !== null) parts.push(t('lineGroups.summary.vat', { amount: formatMoney(totals.vat, currency) }));
      if (totals.gross !== null) parts.push(t('lineGroups.summary.gross', { amount: formatMoney(totals.gross, currency) }));
      return parts.join(' · ');
    };
  }, [t, language]);
}

export function OrderSectionSummary(props: { text: string }): ReactNode {
  return <p className="text-xs tabular-nums text-muted-foreground">{props.text}</p>;
}

/**
 * The *Split line* labels (research N-33), in the admin language, and the
 * accessible name of the button that opens it.
 */
export function useOrderSplitLineLabels(): SplitLineDialogLabels & { action: (context: { name: string }) => string } {
  const t = useTranslation('orders');
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
