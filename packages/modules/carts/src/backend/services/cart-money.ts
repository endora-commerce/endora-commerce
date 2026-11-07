import {
  compareDecimals,
  lineAmountHalfUp,
  moneyDifference,
  moneySum,
  vatByRate,
} from '@endora-commerce/contracts';

/**
 * A cart's amounts, in the contracts' exact decimal arithmetic (issue #417).
 * A cart's stored prices are net; its VAT is derived on read
 * ({@link cartVatMoney}). Its amounts are published as numbers
 * (`Money.amount`); each is a two-place decimal, which a number holds
 * losslessly. On doubles, 3 × 9.05 was published as 27.150000000000002.
 */

/** A line's amount, `unitPrice × quantity`, at two places. */
export function cartLineAmount(unitPrice: string | number, quantity: number): number {
  return Number(lineAmountHalfUp(unitPrice, quantity));
}

/** The sum of the lines' amounts, as a two-place decimal string. */
export function cartSubtotal(lines: ReadonlyArray<{ unitPrice: string | number; quantity: number }>): string {
  return moneySum(lines.map((l) => lineAmountHalfUp(l.unitPrice, l.quantity)));
}

/** `subtotal − discount`, never below zero. */
export function cartTotalAfterDiscount(subtotal: string | number, discount: string | number): number {
  const total = moneyDifference(subtotal, discount);
  return compareDecimals(total, 0) < 0 ? 0 : Number(total);
}

/** What is missing to a minimum spend, or `null` when the subtotal meets it. */
export function cartShortfall(subtotal: string | number, minimum: string | number): number | null {
  return compareDecimals(minimum, subtotal) > 0 ? Number(moneyDifference(minimum, subtotal)) : null;
}

/**
 * Each cart's line count and total, from its lines: grouped by cart and summed
 * once, exactly. The currency is the first line's, as the list views show it.
 */
export function cartTotalsByCart(
  items: ReadonlyArray<{ cartId: string; unitPrice: string | number; quantity: number; currency: string }>,
): Map<string, { count: number; total: number; currency: string }> {
  const byCart = new Map<string, Array<(typeof items)[number]>>();
  for (const item of items) {
    const lines = byCart.get(item.cartId);
    if (lines) lines.push(item);
    else byCart.set(item.cartId, [item]);
  }
  return new Map(
    [...byCart].map(([cartId, lines]) => [
      cartId,
      { count: lines.length, total: Number(cartSubtotal(lines)), currency: lines[0]!.currency },
    ]),
  );
}

/** A line as the cart's VAT reads it: its unit price, its quantity and its rate as a fraction. */
export interface CartVatLine {
  unitPrice: string | number;
  quantity: number;
  taxRate: string | number;
}

/** {@link cartVatMoney}'s answer: two-place amounts, published as numbers. */
export interface CartVatMoney {
  /** One row per rate, ascending. */
  rows: Array<{ taxRate: number; net: number; vat: number; gross: number }>;
  /** Per input line, in input order: its own gross, `round(net × (1 + rate))` — informational. */
  lines: Array<{ gross: number }>;
  vatTotal: number;
  /** The nets' sum plus the VAT. */
  subtotalGross: number;
  /** `subtotalGross − discount`, never below zero. */
  grandTotalGross: number;
}

/**
 * The cart's VAT under **the one VAT method** (owner ruling of 2026-10-24,
 * issue #436): the contracts' `vatByRate` over the lines' nets — per rate, on
 * the sum of the nets at that rate, rounded half-up once; gross = net + VAT.
 * The order computes its totals with the same function at placement, so for
 * the same lines and rates the two agree to the cent
 * (`backend/test/unit/carts/cart-vat-equals-order.test.ts`). The discount
 * comes off the gross untaxed, as on the order; the checkout's delivery and
 * payment charges are not the cart's and are not here.
 */
export function cartVatMoney(lines: readonly CartVatLine[], discount: string | number): CartVatMoney {
  const vat = vatByRate(
    lines.map((l) => ({ net: lineAmountHalfUp(l.unitPrice, l.quantity), rate: l.taxRate })),
    'fraction',
  );
  const gross = vat.gross;
  const afterDiscount = moneyDifference(gross, discount);
  return {
    rows: vat.rows.map((r) => ({
      taxRate: Number(r.rate),
      net: Number(r.net),
      vat: Number(r.vat),
      gross: Number(r.gross),
    })),
    lines: vat.lines.map((l) => ({ gross: Number(l.gross) })),
    vatTotal: Number(vat.vat),
    subtotalGross: Number(gross),
    grandTotalGross: compareDecimals(afterDiscount, 0) < 0 ? 0 : Number(afterDiscount),
  };
}
