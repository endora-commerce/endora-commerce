import { lineAmountHalfUp, moneySum, taxAmountHalfUp } from '@endora-commerce/contracts';

/**
 * A quote's net, VAT and gross as the admin screens show them (issue #417):
 * the net is the lines' agreed prices × quantities summed exactly, the VAT the
 * net total at the quote's one rate (a fraction), half-up, and the gross their
 * sum — the rule the order the quote converts into applies. `null` unless
 * every line is priced. Each figure is a two-place decimal, held by a number
 * losslessly; on doubles 0.70 at 5 % showed a VAT of 0.03.
 */
export function quoteTotals(
  lines: ReadonlyArray<{ agreedUnitPrice: number | string | null; quantity: number }>,
  taxRate: number,
): { net: number; tax: number; gross: number } | null {
  if (lines.some((line) => line.agreedUnitPrice === null)) return null;
  const net = quoteNet(lines.map((line) => ({ price: line.agreedUnitPrice!, quantity: line.quantity })));
  const tax = taxAmountHalfUp(net, taxRate, 'fraction');
  return { net: Number(net), tax: Number(tax), gross: Number(moneySum([net, tax])) };
}

/** The lines' prices × quantities, summed exactly, as a two-place decimal. */
export function quoteNet(lines: ReadonlyArray<{ price: number | string; quantity: number }>): string {
  return moneySum(lines.map((line) => lineAmountHalfUp(line.price, line.quantity)));
}
