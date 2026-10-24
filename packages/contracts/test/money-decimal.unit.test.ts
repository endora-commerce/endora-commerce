import { describe, expect, it } from 'vitest';
import {
  compareDecimals,
  decimalDifference,
  decimalProduct,
  decimalSum,
  grossAmountHalfUp,
  grossFromNetHalfUp,
  lineAmountHalfUp,
  moneyDifference,
  moneySum,
  netFromGrossHalfUp,
  percentOfHalfUp,
  quotientHalfUp,
  roundAmountHalfUp,
  roundHalfUp,
  taxAmountExact,
  taxAmountHalfUp,
  wholeMultiples,
  vatByRate,
  allocateHalfUp,
  netForGrossAtRate,
} from '../src/index.js';

/**
 * Issue #417 — the exact decimal money arithmetic every stored, charged or
 * displayed amount outside the price book is computed with. Each "binary"
 * expectation below is what the double arithmetic it replaces answered, so a
 * regression to `toFixed(2)` or `Math.round(x * 100) / 100` reads as a
 * difference in the vector, not as a vague mismatch
 * (`specs/pricing/worked-examples.md` §10.16 and §10.17).
 */
describe('roundHalfUp', () => {
  it('rounds the decimal digits half-up, which the binary rounding does not', () => {
    expect(roundHalfUp('9.045')).toBe('9.05');
    expect((9.045).toFixed(2)).toBe('9.04');
    expect(roundHalfUp(1.005)).toBe('1.01');
    expect(Math.round(1.005 * 100) / 100).toBe(1);
  });

  it('rounds a negative value half away from zero and never writes −0', () => {
    expect(roundHalfUp('-1.005')).toBe('-1.01');
    expect(roundHalfUp('-0.004')).toBe('0.00');
    expect(roundHalfUp('-0')).toBe('0.00');
  });

  it('pads to the places asked and rounds to four for a unit price', () => {
    expect(roundHalfUp('3')).toBe('3.00');
    expect(roundHalfUp('2.5', 4)).toBe('2.5000');
    expect(roundHalfUp('0.123450', 4)).toBe('0.1235');
    expect(roundHalfUp('12.5', 0)).toBe('13');
  });

  it('agrees with roundAmountHalfUp', () => {
    for (const v of ['9.045', '1.005', '-2.675', '0', '123.4449', '0.995', 36.285, 20.295]) {
      expect(roundHalfUp(v)).toBe(roundAmountHalfUp(v));
    }
  });

  it('refuses what is not a decimal', () => {
    expect(() => roundHalfUp('abc')).toThrow();
    expect(() => roundHalfUp('1.2.3')).toThrow();
    expect(() => roundHalfUp(Number.NaN)).toThrow();
    expect(() => roundHalfUp('1', -1)).toThrow();
  });
});

describe('exact sums, differences and products', () => {
  it('sums without the binary residue', () => {
    expect(decimalSum('0.1', '0.2')).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(decimalSum(0.1, 0.2, '-0.3')).toBe('0.0');
    expect(decimalSum()).toBe('0');
  });

  it('subtracts and multiplies exactly', () => {
    expect(decimalDifference('100.00', '99.99')).toBe('0.01');
    expect(decimalDifference('0.3', 0.1)).toBe('0.2');
    expect(0.3 - 0.1).not.toBe(0.2);
    expect(decimalProduct('29.50', '1.23')).toBe('36.2850');
    expect(decimalProduct('-2.5', '3')).toBe('-7.5');
  });

  it('compares signed decimals of any scale', () => {
    expect(compareDecimals('0.30', 0.3)).toBe(0);
    expect(compareDecimals('0.2', decimalDifference('0.3', '0.1'))).toBe(0);
    expect(compareDecimals('-1', '0.5')).toBe(-1);
    expect(compareDecimals('10.001', '10')).toBe(1);
  });

  it('rounds a money sum and a difference once, at the end', () => {
    expect(moneySum(['6.785', '0.215'])).toBe('7.00');
    expect(moneySum([0.1, 0.2])).toBe('0.30');
    expect(moneySum([])).toBe('0.00');
    expect(moneyDifference('0.30', '0.10')).toBe('0.20');
  });
});

describe('line, tax and gross amounts', () => {
  it('multiplies a unit price by a quantity', () => {
    expect(lineAmountHalfUp('9.05', 3)).toBe('27.15');
    expect(lineAmountHalfUp('0.10', 3)).toBe('0.30');
    expect(0.1 * 3).not.toBe(0.3);
  });

  it('computes the tax on a net half-up on the exact product (§10.17)', () => {
    // T1: 0.70 at 5 % is exactly 0.035.
    expect(taxAmountHalfUp('0.70', '0.05', 'fraction')).toBe('0.04');
    expect(Math.round(0.7 * 0.05 * 100) / 100).toBe(0.03);
    expect(taxAmountHalfUp('29.50', 23, 'percent')).toBe('6.79');
    expect(taxAmountExact('29.50', '0.23', 'fraction')).toBe('6.7850');
  });

  it('computes the gross on a net half-up on the exact product (G1–G4)', () => {
    const vectors: Array<[string, string, string]> = [
      ['29.50', '0.23', '36.29'],
      ['4.30', '0.05', '4.52'],
      ['31.50', '0.23', '38.75'],
      ['16.50', '0.23', '20.30'],
    ];
    for (const [net, rate, gross] of vectors) {
      expect(grossFromNetHalfUp(net, rate, 'fraction')).toBe(gross);
      expect(grossFromNetHalfUp(net, Number(rate) * 100, 'percent')).toBe(gross);
      expect(grossAmountHalfUp(net, rate, 'fraction')).toBe(gross);
    }
    // What the invoice line builder's `Math.round((n + EPSILON) * 100) / 100` answered.
    expect(Math.round((29.5 * 1.23 + Number.EPSILON) * 100) / 100).toBe(36.28);
  });

  it('carries a negative net (a discount line) half away from zero', () => {
    expect(grossFromNetHalfUp('-100.00', 0, 'fraction')).toBe('-100.00');
    expect(grossFromNetHalfUp('-29.50', '0.23', 'fraction')).toBe('-36.29');
  });

  it('refuses a negative rate', () => {
    expect(() => taxAmountHalfUp('1', '-0.23', 'fraction')).toThrow();
    expect(() => grossFromNetHalfUp('1', '-0.23', 'fraction')).toThrow();
  });
});

describe('quotients', () => {
  it('divides half-up on the exact quotient', () => {
    expect(quotientHalfUp('10', '3')).toBe('3.33');
    expect(quotientHalfUp('20', '3')).toBe('6.67');
    expect(quotientHalfUp('0.05', '2')).toBe('0.03');
    expect(quotientHalfUp('-0.05', '2')).toBe('-0.03');
    expect(quotientHalfUp('36.29', '1', 4)).toBe('36.2900');
    expect(quotientHalfUp('1', '-4')).toBe('-0.25');
    expect(() => quotientHalfUp('1', '0')).toThrow();
  });

  it('backs a net out of a gross', () => {
    expect(netFromGrossHalfUp('36.29', '0.23', 'fraction')).toBe('29.50');
    expect(netFromGrossHalfUp('123.00', '0.23', 'fraction')).toBe('100.00');
    expect(netFromGrossHalfUp('4.52', '5', 'percent')).toBe('4.30');
    expect(netFromGrossHalfUp('10.00', '0', 'fraction')).toBe('10.00');
  });
});

describe('percentOfHalfUp', () => {
  it('takes a percentage of an amount half-up on the exact product', () => {
    expect(percentOfHalfUp('0.45', '10')).toBe('0.05');
    expect(percentOfHalfUp('1.45', '10')).toBe('0.15');
    // 1.45 × 10 / 100 on doubles is below 0.145, so the promotions' round2 gave 0.14.
    expect(Math.round(((1.45 * 10) / 100) * 100) / 100).toBe(0.14);
    expect(percentOfHalfUp('100', '12.5')).toBe('12.50');
  });
});

describe('wholeMultiples', () => {
  it('counts the whole steps in an amount exactly, not the binary 2', () => {
    expect(Math.floor(0.3 / 0.1)).toBe(2);
    expect(wholeMultiples('0.30', '0.10')).toBe(3);
    expect(wholeMultiples(0.3, 0.1)).toBe(3);
    expect(wholeMultiples('99.99', '100')).toBe(0);
    expect(wholeMultiples('250', '100')).toBe(2);
  });

  it('refuses a step that is not positive and an amount that is negative', () => {
    expect(() => wholeMultiples('1', '0')).toThrow();
    expect(() => wholeMultiples('-1', '1')).toThrow();
  });
});

/**
 * Owner rulings of 2026-10-24 (issue #417) — one VAT method everywhere: per
 * rate, VAT on the sum of the nets at that rate, rounded half-up once; gross
 * = net + VAT (art. 106e ust. 1 pkt 13–14). A line's gross is informational and
 * is the line's own rounding, `round(net × (1 + rate))` — what the shop shows —
 * so the line grosses may differ from the total by a cent.
 */
describe('vatByRate', () => {
  it('takes VAT per rate on the sum of the nets (V2: 7.01, gross 40.81)', () => {
    const r = vatByRate(
      [
        { net: '29.50', rate: '0.23' },
        { net: '4.30', rate: '0.05' },
      ],
      'fraction',
    );
    expect(r.rows).toEqual([
      { rate: '0.05', net: '4.30', vat: '0.22', gross: '4.52' },
      { rate: '0.23', net: '29.50', vat: '6.79', gross: '36.29' },
    ]);
    expect([r.net, r.vat, r.gross]).toEqual(['33.80', '7.01', '40.81']);
  });

  it('rounds once per rate, not per line', () => {
    // Three lines of 0.02 at 23 %: per line 0.0046 → 0.00 each; per rate 0.0138 → 0.01.
    const r = vatByRate(
      [
        { net: '0.02', rate: 0.23 },
        { net: '0.02', rate: 0.23 },
        { net: '0.02', rate: 0.23 },
      ],
      'fraction',
    );
    expect(r.rows).toEqual([{ rate: '0.23', net: '0.06', vat: '0.01', gross: '0.07' }]);
    // Each line its own rounding: 0.0246 → 0.02; the lines sum to 0.06, the total is 0.07.
    expect(r.lines.map((l) => l.gross)).toEqual(['0.02', '0.02', '0.02']);
  });

  it('shows each line’s own rounding, which may not add up to the total', () => {
    // 9.05 × 3 at 8 % as three one-piece lines: 0.724 each, 2.172 → 2.17 for the rate.
    const r = vatByRate(
      [
        { net: '9.05', rate: '0.08' },
        { net: '9.05', rate: '0.08' },
        { net: '9.05', rate: '0.08' },
      ],
      'fraction',
    );
    expect(r.vat).toBe('2.17');
    expect(r.lines.map((l) => l.gross)).toEqual(['9.77', '9.77', '9.77']);
  });

  it('keys a rate by its value, whatever its notation, and carries 0 % lines', () => {
    const r = vatByRate(
      [
        { net: '10.00', rate: '0.2300' },
        { net: '5.00', rate: 0.23 },
        { net: '-2.00', rate: 0 },
      ],
      'fraction',
    );
    expect(r.rows.map((row) => row.rate)).toEqual(['0', '0.23']);
    expect(r.rows[1]).toEqual({ rate: '0.23', net: '15.00', vat: '3.45', gross: '18.45' });
    expect(r.gross).toBe('16.45');
    expect(vatByRate([{ net: '100', rate: '23' }], 'percent').vat).toBe('23.00');
    expect(vatByRate([], 'fraction')).toEqual({ rows: [], lines: [], net: '0.00', vat: '0.00', gross: '0.00' });
    // 29.50 and 16.50 at 23 %: the rate's VAT is 10.58, and each line shows its own 36.29 and 20.30.
    const shared = vatByRate([{ net: '29.50', rate: '0.23' }, { net: '16.50', rate: '0.23' }], 'fraction');
    expect([shared.vat, shared.gross]).toEqual(['10.58', '56.58']);
    expect(shared.lines.map((l) => l.gross)).toEqual(['36.29', '20.30']);
  });
});

describe('allocateHalfUp', () => {
  it('rounds each part and hands the difference to the parts rounded furthest from their exact value', () => {
    expect(allocateHalfUp('0.01', ['0.0046', '0.0046', '0.0046'])).toEqual(['0.01', '0.00', '0.00']);
    expect(allocateHalfUp('1.00', ['0.335', '0.335', '0.33'])).toEqual(['0.33', '0.34', '0.33']);
    expect(allocateHalfUp('0.02', ['0.005', '0.005', '0.005', '0.005'])).toEqual(['0.00', '0.00', '0.01', '0.01']);
    expect(allocateHalfUp('-0.01', ['-0.0046', '-0.0046', '-0.0046'])).toEqual(['-0.01', '0.00', '0.00']);
  });
});

describe('netForGrossAtRate', () => {
  it('recovers the net a gross was computed from under the per-rate rule', () => {
    expect(netForGrossAtRate('36.29', '0.23', 'fraction')).toEqual({ net: '29.50', vat: '6.79', exact: true });
    expect(netForGrossAtRate('29.32', '0.08', 'fraction')).toEqual({ net: '27.15', vat: '2.17', exact: true });
  });

  it('answers the nearest net, and VAT as the remainder, for a gross the rule cannot produce', () => {
    // No net gives 0.03 at 23 %: 0.02 → 0.02 and 0.03 → 0.04.
    expect(netForGrossAtRate('0.03', '0.23', 'fraction')).toEqual({ net: '0.02', vat: '0.01', exact: false });
    expect(netForGrossAtRate('1.00', '0.23', 'fraction')).toEqual({ net: '0.81', vat: '0.19', exact: true });
  });
});
