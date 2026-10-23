import type { PriceBookRowPrice, PriceBookSelectionKind } from '@endora-commerce/contracts';
import type { CellRefusal, EditLine } from './book-edit-state.js';
import type { Translate } from './cell-labels.js';

/**
 * How the grid names a line, a price kind and a refusal (feature 161, FR-006,
 * FR-007, FR-016, FR-017). Keys are this module's own bundle's.
 */

export const LINE_KINDS: readonly PriceBookSelectionKind[] = ['all', 'attribute', 'category', 'category_attribute', 'product', 'variant'];

export const kindLabel = (t: Translate, kind: PriceBookSelectionKind): string => t(`grid.kind.${kind}`);

/** A line's label and its second line (identifier and kind). */
export function lineLabel(t: Translate, line: EditLine): { readonly label: string; readonly detail: string } {
  const l = line.labels;
  const attribute = l.attributeLabel && l.attributeValueLabel ? `${l.attributeLabel}: ${l.attributeValueLabel}` : (line.selection.attribute ? `${line.selection.attribute.key}: ${line.selection.attribute.value}` : '');
  switch (line.kind) {
    case 'all':
      return { label: t('grid.line.all'), detail: kindLabel(t, 'all') };
    case 'attribute':
      return { label: attribute, detail: kindLabel(t, 'attribute') };
    case 'category':
      return { label: l.categoryPath ?? t('grid.line.unknown'), detail: kindLabel(t, 'category') };
    case 'category_attribute':
      return { label: `${l.categoryPath ?? t('grid.line.unknown')} · ${attribute}`, detail: kindLabel(t, 'category_attribute') };
    case 'product':
      return { label: l.productName ?? l.productSku ?? t('grid.line.unknown'), detail: [kindLabel(t, 'product'), l.productSku].filter(Boolean).join(' · ') };
    case 'variant':
      return { label: l.variantSku ?? l.variantLabel ?? t('grid.line.unknown'), detail: [kindLabel(t, 'variant'), l.variantLabel].filter(Boolean).join(' · ') };
  }
}

/** The words beside a price: its kind, and for a percentage its reference (FR-007). */
export function priceKindText(
  t: Translate,
  price: PriceBookRowPrice,
  reference: 'base' | 'catalogue' | 'productBase',
): string {
  if (price.type === 'fixed') return t('grid.priceKind.fixed');
  if (price.type === 'amount') return t('grid.priceKind.amount');
  return t(`grid.priceKind.percent.${reference}`);
}

/** Why the browser refused a cell's text, in words. */
export function refusalText(t: Translate, refusal: CellRefusal): string {
  switch (refusal.reason) {
    case 'tooManyDecimals':
      return t('grid.refusal.tooManyDecimals', { max: refusal.max });
    case 'percentOutOfRange':
      return t('grid.refusal.percentOutOfRange', { min: refusal.min, max: refusal.max });
    default:
      return t(`grid.refusal.${refusal.reason}`);
  }
}

export const inactiveText = (t: Translate, reason: NonNullable<EditLine['inactiveReason']>): string => t(`grid.inactive.${reason}`);
