import {
  PRICE_BOOK_PERCENT_MAX,
  PRICE_BOOK_PERCENT_MIN,
  formatUnits,
  parseSignedUnits,
  priceBookRowShapeIssues,
  type PriceBookRowPrice,
  type PriceBookSelection,
} from '@endora-commerce/contracts';

/**
 * The price cell: what an administrator types into a grid cell, read as a row
 * price, and the text a stored price is edited and copied as (feature 161,
 * FR-007, FR-017; `data-model.md` §4).
 *
 * | Typed | Price |
 * | --- | --- |
 * | `95`, `95,50`, `1 234.5 zł` | fixed amount |
 * | `-5%`, `+20 %`, `−5%` (Unicode minus) | signed percentage |
 * | `-3`, `+3`, `+3,50` (a leading sign) | signed amount adjustment |
 * | empty | clear |
 *
 * Liberal in what it reads (Postel): a decimal comma or point (with both, the
 * last is the decimal separator), grouping spaces of any width, a currency
 * symbol or a three-letter code before or after the number, `%` with or
 * without a space, the Unicode minus and its dash look-alikes. Conservative in
 * what it answers: a price at the precision the server stores — four places
 * for an amount, two for a percentage — so a cell left as it was compares
 * equal to its stored row.
 *
 * A non-zero percentage needs its sign: `20%` could be a surcharge or a
 * discount, and the cell does not guess (`contracts/csv-format.md` holds the
 * file to the same rule). Pure: no React, no translation — the reasons are
 * codes, translated by the screen.
 */

export type PriceCellRefusal =
  | { readonly kind: 'invalid'; readonly reason: 'notANumber' }
  | { readonly kind: 'invalid'; readonly reason: 'tooManyDecimals'; readonly max: number }
  | { readonly kind: 'invalid'; readonly reason: 'tooLarge' }
  | { readonly kind: 'invalid'; readonly reason: 'percentOutOfRange'; readonly min: number; readonly max: number }
  | { readonly kind: 'invalid'; readonly reason: 'percentNeedsSign' }
  | { readonly kind: 'invalid'; readonly reason: 'fixedOnAll' };

export type PriceCellParse =
  | { readonly kind: 'empty' }
  | { readonly kind: 'price'; readonly price: PriceBookRowPrice }
  | PriceCellRefusal;

export type PriceCellRefusalReason = PriceCellRefusal['reason'];

export interface PriceCellContext {
  /** The line's selection: a fixed price on the all-products line is refused (FR-017). */
  readonly selection: PriceBookSelection;
}

/** The admin languages a cell is formatted for; any other reads as English. */
export type PriceCellLanguage = 'en' | 'pl';

/** Integer digits an amount may carry (`PRICE_BOOK_AMOUNT`: up to ten). */
const MAX_INTEGER_DIGITS = 10;
const AMOUNT_DECIMALS = 4;
const PERCENT_DECIMALS = 2;

/** U+2212 minus, U+2012 figure dash, U+2013 en dash: what a spreadsheet or a word processor writes for `-`. */
const MINUS_LOOKALIKES = /[−‒–]/g;
/** Every space a locale groups digits with, and the ordinary ones. */
const SPACES = /[\s    ]+/g;
/** A currency marker: a symbol or a three-letter code, before or after the number. */
const CURRENCY_MARKER = /(z[łl](?![a-z])|€|\$|£|(?<![a-z])[a-z]{3}(?![a-z]))/gi;

const invalid = <R extends PriceCellRefusal>(refusal: R): R => refusal;

export function parsePriceCell(input: string, context: PriceCellContext): PriceCellParse {
  let text = input.replace(MINUS_LOOKALIKES, '-').trim();
  if (text === '') return { kind: 'empty' };

  text = text.replace(CURRENCY_MARKER, ' ');
  const isPercent = text.includes('%');
  if (isPercent) {
    // One `%`, at the end.
    if (!/^[^%]*%\s*$/.test(text)) return invalid({ kind: 'invalid', reason: 'notANumber' });
    text = text.replace('%', '');
  }
  text = text.replace(SPACES, '');

  let sign: '' | '+' | '-' = '';
  if (text.startsWith('+') || text.startsWith('-')) {
    sign = text[0] as '+' | '-';
    text = text.slice(1);
  }
  const number = readUnsignedDecimal(text);
  if (number === null) return invalid({ kind: 'invalid', reason: 'notANumber' });
  const { whole, fraction } = number;

  if (isPercent) {
    if (fraction.length > PERCENT_DECIMALS) {
      return invalid({ kind: 'invalid', reason: 'tooManyDecimals', max: PERCENT_DECIMALS });
    }
    const zero = /^0*$/.test(whole) && /^0*$/.test(fraction);
    if (!zero && sign === '') return invalid({ kind: 'invalid', reason: 'percentNeedsSign' });
    const value = Number(`${sign === '-' ? '-' : ''}${whole}.${fraction || '0'}`);
    if (whole.replace(/^0+/, '').length > 4 || value < PRICE_BOOK_PERCENT_MIN || value > PRICE_BOOK_PERCENT_MAX) {
      return invalid({ kind: 'invalid', reason: 'percentOutOfRange', min: PRICE_BOOK_PERCENT_MIN, max: PRICE_BOOK_PERCENT_MAX });
    }
    const digits = `${trimLeadingZeros(whole)}.${fraction.padEnd(PERCENT_DECIMALS, '0')}`;
    return { kind: 'price', price: { type: 'percent', percent: zero ? '0.00' : `${sign === '-' ? '-' : ''}${digits}` } };
  }

  if (fraction.length > AMOUNT_DECIMALS) {
    return invalid({ kind: 'invalid', reason: 'tooManyDecimals', max: AMOUNT_DECIMALS });
  }
  if (trimLeadingZeros(whole).length > MAX_INTEGER_DIGITS) return invalid({ kind: 'invalid', reason: 'tooLarge' });
  const units = formatUnits(parseSignedUnits(`${trimLeadingZeros(whole)}${fraction ? `.${fraction}` : ''}`));

  if (sign !== '') {
    return { kind: 'price', price: { type: 'amount', amount: sign === '-' && !/^0\.0+$/.test(units) ? `-${units}` : units } };
  }
  const fixed: PriceBookRowPrice = { type: 'fixed', amount: units };
  const shape = priceBookRowShapeIssues({ selection: context.selection, minQuantity: 1, maxQuantity: null, price: fixed });
  if (shape.some((issue) => issue.path[0] === 'price')) return invalid({ kind: 'invalid', reason: 'fixedOnAll' });
  return { kind: 'price', price: fixed };
}

/**
 * The text a stored price is edited and copied as: a decimal comma in Polish,
 * a point otherwise; amounts with at least two places and no trailing zeros
 * past them; a percentage and an adjustment always signed (a zero adjustment
 * too, so it reads back as an adjustment and not as a fixed zero).
 */
export function formatPriceCell(price: PriceBookRowPrice, language: PriceCellLanguage): string {
  const separator = language === 'pl' ? ',' : '.';
  switch (price.type) {
    case 'fixed':
      return decimal(price.amount, 2, separator);
    case 'amount': {
      const negative = price.amount.startsWith('-');
      const body = decimal(negative ? price.amount.slice(1) : price.amount, 2, separator);
      return `${negative ? '-' : '+'}${body}`;
    }
    case 'percent': {
      const negative = price.percent.startsWith('-');
      const body = decimal(negative ? price.percent.slice(1) : price.percent, 0, separator);
      if (/^0([.,]0*)?$/.test(body)) return '0%';
      return `${negative ? '-' : '+'}${body}%`;
    }
  }
}

/**
 * A number as a spreadsheet writes it, liberal as the cell is (feature 161,
 * T092 — the CSV codec reads its `value` column with it): the Unicode minus
 * and its look-alikes, a currency marker, grouping spaces, a decimal comma or
 * point (with both, the last one). `null` when it is not a number.
 */
export function readDecimalText(input: string): { readonly sign: '' | '+' | '-'; readonly whole: string; readonly fraction: string } | null {
  let text = input.replace(MINUS_LOOKALIKES, '-').replace(CURRENCY_MARKER, ' ').replace(SPACES, '');
  let sign: '' | '+' | '-' = '';
  if (text.startsWith('+') || text.startsWith('-')) {
    sign = text[0] as '+' | '-';
    text = text.slice(1);
  }
  const number = readUnsignedDecimal(text);
  return number === null ? null : { sign, whole: trimLeadingZeros(number.whole), fraction: number.fraction };
}

/** `whole` and `fraction` digits of an unsigned number with one decimal separator, or `null`. */
function readUnsignedDecimal(text: string): { whole: string; fraction: string } | null {
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(',');
  const lastPoint = text.lastIndexOf('.');
  if (lastComma === -1 && lastPoint === -1) return { whole: text, fraction: '' };

  let decimalAt: number;
  let grouping: string | null;
  if (lastComma !== -1 && lastPoint !== -1) {
    // Both: the last one is the decimal separator, the other groups thousands.
    decimalAt = Math.max(lastComma, lastPoint);
    grouping = decimalAt === lastComma ? '.' : ',';
  } else {
    const separator = lastComma !== -1 ? ',' : '.';
    const count = text.split(separator).length - 1;
    if (count === 1) {
      decimalAt = text.indexOf(separator);
      grouping = null;
    } else {
      // Repeated: a grouping separator, and no decimal part.
      return groupsOfThree(text.split(separator)) ? { whole: text.split(separator).join(''), fraction: '' } : null;
    }
  }
  const head = text.slice(0, decimalAt);
  const fraction = text.slice(decimalAt + 1);
  if (fraction === '' || !/^\d+$/.test(fraction)) return null;
  if (grouping !== null && head.includes(grouping)) {
    const groups = head.split(grouping);
    if (!groupsOfThree(groups)) return null;
    return { whole: groups.join(''), fraction };
  }
  if (!/^\d+$/.test(head)) return null;
  return { whole: head, fraction };
}

/** `['1', '234', '567']`: a first group of one to three digits and the rest of exactly three. */
function groupsOfThree(groups: readonly string[]): boolean {
  return (
    groups.length > 1 &&
    /^\d{1,3}$/.test(groups[0]!) &&
    groups.slice(1).every((group) => /^\d{3}$/.test(group))
  );
}

function trimLeadingZeros(digits: string): string {
  const trimmed = digits.replace(/^0+/, '');
  return trimmed === '' ? '0' : trimmed;
}

/** A decimal string with at least `minDecimals` places and no trailing zeros past them. */
function decimal(value: string, minDecimals: number, separator: string): string {
  const [whole, fraction = ''] = value.split('.');
  let digits = fraction.replace(/0+$/, '');
  if (digits.length < minDecimals) digits = digits.padEnd(minDecimals, '0');
  return digits === '' ? whole! : `${whole}${separator}${digits}`;
}
