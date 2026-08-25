import { describe, expect, it } from 'vitest';
import { selectablePaymentMethods } from '../../lib/checkout/payment-method-eligibility';
import { placeOrderBlock } from '../../lib/checkout/place-order-gate';
import type { PaymentMethodSummary } from '../../lib/api/methods';

/**
 * The credit-limit method at checkout — what the storefront decides, measured.
 *
 * `credit_limit` is a first-class `paymentMethodKindSchema` member with a
 * registered adapter, and the dev seed now creates a row for it, so a B2B buyer
 * sees it out of the box. What decides *which* buyer sees it is the rule below,
 * and nothing else on the storefront: `CreditLimitAdapter.validateUseOnStorefront`
 * inherits `() => true`, so the backend's eligibility service offers the method
 * to a buyer with no grant at all.
 *
 * These cases are therefore the evidence for that being a layering defect rather
 * than a reachable one: the outcome is correct at every exit a buyer has, and the
 * repair — teaching the adapter to answer — needs a `payments` -> `credit_limits`
 * edge that no manifest declares today.
 */
const method = (
  id: string,
  kind: PaymentMethodSummary['kind'],
  status: PaymentMethodSummary['status'] = 'active',
): PaymentMethodSummary => ({
  id,
  code: id,
  name: { default: id },
  kind,
  status,
  adapter: kind,
  additionalPrice: 0,
  rendererKey: null,
});

const transfer = method('bank_transfer', 'bank_transfer');
const credit = method('credit_limit', 'credit_limit');

describe('selectablePaymentMethods', () => {
  it('hides the credit-limit method from an organization with no grant', () => {
    const offered = selectablePaymentMethods([transfer, credit], {
      creditAvailable: null,
      cartTotal: 100,
    });
    expect(offered.map((m) => m.id)).toEqual(['bank_transfer']);
  });

  it('hides it when the cart exceeds what is available', () => {
    const offered = selectablePaymentMethods([transfer, credit], {
      creditAvailable: 99,
      cartTotal: 100,
    });
    expect(offered.map((m) => m.id)).toEqual(['bank_transfer']);
  });

  it('offers it when the grant covers the cart, down to the last minor unit', () => {
    const offered = selectablePaymentMethods([transfer, credit], {
      creditAvailable: 100,
      cartTotal: 100,
    });
    expect(offered.map((m) => m.id)).toEqual(['bank_transfer', 'credit_limit']);
  });

  it('never offers an inactive method, whatever its kind', () => {
    const offered = selectablePaymentMethods(
      [method('inactive_transfer', 'bank_transfer', 'inactive')],
      { creditAvailable: 5000, cartTotal: 1 },
    );
    expect(offered).toEqual([]);
  });

  it('blocks Place Order when credit limit was the only method the buyer had', () => {
    // The case the seeded credit-limit row makes reachable and the previous
    // button could not see: the catalogue is non-empty, the buyer's own list is
    // not, and submitting would have sent `paymentMethodId=""` to a uuid schema.
    const offered = selectablePaymentMethods([credit], { creditAvailable: null, cartTotal: 100 });
    expect(offered).toEqual([]);
    expect(placeOrderBlock({ canTransact: true, paymentMethodCount: offered.length })).toBe(
      'no-payment-method',
    );
  });
});
