import { describe, expect, it } from 'vitest';
import type { CheckoutPayer } from '@endora-commerce/contracts';
import type { PaymentMethodSummary } from '../../lib/api/methods';
import { payerSelectablePaymentMethods } from '../../lib/checkout/payment-method-eligibility';

/**
 * `specs/182-related-payers/` RP-16 (c) — the credit-limit method is offered for a payer
 * exactly as for the buyer itself (`credit-limit-method.test.ts`): hidden without a grant
 * and when the available credit is below the cart total — the **payer's** credit.
 */
const method = (id: string, kind: PaymentMethodSummary['kind']): PaymentMethodSummary => ({
  id,
  code: id,
  name: { default: id },
  kind,
  status: 'active',
  adapter: kind,
  additionalPrice: 0,
  rendererKey: null,
});
const transfer = method('bank_transfer', 'bank_transfer');
const credit = method('credit_limit', 'credit_limit');
const payer = (creditAvailable: number | null): CheckoutPayer => ({
  payerOrganizationId: '00000000-0000-4000-8000-0000000000b2',
  name: 'Payer SA',
  taxId: 'PL1234567890',
  commercialTerms: 'buyer',
  billingAddresses: [],
  paymentMethodIds: null,
  creditAvailable,
});

describe('payerSelectablePaymentMethods', () => {
  it('hides the credit method from a payer with no grant', () => {
    expect(payerSelectablePaymentMethods([transfer, credit], payer(null), 100).map((m) => m.id)).toEqual(['bank_transfer']);
  });

  it('hides it when the payer\'s available credit is below the cart total', () => {
    expect(payerSelectablePaymentMethods([transfer, credit], payer(99.99), 100).map((m) => m.id)).toEqual(['bank_transfer']);
  });

  it('offers it when the payer\'s credit covers the cart', () => {
    expect(payerSelectablePaymentMethods([transfer, credit], payer(100), 100).map((m) => m.id)).toEqual([
      'bank_transfer',
      'credit_limit',
    ]);
  });
});
