import { describe, expect, it } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';
import { errorFiguresQuery } from '../../lib/url-error-figures';
import {
  readAmount,
  readCount,
  readCurrency,
  readMoney,
  writeAmount,
  writeCount,
  writeCurrency,
} from '../../lib/url-typed-values';

/**
 * Issue #791 — the one reader of the typed values a URL-borne error may carry
 * (`specs/conventions/module-i18n.md`): a whole number, a decimal amount or an
 * ISO 4217 currency code, each validated when it is read and dropped when it
 * fails, so a page never renders `NaN` or hands `Intl` a code it throws on.
 */

describe('readCount — a positive whole number, the `min=` rule from #783', () => {
  it.each([
    ['1', 1],
    ['10', 10],
    ['999999999', 999999999],
  ])('%s reads as %d', (raw, value) => {
    expect(readCount(raw)).toBe(value);
  });

  it.each(['', '0', '-3', '1.5', '1e3', '0012', '1234567890', ' 10', '10 pcs, call 555', 'NaN'])('%s is dropped', (raw) => {
    expect(readCount(raw)).toBeNull();
  });

  it('reads nothing from an absent value', () => {
    expect(readCount(undefined)).toBeNull();
    expect(readCount(null)).toBeNull();
  });
});

describe('readAmount — a non-negative decimal with at most two places', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    ['12.5', 12.5],
    ['1250.50', 1250.5],
    ['0.01', 0.01],
  ])('%s reads as %d', (raw, value) => {
    expect(readAmount(raw)).toBe(value);
  });

  it.each(['', 'abc', 'NaN', 'Infinity', '-5', '1e3', '0x10', '12.345', '012', '1,50', '12.', '.5', ' 12', '12 zł'])(
    '%s is dropped',
    (raw) => {
      expect(readAmount(raw)).toBeNull();
    },
  );
});

describe('readCurrency — an ISO 4217 code, `^[A-Z]{3}$`', () => {
  it.each(['PLN', 'EUR', 'USD'])('%s reads as itself', (raw) => {
    expect(readCurrency(raw)).toBe(raw);
  });

  it.each(['', 'pln', 'PL', 'PLNX', 'P1N', 'PLN<script>', 'zł'])('%s is dropped', (raw) => {
    expect(readCurrency(raw)).toBeNull();
  });
});

describe('readMoney — an amount and its currency, both or neither', () => {
  it('reads a valid pair', () => {
    expect(readMoney('12.50', 'PLN')).toEqual({ amount: 12.5, currency: 'PLN' });
  });

  it('drops the pair when either half fails', () => {
    expect(readMoney('abc', 'PLN')).toBeNull();
    expect(readMoney('12.50', 'pln')).toBeNull();
    expect(readMoney('12.50', undefined)).toBeNull();
    expect(readMoney(undefined, 'PLN')).toBeNull();
  });
});

describe('the writers put into a URL only what the readers accept', () => {
  it('a count', () => {
    expect(writeCount(10)).toBe('10');
    expect(writeCount(0)).toBeNull();
    expect(writeCount(1.5)).toBeNull();
    expect(writeCount('10')).toBeNull();
  });

  it('an amount, from a number or a two-decimal string', () => {
    expect(writeAmount(12.5)).toBe('12.5');
    expect(writeAmount('1250.50')).toBe('1250.50');
    expect(writeAmount(0.30000000000000004)).toBeNull();
    expect(writeAmount(Number.NaN)).toBeNull();
    expect(writeAmount(-1)).toBeNull();
    expect(writeAmount('1250.50 zł')).toBeNull();
  });

  it('a currency', () => {
    expect(writeCurrency('PLN')).toBe('PLN');
    expect(writeCurrency('pln')).toBeNull();
    expect(writeCurrency(42)).toBeNull();
  });
});

describe('errorFiguresQuery — the figures a refusal carries beside its code', () => {
  it('a negative available amount is clamped at 0 (architect ruling on #831, Q2)', () => {
    for (const availableAmount of ['-50.00', -50]) {
      const err = new StorefrontApiError(409, 'LIMIT_INSUFFICIENT', 'x', undefined, {
        availableAmount,
        orderTotal: '1250.50',
        currency: 'PLN',
      });
      expect(errorFiguresQuery(err)).toBe('&available=0&total=1250.50&currency=PLN');
    }
  });

  it('the reader stays strict: a negative amount in the URL is dropped', () => {
    expect(readAmount('-50.00')).toBeNull();
  });

  it('a credit-limit refusal carries both amounts and the currency', () => {
    const err = new StorefrontApiError(409, 'LIMIT_INSUFFICIENT', 'Dostępny limit kredytowy…', undefined, {
      availableAmount: '1000.00',
      orderTotal: '1250.50',
      currency: 'PLN',
    });
    expect(errorFiguresQuery(err)).toBe('&available=1000.00&total=1250.50&currency=PLN');
  });

  it('a credit-limit refusal with any figure out of shape carries none', () => {
    const err = new StorefrontApiError(409, 'LIMIT_INSUFFICIENT', 'x', undefined, {
      availableAmount: '50 zł',
      orderTotal: '1250.50',
      currency: 'PLN',
    });
    expect(errorFiguresQuery(err)).toBe('');
  });

  it('a minimum refusal carries the minimum, never the product name', () => {
    const err = new StorefrontApiError(422, 'PRODUCT_BELOW_MINIMUM_QUANTITY', '"Bolt" has a minimum…', undefined, {
      productName: 'Bolt',
      minimum: 10,
    });
    expect(errorFiguresQuery(err)).toBe('&min=10');
    const units = new StorefrontApiError(422, 'PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY', 'x', undefined, {
      packagingUnitName: 'Pallet',
      minimum: 2,
    });
    expect(errorFiguresQuery(units)).toBe('&min=2');
  });

  // Issue #832 — the order-minimum-value refusal's display figures, two places, formatted only.
  it('an order-minimum-value refusal carries the minimum, the subtotal and the currency', () => {
    const err = new StorefrontApiError(422, 'ORDER_BELOW_MINIMUM_VALUE', 'Order total 80.00 is below…', undefined, {
      minimum: '100.00',
      subtotal: '80.00',
      currency: 'PLN',
    });
    expect(errorFiguresQuery(err)).toBe('&minValue=100.00&subtotal=80.00&currency=PLN');
  });

  it('an order-minimum-value refusal with any figure out of shape carries none', () => {
    for (const details of [
      { minimum: '100.005', subtotal: '80.00', currency: 'PLN' },
      { minimum: '100.00', subtotal: '-1.00', currency: 'PLN' },
      { minimum: '100.00', subtotal: '80.00', currency: 'zł' },
      { minimum: '100.00', currency: 'PLN' },
    ]) {
      expect(errorFiguresQuery(new StorefrontApiError(422, 'ORDER_BELOW_MINIMUM_VALUE', 'x', undefined, details))).toBe('');
    }
  });

  it('any other refusal, or no API answer, carries nothing', () => {
    expect(errorFiguresQuery(new StorefrontApiError(409, 'CART_EMPTY', 'x', undefined, { minimum: 10 }))).toBe('');
    expect(errorFiguresQuery(new Error('fetch failed'))).toBe('');
    expect(errorFiguresQuery(null)).toBe('');
  });
});
