import { describe, expect, it } from 'vitest';
import { priceBookRowPriceSchema, type PriceBookRowPrice } from '@endora-commerce/contracts';
import { formatPriceCell, parsePriceCell, type PriceCellParse } from './price-cell.js';

/**
 * The price cell's parser and formatter (feature 161, T040; FR-007, FR-017;
 * `data-model.md` §4).
 *
 * The parser is liberal in what it reads (Postel): a decimal comma or point,
 * grouping spaces of every width, a currency symbol or code, a Unicode minus,
 * `%` with or without a space. It is conservative in what it answers: every
 * price it returns parses through the contracts' own `priceBookRowPriceSchema`,
 * at the precision the server stores (four places for amounts, two for
 * percentages), so an edit compares equal to the stored row it does not change.
 */

const PRODUCT = { productId: '00000000-0000-4000-8000-000000161b01' } as const;
const ALL = {} as const;

function price(input: string, selection: Record<string, unknown> = PRODUCT): PriceBookRowPrice {
  const result = parsePriceCell(input, { selection });
  if (result.kind !== 'price') throw new Error(`"${input}" did not parse: ${JSON.stringify(result)}`);
  // What the parser hands the save is a row price the API accepts.
  expect(priceBookRowPriceSchema.parse(result.price)).toEqual(result.price);
  return result.price;
}

function refusal(input: string, selection: Record<string, unknown> = PRODUCT): PriceCellParse {
  const result = parsePriceCell(input, { selection });
  expect(result.kind, `"${input}" should be refused`).toBe('invalid');
  return result;
}

describe('parsePriceCell — a fixed amount', () => {
  it.each([
    ['95', '95.0000'],
    ['95,50', '95.5000'],
    ['95.50', '95.5000'],
    ['1 234.5 zł', '1234.5000'],
    ['1 234,5', '1234.5000'],
    // A no-break space and a narrow no-break space, as a Polish locale groups.
    ['1 234,50', '1234.5000'],
    ['1 234,50', '1234.5000'],
    ['PLN 12,3', '12.3000'],
    ['12,30 PLN', '12.3000'],
    ['12.30pln', '12.3000'],
    ['0', '0.0000'],
    ['0,0001', '0.0001'],
    // Both separators: the last one is the decimal separator.
    ['1.234,56', '1234.5600'],
    ['1,234.56', '1234.5600'],
    ['  7  ', '7.0000'],
  ])('reads %j as fixed %s', (input, amount) => {
    expect(price(input)).toEqual({ type: 'fixed', amount });
  });

  it('refuses more than four decimals', () => {
    expect(refusal('1,23456')).toEqual({ kind: 'invalid', reason: 'tooManyDecimals', max: 4 });
  });

  it('refuses what is not a number', () => {
    for (const input of ['abc', '1,2,3', '12..5', '1 2 3,4,5', '--5', '5-', '%', 'zł']) {
      expect(refusal(input).kind, input).toBe('invalid');
    }
    expect(refusal('abc')).toEqual({ kind: 'invalid', reason: 'notANumber' });
  });

  it('refuses an amount larger than the column holds', () => {
    expect(refusal('12345678901')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
  });

  it('refuses a fixed price on the all-products line (FR-017)', () => {
    expect(refusal('95', ALL)).toEqual({ kind: 'invalid', reason: 'fixedOnAll' });
  });
});

describe('parsePriceCell — a signed percentage', () => {
  it.each([
    ['-5%', '-5.00'],
    ['+20%', '20.00'],
    ['+20 %', '20.00'],
    ['−5%', '-5.00'],
    ['− 5 %', '-5.00'],
    ['-2,5%', '-2.50'],
    ['-2.55 %', '-2.55'],
    ['-100%', '-100.00'],
    ['+1000%', '1000.00'],
    ['0%', '0.00'],
  ])('reads %j as percent %s', (input, percent) => {
    expect(price(input)).toEqual({ type: 'percent', percent });
  });

  it('is accepted on the all-products line', () => {
    expect(price('-5%', ALL)).toEqual({ type: 'percent', percent: '-5.00' });
  });

  it('refuses a percentage outside −100…1000', () => {
    expect(refusal('-101%')).toEqual({ kind: 'invalid', reason: 'percentOutOfRange', min: -100, max: 1000 });
    expect(refusal('+1000,01%')).toEqual({ kind: 'invalid', reason: 'percentOutOfRange', min: -100, max: 1000 });
  });

  it('refuses more than two decimals', () => {
    expect(refusal('-5,125%')).toEqual({ kind: 'invalid', reason: 'tooManyDecimals', max: 2 });
  });

  it('asks for the sign of a non-zero percentage rather than guessing it', () => {
    // `20%` could mean a surcharge or a discount; the cell does not guess.
    expect(refusal('20%')).toEqual({ kind: 'invalid', reason: 'percentNeedsSign' });
  });
});

describe('parsePriceCell — a signed amount adjustment', () => {
  it.each([
    ['-3', '-3.0000'],
    ['+3', '3.0000'],
    ['+3,50', '3.5000'],
    ['−3,5 zł', '-3.5000'],
    ['- 3', '-3.0000'],
  ])('reads %j as amount %s', (input, amount) => {
    expect(price(input)).toEqual({ type: 'amount', amount });
  });

  it('is accepted on the all-products line', () => {
    expect(price('-3', ALL)).toEqual({ type: 'amount', amount: '-3.0000' });
  });

  it('refuses more than four decimals', () => {
    expect(refusal('+0,12345')).toEqual({ kind: 'invalid', reason: 'tooManyDecimals', max: 4 });
  });
});

describe('parsePriceCell — an empty cell', () => {
  it('reads an empty or blank cell as a clear', () => {
    expect(parsePriceCell('', { selection: PRODUCT })).toEqual({ kind: 'empty' });
    expect(parsePriceCell('   ', { selection: PRODUCT })).toEqual({ kind: 'empty' });
  });
});

describe('formatPriceCell', () => {
  it('writes the text a cell is edited and copied as, in the admin language', () => {
    expect(formatPriceCell({ type: 'fixed', amount: '1234.5000' }, 'en')).toBe('1234.50');
    expect(formatPriceCell({ type: 'fixed', amount: '1234.5000' }, 'pl')).toBe('1234,50');
    expect(formatPriceCell({ type: 'fixed', amount: '0.1250' }, 'en')).toBe('0.125');
    expect(formatPriceCell({ type: 'percent', percent: '-5.00' }, 'en')).toBe('-5%');
    expect(formatPriceCell({ type: 'percent', percent: '20.00' }, 'en')).toBe('+20%');
    expect(formatPriceCell({ type: 'percent', percent: '-2.50' }, 'pl')).toBe('-2,5%');
    expect(formatPriceCell({ type: 'percent', percent: '0.00' }, 'en')).toBe('0%');
    expect(formatPriceCell({ type: 'amount', amount: '-3.0000' }, 'en')).toBe('-3.00');
    expect(formatPriceCell({ type: 'amount', amount: '3.5000' }, 'pl')).toBe('+3,50');
    expect(formatPriceCell({ type: 'amount', amount: '0.0000' }, 'en')).toBe('+0.00');
  });

  it('round-trips through the parser in both languages', () => {
    const prices: PriceBookRowPrice[] = [
      { type: 'fixed', amount: '95.5000' },
      { type: 'fixed', amount: '0.0001' },
      { type: 'percent', percent: '-12.34' },
      { type: 'percent', percent: '1000.00' },
      { type: 'amount', amount: '-3.2500' },
      { type: 'amount', amount: '0.0000' },
    ];
    for (const language of ['en', 'pl'] as const) {
      for (const p of prices) {
        const text = formatPriceCell(p, language);
        const back = parsePriceCell(text, { selection: PRODUCT });
        // A zero adjustment keeps its sign (`+0.00`): unsigned, it would read
        // back as a fixed price of zero.
        expect(back, `${language}: ${text}`).toEqual({ kind: 'price', price: p });
      }
    }
  });
});
