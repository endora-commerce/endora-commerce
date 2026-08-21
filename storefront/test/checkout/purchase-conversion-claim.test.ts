import { describe, expect, it } from 'vitest';
import { reportPurchaseOnce } from '../../lib/analytics/purchase-conversion';
import type { GaPurchase } from '../../lib/analytics/ecommerce';

/**
 * Issue #277 — the "has anyone counted this order yet" half of the tracker.
 *
 * Eligibility (`purchase-eligibility.ts`) says whether an order may ever be
 * counted; this says whether it has been counted already. Both are needed, and
 * for different reasons: without eligibility a declined payment is revenue,
 * and without this a buyer who reopens their order is a second sale.
 */
const payload: GaPurchase = {
  transactionId: 'ORD-3001-2026',
  value: 250,
  currency: 'PLN',
  items: [],
};

function recorder(): { fired: GaPurchase[]; fire: (p: GaPurchase) => void } {
  const fired: GaPurchase[] = [];
  return { fired, fire: (p) => fired.push(p) };
}

describe('reportPurchaseOnce', () => {
  it('reports the conversion for the view that wins the claim', async () => {
    const { fired, fire } = recorder();
    await reportPurchaseOnce({ orderId: 'o1', payload, claim: async () => true, fire });
    expect(fired).toEqual([payload]);
  });

  it('reports nothing for a view that arrives after the conversion was counted', async () => {
    const { fired, fire } = recorder();
    await reportPurchaseOnce({ orderId: 'o1', payload, claim: async () => false, fire });
    expect(fired).toEqual([]);
  });

  it('counts one order once across the two surfaces that may count it', async () => {
    // `/checkout/success` and `/orders/:id` are two arrivals of the same
    // conversion, and each is reached by a different payment path. Neither
    // knows what the other did; the claim is what makes them agree.
    const open = new Set(['o1']);
    const claim = async (id: string) => open.delete(id);
    const { fired, fire } = recorder();
    await reportPurchaseOnce({ orderId: 'o1', payload, claim, fire });
    await reportPurchaseOnce({ orderId: 'o1', payload, claim, fire });
    await reportPurchaseOnce({ orderId: 'o1', payload, claim, fire });
    expect(fired).toHaveLength(1);
  });

  it('reports nothing when the claim call fails, leaving it for the next view', async () => {
    // Inventing a conversion the platform never granted puts it in the report
    // for good; skipping one costs nothing but this page view.
    const { fired, fire } = recorder();
    let calls = 0;
    const claim = async () => {
      calls += 1;
      if (calls === 1) throw new Error('network');
      return true;
    };
    await reportPurchaseOnce({ orderId: 'o1', payload, claim, fire });
    expect(fired).toEqual([]);
    await reportPurchaseOnce({ orderId: 'o1', payload, claim, fire });
    expect(fired).toEqual([payload]);
  });
});
