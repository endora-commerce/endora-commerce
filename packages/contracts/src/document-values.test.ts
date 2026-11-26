import { describe, expect, it } from 'vitest';
import {
  documentCellLink,
  documentValueHasValue,
  evaluateDocumentCondition,
  formatDocumentValue,
  resolveDocumentAlign,
  sumDocumentValues,
  type DocumentItem,
  type DocumentValue,
} from './document-values.js';

/**
 * `specs/153-quote-request-pdf-template/contracts/document-collections.md` §3.4 —
 * the pure functions the PDF renderer and the editor canvas share, so the
 * canvas shows exactly what the PDF prints (FR-036, FR-044).
 */

const NBSP = ' ';
const money = (amount: number, currency = 'PLN'): DocumentValue => ({ kind: 'money', amount, currency });
const item = (values: Record<string, DocumentValue>): DocumentItem => ({ values });

describe('documentValueHasValue', () => {
  it('a number has a value, zero included', () => {
    expect(documentValueHasValue({ kind: 'number', value: 0 })).toBe(true);
    expect(documentValueHasValue(money(0))).toBe(true);
    expect(documentValueHasValue({ kind: 'percent', value: 0 })).toBe(true);
  });
  it('null, undefined and blank text have none', () => {
    expect(documentValueHasValue(null)).toBe(false);
    expect(documentValueHasValue(undefined)).toBe(false);
    expect(documentValueHasValue({ kind: 'text', value: '  ' })).toBe(false);
    expect(documentValueHasValue({ kind: 'text', value: 'x' })).toBe(true);
  });
  it('a non-finite number or a malformed value has none', () => {
    expect(documentValueHasValue({ kind: 'number', value: Number.NaN })).toBe(false);
    expect(documentValueHasValue({ kind: 'money', amount: Infinity, currency: 'PLN' })).toBe(false);
    expect(documentValueHasValue({ kind: 'date', value: '' })).toBe(false);
    expect(documentValueHasValue({ nonsense: true } as unknown as DocumentValue)).toBe(false);
  });
});

describe('formatDocumentValue', () => {
  it('text as is', () => {
    expect(formatDocumentValue({ kind: 'text', value: 'Śruba M8' }, {}, 'pl-PL')).toBe('Śruba M8');
  });

  it('numbers: integers with no decimals, others with two, or the chosen decimals, in the language', () => {
    expect(formatDocumentValue({ kind: 'number', value: 12 }, {}, 'en-US')).toBe('12');
    expect(formatDocumentValue({ kind: 'number', value: 1234.5 }, {}, 'en-US')).toBe('1,234.50');
    expect(formatDocumentValue({ kind: 'number', value: 1234.5 }, {}, 'pl-PL')).toBe(`1234,50`);
    expect(formatDocumentValue({ kind: 'number', value: 12345.5 }, {}, 'pl-PL')).toBe(`12${NBSP}345,50`);
    expect(formatDocumentValue({ kind: 'number', value: 2.5 }, { decimals: 0 }, 'en-US')).toBe('3');
    expect(formatDocumentValue({ kind: 'number', value: 2 }, { decimals: 3 }, 'en-US')).toBe('2.000');
  });

  it('money: symbol by default, code, or no currency', () => {
    expect(formatDocumentValue(money(1234.5, 'USD'), {}, 'en-US')).toBe('$1,234.50');
    expect(formatDocumentValue(money(1234.5), {}, 'pl-PL')).toBe(`1234,50${NBSP}zł`);
    expect(formatDocumentValue(money(1234.5), { currencyDisplay: 'code' }, 'en-US')).toBe(`PLN${NBSP}1,234.50`);
    expect(formatDocumentValue(money(1234.5), { currencyDisplay: 'none' }, 'en-US')).toBe('1,234.50');
    expect(formatDocumentValue(money(10), { decimals: 0 }, 'en-US')).toBe('PLN 10'.replace(' ', NBSP));
  });

  it('a unit price shows its significant places, up to four, and never fewer than the format says (§10.18)', () => {
    const unit = (amount: number) => ({ kind: 'money' as const, amount, currency: 'PLN', unitPrice: true });
    expect(formatDocumentValue(unit(0.0125), { decimals: 2 }, 'pl-PL')).toBe(`0,0125${NBSP}zł`);
    expect(formatDocumentValue(unit(1.505), {}, 'pl-PL')).toBe(`1,505${NBSP}zł`);
    expect(formatDocumentValue(unit(1.5), { decimals: 2 }, 'pl-PL')).toBe(`1,50${NBSP}zł`);
    expect(formatDocumentValue(unit(0.0125), { currencyDisplay: 'none' }, 'en-US')).toBe('0.0125');
    // An amount (a line value, a total) keeps its two places.
    expect(formatDocumentValue(money(0.0125), {}, 'pl-PL')).toBe(`0,01${NBSP}zł`);
  });

  it('issue #430: an amount that is not zero but rounds to no cent prints a dash, never 0,00', () => {
    const below: DocumentValue = { kind: 'money', amount: 0, currency: 'PLN', belowMinorUnit: true };
    expect(formatDocumentValue(below, { decimals: 2 }, 'pl-PL')).toBe('—');
    expect(formatDocumentValue(below, { currencyDisplay: 'none' }, 'en-US')).toBe('—');
    expect(documentValueHasValue(below)).toBe(true);
    // A real zero is still a zero.
    expect(formatDocumentValue(money(0), {}, 'pl-PL')).toBe(`0,00${NBSP}zł`);
  });

  it('money in a currency Intl cannot format prints the number and the code', () => {
    expect(formatDocumentValue(money(5, 'X1'), {}, 'en-US')).toBe('5.00 X1');
  });

  it('percent with a non-breaking space before the sign', () => {
    expect(formatDocumentValue({ kind: 'percent', value: 12.5 }, { decimals: 1 }, 'pl-PL')).toBe(`12,5${NBSP}%`);
    expect(formatDocumentValue({ kind: 'percent', value: 23 }, {}, 'en-US')).toBe(`23${NBSP}%`);
  });

  it('dates in the chosen style, a date-only value never shifted by a time zone', () => {
    expect(formatDocumentValue({ kind: 'date', value: '2026-10-17' }, { dateStyle: 'long' }, 'en-US')).toBe(
      'October 17, 2026',
    );
    expect(formatDocumentValue({ kind: 'date', value: '2026-10-17' }, {}, 'pl-PL')).toBe('17 paź 2026');
    expect(formatDocumentValue({ kind: 'date', value: '2026-10-17' }, { dateStyle: 'short' }, 'pl-PL')).toBe(
      '17.10.2026',
    );
  });

  it('no value prints nothing; a failure prints the raw value', () => {
    expect(formatDocumentValue(null, {}, 'en-US')).toBe('');
    expect(formatDocumentValue({ kind: 'date', value: 'not a date' }, {}, 'en-US')).toBe('not a date');
    expect(formatDocumentValue({ kind: 'number', value: 3 }, {}, 'not a language!')).toBe('3');
  });
});

describe('evaluateDocumentCondition', () => {
  const items = [item({ a: null, b: { kind: 'number', value: 0 } }), item({ a: null })];

  it('always and never', () => {
    expect(evaluateDocumentCondition({ op: 'always' }, {}, 'a')).toBe(true);
    expect(evaluateDocumentCondition({ op: 'never' }, { items }, 'b')).toBe(false);
  });

  it('any_has_value over the collection, on the default or the rule’s own field', () => {
    expect(evaluateDocumentCondition({ op: 'any_has_value' }, { items }, 'a')).toBe(false);
    expect(evaluateDocumentCondition({ op: 'any_has_value' }, { items }, 'b')).toBe(true);
    expect(evaluateDocumentCondition({ op: 'any_has_value', field: 'b' }, { items }, 'a')).toBe(true);
    expect(evaluateDocumentCondition({ op: 'any_has_value' }, {}, 'b')).toBe(false);
  });

  it('has_value over one item, or over the totals', () => {
    expect(evaluateDocumentCondition({ op: 'has_value' }, { item: items[0]! }, 'b')).toBe(true);
    expect(evaluateDocumentCondition({ op: 'has_value' }, { item: items[1]! }, 'b')).toBe(false);
    expect(evaluateDocumentCondition({ op: 'has_value' }, { summary: { netTotal: money(1) } }, 'netTotal')).toBe(true);
    expect(evaluateDocumentCondition({ op: 'has_value' }, { summary: { netTotal: null } }, 'netTotal')).toBe(false);
  });

  it('an unreadable rule reads as always', () => {
    expect(evaluateDocumentCondition(undefined, { items }, 'a')).toBe(true);
    expect(evaluateDocumentCondition({ op: 'whenever' }, { items }, 'a')).toBe(true);
    expect(evaluateDocumentCondition('never', { items }, 'a')).toBe(true);
  });
});

describe('sumDocumentValues', () => {
  it('sums numbers', () => {
    expect(sumDocumentValues([{ kind: 'number', value: 1 }, null, { kind: 'number', value: 2.5 }])).toEqual({
      kind: 'number',
      value: 3.5,
    });
  });
  it('sums money of one currency, rounded to the minor unit', () => {
    expect(sumDocumentValues([money(0.1), money(0.2), money(10.005)])).toEqual(money(10.31));
  });
  it('issue #430: a sum of discounts that round to no cent keeps the mark; a real cent drops it', () => {
    const below: DocumentValue = { kind: 'money', amount: 0, currency: 'PLN', belowMinorUnit: true };
    expect(sumDocumentValues([below, below])).toEqual(below);
    expect(sumDocumentValues([below, money(0.01)])).toEqual(money(0.01));
    expect(sumDocumentValues([money(0), money(0)])).toEqual(money(0));
  });
  it('mixed currencies, mixed kinds, or nothing with a value answer no value', () => {
    expect(sumDocumentValues([money(1), money(1, 'EUR')])).toBeNull();
    expect(sumDocumentValues([money(1), { kind: 'number', value: 1 }])).toBeNull();
    expect(sumDocumentValues([{ kind: 'text', value: 'x' }])).toBeNull();
    expect(sumDocumentValues([null, undefined])).toBeNull();
    expect(sumDocumentValues([])).toBeNull();
  });
});

describe('resolveDocumentAlign', () => {
  it('an explicit alignment wins', () => {
    expect(resolveDocumentAlign('center', 'right', 'money')).toBe('center');
  });
  it('auto: the field’s default, else right for numbers and left otherwise', () => {
    expect(resolveDocumentAlign('auto', 'center', 'money')).toBe('center');
    expect(resolveDocumentAlign('auto', undefined, 'money')).toBe('right');
    expect(resolveDocumentAlign('auto', undefined, 'percent')).toBe('right');
    expect(resolveDocumentAlign('auto', undefined, 'number')).toBe('right');
    expect(resolveDocumentAlign('auto', undefined, 'text')).toBe('left');
    expect(resolveDocumentAlign('auto', undefined, 'date')).toBe('left');
    expect(resolveDocumentAlign('bogus' as never, undefined, undefined)).toBe('left');
  });
});

describe('documentCellLink (issue #1904)', () => {
  const linked = { linkPath: 'productUrl' };
  const row = item({ productName: { kind: 'text', value: 'Bolt' }, productUrl: { kind: 'text', value: 'https://shop.example.com/p/bolt' } });

  it('a column printed as a link answers its field’s URL field', () => {
    expect(documentCellLink(true, linked, row)).toBe('https://shop.example.com/p/bolt');
    expect(documentCellLink('true', linked, row)).toBe('https://shop.example.com/p/bolt');
  });

  it('off by default: no option, a false option, or a field that declares no URL field', () => {
    expect(documentCellLink(undefined, linked, row)).toBeNull();
    expect(documentCellLink(false, linked, row)).toBeNull();
    expect(documentCellLink(true, {}, row)).toBeNull();
    expect(documentCellLink(true, undefined, row)).toBeNull();
  });

  it('no link where the line has no URL, or one that is not an absolute http(s) address', () => {
    expect(documentCellLink(true, linked, item({ productUrl: null }))).toBeNull();
    expect(documentCellLink(true, linked, item({ productUrl: { kind: 'text', value: '  ' } }))).toBeNull();
    expect(documentCellLink(true, linked, item({ productUrl: { kind: 'text', value: '/p/bolt' } }))).toBeNull();
    expect(documentCellLink(true, linked, item({ productUrl: { kind: 'text', value: 'javascript:alert(1)' } }))).toBeNull();
    expect(documentCellLink(true, linked, item({ productUrl: { kind: 'number', value: 3 } }))).toBeNull();
  });
});
