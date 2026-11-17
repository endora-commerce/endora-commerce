import {
  compareDecimals,
  decimalProduct,
  decimalSum,
  lineAmountHalfUp,
  moneySum,
  percentOfHalfUp,
  roundHalfUp,
  vatByRate,
  type CartLine,
} from '@endora-commerce/contracts';

/**
 * Round to 2 decimal places (money), half-up on the value's decimal digits
 * (issue #417). A number is read as its shortest decimal, so a sum or a
 * difference of two-place amounts rounds to the two places it stands for;
 * `Math.round(value * 100) / 100` rounded the binary double.
 */
export function round2(value: number | string): number {
  return Number(roundHalfUp(value));
}

/** `percent` % of an amount, half-up on the exact decimal product (10 % of 1.45 is 0.15). */
export function percentOf(amount: number | string, percent: number | string): number {
  return Number(percentOfHalfUp(amount, percent));
}

/** `count × amount`, exactly, at two places. */
export function times(count: number, amount: number | string): number {
  return Number(roundHalfUp(decimalProduct(count, amount)));
}

/**
 * The sum of the lines' `unit price × quantity`, exact, at two places — the
 * one subtotal the engine computes (`applyToCart`, a line-scoped base). On
 * doubles 0.01 + 2.34 is 2.3499999999999996, and 10 % of it rounded to 0.23.
 */
export function linesSubtotal(lines: readonly CartLine[]): number {
  return Number(moneySum(lines.map((l) => lineAmountHalfUp(l.unitPrice.amount, l.quantity))));
}

/**
 * What the buyer pays for the lines (issue #1350): the gross under the one VAT
 * method, `vatByRate` — per rate, the VAT on the sum of the line nets, rounded
 * once — the figure the cart and the order charge for the goods. A line with
 * no `taxRate` carries no VAT.
 */
export function linesGross(lines: readonly CartLine[]): number {
  return Number(
    vatByRate(
      lines.map((l) => ({ net: lineAmountHalfUp(l.unitPrice.amount, l.quantity), rate: l.taxRate ?? 0 })),
      'fraction',
    ).gross,
  );
}

/**
 * What the buyer pays for the units (issue #1350): per rate, the units' net
 * prices summed exactly and rounded once, then `vatByRate` over those nets —
 * so two free units at 29.50 and 23 % are 72.57, the rate's gross, not two
 * unit grosses of 36.29.
 */
export function unitsGross(units: readonly CartUnit[]): number {
  const netByRate = new Map<number, number[]>();
  for (const u of units) {
    const prices = netByRate.get(u.taxRate);
    if (prices) prices.push(u.price);
    else netByRate.set(u.taxRate, [u.price]);
  }
  return Number(
    vatByRate(
      [...netByRate].map(([rate, prices]) => ({ net: moneySum(prices), rate })),
      'fraction',
    ).gross,
  );
}

/** A single purchasable unit expanded from a cart line (one per quantity). */
export interface CartUnit {
  productId: string;
  variantId: string | null;
  /** The net unit price. */
  price: number;
  /** The line's VAT rate as a fraction; 0 when the line carries none. */
  taxRate: number;
}

/** Expand cart lines into individual units (one entry per quantity). */
export function expandUnits(lines: readonly CartLine[]): CartUnit[] {
  const units: CartUnit[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i += 1) {
      units.push({
        productId: line.productId,
        variantId: line.variantId,
        price: line.unitPrice.amount,
        taxRate: line.taxRate ?? 0,
      });
    }
  }
  return units;
}

/**
 * Orders units by what the buyer pays for one — the exact `net × (1 + rate)` —
 * ascending (issue #1350): the cheapest unit is the cheapest gross. Equal
 * grosses compare equal, so a stable sort keeps the cart's order on a tie.
 */
export function compareUnitGross(a: CartUnit, b: CartUnit): number {
  return compareDecimals(
    decimalProduct(a.price, decimalSum(1, a.taxRate)),
    decimalProduct(b.price, decimalSum(1, b.taxRate)),
  );
}
