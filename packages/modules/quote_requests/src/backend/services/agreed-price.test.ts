import { describe, expect, it } from 'vitest';
import { hasUnpricedLine, quoteIncompleteError } from './agreed-price.js';

describe('hasUnpricedLine', () => {
  it('is true when a line has no agreed unit price', () => {
    expect(hasUnpricedLine([{ agreedUnitPrice: null }])).toBe(true);
    expect(hasUnpricedLine([{}])).toBe(true);
  });

  it('is true when any one line of several has no agreed unit price', () => {
    expect(hasUnpricedLine([{ agreedUnitPrice: '7.50' }, { agreedUnitPrice: null }])).toBe(true);
  });

  it('is false when every line carries an agreed unit price', () => {
    expect(hasUnpricedLine([{ agreedUnitPrice: '7.50' }, { agreedUnitPrice: '1.00' }])).toBe(false);
  });

  it('treats an agreed price of exactly zero as a price', () => {
    expect(hasUnpricedLine([{ agreedUnitPrice: '0.00' }])).toBe(false);
    expect(hasUnpricedLine([{ agreedUnitPrice: '0' }])).toBe(false);
  });
});

describe('quoteIncompleteError', () => {
  it('answers 409 QUOTE_INCOMPLETE', () => {
    const err = quoteIncompleteError();
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('QUOTE_INCOMPLETE');
  });
});
