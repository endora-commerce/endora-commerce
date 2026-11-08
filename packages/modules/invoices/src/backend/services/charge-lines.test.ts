import { describe, expect, it } from 'vitest';
import { chargeLinesOf } from './corrective-invoice.js';

/**
 * Issue #876, ruling Q3 on PR #965 — the delivery and surcharge lines a
 * correction credits. By `line_kind` where the invoice records it; on an
 * invoice issued before #904, by position, and only among 0 % lines: a
 * positive line naming no order item at another rate is not a charge this
 * platform ever wrote, so it is never taken for one.
 */
type L = { ordinal: number; orderItemId: string | null; lineKind: string | null; grossValue: string; taxRate: string };
const line = (ordinal: number, over: Partial<L> = {}): L => ({
  ordinal,
  orderItemId: null,
  lineKind: null,
  grossValue: '15.99',
  taxRate: '0.0000',
  ...over,
});

describe('chargeLinesOf (#876, Q3)', () => {
  it('reads the line kinds an invoice issued after #904 records', () => {
    const delivery = line(2, { lineKind: 'delivery' });
    const surcharge = line(3, { lineKind: 'payment_surcharge', grossValue: '2.50' });
    expect(chargeLinesOf([line(1, { orderItemId: 'a', lineKind: 'goods', taxRate: '0.2300' }), delivery, surcharge])).toEqual({
      delivery,
      payment_surcharge: surcharge,
    });
  });

  it('on a legacy invoice, the first positive 0 % line naming no order item is the delivery, the second the surcharge', () => {
    const goods = line(1, { orderItemId: 'a', taxRate: '0.2300', grossValue: '123.00' });
    const delivery = line(2);
    const surcharge = line(3, { grossValue: '2.50' });
    const discount = line(4, { grossValue: '-5.00' });
    expect(chargeLinesOf([surcharge, discount, goods, delivery])).toEqual({ delivery, payment_surcharge: surcharge });
  });

  it('on a legacy invoice, a single such line answers for whichever charge the order had', () => {
    const only = line(2);
    expect(chargeLinesOf([line(1, { orderItemId: 'a', taxRate: '0.2300' }), only])).toEqual({ delivery: only, payment_surcharge: only });
  });

  it('on a legacy invoice, a positive line at a rate other than 0 % is never taken for a charge', () => {
    expect(chargeLinesOf([line(1, { orderItemId: 'a', taxRate: '0.2300' }), line(2, { taxRate: '0.2300' })])).toEqual({});
    const delivery = line(3);
    expect(chargeLinesOf([line(2, { taxRate: '0.0800' }), delivery])).toEqual({ delivery, payment_surcharge: delivery });
  });
});
