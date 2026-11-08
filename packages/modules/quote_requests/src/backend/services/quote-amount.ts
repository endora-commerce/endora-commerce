import { lineAmountHalfUp, moneySum, type QuoteRequestAmount } from '@endora-commerce/contracts';

/** The fields of a stored line the amount is computed from. */
export interface QuoteAmountLine {
  quantity: number;
  agreedUnitPrice?: string | null;
  desiredUnitPrice?: string | null;
  lineCurrency: string;
}

/**
 * What a quote request is worth — the one rule (issue #456, owner ruling of
 * 2026-11-07; the shape and its wording are `quoteRequestAmountSchema`'s).
 *
 * Each line is valued at its agreed unit price, or the price the customer
 * asked for while none is agreed; `lineAmountHalfUp` makes the line value the
 * one rounding point, and the line values are added exactly. A line with
 * neither price adds nothing and keeps the quote partially agreed.
 *
 * The quote desk list and `quoteRequestReadPort.amountOf` both answer with
 * this; nothing outside this module computes it.
 */
export function quoteRequestAmount(lines: readonly QuoteAmountLine[]): QuoteRequestAmount {
  const values: string[] = [];
  let partiallyAgreed = false;
  for (const line of lines) {
    const agreed = line.agreedUnitPrice ?? null;
    if (agreed === null) partiallyAgreed = true;
    const price = agreed ?? line.desiredUnitPrice ?? null;
    if (price !== null) values.push(lineAmountHalfUp(price, line.quantity));
  }
  return { amount: moneySum(values), currency: lines[0]?.lineCurrency ?? null, partiallyAgreed };
}
