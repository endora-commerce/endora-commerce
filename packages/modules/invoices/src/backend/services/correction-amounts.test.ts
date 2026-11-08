import { describe, expect, it } from 'vitest';
import {
  compareDecimals,
  decimalProduct,
  lineAmountHalfUp,
  moneyDifference,
  moneySum,
  quotientHalfUp,
  roundHalfUp,
  vatByRate,
} from '@endora-commerce/contracts';
import {
  CorrectionExceedsRateRemainingError,
  correctionAmounts,
  creditedQuantity,
  isPriceReductionLine,
  storedCorrectionQuantity,
  type CorrectionInput,
  type CreditedLine,
} from './corrective-invoice.js';

/**
 * Issue #417 — a correction's amounts in exact decimal arithmetic, under the
 * invoice's VAT method (owner ruling of 2026-10-24).
 *
 * Issue #873 — on an invoice issued per rate, a correction is anchored on what
 * the invoice keeps: per rate, the net and VAT left after it are `vatByRate` of
 * the kept nets when the refund is the default one (the quantity path), and the
 * gross left is split by the same rule otherwise (the gross path).
 *
 * Issue #885 — a complaint settled with money is a price reduction: credited as
 * gross at the line's rate, with no discount, and it lowers no kept quantity.
 */
type Line = CorrectionInput['lines'][number];

const line = (
  amount: string | number,
  quantity: number,
  rate: string,
  orderItemId = 'a',
  extra: Partial<Line> = {},
): Line => ({ amount, quantity, rate, orderItemId, ...extra });

interface InvoicedLine {
  id: string;
  /** The unit net price, four places. */
  unit: string;
  qty: number;
  rate: string;
}

/** An invoice issued per rate, as `buildInvoiceLines` writes one: goods lines, 0 % extras and a discount line. */
function invoiceOf(
  lines: InvoicedLine[],
  extras: { discount?: string; delivery?: string; surcharge?: string } = {},
) {
  const goods = lines.map((l) => ({ net: lineAmountHalfUp(l.unit, l.qty), rate: l.rate }));
  const zero = [extras.delivery, extras.surcharge]
    .filter((v): v is string => v !== undefined && compareDecimals(v, 0) > 0)
    .map((net) => ({ net, rate: '0' }));
  const discount = extras.discount && compareDecimals(extras.discount, 0) > 0 ? [{ net: `-${extras.discount}`, rate: '0' }] : [];
  const vat = vatByRate([...goods, ...zero, ...discount], 'fraction');
  const originalLines: CreditedLine[] = lines.map((l, i) => ({
    orderItemId: l.id,
    rate: roundHalfUp(l.rate, 4),
    net: goods[i]!.net,
    gross: vat.lines[i]!.gross,
    quantity: l.qty,
    unitNetPrice: roundHalfUp(l.unit, 4),
  }));
  const originalSummary = vat.rows.map((r) => ({ taxRate: r.rate, netTotal: r.net, vatAmount: r.vat, grossTotal: r.gross }));
  return { originalLines, originalSummary, originalGross: vat.gross };
}

type Invoice = ReturnType<typeof invoiceOf>;

/**
 * An invoice and the corrections issued against it, in order: each correction
 * reads the ones before it, as `CorrectiveInvoiceProvider` does.
 */
class Ledger {
  readonly earlier: CreditedLine[] = [];
  creditedBefore = '0.00';
  constructor(readonly invoice: Invoice) {}

  correct(total: string | number, lines: Line[]) {
    const r = correctionAmounts({
      total,
      originalGross: this.invoice.originalGross,
      creditedBefore: this.creditedBefore,
      perRate: true,
      originalLines: this.invoice.originalLines,
      originalSummary: this.invoice.originalSummary,
      earlierLines: this.earlier,
      lines,
    });
    lines.forEach((l, i) => {
      this.earlier.push({
        orderItemId: l.orderItemId,
        rate: roundHalfUp(l.rate, 4),
        net: r.lines[i]!.net,
        gross: r.lines[i]!.gross,
        quantity: storedCorrectionQuantity(l.basis, l.quantity),
        unitNetPrice: r.lines[i]!.unitNetPrice,
      });
    });
    this.creditedBefore = moneySum([this.creditedBefore, r.credited]);
    return r;
  }

  /** What the invoice keeps at a rate: [net, VAT, gross]. */
  remaining(rate: string): [string, string, string] {
    const key = roundHalfUp(rate, 4);
    const row = this.invoice.originalSummary.find((s) => roundHalfUp(s.taxRate, 4) === key)!;
    const goods = this.invoice.originalLines.filter((l) => l.rate === key);
    const n0 = compareDecimals(key, 0) === 0 ? moneySum(goods.map((l) => l.net)) : row.netTotal;
    const v0 = compareDecimals(key, 0) === 0 ? '0.00' : row.vatAmount;
    const credited = this.earlier.filter((e) => e.rate === key);
    const net = moneyDifference(n0, moneySum(credited.map((e) => e.net)));
    const vat = moneyDifference(v0, moneySum(credited.map((e) => moneyDifference(e.gross, e.net))));
    return [net, vat, moneySum([net, vat])];
  }

  /** The kept quantity of an order item, as the invoice side reads it. */
  keptQuantity(orderItemId: string): number {
    const invoiced = this.invoice.originalLines.filter((l) => l.orderItemId === orderItemId).reduce((a, l) => a + l.quantity, 0);
    return invoiced - this.earlier.filter((e) => e.orderItemId === orderItemId).reduce((a, e) => a + creditedQuantity(e), 0);
  }
}

/** One correction of an invoice issued per rate, with nothing credited before it. */
const first = (total: string | number, invoice: Invoice, lines: Line[]) => new Ledger(invoice).correct(total, lines);

const perRate = (r: ReturnType<typeof correctionAmounts>, rate: string) =>
  r.vatSummary.find((s) => s.taxRate === roundHalfUp(rate, 4));

describe('correctionAmounts', () => {
  it('stores the unit net price half-up at four places, not the binary 0.0187', () => {
    // 0.15 over 8 pieces is exactly 0.01875; `(0.15 / 8).toFixed(4)` is 0.0187.
    const invoice = invoiceOf([{ id: 'a', unit: '0.01875', qty: 8, rate: '0' }]);
    expect(first('0.15', invoice, [line('0.15', 8, '0')]).lines[0]?.unitNetPrice).toBe('0.0188');
  });

  it('rounds a credited amount half-up on its decimal digits, not the binary 1.00', () => {
    const r = first(1.005, invoiceOf([{ id: 'a', unit: '1.01', qty: 1, rate: '0' }]), [line(1.005, 1, '0')]);
    expect([r.credited, r.lines[0]?.gross]).toEqual(['1.01', '1.01']);
  });

  it('backs the net out per rate (G1, G2; V2 7.01)', () => {
    const invoice = invoiceOf([
      { id: 'a', unit: '29.50', qty: 1, rate: '0.23' },
      { id: 'b', unit: '4.30', qty: 1, rate: '0.05' },
    ]);
    const r = first('40.81', invoice, [line('36.29', 1, '0.2300', 'a'), line('4.52', 1, '0.0500', 'b')]);
    expect(r.lines.map((l) => [l.gross, l.net])).toEqual([
      ['36.29', '29.50'],
      ['4.52', '4.30'],
    ]);
    expect([r.credited, r.netTotal, r.taxTotal]).toEqual(['40.81', '33.80', '7.01']);
  });

  it('credits 9.05 × 3 at 8 % as the invoice charged it: 27.15 net, 2.17 VAT (V3)', () => {
    const r = first('29.32', invoiceOf([{ id: 'a', unit: '9.05', qty: 3, rate: '0.08' }]), [line('29.32', 3, '0.0800')]);
    expect([r.credited, r.netTotal, r.taxTotal]).toEqual(['29.32', '27.15', '2.17']);
  });

  it('caps the credit at the original gross and shares it out in line order', () => {
    const invoice = invoiceOf([
      { id: 'a', unit: '20.00', qty: 1, rate: '0' },
      { id: 'b', unit: '5.00', qty: 2, rate: '0' },
    ]);
    const r = first('40.00', invoice, [line('20.00', 1, '0', 'a'), line('20.00', 2, '0', 'b')]);
    expect(r.credited).toBe('30.00');
    expect(r.lines.map((l) => l.gross)).toEqual(['20.00', '10.00']);
    expect(r.lines[1]?.unitNetPrice).toBe('5.0000');
  });

  it('never credits a negative line', () => {
    const r = first('0.00', invoiceOf([{ id: 'a', unit: '10.00', qty: 1, rate: '0.23' }]), [line(-5, 1, '0.23')]);
    expect([r.lines[0]?.gross, r.lines[0]?.net]).toEqual(['0.00', '0.00']);
  });
});

describe('correctionAmounts — cumulative over an invoice’s corrections (review of PR #423)', () => {
  it('two corrections of 1 × 0.03 at 23 % credit 0.06 net and 0.01 VAT together — what was invoiced', () => {
    // Invoiced: 2 × 0.03, 0.06 net, 0.01 VAT, 0.07 gross. The returns refund 0.04, then 0.03.
    const ledger = new Ledger(invoiceOf([{ id: 'a', unit: '0.03', qty: 2, rate: '0.23' }]));
    const a = ledger.correct('0.04', [line('0.04', 1, '0.2300')]);
    const b = ledger.correct('0.03', [line('0.03', 1, '0.2300')]);
    expect([a.netTotal, a.taxTotal]).toEqual(['0.03', '0.01']);
    expect([b.netTotal, b.taxTotal]).toEqual(['0.03', '0.00']);
    expect(ledger.remaining('0.23')).toEqual(['0.00', '0.00', '0.00']);
  });

  it('credits a line of an invoice issued before 0.108.0 in proportion to that line, as it was invoiced', () => {
    // Issued before the per-rate method: the line was 2 × 0.03 at 23 %, net 0.06, gross 0.07.
    const original = [{ orderItemId: 'a', rate: '0.2300', net: '0.06', gross: '0.07', quantity: 2, unitNetPrice: '0.0300' }];
    const a = correctionAmounts({ total: '0.04', originalGross: '0.07', perRate: false, originalLines: original, earlierLines: [], lines: [line('0.04', 1, '0.2300')] });
    const b = correctionAmounts({
      total: '0.03',
      originalGross: '0.07',
      perRate: false,
      originalLines: original,
      earlierLines: [{ orderItemId: 'a', rate: '0.2300', net: a.lines[0]!.net, gross: a.lines[0]!.gross, quantity: 1, unitNetPrice: a.lines[0]!.unitNetPrice }],
      lines: [line('0.03', 1, '0.2300')],
    });
    expect(Number(a.lines[0]!.net) + Number(b.lines[0]!.net)).toBeCloseTo(0.06, 10);
    expect(Number(a.taxTotal) + Number(b.taxTotal)).toBeCloseTo(0.01, 10);
  });

  it('never credits more than remains of the invoice after earlier corrections', () => {
    const ledger = new Ledger(invoiceOf([{ id: 'a', unit: '5.00', qty: 6, rate: '0' }]));
    ledger.correct('25.00', [line('25.00', 5, '0')]);
    expect(ledger.correct('20.00', [line('20.00', 4, '0')]).credited).toBe('5.00');
  });

  it('refuses a total above the sum of its lines rather than book the excess as net without VAT', () => {
    const invoice = invoiceOf([{ id: 'a', unit: '100.00', qty: 1, rate: '0.23' }]);
    expect(() => first('50.00', invoice, [line('20.00', 1, '0.23')])).toThrow(/exceeds/);
  });
});

describe('correctionAmounts — an order-level discount (review of PR #423)', () => {
  it('credits the goods as invoiced and the discount back on its own 0 % line, totalling the refund', () => {
    // Invoiced: 100.00 net at 23 % (123.00) and a 0 % discount line of −50.00. A full return refunds 73.00.
    const invoice = invoiceOf([{ id: 'a', unit: '100.00', qty: 1, rate: '0.23' }], { discount: '50.00' });
    const r = first('73.00', invoice, [{ amount: '73.00', discount: '50.00', quantity: 1, rate: '0.2300', orderItemId: 'a' }]);
    expect(r.lines.map((l) => [l.gross, l.net])).toEqual([['123.00', '100.00']]);
    expect(r.discountCredit).toBe('-50.00');
    expect([r.credited, r.netTotal, r.taxTotal]).toEqual(['73.00', '50.00', '23.00']);
    expect(r.vatSummary).toEqual([
      { taxRate: '0.0000', netTotal: '-50.00', vatAmount: '0.00', grossTotal: '-50.00' },
      { taxRate: '0.2300', netTotal: '100.00', vatAmount: '23.00', grossTotal: '123.00' },
    ]);
  });

  // Review of PR #423 (B1): 2 × 100.00 net at 23 % and a 20.00 order discount,
  // each line carrying 10.00 of it and refunding 113.00. A total below what the
  // lines add up to must not credit every line at amount + discount.
  const discounted = (total: string) =>
    first(
      total,
      invoiceOf(
        [
          { id: 'a', unit: '100.00', qty: 1, rate: '0.23' },
          { id: 'b', unit: '100.00', qty: 1, rate: '0.23' },
        ],
        { discount: '20.00' },
      ),
      [
        { amount: '113.00', discount: '10.00', quantity: 1, rate: '0.2300', orderItemId: 'a' },
        { amount: '113.00', discount: '10.00', quantity: 1, rate: '0.2300', orderItemId: 'b' },
      ],
    );

  it('credits a total below its lines as goods only, never more VAT than the total carries', () => {
    const r = discounted('113.00');
    expect(r.lines.map((l) => l.gross)).toEqual(['113.00', '0.00']);
    expect(r.discountCredit).toBe('0.00');
    expect([r.credited, r.netTotal, r.taxTotal]).toEqual(['113.00', '91.87', '21.13']);
    expect(r.vatSummary).toEqual([{ taxRate: '0.2300', netTotal: '91.87', vatAmount: '21.13', grossTotal: '113.00' }]);
  });

  it('credits nothing — no goods, no VAT, no discount — for a total of zero', () => {
    const r = discounted('0.00');
    expect(r.lines.map((l) => [l.gross, l.net])).toEqual([
      ['0.00', '0.00'],
      ['0.00', '0.00'],
    ]);
    expect([r.credited, r.netTotal, r.taxTotal, r.discountCredit]).toEqual(['0.00', '0.00', '0.00', '0.00']);
  });

  it('still credits the goods and the discount separately when the total is what the lines add up to', () => {
    const r = discounted('226.00');
    expect(r.lines.map((l) => [l.gross, l.net])).toEqual([
      ['123.00', '100.00'],
      ['123.00', '100.00'],
    ]);
    expect([r.credited, r.netTotal, r.taxTotal, r.discountCredit]).toEqual(['226.00', '180.00', '46.00', '-20.00']);
  });
});

// The worked examples of the #873 design (2026-11-07), gross / net / VAT.
const BOLT: InvoicedLine = { id: 'A', unit: '10.0100', qty: 3, rate: '0.23' };
const WASHER: InvoicedLine = { id: 'B', unit: '4.9950', qty: 2, rate: '0.08' };

describe('correctionAmounts — anchored on what the invoice keeps (issue #873)', () => {
  it('3 × 10.01 at 23 %, one unit back at 12.32: credits 10.01 / 2.31 and keeps 20.02 / 4.60 — vatByRate of the kept 20.02', () => {
    const ledger = new Ledger(invoiceOf([BOLT]));
    const r = ledger.correct('12.32', [line('12.32', 1, '0.23', 'A')]);
    expect(perRate(r, '0.23')).toEqual({ taxRate: '0.2300', netTotal: '10.01', vatAmount: '2.31', grossTotal: '12.32' });
    expect(r.paths).toEqual({ '0.2300': 'quantity' });
    expect(ledger.remaining('0.23')).toEqual(['20.02', '4.60', '24.62']);
  });

  it('then one unit, then the last: 12.31 / 10.01 / 2.30 each, down to 0 / 0', () => {
    const ledger = new Ledger(invoiceOf([BOLT]));
    ledger.correct('12.32', [line('12.32', 1, '0.23', 'A')]);
    const second = ledger.correct('12.31', [line('12.31', 1, '0.23', 'A')]);
    expect([second.netTotal, second.taxTotal, second.paths['0.2300']]).toEqual(['10.01', '2.30', 'quantity']);
    expect(ledger.remaining('0.23')).toEqual(['10.01', '2.30', '12.31']);
    const third = ledger.correct('12.31', [line('12.31', 1, '0.23', 'A')]);
    expect([third.netTotal, third.taxTotal, third.paths['0.2300']]).toEqual(['10.01', '2.30', 'quantity']);
    expect(ledger.remaining('0.23')).toEqual(['0.00', '0.00', '0.00']);
  });

  describe('two rates with a 5.00 order discount: A = 3 × 10.0100 at 23 %, B = 2 × 4.9950 at 8 %', () => {
    for (const extras of [{}, { delivery: '10.00', surcharge: '2.50' }] as const) {
      const label = 'delivery' in extras ? ', with delivery and a surcharge' : '';
      it(`closes at what the invoice charged per rate, case by case${label}`, () => {
        const invoice = invoiceOf([BOLT, WASHER], { discount: '5.00', ...extras });
        expect(invoice.originalSummary.filter((s) => s.taxRate !== '0')).toEqual([
          { taxRate: '0.08', netTotal: '9.99', vatAmount: '0.80', grossTotal: '10.79' },
          { taxRate: '0.23', netTotal: '30.03', vatAmount: '6.91', grossTotal: '36.94' },
        ]);
        const ledger = new Ledger(invoice);

        // Case 1: 1A + 1B.
        const one = ledger.correct('15.86', [
          line('11.03', 1, '0.23', 'A', { discount: '1.29' }),
          line('4.83', 1, '0.08', 'B', { discount: '0.56' }),
        ]);
        expect(perRate(one, '0.23')).toEqual({ taxRate: '0.2300', netTotal: '10.01', vatAmount: '2.31', grossTotal: '12.32' });
        expect(perRate(one, '0.08')).toEqual({ taxRate: '0.0800', netTotal: '4.99', vatAmount: '0.40', grossTotal: '5.39' });
        expect(one.discountCredit).toBe('-1.85');
        expect([one.credited, one.netTotal, one.taxTotal]).toEqual(['15.86', '13.15', '2.71']);
        expect(ledger.remaining('0.23')).toEqual(['20.02', '4.60', '24.62']);
        expect(ledger.remaining('0.08')).toEqual(['5.00', '0.40', '5.40']);
        // 24.62 + 5.40 − 3.15 of discount left = 26.87 = 42.73 − 15.86.
        expect(moneyDifference(invoice.originalGross, ledger.creditedBefore)).toBe(
          moneySum(['26.87', 'delivery' in extras ? '12.50' : '0']),
        );

        // Case 2: 1A.
        const two = ledger.correct('11.02', [line('11.02', 1, '0.23', 'A', { discount: '1.29' })]);
        expect(perRate(two, '0.23')).toEqual({ taxRate: '0.2300', netTotal: '10.01', vatAmount: '2.30', grossTotal: '12.31' });
        expect(two.discountCredit).toBe('-1.29');
        expect(moneyDifference(invoice.originalGross, ledger.creditedBefore)).toBe(
          moneySum(['15.85', 'delivery' in extras ? '12.50' : '0']),
        );

        // Case 3: the rest.
        const three = ledger.correct('15.85', [
          line('11.02', 1, '0.23', 'A', { discount: '1.29' }),
          line('4.83', 1, '0.08', 'B', { discount: '0.57' }),
        ]);
        expect(perRate(three, '0.23')).toEqual({ taxRate: '0.2300', netTotal: '10.01', vatAmount: '2.30', grossTotal: '12.31' });
        expect(perRate(three, '0.08')).toEqual({ taxRate: '0.0800', netTotal: '5.00', vatAmount: '0.40', grossTotal: '5.40' });
        expect(three.discountCredit).toBe('-1.86');
        expect(ledger.remaining('0.23')).toEqual(['0.00', '0.00', '0.00']);
        expect(ledger.remaining('0.08')).toEqual(['0.00', '0.00', '0.00']);
        // Only the delivery and the surcharge are left, untouched by a return.
        expect(moneyDifference(invoice.originalGross, ledger.creditedBefore)).toBe('delivery' in extras ? '12.50' : '0.00');
      });
    }
  });

  it('an operator-reduced amount takes the gross path: 10.00 of 12.32 credits 8.13 / 1.87 and keeps 21.90 / 5.04', () => {
    const ledger = new Ledger(invoiceOf([BOLT]));
    const reduced = ledger.correct('10.00', [line('10.00', 1, '0.23', 'A')]);
    expect([reduced.netTotal, reduced.taxTotal, reduced.paths['0.2300']]).toEqual(['8.13', '1.87', 'gross']);
    expect(ledger.remaining('0.23')).toEqual(['21.90', '5.04', '26.94']);
    // The other two units at their default of 24.62: what is left is the retained amount.
    const rest = ledger.correct('24.62', [line('24.62', 2, '0.23', 'A')]);
    expect([rest.netTotal, rest.taxTotal]).toEqual(['20.01', '4.61']);
    expect(ledger.remaining('0.23')).toEqual(['1.89', '0.43', '2.32']);
  });

  it('a reduced amount carrying a discount: 5.50 of 11.03 credits 6.14 / 4.99 / 1.15 and −0.64 of discount', () => {
    const ledger = new Ledger(invoiceOf([BOLT, WASHER], { discount: '5.00' }));
    const r = ledger.correct('5.50', [line('5.50', 1, '0.23', 'A', { discount: '0.64' })]);
    expect(perRate(r, '0.23')).toEqual({ taxRate: '0.2300', netTotal: '4.99', vatAmount: '1.15', grossTotal: '6.14' });
    expect([r.discountCredit, r.credited, r.paths['0.2300']]).toEqual(['-0.64', '5.50', 'gross']);
  });

  // E1 (owner ruling of 2026-11-07): no net gives 30.94 at 23 %, so the credit
  // follows the rule and what is left is a cent off it; the money is exact.
  it('E1 — 6.00 of 12.32 has no exact remainder: the credit is 4.88 / 1.12, the invoice keeps 25.15 / 5.79', () => {
    const ledger = new Ledger(invoiceOf([BOLT]));
    const r = ledger.correct('6.00', [line('6.00', 1, '0.23', 'A')]);
    expect([r.netTotal, r.taxTotal, r.paths['0.2300']]).toEqual(['4.88', '1.12', 'gross_credit']);
    expect(ledger.remaining('0.23')).toEqual(['25.15', '5.79', '30.94']);
  });

  it('L0 — a pre-0.108.0 order on a per-rate invoice: 36.28 + 4.52 credits 29.49 / 6.79 and 4.30 / 0.22', () => {
    const ledger = new Ledger(
      invoiceOf([
        { id: 'a', unit: '29.50', qty: 1, rate: '0.23' },
        { id: 'b', unit: '4.30', qty: 1, rate: '0.05' },
      ]),
    );
    const r = ledger.correct('40.80', [line('36.28', 1, '0.23', 'a'), line('4.52', 1, '0.05', 'b')]);
    expect([r.credited, r.netTotal, r.taxTotal]).toEqual(['40.80', '33.79', '7.01']);
    expect(r.paths).toEqual({ '0.0500': 'quantity', '0.2300': 'gross' });
    // The cent never paid stays on the invoice as 0.01 net and no VAT, which follows the rule.
    expect(ledger.remaining('0.23')).toEqual(['0.01', '0.00', '0.01']);
  });

  it('splits a rate’s net over its lines by what each kept line lost, on the quantity path', () => {
    // Two lines at 23 %: 3 × 10.01 and 1 × 0.01. One Bolt and the 0.01 come back at their drop.
    const ledger = new Ledger(invoiceOf([BOLT, { id: 'C', unit: '0.01', qty: 1, rate: '0.23' }]));
    // Kept 20.02, VAT 4.60: 24.62 of 36.95, so the drop is 12.33.
    const r = ledger.correct('12.33', [line('12.32', 1, '0.23', 'A'), line('0.01', 1, '0.23', 'C')]);
    expect(r.paths['0.2300']).toBe('quantity');
    expect(r.lines.map((l) => l.net)).toEqual(['10.01', '0.01']);
  });
});

describe('correctionAmounts — a complaint refund is a price reduction (issue #885)', () => {
  const reduction = (amount: string, quantity = 1, orderItemId = 'A') =>
    line(amount, quantity, '0.23', orderItemId, { basis: 'price_reduction' });

  it('AC-885-1 — 6.15 on 1 of 3 × 10.01 credits 5.00 / 1.15, no discount, and keeps the 3 units', () => {
    const ledger = new Ledger(invoiceOf([BOLT]));
    const r = ledger.correct('6.15', [reduction('6.15')]);
    expect([r.netTotal, r.taxTotal, r.credited, r.discountCredit, r.paths['0.2300']]).toEqual([
      '5.00',
      '1.15',
      '6.15',
      '0.00',
      'gross',
    ]);
    // The change in the unit net price over the 3 units still on the invoice.
    expect(r.lines[0]!.unitNetPrice).toBe('1.6667');
    expect(ledger.keptQuantity('A')).toBe(3);
    expect(ledger.remaining('0.23')).toEqual(['25.03', '5.76', '30.79']);
  });

  it('on one rate the invoice-wide cap binds first: 36.94 asked after 6.15 credits the 30.79 left', () => {
    const ledger = new Ledger(invoiceOf([BOLT]));
    ledger.correct('6.15', [reduction('6.15')]);
    expect(ledger.correct('36.94', [line('36.94', 3, '0.23', 'A')]).credited).toBe('30.79');
    expect(ledger.remaining('0.23')).toEqual(['0.00', '0.00', '0.00']);
  });

  // Architect ruling on #932: the invoice-wide cap applies before the per-rate
  // guard, so AC-885-8 applies to multi-rate invoices only.
  it('cap first on one rate: 36.94 asked after a 6.15 price reduction is capped at 30.79 = 25.03 / 5.76, not refused', () => {
    const ledger = new Ledger(invoiceOf([BOLT]));
    ledger.correct('6.15', [reduction('6.15')]);
    expect(ledger.earlier[0]).toMatchObject({ net: '5.00', gross: '6.15', quantity: 0 });
    let r: ReturnType<typeof correctionAmounts> | undefined;
    expect(() => {
      r = ledger.correct('36.94', [line('36.94', 3, '0.23', 'A')]);
    }).not.toThrow();
    expect([r!.credited, r!.netTotal, r!.taxTotal]).toEqual(['30.79', '25.03', '5.76']);
    expect(ledger.remaining('0.23')).toEqual(['0.00', '0.00', '0.00']);
  });

  it('a zero credit at a rate the invoice no longer charges is not refused', () => {
    const ledger = new Ledger(invoiceOf([BOLT, WASHER], { discount: '5.00' }));
    // All of A back: the 23 % rate is fully credited.
    ledger.correct('33.07', [line('33.07', 3, '0.23', 'A', { discount: '3.87' })]);
    expect(ledger.remaining('0.23')).toEqual(['0.00', '0.00', '0.00']);
    let r: ReturnType<typeof correctionAmounts> | undefined;
    expect(() => {
      r = ledger.correct('4.83', [
        line('0.00', 1, '0.23', 'A'),
        line('4.83', 1, '0.08', 'B', { discount: '0.56' }),
      ]);
    }).not.toThrow(CorrectionExceedsRateRemainingError);
    expect(perRate(r!, '0.23')).toEqual({ taxRate: '0.2300', netTotal: '0.00', vatAmount: '0.00', grossTotal: '0.00' });
    expect(ledger.remaining('0.23')).toEqual(['0.00', '0.00', '0.00']);
  });

  it('AC-885-2 — then a return of 1 unit at 12.32 (3 → 2), then the last 2 capped at 18.47, down to 0', () => {
    const ledger = new Ledger(invoiceOf([BOLT]));
    ledger.correct('6.15', [reduction('6.15')]);
    const back = ledger.correct('12.32', [line('12.32', 1, '0.23', 'A')]);
    expect([back.netTotal, back.taxTotal, back.paths['0.2300']]).toEqual(['10.01', '2.31', 'gross']);
    expect(ledger.keptQuantity('A')).toBe(2);
    expect(ledger.remaining('0.23')).toEqual(['15.02', '3.45', '18.47']);
    expect(compareDecimals(ledger.creditedBefore, '36.94')).toBeLessThanOrEqual(0);
    // AC-885-2b.
    const rest = ledger.correct('18.47', [line('18.47', 2, '0.23', 'A')]);
    expect([rest.netTotal, rest.taxTotal, rest.paths['0.2300']]).toEqual(['15.02', '3.45', 'quantity']);
    expect(ledger.remaining('0.23')).toEqual(['0.00', '0.00', '0.00']);
    expect(ledger.creditedBefore).toBe('36.94');
  });

  it('AC-885-3 — on the discounted two-rate order: no discount credit, then a return of 1A carries its own', () => {
    const invoice = invoiceOf([BOLT, WASHER], { discount: '5.00' });
    const ledger = new Ledger(invoice);
    const complaint = ledger.correct('6.15', [reduction('6.15')]);
    expect(complaint.vatSummary).toEqual([{ taxRate: '0.2300', netTotal: '5.00', vatAmount: '1.15', grossTotal: '6.15' }]);
    expect(complaint.discountCredit).toBe('0.00');
    const back = ledger.correct('11.03', [line('11.03', 1, '0.23', 'A', { discount: '1.29' })]);
    expect(perRate(back, '0.23')).toEqual({ taxRate: '0.2300', netTotal: '10.01', vatAmount: '2.31', grossTotal: '12.32' });
    expect(back.discountCredit).toBe('-1.29');
    expect(ledger.remaining('0.23')).toEqual(['15.02', '3.45', '18.47']);
    expect(ledger.remaining('0.08')).toEqual(['9.99', '0.80', '10.79']);
    // 18.47 + 10.79 − 3.71 = 25.55 = 42.73 − 6.15 − 11.03.
    expect(moneyDifference(invoice.originalGross, ledger.creditedBefore)).toBe('25.55');
  });

  it('AC-885-4 — a price-reduction line contributes 0 to the credited quantities, a returned-goods line its quantity', () => {
    expect(isPriceReductionLine({ orderItemId: 'A', quantity: '0.000' })).toBe(true);
    expect(isPriceReductionLine({ orderItemId: 'A', quantity: '1.000' })).toBe(false);
    // A 0 % discount line names no order item: not goods, not a price reduction.
    expect(isPriceReductionLine({ orderItemId: null, quantity: 0 })).toBe(false);
    expect(creditedQuantity({ orderItemId: 'A', quantity: '0.000' })).toBe(0);
    expect(creditedQuantity({ orderItemId: 'A', quantity: '2.000' })).toBe(2);
    expect(storedCorrectionQuantity('price_reduction', 1)).toBe(0);
    expect(storedCorrectionQuantity('returned_goods', 2)).toBe(2);
    expect(storedCorrectionQuantity(undefined, 2)).toBe(2);
  });

  it('AC-885-4 — a complaint correction issued before this release (quantity 1) followed by a one-unit return still credits 10.01 / 2.31', () => {
    const ledger = new Ledger(invoiceOf([BOLT]));
    // Issued as a quantity credit, the way corrections were written before #885.
    ledger.correct('6.15', [line('6.15', 1, '0.23', 'A')]);
    expect(ledger.keptQuantity('A')).toBe(2);
    const back = ledger.correct('12.32', [line('12.32', 1, '0.23', 'A')]);
    expect([back.netTotal, back.taxTotal]).toEqual(['10.01', '2.31']);
  });

  it('AC-885-8 — refuses a credit above what the invoice still charges at a rate', () => {
    // Two rates: the invoice-wide cap (42.73 − 6.15 = 36.58) does not bound one rate.
    // All of A back at 33.07 carrying 3.87 of discount asks 36.94 at 23 %, where 30.79 is left.
    const ledger = new Ledger(invoiceOf([BOLT, WASHER], { discount: '5.00' }));
    ledger.correct('6.15', [reduction('6.15')]);
    let thrown: unknown;
    try {
      ledger.correct('33.07', [line('33.07', 3, '0.23', 'A', { discount: '3.87' })]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CorrectionExceedsRateRemainingError);
    expect(thrown).toMatchObject({ taxRate: '0.2300', remaining: '30.79' });
  });

  // E1 (owner ruling of 2026-11-07) covers complaint amounts with no exact split too.
  it('E1 — a complaint of 6.00 credits 4.88 / 1.12 on the credit-exact step', () => {
    const r = first('6.00', invoiceOf([BOLT]), [reduction('6.00')]);
    expect([r.netTotal, r.taxTotal, r.paths['0.2300']]).toEqual(['4.88', '1.12', 'gross_credit']);
  });
});

// ---------------------------------------------------------------------------
// Properties. A seeded generator, so a failure names its seed and replays.
// ---------------------------------------------------------------------------

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RATES = ['0.23', '0.08', '0.05', '0'];

interface Generated {
  lines: InvoicedLine[];
  extras: { discount?: string; delivery?: string; surcharge?: string };
}

function generateInvoice(rand: () => number): Generated {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const rates = [...RATES].sort(() => rand() - 0.5).slice(0, int(1, 3));
  const lines: InvoicedLine[] = [];
  for (const rate of rates) {
    for (let k = int(1, 3); k > 0; k -= 1) {
      lines.push({ id: `l${lines.length}`, unit: (int(100, 500_000) / 10_000).toFixed(4), qty: int(1, 5), rate });
    }
  }
  const goodsGross = vatByRate(lines.map((l) => ({ net: lineAmountHalfUp(l.unit, l.qty), rate: l.rate })), 'fraction').gross;
  const extras: Generated['extras'] = {};
  const maxDiscount = Math.floor(Number(goodsGross) * 30);
  if (rand() < 0.5 && maxDiscount > 0) extras.discount = (int(1, maxDiscount) / 100).toFixed(2);
  if (rand() < 0.3) extras.delivery = (int(1, 2000) / 100).toFixed(2);
  if (rand() < 0.3) extras.surcharge = '2.50';
  return { lines, extras };
}

/** The gross of the kept nets at a rate, under `vatByRate` — what the returns side refunds the drop of. */
function keptGross(g: Generated, kept: Map<string, number>, rate: string): string {
  const atRate = g.lines.filter((l) => l.rate === rate);
  const nets = atRate.map((l) => {
    const q = kept.get(l.id)!;
    return q === l.qty ? lineAmountHalfUp(l.unit, l.qty) : lineAmountHalfUp(l.unit, q);
  });
  return moneySum([moneySum(nets), roundHalfUp(decimalProduct(moneySum(nets), rate))]);
}

/**
 * A default-amount return of `k` units of `l`, as the returns side refunds one:
 * the drop in the kept gross at the line's rate (no more than the invoice keeps
 * there), carrying its share of the order discount — the last return all of
 * what is left, and always enough that the refund fits what the invoice keeps.
 */
function defaultReturn(
  g: Generated,
  ledger: Ledger,
  kept: Map<string, number>,
  discount: { total: string; left: string },
  l: InvoicedLine,
  k: number,
): { total: string; line: Line } {
  const remainingOfInvoice = moneyDifference(ledger.invoice.originalGross, ledger.creditedBefore);
  const before = keptGross(g, kept, l.rate);
  kept.set(l.id, kept.get(l.id)! - k);
  let drop = moneyDifference(before, keptGross(g, kept, l.rate));
  const atRate = ledger.remaining(l.rate)[2];
  if (compareDecimals(drop, atRate) > 0) drop = atRate;
  const goodsGross = vatByRate(g.lines.map((x) => ({ net: lineAmountHalfUp(x.unit, x.qty), rate: x.rate })), 'fraction').gross;
  let carried = g.lines.every((x) => kept.get(x.id) === 0)
    ? discount.left
    : quotientHalfUp(decimalProduct(discount.total, drop), goodsGross);
  const atLeast = moneyDifference(drop, remainingOfInvoice);
  if (compareDecimals(carried, atLeast) < 0) carried = atLeast;
  if (compareDecimals(carried, discount.left) > 0) carried = discount.left;
  if (compareDecimals(carried, drop) > 0) carried = drop;
  if (compareDecimals(carried, 0) < 0) carried = '0.00';
  const amount = moneyDifference(drop, carried);
  discount.left = moneyDifference(discount.left, carried);
  return { total: amount, line: line(amount, k, l.rate, l.id, compareDecimals(carried, 0) > 0 ? { discount: carried } : {}) };
}

describe('correctionAmounts — properties (issues #873, #885)', () => {
  it('default-amount returns only: every correction takes the quantity path and the invoice keeps vatByRate of the kept nets', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const rand = prng(seed);
      const g = generateInvoice(rand);
      const ledger = new Ledger(invoiceOf(g.lines, g.extras));
      const kept = new Map(g.lines.map((l) => [l.id, l.qty]));
      const discount = { total: g.extras.discount ?? '0.00', left: g.extras.discount ?? '0.00' };
      for (let step = 0; step < 8; step += 1) {
        const candidates = g.lines.filter((l) => kept.get(l.id)! > 0);
        if (candidates.length === 0) break;
        const l = candidates[Math.floor(rand() * candidates.length)]!;
        const k = 1 + Math.floor(rand() * kept.get(l.id)!);
        const { total, line: returned } = defaultReturn(g, ledger, kept, discount, l, k);
        const r = ledger.correct(total, [returned]);
        expect(r.credited, `seed ${seed}`).toBe(total);
        expect(r.paths[roundHalfUp(l.rate, 4)], `seed ${seed}`).toBe('quantity');
        for (const rate of new Set(g.lines.map((x) => x.rate))) {
          const keptNets = g.lines
            .filter((x) => x.rate === rate)
            .map((x) => (kept.get(x.id) === x.qty ? lineAmountHalfUp(x.unit, x.qty) : lineAmountHalfUp(x.unit, kept.get(x.id)!)));
          const expected = vatByRate([{ net: moneySum(keptNets), rate }], 'fraction').rows[0]!;
          expect(ledger.remaining(rate), `seed ${seed}, rate ${rate}`).toEqual([expected.net, expected.vat, expected.gross]);
        }
      }
    }
  });

  it('random complaints interleaved with returns: the money is exact, kept quantities ignore complaints, and VAT never drifts', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const rand = prng(seed * 7919);
      const g = generateInvoice(rand);
      const invoice = invoiceOf(g.lines, g.extras);
      const ledger = new Ledger(invoice);
      const kept = new Map(g.lines.map((l) => [l.id, l.qty]));
      const discount = { total: g.extras.discount ?? '0.00', left: g.extras.discount ?? '0.00' };
      let amounts = '0.00';
      const events = 1 + Math.floor(rand() * 8);
      for (let step = 0; step < events; step += 1) {
        const remainingOfInvoice = moneyDifference(invoice.originalGross, ledger.creditedBefore);
        const complaint = rand() < 0.5;
        let r: ReturnType<typeof correctionAmounts>;
        let rate: string;
        let total: string;
        if (complaint) {
          const candidates = g.lines.filter((l) => compareDecimals(ledger.remaining(l.rate)[2], 0) > 0);
          if (candidates.length === 0 || compareDecimals(remainingOfInvoice, 0) <= 0) continue;
          const l = candidates[Math.floor(rand() * candidates.length)]!;
          rate = l.rate;
          const bound = Math.round(
            Number(compareDecimals(ledger.remaining(rate)[2], remainingOfInvoice) <= 0 ? ledger.remaining(rate)[2] : remainingOfInvoice) * 100,
          );
          total = ((1 + Math.floor(rand() * bound)) / 100).toFixed(2);
          const complained = 1 + Math.floor(rand() * l.qty);
          r = ledger.correct(total, [line(total, complained, rate, l.id, { basis: 'price_reduction' })]);
          // Invariant 5: a complaint carries no discount.
          expect(r.discountCredit, `seed ${seed}`).toBe('0.00');
        } else {
          const candidates = g.lines.filter((l) => kept.get(l.id)! > 0);
          if (candidates.length === 0) continue;
          const l = candidates[Math.floor(rand() * candidates.length)]!;
          rate = l.rate;
          const k = 1 + Math.floor(rand() * kept.get(l.id)!);
          const returned = defaultReturn(g, ledger, kept, discount, l, k);
          total = returned.total;
          r = ledger.correct(total, [returned.line]);
        }
        amounts = moneySum([amounts, total]);
        // Invariant 2: what the invoice keeps is what is left paid, to the cent.
        expect(r.credited, `seed ${seed}`).toBe(total);
        expect(moneyDifference(invoice.originalGross, ledger.creditedBefore), `seed ${seed}`).toBe(
          moneyDifference(invoice.originalGross, amounts),
        );
        // Invariant 3: per rate, the credited net is within [0, G] and the VAT is the rest.
        const key = roundHalfUp(rate, 4);
        const row = perRate(r, rate)!;
        expect(compareDecimals(row.netTotal, 0), `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(compareDecimals(row.netTotal, row.grossTotal), `seed ${seed}`).toBeLessThanOrEqual(0);
        expect(row.vatAmount).toBe(moneyDifference(row.grossTotal, row.netTotal));
        for (const x of new Set(g.lines.map((l) => l.rate))) {
          const [net, vat, gross] = ledger.remaining(x);
          expect(compareDecimals(net, 0), `seed ${seed}, rate ${x}`).toBeGreaterThanOrEqual(0);
          expect(compareDecimals(vat, 0), `seed ${seed}, rate ${x}`).toBeGreaterThanOrEqual(0);
          // Invariant 4: on the rule, or within the one cent E1 allows — never further.
          const drift = Math.abs(Number(moneyDifference(vat, roundHalfUp(decimalProduct(net, x)))));
          expect(drift, `seed ${seed}, rate ${x}`).toBeLessThanOrEqual(0.01);
          if (x === rate && (r.paths[key] === 'quantity' || r.paths[key] === 'gross')) {
            expect(vat, `seed ${seed}, rate ${x}, path ${r.paths[key]}`).toBe(roundHalfUp(decimalProduct(net, x)));
          }
          // Invariant 6: a rate whose goods all came back keeps nothing.
          if (g.lines.filter((l) => l.rate === x).every((l) => kept.get(l.id) === 0)) {
            expect([net, vat, gross], `seed ${seed}, rate ${x}`).toEqual(['0.00', '0.00', '0.00']);
          }
        }
        // Invariant 1: the invoice side's kept quantity ignores complaints.
        for (const l of g.lines) expect(ledger.keptQuantity(l.id), `seed ${seed}`).toBe(kept.get(l.id));
      }
    }
  });
});
