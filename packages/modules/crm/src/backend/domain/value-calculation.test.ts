import { describe, expect, it } from 'vitest';
import {
  calculateOpportunityValue,
  quoteRequestAmount,
  type OpportunityValueInput,
} from './value-calculation.js';

const ORDER_A = '00000000-0000-4000-8000-0000000000a1';
const ORDER_B = '00000000-0000-4000-8000-0000000000a2';
const QUOTE_A = '00000000-0000-4000-8000-0000000000b1';
const QUOTE_B = '00000000-0000-4000-8000-0000000000b2';

function input(overrides: Partial<OpportunityValueInput> = {}): OpportunityValueInput {
  return {
    currency: 'PLN',
    countingStatuses: { order: ['paid', 'completed'], quoteRequest: ['Approved'] },
    orders: [],
    quoteRequests: [],
    ...overrides,
  };
}

describe('calculateOpportunityValue', () => {
  it('answers 0.00 for an Opportunity with no linked document', () => {
    expect(calculateOpportunityValue(input())).toEqual({ value: '0.00', excludedDocuments: [] });
  });

  it('sums the Orders whose status is in the counting set, and only those', () => {
    const result = calculateOpportunityValue(
      input({
        orders: [
          { id: ORDER_A, status: 'paid', total: '123.00', currency: 'PLN' },
          { id: ORDER_B, status: 'new', total: '999.99', currency: 'PLN' },
        ],
      }),
    );
    expect(result).toEqual({ value: '123.00', excludedDocuments: [] });
  });

  it('sums the Quote Requests whose status is in the counting set: quantity × unit price per line', () => {
    const result = calculateOpportunityValue(
      input({
        quoteRequests: [
          {
            id: QUOTE_A,
            status: 'Approved',
            convertedOrderId: null,
            lines: [
              { quantity: 7, unitPrice: '11.25', currency: 'PLN' },
              { quantity: 3, unitPrice: '0.10', currency: 'PLN' },
            ],
          },
          {
            id: QUOTE_B,
            status: 'Pending',
            convertedOrderId: null,
            lines: [{ quantity: 100, unitPrice: '50.00', currency: 'PLN' }],
          },
        ],
      }),
    );
    expect(result).toEqual({ value: '79.05', excludedDocuments: [] });
  });

  it('adds Orders and Quote Requests together', () => {
    const result = calculateOpportunityValue(
      input({
        orders: [{ id: ORDER_A, status: 'completed', total: '100.00', currency: 'PLN' }],
        quoteRequests: [
          {
            id: QUOTE_A,
            status: 'Approved',
            convertedOrderId: null,
            lines: [{ quantity: 2, unitPrice: '10.50', currency: 'PLN' }],
          },
        ],
      }),
    );
    expect(result.value).toBe('121.00');
  });

  it('answers 0.00 when the counting sets are empty, whatever is linked', () => {
    const result = calculateOpportunityValue(
      input({
        countingStatuses: { order: [], quoteRequest: [] },
        orders: [{ id: ORDER_A, status: 'paid', total: '123.00', currency: 'PLN' }],
        quoteRequests: [
          {
            id: QUOTE_A,
            status: 'Approved',
            convertedOrderId: null,
            lines: [{ quantity: 1, unitPrice: '5.00', currency: 'PLN' }],
          },
        ],
      }),
    );
    expect(result).toEqual({ value: '0.00', excludedDocuments: [] });
  });

  it('counts a Quote Request once when the Order placed from it is linked and counted', () => {
    const result = calculateOpportunityValue(
      input({
        orders: [{ id: ORDER_A, status: 'paid', total: '96.86', currency: 'PLN' }],
        quoteRequests: [
          {
            id: QUOTE_A,
            status: 'Approved',
            convertedOrderId: ORDER_A,
            lines: [{ quantity: 7, unitPrice: '11.25', currency: 'PLN' }],
          },
        ],
      }),
    );
    expect(result).toEqual({ value: '96.86', excludedDocuments: [] });
  });

  it('counts once when only the Order says which Quote Request it was placed from', () => {
    const result = calculateOpportunityValue(
      input({
        countingStatuses: { order: ['paid'], quoteRequest: ['Pending'] },
        orders: [
          { id: ORDER_A, status: 'paid', total: '96.86', currency: 'PLN', sourceQuoteRequestId: QUOTE_A },
        ],
        quoteRequests: [
          {
            id: QUOTE_A,
            status: 'Pending',
            convertedOrderId: null,
            lines: [{ quantity: 7, unitPrice: '11.25', currency: 'PLN' }],
          },
        ],
      }),
    );
    expect(result).toEqual({ value: '96.86', excludedDocuments: [] });
  });

  it('still counts the Quote Request while the Order placed from it is not counted', () => {
    const quote = {
      id: QUOTE_A,
      status: 'Approved',
      convertedOrderId: ORDER_A,
      lines: [{ quantity: 7, unitPrice: '11.25', currency: 'PLN' }],
    };
    // The Order is linked but not in a counting status.
    expect(
      calculateOpportunityValue(
        input({
          orders: [{ id: ORDER_A, status: 'new', total: '96.86', currency: 'PLN' }],
          quoteRequests: [quote],
        }),
      ).value,
    ).toBe('78.75');
    // The Order is not linked to this Opportunity at all.
    expect(calculateOpportunityValue(input({ quoteRequests: [quote] })).value).toBe('78.75');
  });

  it('leaves out and names a document in another currency', () => {
    const result = calculateOpportunityValue(
      input({
        orders: [
          { id: ORDER_A, status: 'paid', total: '100.00', currency: 'EUR' },
          { id: ORDER_B, status: 'paid', total: '50.00', currency: 'PLN' },
        ],
        quoteRequests: [
          {
            id: QUOTE_A,
            status: 'Approved',
            convertedOrderId: null,
            lines: [{ quantity: 1, unitPrice: '10.00', currency: 'EUR' }],
          },
        ],
      }),
    );
    expect(result.value).toBe('50.00');
    expect(result.excludedDocuments).toEqual([
      { kind: 'order', id: ORDER_A, reason: 'currency_mismatch' },
      { kind: 'quote_request', id: QUOTE_A, reason: 'currency_mismatch' },
    ]);
  });

  it('does not name a document in another currency that would not have counted anyway', () => {
    const result = calculateOpportunityValue(
      input({ orders: [{ id: ORDER_A, status: 'new', total: '100.00', currency: 'EUR' }] }),
    );
    expect(result).toEqual({ value: '0.00', excludedDocuments: [] });
  });

  it('counts the lines of a Quote Request in the Opportunity currency and names the request when a line is left out', () => {
    const result = calculateOpportunityValue(
      input({
        quoteRequests: [
          {
            id: QUOTE_A,
            status: 'Approved',
            convertedOrderId: null,
            lines: [
              { quantity: 2, unitPrice: '10.00', currency: 'PLN' },
              { quantity: 1, unitPrice: '99.00', currency: 'EUR' },
            ],
          },
        ],
      }),
    );
    expect(result.value).toBe('20.00');
    expect(result.excludedDocuments).toEqual([
      { kind: 'quote_request', id: QUOTE_A, reason: 'currency_mismatch' },
    ]);
  });

  it('a Quote Request in another currency does not hide behind its converted Order', () => {
    // The Order is counted; the request is skipped as the same business and is
    // therefore not reported as left out for its currency.
    const result = calculateOpportunityValue(
      input({
        orders: [{ id: ORDER_A, status: 'paid', total: '10.00', currency: 'PLN' }],
        quoteRequests: [
          {
            id: QUOTE_A,
            status: 'Approved',
            convertedOrderId: ORDER_A,
            lines: [{ quantity: 1, unitPrice: '10.00', currency: 'EUR' }],
          },
        ],
      }),
    );
    expect(result).toEqual({ value: '10.00', excludedDocuments: [] });
  });

  it('adds decimal strings without float error', () => {
    const result = calculateOpportunityValue(
      input({
        orders: [
          { id: ORDER_A, status: 'paid', total: '0.10', currency: 'PLN' },
          { id: ORDER_B, status: 'paid', total: '0.20', currency: 'PLN' },
        ],
      }),
    );
    expect(result.value).toBe('0.30');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('keeps every digit of a large figure', () => {
    const result = calculateOpportunityValue(
      input({
        orders: [
          { id: ORDER_A, status: 'paid', total: '999999999999.99', currency: 'PLN' },
          { id: ORDER_B, status: 'paid', total: '0.01', currency: 'PLN' },
        ],
      }),
    );
    expect(result.value).toBe('1000000000000.00');
  });
});

describe('quoteRequestAmount', () => {
  it('multiplies and adds exactly', () => {
    expect(
      quoteRequestAmount([
        { quantity: 3, unitPrice: '0.10', currency: 'PLN' },
        { quantity: 1, unitPrice: '0.20', currency: 'PLN' },
      ]),
    ).toBe('0.50');
  });

  it('rounds a figure with more than two places half up, once, on the sum', () => {
    expect(quoteRequestAmount([{ quantity: 1, unitPrice: '0.005', currency: 'PLN' }])).toBe('0.01');
    expect(quoteRequestAmount([{ quantity: 3, unitPrice: '0.3333', currency: 'PLN' }])).toBe('1.00');
    expect(
      quoteRequestAmount([
        { quantity: 1, unitPrice: '0.004', currency: 'PLN' },
        { quantity: 1, unitPrice: '0.004', currency: 'PLN' },
      ]),
    ).toBe('0.01');
  });

  it('takes a line with no price as nothing', () => {
    expect(
      quoteRequestAmount([
        { quantity: 5, unitPrice: null, currency: 'PLN' },
        { quantity: 2, unitPrice: '1.50', currency: 'PLN' },
      ]),
    ).toBe('3.00');
  });

  it('takes a figure that is not a decimal as nothing rather than as NaN', () => {
    expect(quoteRequestAmount([{ quantity: 2, unitPrice: 'abc', currency: 'PLN' }])).toBe('0.00');
  });

  it('answers 0.00 for no lines', () => {
    expect(quoteRequestAmount([])).toBe('0.00');
  });
});
