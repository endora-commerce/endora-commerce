import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { OrderSummary } from '../../lib/api/orders';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from '../account/i18n/text';
import { actionsOf, form, redirectOf } from './actions';

/**
 * Issue #745 — `/orders/:id?error=` carries a code. Its actions (comment,
 * order again, order again as a quote, cancel, pay again) and the checkout
 * failure page's pay-again land here.
 */

let locale = 'en-US';
let failure: Error | null = null;

const order = {
  id: '11111111-2222-4333-8444-555555555555',
  businessId: 'ORD-2001-2026',
  organizationId: 'org-1',
  status: 'new',
  paymentStatus: 'failed',
  deliveryAddress: {},
  billingAddress: {},
  deliveryMethod: { id: 'd1', code: 'courier', name: {}, cost: 0 },
  paymentMethod: { id: 'p1', code: 'card', name: {}, kind: 'gateway' },
  items: [],
  subtotal: 100,
  taxTotal: 23,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 123,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-08-21T10:00:00.000Z',
  nextAction: null,
  customerCancellable: true,
} as unknown as OrderSummary;

vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale }, modules: { isPresent: () => true, presentIds: [], absentIds: [] } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      id: 'member-1',
      organizationRole: { id: 'role-1', kind: 'administrator', name: 'Administrator' },
      permissions: ['carts.create', 'quote_requests.create'],
    },
    organization: { id: 'org-1', name: 'Acme', isPersonal: false },
    impersonation: null,
  }),
}));
const refuse = async (): Promise<never> => {
  throw failure ?? new Error('fetch failed');
};
vi.mock('../../lib/api/orders', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/orders')>('../../lib/api/orders');
  return {
    ...actual,
    getMyOrder: async () => order,
    listOrderComments: async () => [],
    addOrderComment: refuse,
    reorderOrder: refuse,
    cancelMyOrder: refuse,
    cloneOrderToQuote: refuse,
  };
});
vi.mock('../../lib/api/returns', () => ({ getReturnable: async () => ({ eligible: false, lines: [] }) }));
vi.mock('../../lib/api/invoices', () => ({
  listMyOrderInvoices: async () => [],
  invoiceDownloadUrl: () => '#',
}));
vi.mock('../../lib/api/payments', () => ({ retryOrderPayment: refuse }));
vi.mock('../../components/analytics/EcommerceTrackers', () => ({ PurchaseTracker: () => null }));

const { default: OrderPage } = await import('../../app/(account)/orders/[id]/page');

async function tree(sp: Record<string, string> = {}): Promise<unknown> {
  return OrderPage({ params: Promise.resolve({ id: order.id }), searchParams: Promise.resolve(sp) });
}

async function text(sp: Record<string, string>): Promise<string> {
  return visibleText(renderToString(<>{(await tree(sp)) as React.ReactElement}</>));
}

beforeEach(() => {
  locale = 'en-US';
  failure = null;
});

describe('a crafted ?error= never reaches the order page', () => {
  it.each(['Zamówienie anulowane — zwrot na konto 00 1111', 'SOMETHING_ELSE', 'constructor'])('%s', async (crafted) => {
    const out = await text({ error: crafted });
    expect(out).not.toContain(crafted);
    expect(out).toContain('Something went wrong with this order. Please try again.');
  });
});

describe('each known code reads in English and Polish', () => {
  it.each([
    ['ORDER_NOT_CANCELLABLE', 'This order can no longer be cancelled.', 'Tego zamówienia nie można już anulować.'],
    ['PAYMENT_NOT_DUE', 'This order is not awaiting payment.', 'To zamówienie nie oczekuje na płatność.'],
    [
      'PAYMENT_RETRY_FAILED',
      'We could not start the payment. Please try again in a moment.',
      'Nie udało się rozpocząć płatności. Spróbuj ponownie za chwilę.',
    ],
  ])('%s', async (code, en, pl) => {
    expect(await text({ error: code })).toContain(en);
    locale = 'pl-PL';
    expect(await text({ error: code })).toContain(pl);
  });
});

describe('the order page’s actions redirect with a code, never a sentence', () => {
  async function run(name: string): Promise<string> {
    const action = actionsOf(await tree()).get(name);
    if (!action) throw new Error(`the order page hands no ${name}`);
    return redirectOf(() => action(form({ id: order.id, body: 'Hello' }) as never));
  }

  it('cancel carries the API code it names', async () => {
    failure = new StorefrontApiError(409, 'ORDER_NOT_CANCELLABLE', 'Tego zamówienia nie można już anulować.');
    expect(await run('cancelOrderAction')).toBe(`/orders/${order.id}?error=ORDER_NOT_CANCELLABLE`);
  });

  it.each([
    ['cancelOrderAction', 'CANCEL_FAILED'],
    ['reorderAction', 'REORDER_FAILED'],
    ['reorderToQuoteAction', 'REORDER_TO_QUOTE_FAILED'],
    ['retryPaymentAction', 'PAYMENT_RETRY_FAILED'],
  ])('%s carries %s for a refusal it cannot name', async (name, code) => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await run(name)).toBe(`/orders/${order.id}?error=${code}`);
  });
});
