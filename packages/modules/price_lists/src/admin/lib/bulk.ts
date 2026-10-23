import { formatUnits, parseUnits, type PriceBookRowPrice } from '@endora-commerce/contracts';
import { formatPriceCell, type PriceCellLanguage } from './price-cell.js';

/**
 * The grid's bulk changes (feature 161, FR-012): each turns the selected cells
 * into the texts the grid applies as **one** undoable group. A percentage or
 * an adjustment is written as the operator would type it, so the cell parser
 * judges it as it judges typing (Postel; a refused value is marked in its
 * cell). *Multiply fixed prices* touches fixed prices only and rounds half-up
 * to four places in integers, as the server does (G17).
 */

export type BulkAction =
  | { readonly kind: 'percent'; readonly value: string }
  | { readonly kind: 'amount'; readonly value: string }
  | { readonly kind: 'multiply'; readonly factor: string }
  | { readonly kind: 'clear' };

/** `value` as a signed text: a leading sign is kept, a bare number gets `+`. */
function signed(value: string): string {
  const text = value.trim().replace(/[−‒–]/g, '-');
  return /^[+-]/.test(text) ? text : `+${text}`;
}

/** A positive factor with up to six decimals, comma or point; `null` otherwise. */
export function parseFactor(text: string): bigint | null {
  const normal = text.trim().replace(',', '.');
  const match = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(normal);
  if (!match) return null;
  const millionths = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
  return millionths > 0n ? millionths : null;
}

/** `amount × factor`, half-up to four places. */
export function multiplyAmount(amount: string, factorMillionths: bigint): string {
  const units = parseUnits(amount) * factorMillionths;
  return formatUnits((units + 500_000n) / 1_000_000n);
}

/**
 * The new text of one cell, or `null` to leave it alone. `price` is the cell's
 * price now (`null` when empty).
 */
export function bulkText(action: BulkAction, price: PriceBookRowPrice | null, language: PriceCellLanguage): string | null {
  switch (action.kind) {
    case 'clear':
      return price === null ? null : '';
    case 'percent': {
      const text = signed(action.value);
      return text.endsWith('%') ? text : `${text}%`;
    }
    case 'amount':
      return signed(action.value);
    case 'multiply': {
      if (price?.type !== 'fixed') return null;
      const factor = parseFactor(action.factor);
      if (factor === null) return null;
      return formatPriceCell({ type: 'fixed', amount: multiplyAmount(price.amount, factor) }, language);
    }
  }
}
