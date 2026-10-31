import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { OrderSummary } from '../../../lib/api/orders';
import type { ReturnCaseDetail } from '../../../lib/api/returns';
import { POLISH_DIACRITIC, visibleText, withoutZloty } from './text';

/**
 * Issue #85 — the account's order and return pages render the shop's language:
 * the list and detail of each, the order's payment status (a code until now)
 * and the return's kind and author (codes too), in `en-US` and `pl-PL`.
 */

let locale = 'en-US';

const order: OrderSummary = {
  id: '11111111-2222-4333-8444-555555555555',
  businessId: 'ORD-2001-2026',
  organizationId: 'org-1',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: {},
  billingAddress: {},
  deliveryMethod: { id: 'd1', code: 'courier', name: {}, cost: 0 },
  paymentMethod: { id: 'p1', code: 'bank_transfer', name: {}, kind: 'bank_transfer' },
  items: [
    {
      id: 'i1',
      productId: 'prod-1',
      variantId: null,
      quantity: 2,
      unitPrice: 50,
      taxRate: 23,
      lineTotal: 100,
      productSnapshot: { sku: 'SKU-1', name: 'Widget', primaryAssetUrl: null },
      variantSnapshot: null,
    },
  ],
  subtotal: 100,
  taxTotal: 23,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 123,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-08-21T10:00:00.000Z',
  nextAction: { kind: 'awaiting_transfer' },
} as OrderSummary;

const returnCase: ReturnCaseDetail = {
  id: 'r1',
  rmaNumber: null,
  kind: 'complaint',
  orderId: order.id,
  statusCode: 'submitted',
  statusLabel: 'Submitted',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-08-22T10:00:00.000Z',
  resolutionType: null,
  rejectionReason: null,
  freeReturnEligible: false,
  items: [{ id: 'ri1', productName: 'Widget', quantity: 1, defaultRefundAmount: 50, approvedRefundAmount: 0 }],
  comments: [
    { id: 'c1', authorKind: 'admin', body: 'We are looking into it.', isCustomerVisible: true, createdAt: '2026-08-23T10:00:00.000Z' },
  ],
};

let orders: OrderSummary[] = [];
let returns: ReturnCaseDetail[] = [];

vi.mock('../../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../../lib/api/orders', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api/orders')>('../../../lib/api/orders');
  return {
    ...actual,
    listMyOrders: async () => orders,
    getMyOrder: async () => order,
    listOrderComments: async () => [],
  };
});
vi.mock('../../../lib/api/returns', () => ({
  getReturnable: async () => ({ eligible: false }),
  listMyReturns: async () => returns,
  getMyReturn: async () => returnCase,
  addReturnComment: async () => undefined,
}));
vi.mock('../../../lib/api/invoices', () => ({
  listMyOrderInvoices: async () => [{ id: 'inv1', number: 'FV/1/2026' }],
  invoiceDownloadUrl: () => '#',
}));
vi.mock('../../../lib/api/payments', () => ({ retryOrderPayment: async () => ({ opened: false }) }));
vi.mock('../../../components/analytics/EcommerceTrackers', () => ({ PurchaseTracker: () => null }));

async function render(element: unknown): Promise<string> {
  return visibleText(renderToString((await element) as React.ReactElement));
}

describe('account orders — the shop language (issue #85)', () => {
  beforeEach(() => {
    orders = [];
  });

  it('renders the empty list in both languages', async () => {
    const { default: Page } = await import('../../../app/(account)/orders/page');
    locale = 'en-US';
    const en = await render(Page());
    expect(en).toContain('Orders');
    expect(en).toContain('You don\'t have any orders yet.');
    expect(en).toContain('Browse the catalog');
    locale = 'pl-PL';
    const pl = await render(Page());
    expect(pl).toContain('Zamówienia');
    expect(pl).toContain('Nie masz jeszcze żadnych zamówień.');
    expect(pl).toContain('Przeglądaj katalog');
  });

  it('renders the list with a payment status label, not its code', async () => {
    orders = [order];
    const { default: Page } = await import('../../../app/(account)/orders/page');
    locale = 'en-US';
    const en = await render(Page());
    expect(en).toContain('Placed Order Status Payment Total');
    expect(en).toContain('Awaiting payment');
    expect(en).not.toContain('awaiting_payment');
    expect(en).toContain('Open');
    locale = 'pl-PL';
    const pl = await render(Page());
    expect(pl).toContain('Data złożenia Zamówienie Status Płatność Razem');
    expect(pl).toContain('Oczekuje na płatność');
    expect(pl).toContain('Otwórz');
  });

  it('renders the order detail in English', async () => {
    const { default: Page } = await import('../../../app/(account)/orders/[id]/page');
    locale = 'en-US';
    const text = await render(Page({ params: Promise.resolve({ id: order.id }), searchParams: Promise.resolve({}) }));
    expect(text).toContain('Thank you — order placed');
    expect(text).toContain('Order ORD-2001-2026 has been received.');
    expect(text).toContain('Pay by bank transfer using the reference printed on the proforma invoice');
    expect(text).toContain('Order again → cart');
    expect(text).toContain('Download invoice FV/1/2026');
    expect(text).toContain('Order status');
    expect(text).toContain('Payment status Awaiting payment');
    expect(text).toContain('Product Qty Unit price Line total');
    expect(text).toContain('SKU: SKU-1');
    expect(text).toContain('Subtotal');
    expect(text).toContain('This order is awaiting payment. Use the bank-transfer details above to pay.');
    expect(text).toContain('No comments yet.');
    expect(text).toContain('Add comment');
    expect(text).not.toMatch(POLISH_DIACRITIC);
  });

  it('renders the order detail in Polish', async () => {
    const { default: Page } = await import('../../../app/(account)/orders/[id]/page');
    locale = 'pl-PL';
    const text = await render(Page({ params: Promise.resolve({ id: order.id }), searchParams: Promise.resolve({}) }));
    expect(text).toContain('Dziękujemy — zamówienie zostało złożone');
    expect(text).toContain('Otrzymaliśmy zamówienie ORD-2001-2026.');
    expect(text).toContain('Zamów ponownie → koszyk');
    expect(text).toContain('Pobierz fakturę FV/1/2026');
    expect(text).toContain('Status płatności Oczekuje na płatność');
    expect(text).toContain('Produkt Ilość Cena jednostkowa Wartość');
    expect(text).toContain('Suma częściowa');
    expect(text).toContain('To zamówienie oczekuje na płatność.');
    expect(text).toContain('Nie ma jeszcze komentarzy.');
    expect(text).toContain('Dodaj komentarz');
  });
});

describe('account returns — the shop language (issue #85)', () => {
  beforeEach(() => {
    returns = [];
  });

  it('renders the list in both languages, with the kind as a word', async () => {
    const { default: Page } = await import('../../../app/(account)/returns/page');
    locale = 'en-US';
    expect(await render(Page())).toContain('You don’t have any returns yet.');
    returns = [returnCase];
    const en = await render(Page());
    expect(en).toContain('Returns & complaints');
    expect(en).toContain('Submitted RMA Type Status Refund');
    expect(en).toContain('Complaint');
    expect(withoutZloty(en)).not.toMatch(POLISH_DIACRITIC);
    locale = 'pl-PL';
    const pl = await render(Page());
    expect(pl).toContain('Zwroty i reklamacje');
    expect(pl).toContain('Data zgłoszenia Numer RMA Rodzaj Status Kwota zwrotu');
    expect(pl).toContain('Reklamacja');
  });

  it('renders the case in both languages', async () => {
    const { default: Page } = await import('../../../app/(account)/returns/[id]/page');
    locale = 'en-US';
    const en = await render(Page({ params: Promise.resolve({ id: 'r1' }) }));
    expect(en).toContain('← Back to returns');
    expect(en).toContain('Return case');
    expect(en).toContain('Status: Submitted · Complaint');
    expect(en).toContain('Conversation');
    expect(en).toContain('Customer service');
    expect(en).toContain('Add a message');
    expect(en).not.toMatch(POLISH_DIACRITIC);
    locale = 'pl-PL';
    const pl = await render(Page({ params: Promise.resolve({ id: 'r1' }) }));
    expect(pl).toContain('← Wróć do zwrotów');
    expect(pl).toContain('Zgłoszenie zwrotu');
    expect(pl).toContain('Status: Submitted · Reklamacja');
    expect(pl).toContain('Korespondencja');
    expect(pl).toContain('Obsługa klienta');
    expect(pl).toContain('Dodaj wiadomość');
  });
});
