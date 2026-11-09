import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  compareDecimals,
  allocateHalfUp,
  decimalDifference,
  decimalProduct,
  lineAmountHalfUp,
  moneyDifference,
  moneySum,
  netForGrossAtRate,
  netFromGrossHalfUp,
  quotientHalfUp,
  roundHalfUp,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceLine } from '../entities/invoice-line.entity.js';
import type { InvoiceNumberGenerator } from './invoice-number-generator.js';
import type { InvoiceAuditRecorder, InvoiceDomainEventEmitter } from './invoice-service.js';
import {
  shouldHoldForVendorNumber,
  type LedgerNumberingLookup,
} from './vendor-number-hold.js';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { refuseDuplicateInvoiceNumber } from './duplicate-number-refusal.js';
// Feature 075, Phase C — `returns` states this shape and `invoices` satisfies
// it. Naming it from `@endora-commerce/contracts` keeps that direction while removing the
// import: the implementor no longer depends on the declarer's directory.
import type {
  CorrectionLineBasis,
  CorrectiveInvoiceInput,
  CorrectiveInvoicePort,
  CorrectiveInvoiceResult,
  SupportedLanguage,
} from '@endora-commerce/contracts';
import { supportedLanguageOf } from '@endora-commerce/contracts';
import { INVOICE_RENDER_LANGUAGE } from '../document/invoice-document-type.js';
import { invoicesProse, type InvoicesTranslate } from '../invoices-prose.js';

/** The smaller of two decimals. */
function minDecimal(a: string, b: string): string {
  return compareDecimals(a, b) <= 0 ? a : b;
}

/** One corrected line's amounts, as the `invoice_lines` columns store them. */
export interface CorrectionLineAmounts {
  gross: string;
  net: string;
  unitNetPrice: string;
}

/** A correction asked to credit more than its lines add up to (review of PR #423). */
export class CorrectionTotalExceedsLinesError extends Error {
  constructor(
    readonly total: string,
    readonly linesTotal: string,
  ) {
    super(`The correction total ${total} exceeds the sum of its lines, ${linesTotal}.`);
    this.name = 'CorrectionTotalExceedsLinesError';
  }
}

/**
 * A correction asked to credit more goods at one VAT rate than the invoice
 * still charges at that rate (issue #885). Crediting it would take back more
 * VAT than the rate charged.
 */
export class CorrectionExceedsRateRemainingError extends Error {
  constructor(
    readonly taxRate: string,
    readonly remaining: string,
  ) {
    super(`The correction credits more at ${taxRate} VAT than the invoice still charges there, ${remaining}.`);
    this.name = 'CorrectionExceedsRateRemainingError';
  }
}

/**
 * A correction asked to credit more of an order charge — the delivery or the
 * payment surcharge — than the invoice still charges for it (issue #876).
 */
export class CorrectionExceedsChargeRemainingError extends Error {
  constructor(
    readonly kind: CorrectionChargeKind,
    readonly remaining: string,
  ) {
    super(`The correction credits more of the ${kind} than the invoice still charges for it, ${remaining}.`);
    this.name = 'CorrectionExceedsChargeRemainingError';
  }
}

/** The order charges a correction may credit (issue #876), named as `invoice_lines.line_kind` names their lines. */
export type CorrectionChargeKind = 'delivery' | 'payment_surcharge';

/** One order charge a correction credits (issue #876). */
export interface CorrectionCharge {
  kind: CorrectionChargeKind;
  /** The gross credited. */
  amount: string | number;
  /** The rate of the invoice line that charged it, as stored (`0.0000` today). */
  rate: string | number;
  /** What the invoice still charges for it: the line's gross less what earlier corrections credited of it. */
  remaining: string;
}

/**
 * On a correction, a goods line (one naming an order item) stored with
 * quantity 0 is a price reduction (issue #885): its value changed, not its
 * quantity. Corrections written before #885 never stored a goods line with
 * quantity 0, so the rule holds for the whole history.
 */
export function isPriceReductionLine(l: { orderItemId?: string | null; quantity: string | number }): boolean {
  return !!l.orderItemId && Number(l.quantity) === 0;
}

/** The units a correction line credits: none for a price reduction. */
export function creditedQuantity(l: { orderItemId?: string | null; quantity: string | number }): number {
  return isPriceReductionLine(l) ? 0 : Number(l.quantity);
}

/**
 * The quantity a correction line is stored with: 0 for a price reduction, the
 * returned quantity otherwise — and never 0 for returned goods, so a returned
 * line is never read back as a price reduction.
 */
export function storedCorrectionQuantity(basis: CorrectionLineBasis | undefined, quantity: number): number {
  return basis === 'price_reduction' ? 0 : quantity || 1;
}

/** A line already credited by an earlier correction of the same invoice, or a goods line of that invoice. */
export interface CreditedLine {
  orderItemId: string;
  rate: string;
  net: string;
  gross: string;
  /** As stored. On an earlier correction, 0 is a price reduction ({@link isPriceReductionLine}). */
  quantity: number;
  unitNetPrice: string;
}

/** One row of the corrected invoice's per-rate summary, as `invoices.vat_summary` stores it. */
export interface CorrectedSummaryRow {
  taxRate: string;
  netTotal: string;
  vatAmount: string;
  grossTotal: string;
}

/**
 * How a rate's credited net was found (issue #873). Returned for tests and not
 * persisted: `quantity` — the refund is the default one, and the invoice keeps
 * `vatByRate` of the kept nets; `gross` — what the invoice keeps at the rate
 * has a net under the rule; `gross_credit` — it has none, but the credit does;
 * `gross_nearest` — neither does, so the nearest net is kept.
 */
export type CorrectionPath = 'quantity' | 'gross' | 'gross_credit' | 'gross_nearest';

export interface CorrectionInput {
  /** The gross the correction credits. Refused when above the sum of `lines`. */
  total: string | number;
  /** The corrected invoice's gross. */
  originalGross: string;
  /** What earlier corrections of the same invoice already credited, gross. */
  creditedBefore?: string;
  /**
   * Whether the corrected invoice was issued under the per-rate VAT method
   * (it stored its summary); otherwise it was issued before 0.108.0 and is
   * credited line by line, in proportion to what each line was invoiced.
   */
  perRate: boolean;
  /** The corrected invoice's goods lines, with the quantities and unit prices it invoiced. */
  originalLines: readonly CreditedLine[];
  /** The corrected invoice's stored per-rate summary — read on an invoice issued per rate. */
  originalSummary?: readonly CorrectedSummaryRow[] | null;
  /** The goods lines of earlier, not cancelled, corrections of the same invoice. */
  earlierLines: readonly CreditedLine[];
  lines: ReadonlyArray<{
    amount: string | number;
    /** The part of the order-level discount `amount` carries: the goods are credited at `amount + discount`. */
    discount?: string | number;
    quantity: number;
    rate: string | number;
    orderItemId: string;
    /** What the line documents (issue #885); `returned_goods` when absent. */
    basis?: CorrectionLineBasis;
  }>;
  /**
   * Issue #876 — the order charges a consumer's withdrawal refunds, credited
   * beside the goods: `total` includes them. Absent: goods only.
   */
  charges?: readonly CorrectionCharge[];
}

const ZERO = '0.00';

/** `round(net × rate)`, the VAT `vatByRate` charges on a net at one rate. */
function vatAt(net: string, rate: string): string {
  return roundHalfUp(decimalProduct(net, rate));
}

/** `net` shared over `weights` in proportion, adding up to `net` exactly. */
function shareOut(net: string, weights: readonly string[]): string[] {
  const sum = moneySum(weights, 6);
  if (compareDecimals(sum, 0) === 0) return weights.map(() => ZERO);
  return allocateHalfUp(
    net,
    weights.map((w) => quotientHalfUp(decimalProduct(net, w), sum, 6)),
  );
}

/**
 * A correction's amounts, in exact decimal arithmetic, under the invoice's VAT
 * method (issue #417, owner ruling of 2026-10-24, review of PR #423).
 *
 * The credited amount is gross (a return credits what was paid, tax included),
 * capped at what remains of the invoice after earlier corrections (FR-020),
 * and shared out over the lines in order; a total above the lines' sum is
 * refused ({@link CorrectionTotalExceedsLinesError}) rather than booked as a
 * net with no VAT and no line.
 *
 * **An invoice issued per rate** (issue #873) is corrected on what it keeps,
 * rate by rate. Before the correction the invoice keeps `Nb` net and `Vb` VAT
 * at a rate, `Gb` gross: its summary row less what earlier corrections credited
 * there. The correction credits `G` gross at the rate. Its goods lines leave
 * each invoiced line with a kept quantity — the invoiced quantity less every
 * credited quantity, where a price reduction (issue #885) credits none — and
 * the kept net `K` is those quantities at the invoiced unit prices.
 * - **Quantity path**: when `Gb − G` is `K + round(K × rate)`, the refund is the
 *   default one; the invoice keeps `K` net and `round(K × rate)` VAT, exactly
 *   what `vatByRate` charges on the kept nets, and the correction credits the
 *   rest.
 * - **Gross path** otherwise — an operator-reduced amount, a price reduction, a
 *   capped credit, an order placed before 0.108.0: the invoice keeps `Gb − G`
 *   gross. When a net has that gross under the rule, the invoice keeps it;
 *   otherwise, when one has `G`, the correction credits it; otherwise the
 *   invoice keeps the nearest (owner ruling E1, 2026-11-07: the money is exact,
 *   and what is left may be a cent off the rule until the next correction).
 *
 * In every case the credited VAT is `G` less the credited net, which lies
 * within `[0, G]` and never above `Nb`; a `G` above `Gb` is refused
 * ({@link CorrectionExceedsRateRemainingError}). On the quantity path a rate's
 * net is shared over its lines by what each line's kept net fell; otherwise in
 * proportion to their gross.
 *
 * **An invoice issued before 0.108.0** is credited line by line, cumulatively:
 * the invoiced line net in proportion to the cumulative gross, less the nets
 * earlier corrections credited.
 *
 * An order-level discount the goods carried is credited back as a negative
 * 0 % amount. A price-reduction line carries none.
 */
export function correctionAmounts(input: CorrectionInput): {
  credited: string;
  netTotal: string;
  taxTotal: string;
  lines: CorrectionLineAmounts[];
  /** The correction's per-rate summary, as `invoices.vat_summary` stores it. */
  vatSummary: Array<{ taxRate: string; netTotal: string; vatAmount: string; grossTotal: string }>;
  /** The order-level discount credited back, as a negative 0 % amount (`0.00` when none). */
  discountCredit: string;
  /** Per rate of an invoice issued per rate, how its net was found. Not persisted. */
  paths: Record<string, CorrectionPath>;
  /** The order charges credited (issue #876), each at its line's rate. */
  chargeLines: Array<{ kind: CorrectionChargeKind; gross: string; net: string; rate: string }>;
} {
  // Issue #876 — the order charges first: each is credited in full at the rate
  // of the invoice line that charged it, and never above what that line still
  // charges. The goods share what is left of the total and of the invoice.
  const chargeLines = (input.charges ?? [])
    .filter((c) => compareDecimals(c.amount, 0) > 0)
    .map((c) => {
      const gross = roundHalfUp(c.amount);
      if (compareDecimals(gross, c.remaining) > 0) throw new CorrectionExceedsChargeRemainingError(c.kind, roundHalfUp(c.remaining));
      const rate = roundHalfUp(c.rate, 4);
      const net = compareDecimals(rate, 0) === 0 ? gross : netFromGrossHalfUp(gross, rate, 'fraction');
      return { kind: c.kind, gross, net, rate };
    });
  const chargesTotal = moneySum(chargeLines.map((c) => c.gross));

  const asked = input.lines.map((l) => (compareDecimals(l.amount, 0) < 0 ? ZERO : roundHalfUp(l.amount)));
  const linesTotal = moneySum(asked);
  const total = moneyDifference(roundHalfUp(input.total), chargesTotal);
  if (compareDecimals(total, linesTotal) > 0) throw new CorrectionTotalExceedsLinesError(roundHalfUp(input.total), moneySum([linesTotal, chargesTotal]));
  if (compareDecimals(total, 0) < 0) throw new CorrectionTotalExceedsLinesError(roundHalfUp(input.total), chargesTotal);
  const remainingOfInvoice = moneyDifference(
    moneyDifference(input.originalGross, input.creditedBefore ?? '0'),
    chargesTotal,
  );
  const credited = compareDecimals(remainingOfInvoice, 0) <= 0 ? ZERO : minDecimal(total, remainingOfInvoice);
  const discounts = input.lines.map((l) =>
    l.discount === undefined || compareDecimals(l.discount, 0) <= 0 ? ZERO : roundHalfUp(l.discount),
  );
  // An order-level discount (issue #417, review of PR #423): the invoice charged
  // the goods at their full value and the discount on a 0 % line of its own, so
  // the goods are credited at `amount + discount` and the discount comes back as
  // a negative 0 % amount — the correction totals the refund, and the goods'
  // VAT is credited as it was charged. That holds only when the correction
  // credits exactly what its lines add up to: a total below the lines (a short
  // settlement, an empty one) or a credit capped below the total credits its
  // amounts as goods, in line order, and no discount — crediting every line at
  // `amount + discount` there would credit more VAT than the total carries
  // (review of PR #423, B1).
  const withDiscount =
    compareDecimals(credited, total) === 0 &&
    compareDecimals(credited, linesTotal) === 0 &&
    discounts.some((d) => compareDecimals(d, 0) > 0);
  let remaining = credited;
  const grosses = asked.map((a, i) => {
    if (withDiscount) return moneySum([a, discounts[i]!]);
    const gross = minDecimal(a, remaining);
    remaining = roundHalfUp(decimalDifference(remaining, gross));
    return gross;
  });
  const discountCredit = withDiscount ? moneyDifference('0', moneySum(discounts)) : ZERO;

  const isReduction = (i: number) => input.lines[i]!.basis === 'price_reduction';
  const rateOf = (rate: string | number) => roundHalfUp(rate, 4);
  const groupOf = (l: { orderItemId: string; rate: string | number }) => (input.perRate ? rateOf(l.rate) : l.orderItemId);
  const byGroup = new Map<string, number[]>();
  input.lines.forEach((l, i) => {
    const group = groupOf(l);
    const indexes = byGroup.get(group);
    if (indexes) indexes.push(i);
    else byGroup.set(group, [i]);
  });

  // What the invoice invoiced and earlier corrections credited, per order item.
  const invoiced = new Map<string, { quantity: number; net: string[]; unitNetPrice: string }>();
  for (const o of input.originalLines) {
    const cur = invoiced.get(o.orderItemId);
    if (cur) {
      cur.quantity += o.quantity;
      cur.net.push(o.net);
    } else {
      invoiced.set(o.orderItemId, { quantity: o.quantity, net: [o.net], unitNetPrice: o.unitNetPrice });
    }
  }
  const creditedBeforeOf = (orderItemId: string) => {
    const lines = input.earlierLines.filter((e) => e.orderItemId === orderItemId);
    return { quantity: lines.reduce((a, e) => a + creditedQuantity(e), 0), net: moneySum(lines.map((e) => e.net)) };
  };

  const nets: string[] = input.lines.map(() => ZERO);
  const paths: Record<string, CorrectionPath> = {};
  for (const [group, indexes] of byGroup) {
    const gross = moneySum(indexes.map((i) => grosses[i]!));
    let net: string;
    let weights = indexes.map((i) => grosses[i]!);
    if (input.perRate) {
      const rate = group;
      const zeroRate = compareDecimals(rate, 0) === 0;
      const goods = input.originalLines.filter((o) => rateOf(o.rate) === rate);
      const row = zeroRate ? undefined : input.originalSummary?.find((r) => rateOf(r.taxRate) === rate);
      // The invoice's own figures at the rate. At 0 % its row also holds the
      // delivery, the surcharge and the discount, so the goods are summed.
      const n0 = row ? roundHalfUp(row.netTotal) : moneySum(goods.map((o) => o.net));
      const v0 = row ? roundHalfUp(row.vatAmount) : zeroRate ? ZERO : vatAt(n0, rate);
      const before = input.earlierLines.filter((e) => rateOf(e.rate) === rate);
      const nb = moneyDifference(n0, moneySum(before.map((e) => e.net)));
      const vb = moneyDifference(v0, moneySum(before.map((e) => moneyDifference(e.gross, e.net))));
      const gb = moneySum([nb, vb]);
      // Nothing credited at the rate is never refused, whatever an earlier
      // correction left there.
      if (compareDecimals(gross, 0) > 0 && compareDecimals(gross, gb) > 0) {
        throw new CorrectionExceedsRateRemainingError(rate, gb);
      }

      // The kept state after this correction: each invoiced line's kept
      // quantity at its invoiced unit price, untouched when none came back.
      const keptAfter = new Map<string, string>();
      for (const id of new Set(goods.map((o) => o.orderItemId))) {
        const inv = invoiced.get(id)!;
        const returnedNow = indexes
          .filter((i) => input.lines[i]!.orderItemId === id && !isReduction(i))
          .reduce((a, i) => a + input.lines[i]!.quantity, 0);
        const q = Math.max(0, inv.quantity - creditedBeforeOf(id).quantity - returnedNow);
        keptAfter.set(id, q === inv.quantity ? moneySum(inv.net) : lineAmountHalfUp(inv.unitNetPrice, q));
      }
      const k = moneySum([...keptAfter.values()]);
      const after = moneyDifference(gb, gross);
      if (compareDecimals(after, moneySum([k, vatAt(k, rate)])) === 0) {
        paths[rate] = 'quantity';
        net = moneyDifference(nb, k);
        // Each line's share: what its kept net fell by, split by quantity
        // among entries naming the same item. Exact when the history was all
        // on this path; a price reduction in the history may leave a weight
        // that is not, and then the gross shares are used.
        const fell = indexes.map((i) => {
          const id = input.lines[i]!.orderItemId;
          const remBefore = moneyDifference(moneySum(invoiced.get(id)?.net ?? []), creditedBeforeOf(id).net);
          const drop = moneyDifference(remBefore, keptAfter.get(id) ?? ZERO);
          const same = indexes.filter((j) => input.lines[j]!.orderItemId === id);
          const units = same.reduce((a, j) => a + input.lines[j]!.quantity, 0);
          return units > 0 ? quotientHalfUp(decimalProduct(drop, input.lines[i]!.quantity), units, 6) : ZERO;
        });
        if (
          !indexes.some(isReduction) &&
          fell.every((w) => compareDecimals(w, 0) >= 0) &&
          fell.some((w) => compareDecimals(w, 0) > 0)
        ) {
          weights = fell;
        }
      } else {
        const keeps = netForGrossAtRate(after, rate, 'fraction');
        const credits = netForGrossAtRate(gross, rate, 'fraction');
        if (keeps.exact) {
          paths[rate] = 'gross';
          net = moneyDifference(nb, keeps.net);
        } else if (credits.exact) {
          paths[rate] = 'gross_credit';
          net = credits.net;
        } else {
          paths[rate] = 'gross_nearest';
          net = moneyDifference(nb, keeps.net);
        }
      }
      if (compareDecimals(net, nb) > 0) net = nb;
    } else {
      const before = input.earlierLines.filter((e) => e.orderItemId === group);
      const cumulativeGross = moneySum([...before.map((e) => e.gross), gross]);
      const original = input.originalLines.find((o) => o.orderItemId === group);
      const cumulativeNet =
        original && compareDecimals(original.gross, 0) > 0
          ? quotientHalfUp(decimalProduct(original.net, cumulativeGross), original.gross)
          : netFromGrossHalfUp(cumulativeGross, input.lines[indexes[0]!]!.rate, 'fraction');
      net = moneyDifference(cumulativeNet, moneySum(before.map((e) => e.net)));
    }
    if (compareDecimals(net, 0) < 0) net = ZERO;
    if (compareDecimals(net, gross) > 0) net = gross;
    const shares = compareDecimals(gross, 0) === 0 ? indexes.map(() => ZERO) : shareOut(net, weights);
    indexes.forEach((lineIndex, k) => {
      nets[lineIndex] = shares[k]!;
    });
  }

  const taxTotal = moneySum([
    ...grosses.map((g, i) => moneyDifference(g, nets[i]!)),
    ...chargeLines.map((c) => moneyDifference(c.gross, c.net)),
  ]);
  const rates = new Map<string, { net: string[]; gross: string[] }>();
  const addToRate = (key: string, net: string, gross: string) => {
    const sums = rates.get(key) ?? { net: [], gross: [] };
    sums.net.push(net);
    sums.gross.push(gross);
    rates.set(key, sums);
  };
  input.lines.forEach((l, i) => addToRate(rateOf(l.rate), nets[i]!, grosses[i]!));
  if (compareDecimals(discountCredit, 0) !== 0) addToRate('0.0000', discountCredit, discountCredit);
  for (const c of chargeLines) addToRate(c.rate, c.net, c.gross);
  const creditedTotal = moneySum([credited, chargesTotal]);
  return {
    credited: creditedTotal,
    netTotal: roundHalfUp(decimalDifference(creditedTotal, taxTotal)),
    taxTotal,
    lines: input.lines.map((l, i) => ({
      gross: grosses[i]!,
      net: nets[i]!,
      // A price reduction's unit price is the change in the line's unit net
      // price over the units still on the invoice (issue #885): 3 × 10.0100
      // reduced by 5.00 shows 1.6667. Informational, at four places.
      unitNetPrice: isReduction(i)
        ? quotientHalfUp(
            nets[i]!,
            Math.max(1, (invoiced.get(l.orderItemId)?.quantity ?? 0) - creditedBeforeOf(l.orderItemId).quantity),
            4,
          )
        : quotientHalfUp(nets[i]!, l.quantity || 1, 4),
    })),
    vatSummary: [...rates.entries()]
      .sort((a, b) => compareDecimals(a[0], b[0]))
      .map(([taxRate, sums]) => {
        const netTotal = moneySum(sums.net);
        const grossTotal = moneySum(sums.gross);
        return { taxRate, netTotal, vatAmount: moneyDifference(grossTotal, netTotal), grossTotal };
      }),
    discountCredit,
    paths,
    chargeLines,
  };
}

/**
 * The invoice's delivery and payment-surcharge lines (issue #876), by
 * `line_kind`. A line issued before #904 has none. Issuance has written the
 * delivery before the surcharge, each a positive 0 % line naming no order item,
 * since it first itemised them (`ee860569e`, "itemize delivery, payment
 * surcharge, and discount as lines"), so with two such lines the first is the
 * delivery and the second the surcharge. Only 0 % lines are matched (ruling Q3
 * on PR #965): a positive line at another rate is no charge issuance wrote, so
 * a credit asked of it is refused `no_corrected_line`. With one, it is whichever charge the order had — the settlement
 * names only a charge that was paid, so it never asks for both — and it answers
 * for either. On those invoices both are 0 % lines, so the rate a credit
 * mirrors is the same either way.
 */
export function chargeLinesOf<
  T extends { orderItemId?: string | null; lineKind?: string | null; grossValue: string; taxRate: string; ordinal: number },
>(
  lines: readonly T[],
): { delivery?: T; payment_surcharge?: T } {
  const delivery = lines.find((l) => l.lineKind === 'delivery');
  const surcharge = lines.find((l) => l.lineKind === 'payment_surcharge');
  if (delivery || surcharge || lines.some((l) => l.lineKind != null)) {
    return { ...(delivery ? { delivery } : {}), ...(surcharge ? { payment_surcharge: surcharge } : {}) };
  }
  const legacy = lines
    .filter((l) => !l.orderItemId && compareDecimals(l.grossValue, 0) > 0 && compareDecimals(l.taxRate, 0) === 0)
    .sort((a, b) => a.ordinal - b.ordinal);
  if (legacy.length === 1) return { delivery: legacy[0]!, payment_surcharge: legacy[0]! };
  return {
    ...(legacy[0] ? { delivery: legacy[0] } : {}),
    ...(legacy[1] ? { payment_surcharge: legacy[1] } : {}),
  };
}

/** What a corrected line inherits from the original line it credits. */
interface MirroredLine {
  /** The original line's VAT rate, as a fraction (`0.2300` for 23%), as stored. */
  rate: string;
  /** The original line's unit of measure, verbatim. */
  unit: string;
}

/**
 * What a corrective line inherits from the line it corrects (product ruling
 * 2026-08-16, issue #131 and #136.1): the VAT rate and the unit of measure,
 * never the rate in force on the correction date and never a constant.
 *
 * A line naming an order item the original never invoiced is refused —
 * inventing a rate for an added position is worse than refusing it.
 */
function mirrorFor(
  original: Invoice,
  byOrderItem: ReadonlyMap<string, MirroredLine>,
  orderItemId: string,
): MirroredLine {
  const mirrored = byOrderItem.get(orderItemId);
  if (!mirrored) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'The corrected line has no counterpart on the original invoice, so its VAT rate is unknown.',
      { code: 'no_corrected_line', orderItemId, originalInvoiceId: original.id },
    );
  }
  return mirrored;
}

/**
 * Invoices-side implementation of the returns module's `CorrectiveInvoicePort`
 * (feature 046 / 047 US3). Creates an `invoices` row of kind `correction`:
 *   - number drawn from the correction counter (per channel/year) when a
 *     number generator is wired (falls back to a UUID-stamped number otherwise);
 *   - references the order's original VAT invoice;
 *   - snapshots the corrected lines into `invoice_lines`, each carrying the VAT
 *     rate and the unit of the original line it corrects (issues #131, #136.1);
 *   - caps the credited total at the original invoice gross (FR-020).
 *
 * **An order that was never invoiced gets no document** (product ruling
 * 2026-08-17, issue #135): there is nothing to correct, so the port answers
 * `{ issued: false, reason: 'order_not_invoiced' }` and the settlement records
 * the refund without a VAT-shaped document standing in for one that never
 * existed.
 */
export class CorrectiveInvoiceProvider implements CorrectiveInvoicePort {
  /**
   * `numbers` is an accessor for the same reason `emFactory` is: the generator
   * is a gated port, so resolving it is a question about `invoices`' effective
   * state whose answer changes while the process runs. A composition root that
   * resolved it while wiring this provider asked at boot, and an operator who
   * had switched `invoices` off took the backend down with it.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly numbers?: () => InvoiceNumberGenerator,
    private readonly audit?: InvoiceAuditRecorder,
    private readonly events?: InvoiceDomainEventEmitter,
    private readonly ledgerRouting?: LedgerNumberingLookup,
    /**
     * The language a price-reduction line is named in, and this module's
     * bundle to name it from (issue #885), as `InvoiceService` names the lines
     * it itemises: the name is stored with the line, so it is written in the
     * document's language, `INVOICE_RENDER_LANGUAGE`. Without a translator,
     * English.
     */
    private readonly lineProse: {
      readonly translate?: InvoicesTranslate | undefined;
      readonly language?: SupportedLanguage;
    } = {},
  ) {}

  /**
   * Refuse, without writing anything, exactly what {@link createCorrection}
   * would refuse for this input (issue #417, review of PR #423): a settlement
   * asks before it moves any money, so a correction that cannot be made never
   * follows a refund that was. An order with no invoice is not a refusal — its
   * settlement records the refund without a document.
   */
  async validateCorrection(input: CorrectiveInvoiceInput): Promise<void> {
    const em = this.emFactory();
    if (input.idempotencyKey) {
      const already = await em.findOne(Invoice, { correctionIdempotencyKey: input.idempotencyKey, kind: 'correction' });
      if (already) return;
    }
    await this.#prepare(em, input);
  }

  /**
   * Everything a correction is computed from, and every refusal, before a
   * number is drawn: the original invoice (or `null` when the order was never
   * invoiced), its channel, the amounts and the line snapshots.
   */
  async #prepare(em: EntityManager, input: CorrectiveInvoiceInput) {
    const original = await em.findOne(Invoice, { orderId: input.orderId, kind: 'invoice' });
    // No original, no correction (#135). The caller records the refund on the
    // return case and the payment; only the VAT document is skipped, and the
    // reason is stated so the caller reports it rather than reporting nothing.
    if (!original) return null;

    // A correction is denominated in the corrected document's currency: the cap
    // below compares the credited amount with the original gross, and two
    // amounts in different currencies do not compare (#136.2). Nothing produces
    // a cross-currency credit today — the return case inherits the order's
    // currency — so refusing costs nothing and closes the seam. Conversion is
    // deliberately not attempted here.
    if (input.currency !== original.currency) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        `A correction must be issued in the corrected invoice's currency (${original.currency}), not ${input.currency}.`,
        {
          code: 'correction_currency_mismatch',
          requestedCurrency: input.currency,
          originalCurrency: original.currency,
          originalInvoiceId: original.id,
        },
      );
    }

    // The correction belongs to the corrected document's channel — that is the
    // numbering series it continues.
    const salesChannelId = original.salesChannelId ?? null;

    // A correction mirrors the line it corrects. The link is `orderItemId`:
    // issuance snapshots it on every product line of the original, and a return
    // case item names the same order item.
    const mirrorByOrderItem = new Map<string, MirroredLine>();
    const originalLines = await em.find(InvoiceLine, { invoiceId: original.id });
    for (const l of originalLines) {
      if (l.orderItemId) mirrorByOrderItem.set(l.orderItemId, { rate: l.taxRate, unit: l.unit });
    }
    // Resolve every line before the transaction opens, so a line that cannot
    // be mirrored refuses without having drawn a correction number.
    const mirrored = input.lines.map((l) => mirrorFor(original, mirrorByOrderItem, l.orderItemId));
    // A price reduction keeps the goods, and the order discount they carried
    // with them (issue #885), so it credits none back. `returns` never sends
    // one; a caller that does has misread the port.
    const discounted = input.lines.find(
      (l) => l.basis === 'price_reduction' && l.discount !== undefined && compareDecimals(l.discount, 0) > 0,
    );
    if (discounted) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'A price reduction carries no discount: the buyer keeps the goods and the discount they carried.',
        { code: 'price_reduction_carries_discount', orderItemId: discounted.orderItemId },
      );
    }
    // What earlier corrections of this invoice already credited: the cap and
    // the cumulative rule both read it (review of PR #423).
    // A cancelled correction credits nothing, so it is neither in the cap nor in
    // the cumulative nets (review of PR #423).
    const earlierCorrections = (await em.find(Invoice, { originalInvoiceId: original.id, kind: 'correction' })).filter(
      (c) => c.status !== 'cancelled',
    );
    const earlierLines =
      earlierCorrections.length > 0
        ? await em.find(InvoiceLine, { invoiceId: { $in: earlierCorrections.map((c) => c.id) } })
        : [];
    const asCredited = (l: InvoiceLine) => ({
      orderItemId: l.orderItemId ?? '',
      rate: l.taxRate,
      net: l.netValue,
      gross: l.grossValue,
      // The kept quantities are read from these (issue #873); on an earlier
      // correction, 0 is a price reduction and credits no unit (#885).
      quantity: Number(l.quantity),
      unitNetPrice: l.unitNetPrice,
    });
    // The invoice's own discount line: the discount credit mirrors its name and
    // unit, and an invoice that itemized no discount credits none separately.
    const discountLine = originalLines.find((l) => !l.orderItemId && compareDecimals(l.grossValue, 0) < 0);
    // Issue #876 — the invoice's delivery and surcharge lines a consumer's
    // withdrawal credits, each at its own rate and never above what it still
    // charges after earlier corrections.
    const chargeLineOf = chargeLinesOf(originalLines);
    const charges = (
      [
        ['delivery', input.charges?.delivery],
        ['payment_surcharge', input.charges?.surcharge],
      ] as const
    ).flatMap(([kind, amount]) => {
      if (amount === undefined || compareDecimals(amount, 0) <= 0) return [];
      const charged = chargeLineOf[kind];
      if (!charged) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'The corrected charge has no line on the original invoice, so its VAT rate is unknown.',
          { code: 'no_corrected_line', chargeKind: kind, originalInvoiceId: original.id },
        );
      }
      const creditedOfIt = earlierLines.filter((l) => l.lineKind === kind).map((l) => l.grossValue);
      return [
        {
          kind,
          amount,
          rate: charged.taxRate,
          remaining: moneyDifference(charged.grossValue, moneySum(creditedOfIt)),
          line: charged,
        },
      ];
    });
    let amounts: ReturnType<typeof correctionAmounts>;
    try {
      amounts = correctionAmounts({
        total: input.total,
        originalGross: original.total,
        creditedBefore: moneySum(earlierCorrections.map((c) => c.total)),
        // Issued under the per-rate method exactly when it stored its summary.
        perRate: original.vatSummary != null,
        originalSummary: original.vatSummary ?? null,
        // Goods lines only: a delivery, surcharge or discount line names no order
        // item, and an earlier correction's discount credit is not goods.
        originalLines: originalLines.filter((l) => l.orderItemId).map(asCredited),
        earlierLines: earlierLines.filter((l) => l.orderItemId).map(asCredited),
        lines: input.lines.map((l, index) => ({
          amount: l.amount,
          ...(l.discount !== undefined && discountLine ? { discount: l.discount } : {}),
          quantity: l.quantity,
          rate: mirrored[index]!.rate,
          orderItemId: l.orderItemId,
          basis: l.basis ?? 'returned_goods',
        })),
        charges: charges.map(({ kind, amount, rate, remaining }) => ({ kind, amount, rate, remaining })),
      });
    } catch (err) {
      if (err instanceof CorrectionExceedsChargeRemainingError) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, err.message, {
          code: 'correction_exceeds_charge_remaining',
          chargeKind: err.kind,
          remaining: err.remaining,
        });
      }
      if (err instanceof CorrectionExceedsRateRemainingError) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, err.message, {
          code: 'correction_exceeds_rate_remaining',
          taxRate: err.taxRate,
          remaining: err.remaining,
          // For the operator's sentence: 23, not 0.2300.
          vatRatePercent: String(Number(decimalProduct(err.taxRate, 100))),
        });
      }
      if (!(err instanceof CorrectionTotalExceedsLinesError)) throw err;
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, err.message, {
        code: 'correction_total_exceeds_lines',
        total: err.total,
        linesTotal: err.linesTotal,
      });
    }
    // One at a time, as `invoicesProseTable` reads the bundle.
    const names: string[] = [];
    for (const l of input.lines) names.push(await this.#lineName(l, input.caseReference));
    const snapshots = input.lines.map((l, index) => ({
      ordinal: index + 1,
      orderItemId: l.orderItemId,
      name: names[index]!,
      // A price reduction is stored with quantity 0 (issue #885); returned
      // goods keep their quantity, and never 0.
      quantity: storedCorrectionQuantity(l.basis, l.quantity),
      rate: roundHalfUp(mirrored[index]!.rate, 4),
      unit: mirrored[index]!.unit,
      ...amounts.lines[index]!,
    }));
    // Each credited charge mirrors the name and the unit of the line it credits.
    const chargeSnapshots = amounts.chargeLines.map((c) => {
      const line = charges.find((x) => x.kind === c.kind)!.line;
      return { ...c, name: line.name, unit: line.unit };
    });
    return { original, salesChannelId, amounts, snapshots, discountLine, chargeSnapshots };
  }

  /**
   * A returned-goods line is named after its product. A price reduction is
   * named as one, in the document's language, with the case it settles
   * (issue #885): "Obniżka ceny (reklamacja RMA-…): Widget".
   */
  async #lineName(line: CorrectiveInvoiceInput['lines'][number], caseReference: string | undefined): Promise<string> {
    if (line.basis !== 'price_reduction') return line.productName;
    const language = this.lineProse.language ?? supportedLanguageOf(INVOICE_RENDER_LANGUAGE);
    const name = caseReference
      ? await invoicesProse(this.lineProse.translate, 'lines.priceReduction', language, {
          rma: caseReference,
          product: line.productName,
        })
      : await invoicesProse(this.lineProse.translate, 'lines.priceReductionUnreferenced', language, {
          product: line.productName,
        });
    // The column's width.
    return name.slice(0, 512);
  }

  async createCorrection(input: CorrectiveInvoiceInput): Promise<CorrectiveInvoiceResult> {
    const em = this.emFactory();

    // The same correction, asked for twice (D-91). A settlement attempts every
    // external effect before it writes any state, so a refusal from a later
    // step leaves a retryable case and the retry arrives here with the key of
    // the correction this call already issued. Answering with that document is
    // what keeps one return case to one credit note; the partial unique index
    // on the column is what keeps two concurrent retries to one as well.
    if (input.idempotencyKey) {
      const already = await em.findOne(Invoice, {
        correctionIdempotencyKey: input.idempotencyKey,
        kind: 'correction',
      });
      if (already) {
        return {
          issued: true,
          invoiceId: already.id,
          number: already.number,
          status: already.status,
        };
      }
    }

    const plan = await this.#prepare(em, input);
    // No original, no correction (#135).
    if (!plan) return { issued: false, reason: 'order_not_invoiced' };
    const { original, salesChannelId, amounts, snapshots, discountLine, chargeSnapshots } = plan;
    const { credited: creditedTotal, netTotal, taxTotal } = amounts;

    const issuedAt = new Date();
    const holdForVendor = await shouldHoldForVendorNumber(this.ledgerRouting, salesChannelId);
    // Captured out of the transaction: see the same note in `InvoiceService`.
    let drawnNumber: string | null = null;
    const runCorrection = async (tx: EntityManager): Promise<Invoice> => {
      // Draw from the correction counter (a real numbering series to continue)
      // whenever a generator and a channel are known.
      let number: string;
      if (this.numbers && salesChannelId) {
        number = await this.numbers().next(tx, 'correction', salesChannelId, issuedAt);
      } else {
        number = `KOR-${randomUUID().slice(0, 8).toUpperCase()}`;
      }
      drawnNumber = number;
      const inv = tx.create(Invoice, {
        orderId: input.orderId,
        salesChannelId,
        kind: 'correction',
        number,
        issuedAt,
        // The sale date is a fact about the sale, not about the correction
        // (product ruling 2026-08-17, #136.4): a credit note reports the date
        // the goods were delivered or the service performed, which is the
        // original's sale date. `issuedAt` above is the correction's own issue
        // date and keeps its meaning — do not collapse the two back together.
        saleDate: original.saleDate ?? issuedAt.toISOString().slice(0, 10),
        currency: input.currency,
        netTotal,
        taxTotal,
        total: creditedTotal,
        vatSummary: amounts.vatSummary,
        paidTotal: '0',
        originalInvoiceId: original.id,
        ...(input.idempotencyKey ? { correctionIdempotencyKey: input.idempotencyKey } : {}),
        ...(original.buyerSnapshot ? { buyerSnapshot: original.buyerSnapshot } : {}),
        ...(original.sellerSnapshot ? { sellerSnapshot: original.sellerSnapshot } : {}),
        issuedBy: 'system',
        status: holdForVendor ? 'pending' : 'ready',
      });
      await tx.persistAndFlush(inv);

      // Snapshot the corrected lines (already capped at the credited remainder).
      for (const s of snapshots) {
        tx.create(InvoiceLine, {
          invoiceId: inv.id,
          ordinal: s.ordinal,
          name: s.name,
          // The unit comes from the original line, so a position invoiced in
          // `opak.` is credited in `opak.` and not in `szt.` (#136.1).
          unit: s.unit,
          quantity: String(s.quantity),
          unitNetPrice: s.unitNetPrice,
          taxRate: s.rate,
          netValue: s.net,
          grossValue: s.gross,
          orderItemId: s.orderItemId,
        });
      }
      // Issue #876 — the delivery and the surcharge a consumer's withdrawal
      // refunds, each on a line of its own kind at the rate it was charged at.
      chargeSnapshots.forEach((c, i) => {
        tx.create(InvoiceLine, {
          invoiceId: inv.id,
          ordinal: snapshots.length + i + 1,
          name: c.name,
          unit: c.unit,
          quantity: '1',
          unitNetPrice: roundHalfUp(c.net, 4),
          taxRate: c.rate,
          netValue: c.net,
          grossValue: c.gross,
          orderItemId: null,
          lineKind: c.kind,
        });
      });
      // The order-level discount the returned goods carried, credited back on
      // a 0 % line of its own, as the invoice charged it (issue #417).
      if (discountLine && compareDecimals(amounts.discountCredit, 0) !== 0) {
        tx.create(InvoiceLine, {
          invoiceId: inv.id,
          ordinal: snapshots.length + chargeSnapshots.length + 1,
          name: discountLine.name,
          unit: discountLine.unit,
          quantity: '1',
          unitNetPrice: roundHalfUp(amounts.discountCredit, 4),
          taxRate: '0.0000',
          netValue: amounts.discountCredit,
          grossValue: amounts.discountCredit,
          orderItemId: null,
        });
      }
      await tx.flush();
      return inv;
    };

    // Feature 078, D-95.2 — a correction draws from the same platform-wide
    // number space, so it is refused the same way. `rethrowIfModuleDisabled` is
    // the **first** line: `ModuleDisabledError` is an `HttpError`, so any other
    // test lets it through by accident rather than by decision, and the
    // callback reaches this module's own gated number generator.
    let invoice: Invoice;
    try {
      invoice = await em.transactional(runCorrection);
    } catch (err) {
      rethrowIfModuleDisabled(err);
      await refuseDuplicateInvoiceNumber({
        error: err,
        drawnNumber,
        salesChannelId,
        emFactory: this.emFactory,
      });
      throw err;
    }

    if (this.audit) {
      await this.audit
        .record({
          action: 'invoice.corrected',
          objectType: 'invoice',
          objectId: invoice.id,
          stateAfter: {
            number: invoice.number,
            orderId: input.orderId,
            originalInvoiceId: original.id,
            credited: Number(creditedTotal),
            priceReductionLines: input.lines.filter((l) => l.basis === 'price_reduction').length,
            ...(chargeSnapshots.length > 0
              ? { charges: Object.fromEntries(chargeSnapshots.map((c) => [c.kind, Number(c.gross)])) }
              : {}),
          },
        })
        .catch(() => undefined);
    }

    // Feature 059 — domain event for downstream consumers (e.g. KSeF submission).
    this.events?.emit('invoice.corrected.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      invoiceId: invoice.id,
      originalInvoiceId: original.id,
      orderId: input.orderId,
      salesChannelId,
    });

    return { issued: true, invoiceId: invoice.id, number: invoice.number, status: invoice.status };
  }
}
