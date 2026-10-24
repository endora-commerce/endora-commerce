import {
  decimalDifference,
  decimalSum,
  lineAmountHalfUp,
  roundHalfUp,
  vatByRate,
} from '@endora-commerce/contracts';

/** A line as the order prices it: the cart's stored unit price, its quantity and its rate (a fraction). */
export interface OrderMoneyLine {
  unitPrice: string | number;
  quantity: number;
  taxRate: string | number;
}

/** One order line's amounts, as `order_items` stores them. */
export interface OrderLineMoney {
  /** `unitPrice × quantity`, two places. */
  net: string;
  /** `lineTotal`: the line's own rounding of its gross, `round(net × (1 + rate))` — informational. */
  gross: string;
  /** The rate at four places. */
  taxRate: string;
}

/**
 * An order's totals, at two places, under **the one VAT method** (`vatByRate`,
 * owner ruling of 2026-10-24, issue #417; art. 106e ust. 1 pkt 13–14): per
 * rate, VAT on the sum of the lines' nets at that rate, rounded half-up once.
 * The subtotal is the nets' sum; delivery, the payment surcharge and the
 * discount are added and subtracted on the gross without tax of their own (the
 * invoice carries them as 0 % lines); the total is rounded once. The one
 * computation placement, the checkout preview and the admin preview share, and
 * the invoice computes the same figures with the same function — so the paid
 * amount, the proforma, the order total and the invoice gross are one number.
 *
 * `lines` is each line's stored amounts: a line's gross is its own rounding,
 * `round(net × (1 + rate))` — what the shop shows (owner ruling of
 * 2026-10-24) — so the line grosses may differ from the products' gross by a
 * cent; the VAT and the totals are the per-rate figures.
 */
export function orderTotalsMoney(input: {
  lines: readonly OrderMoneyLine[];
  deliveryTotal: string | number;
  paymentSurcharge: string | number;
  discountTotal: string | number;
}): {
  subtotal: string;
  taxTotal: string;
  deliveryTotal: string;
  paymentSurcharge: string;
  discountTotal: string;
  total: string;
  lines: OrderLineMoney[];
} {
  const nets = input.lines.map((l) => lineAmountHalfUp(l.unitPrice, l.quantity));
  const vat = vatByRate(
    input.lines.map((l, i) => ({ net: nets[i]!, rate: l.taxRate })),
    'fraction',
  );
  const deliveryTotal = roundHalfUp(input.deliveryTotal);
  const paymentSurcharge = roundHalfUp(input.paymentSurcharge);
  const discountTotal = roundHalfUp(input.discountTotal);
  const total = roundHalfUp(
    decimalDifference(decimalSum(vat.net, vat.vat, deliveryTotal, paymentSurcharge), discountTotal),
  );
  return {
    subtotal: vat.net,
    taxTotal: vat.vat,
    deliveryTotal,
    paymentSurcharge,
    discountTotal,
    total,
    lines: input.lines.map((l, i) => ({
      net: nets[i]!,
      gross: vat.lines[i]!.gross,
      taxRate: roundHalfUp(l.taxRate, 4),
    })),
  };
}
