import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { PaidOrderDetail, PaidOrderSummary } from '@endora-commerce/contracts';
import {
  OrderPayerLine,
  PaidOrderDetailView,
  PaidOrdersTable,
  showsPaidOrders,
} from '../../components/account/PaidOrders';

/**
 * `specs/182-related-payers/` T043 (FR-070, FR-071, FR-073, RP-13) — *Orders we pay for* in the
 * payer's account: a list linking to a read-only detail with the invoice downloads (no
 * storefront invoice list, RP-13), no buyer action; the entry shown only to a holder of
 * *View orders we pay for* while the module is present; and *Paid by* on the buyer's order.
 */
const SUMMARY: PaidOrderSummary = {
  id: '00000000-0000-4000-8000-0000000000e1',
  businessId: 'ORD-182',
  placedAt: '2026-11-18T10:00:00.000Z',
  status: 'new',
  statusLabel: 'New',
  paymentStatus: 'awaiting_payment',
  buyerOrganizationId: '00000000-0000-4000-8000-0000000000b1',
  buyerName: 'Buyer X',
  total: 49.18,
  currency: 'PLN',
};

const DETAIL: PaidOrderDetail = {
  ...SUMMARY,
  items: [
    {
      id: '00000000-0000-4000-8000-0000000000f1',
      productId: '00000000-0000-4000-8000-0000000000f2',
      productSnapshot: { sku: 'S-1', name: 'Screw', primaryAssetUrl: null },
      variantId: null,
      variantSnapshot: null,
      quantity: 2,
      unitPrice: 19.99,
      taxRate: 0.23,
      lineTotal: 39.98,
      groupId: null,
      position: 0,
    },
  ],
  subtotal: 39.98,
  taxTotal: 9.2,
  discountTotal: 0,
  deliveryTotal: 0,
  billingAddress: { recipientName: 'Payer SA', street: 'Płatnika 9', city: 'Kraków', postalCode: '30-001', country: 'PL', companyName: 'Payer SA', taxId: 'PL1234567890' },
  payer: { organizationId: '00000000-0000-4000-8000-0000000000b2', name: 'Payer SA', taxId: 'PL1234567890', terms: 'buyer' },
  deliveryMethodName: 'DPD',
  invoices: [{ id: '00000000-0000-4000-8000-0000000000a9', number: 'FV/1/2026' }],
};

describe('Orders we pay for (FR-070)', () => {
  it('lists each order with its buyer and links to its read-only detail', () => {
    const html = renderToString(<PaidOrdersTable orders={[SUMMARY]} locale="en-US" />);
    expect(html).toContain('ORD-182');
    expect(html).toContain('Buyer X');
    expect(html).toContain(`/paid-orders/${SUMMARY.id}`);
  });

  it('says so when there is nothing to pay for', () => {
    expect(renderToString(<PaidOrdersTable orders={[]} locale="en-US" />)).toContain('No orders');
  });

  it('shows the detail read-only, with the invoice download through the paid-order route (RP-13)', () => {
    const html = renderToString(<PaidOrderDetailView order={DETAIL} locale="en-US" />);
    expect(html).toContain('Screw');
    expect(html).toContain('Buyer X');
    expect(html).toContain('PL1234567890');
    expect(html).toContain(`/api/v1/account/paid-orders/${DETAIL.id}/invoices/${DETAIL.invoices[0]!.id}/pdf`);
    expect(html).toContain('FV/1/2026');
    // FR-071 — no buyer action: no form, no cancel, reorder, quote or return.
    expect(html).not.toContain('<form');
    for (const word of ['Cancel', 'Reorder', 'quote', 'Return']) expect(html).not.toContain(word);
  });
});

describe('the account entry (FR-070, FR-101)', () => {
  const me = (permissions: string[], kind: 'administrator' | 'member' = 'member') => ({
    customerAccount: { permissions, organizationRole: { kind } },
    organization: { isPersonal: false },
  });
  const present = { isPresent: () => true };
  const absent = { isPresent: (id: string) => id !== 'related_payers' };

  it('is shown to a holder of view_paid_orders while the module is present', () => {
    expect(showsPaidOrders(me(['related_payers.view_paid_orders']) as never, present)).toBe(true);
    expect(showsPaidOrders(me([], 'administrator') as never, present)).toBe(true);
  });

  it('is absent without the permission or with the module off', () => {
    expect(showsPaidOrders(me([]) as never, present)).toBe(false);
    expect(showsPaidOrders(me(['related_payers.view_paid_orders']) as never, absent)).toBe(false);
  });
});

describe('Paid by on the buyer\'s order (FR-073)', () => {
  it('names the payer, and renders nothing for an order the buyer pays', () => {
    expect(renderToString(<OrderPayerLine payer={DETAIL.payer} locale="en-US" />)).toContain('Payer SA');
    expect(renderToString(<OrderPayerLine payer={null} locale="en-US" />)).toBe('');
  });
});
