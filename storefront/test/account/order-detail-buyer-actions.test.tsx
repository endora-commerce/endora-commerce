import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { OrderSummary } from '../../lib/api/orders';
import { orderBuyerActions } from '../../lib/orders/order-actions';
import { visibleText } from './i18n/text';

/**
 * Feature 170 (`specs/170-organization-roles/` WP-16, T156; FR-030, FR-040, FR-057) — the order
 * detail's two "order again" actions are judged by what they build, as the backend judges them
 * (`contracts/storefront-api.md` §5): *Order again → cart* replaces the active cart and needs
 * `carts.create`; *Order again → quote request* creates a quote request and needs
 * `quote_requests.create`. A member lacking the code is not offered the action (a single action:
 * hidden, not explained — the order detail's rule for *Start a return*, WP-14b). A session that
 * cannot be read keeps today's page: the server is the gate.
 *
 * The page is an async server component, awaited and rendered with the session, the account and
 * the API clients mocked (the pattern of `returns-organization-permissions.test.tsx`). SSR-only.
 */

let locale = 'en-US';
let permissions: string[] = ['carts.create', 'quote_requests.create'];
let meFails = false;

const order = {
  id: '11111111-2222-4333-8444-555555555555',
  businessId: 'ORD-2001-2026',
  organizationId: 'org-1',
  status: 'completed',
  paymentStatus: 'paid',
  deliveryAddress: {},
  billingAddress: {},
  deliveryMethod: { id: 'd1', code: 'courier', name: {}, cost: 0 },
  paymentMethod: { id: 'p1', code: 'bank_transfer', name: {}, kind: 'bank_transfer' },
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
} as unknown as OrderSummary;

vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => {
    if (meFails) throw new Error('me unavailable');
    return {
      customerAccount: {
        id: 'member-1',
        organizationRole: { id: 'role-1', kind: 'custom', name: 'Purchasing' },
        permissions,
      },
      organization: { id: 'org-1', name: 'Acme', isPersonal: false },
      impersonation: null,
    };
  },
}));
vi.mock('../../lib/api/orders', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/orders')>('../../lib/api/orders');
  return { ...actual, getMyOrder: async () => order, listOrderComments: async () => [] };
});
vi.mock('../../lib/api/returns', () => ({ getReturnable: async () => ({ eligible: false, lines: [] }) }));
vi.mock('../../lib/api/invoices', () => ({
  listMyOrderInvoices: async () => [],
  invoiceDownloadUrl: () => '#',
}));
vi.mock('../../lib/api/payments', () => ({ retryOrderPayment: async () => ({ opened: false }) }));
vi.mock('../../components/analytics/EcommerceTrackers', () => ({ PurchaseTracker: () => null }));

const { default: OrderPage } = await import('../../app/(account)/orders/[id]/page');

async function text(): Promise<string> {
  const element = await OrderPage({ params: Promise.resolve({ id: order.id }), searchParams: Promise.resolve({}) });
  return visibleText(renderToString(<>{element as React.ReactElement}</>).replaceAll('<!-- -->', ''));
}

const LABELS = {
  'en-US': { cart: 'Order again → cart', quote: 'Order again → quote request' },
  'pl-PL': { cart: 'Zamów ponownie → koszyk', quote: 'Zamów ponownie → zapytanie ofertowe' },
} as const;

beforeEach(() => {
  locale = 'en-US';
  permissions = ['carts.create', 'quote_requests.create'];
  meFails = false;
});

describe('orderBuyerActions', () => {
  it('follows carts.create for the reorder and quote_requests.create for the clone', () => {
    expect(orderBuyerActions({ permissions: ['carts.create', 'quote_requests.create'] })).toEqual({
      reorder: true,
      cloneToQuote: true,
    });
    expect(orderBuyerActions({ permissions: ['carts.create'] })).toEqual({ reorder: true, cloneToQuote: false });
    expect(orderBuyerActions({ permissions: ['quote_requests.create'] })).toEqual({ reorder: false, cloneToQuote: true });
    expect(orderBuyerActions({ permissions: ['orders.view_organization'] })).toEqual({
      reorder: false,
      cloneToQuote: false,
    });
  });

  it('keeps both when the session could not be read — the server judges', () => {
    expect(orderBuyerActions(null)).toEqual({ reorder: true, cloneToQuote: true });
  });
});

describe.each(['en-US', 'pl-PL'] as const)('order detail — the order-again actions (%s)', (lang) => {
  beforeEach(() => {
    locale = lang;
  });

  it('offers both to a member holding both codes', async () => {
    const out = await text();
    expect(out).toContain(LABELS[lang].cart);
    expect(out).toContain(LABELS[lang].quote);
  });

  it('hides the reorder from a member without carts.create', async () => {
    permissions = ['quote_requests.create'];
    const out = await text();
    expect(out).not.toContain(LABELS[lang].cart);
    expect(out).toContain(LABELS[lang].quote);
  });

  it('hides the clone to a quote request from a member without quote_requests.create', async () => {
    permissions = ['carts.create'];
    const out = await text();
    expect(out).toContain(LABELS[lang].cart);
    expect(out).not.toContain(LABELS[lang].quote);
  });

  it('hides both from a member holding neither, and keeps the rest of the page', async () => {
    permissions = [];
    const out = await text();
    expect(out).not.toContain(LABELS[lang].cart);
    expect(out).not.toContain(LABELS[lang].quote);
    expect(out).toContain('ORD-2001-2026');
  });

  it('keeps both when the session could not be read', async () => {
    meFails = true;
    const out = await text();
    expect(out).toContain(LABELS[lang].cart);
    expect(out).toContain(LABELS[lang].quote);
  });
});
