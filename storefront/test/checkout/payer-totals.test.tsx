// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutPayer } from '@endora-commerce/contracts';
import { CheckoutPayerScope, PayerSelector, PayerTotals, type PayerTotalsAction } from '../../components/checkout/CheckoutPayer';

/**
 * `specs/182-related-payers/` RP-16 (b), FR-064 — switching *Paid by* recomputes the totals
 * through the order preview **with the payer**, so the net, VAT and gross shown are what
 * placement writes. Without a payer nothing is asked and nothing extra is shown (SC-007).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAYER: CheckoutPayer = {
  payerOrganizationId: '00000000-0000-4000-8000-0000000000b2',
  name: 'Payer SA',
  taxId: 'PL1234567890',
  commercialTerms: 'buyer',
  billingAddresses: [
    { id: 'pa1', recipientName: 'Payer SA', street: 'ul. Płatnika 9', city: 'Kraków', postalCode: '30-001', country: 'PL', phone: null },
  ],
  paymentMethodIds: null,
  creditAvailable: null,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(action: PayerTotalsAction): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <form>
        <input type="hidden" name="deliveryMethodId" value="dm1" readOnly />
        <input type="radio" name="paymentMethodId" value="pm1" defaultChecked />
        <CheckoutPayerScope payers={[PAYER]}>
          <PayerSelector locale="en-US" organizationName="Buyer X" />
          <select name="payerBillingAddressId" defaultValue="pa1">
            <option value="pa1">pa1</option>
          </select>
          <PayerTotals action={action} locale="en-US" />
        </CheckoutPayerScope>
      </form>,
    );
  });
  return host;
}

describe('PayerTotals (RP-16 b)', () => {
  it('asks nothing and shows nothing while the buyer pays itself', async () => {
    const action = vi.fn<PayerTotalsAction>();
    const view = await render(action);
    expect(action).not.toHaveBeenCalled();
    expect(view.querySelector('[data-testid="payer-totals"]')).toBeNull();
  });

  it('on choosing the payer, previews with the payer and shows net, VAT and gross', async () => {
    const action = vi.fn<PayerTotalsAction>(async () => ({
      subtotal: 39.98,
      taxTotal: 9.2,
      deliveryTotal: 0,
      paymentSurcharge: 0,
      discountTotal: 0,
      total: 49.18,
      currency: 'PLN',
    }));
    const view = await render(action);
    const select = view.querySelector('select[name="payerOrganizationId"]') as HTMLSelectElement;
    await act(async () => {
      select.value = PAYER.payerOrganizationId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(action).toHaveBeenCalledWith({
      payerOrganizationId: PAYER.payerOrganizationId,
      billingAddressId: 'pa1',
      deliveryMethodId: 'dm1',
      paymentMethodId: 'pm1',
    });
    const totals = view.querySelector('[data-testid="payer-totals"]');
    expect(totals?.textContent).toContain('9.20');
    expect(totals?.textContent).toContain('49.18');
    expect(totals?.textContent).toContain('39.98');
  });

  it('a refused preview says the totals could not be computed, never shows stale figures', async () => {
    const action = vi.fn<PayerTotalsAction>(async () => null);
    const view = await render(action);
    const select = view.querySelector('select[name="payerOrganizationId"]') as HTMLSelectElement;
    await act(async () => {
      select.value = PAYER.payerOrganizationId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(view.querySelector('[data-testid="payer-totals"]')?.textContent).toContain('could not be computed');
  });
});
