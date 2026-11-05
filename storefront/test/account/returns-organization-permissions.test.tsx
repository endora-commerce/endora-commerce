import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { OrderSummary } from '../../lib/api/orders';
import type { ReturnCaseDetail, ReturnableResponse } from '../../lib/api/returns';
import { visibleText } from './i18n/text';

/**
 * Feature 170 (`specs/170-organization-roles/`, owner ruling OR-11; FR-052, FR-053, FR-057) — the
 * storefront's returns surfaces read the member's role:
 *
 * - opening a return or a complaint needs `returns.create`: the order detail offers no entry, the
 *   returns list no *Start a new return* link, and `/returns/new` says why instead of the form;
 * - a holder of `returns.view_organization` lists the Organization's cases, and the list marks a
 *   case filed by a colleague (`customerAccountId` is not the member's);
 * - a colleague's case is read-only (Q-R2 = A): no message form, and one line saying why.
 *
 * The pages are async server components, awaited and rendered with the session, the account and
 * the API clients mocked (the pattern of `org-cart-detail.test.tsx`). SSR-only.
 */
const ME = '00000000-0000-4000-8000-000000000001';
const COLLEAGUE = '00000000-0000-4000-8000-000000000002';

let locale = 'en-US';
let permissions: string[] = ['returns.create'];
let meFails = false;
let returnable: ReturnableResponse = { eligible: true, freeReturnEligible: false, lines: [] };

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

function returnCase(overrides: Partial<ReturnCaseDetail> = {}): ReturnCaseDetail {
  return {
    id: 'r1',
    rmaNumber: 'RMA-1',
    kind: 'return',
    orderId: order.id,
    customerAccountId: ME,
    statusCode: 'submitted',
    statusLabel: 'Submitted',
    totalRefundAmount: 0,
    currency: 'PLN',
    submittedAt: '2026-08-22T10:00:00.000Z',
    resolutionType: null,
    rejectionReason: null,
    freeReturnEligible: false,
    items: [],
    comments: [],
    ...overrides,
  };
}

let cases: ReturnCaseDetail[] = [];
let detail: ReturnCaseDetail = returnCase();

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
        id: ME,
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
  return {
    ...actual,
    listMyOrders: async () => [order],
    getMyOrder: async () => order,
    listOrderComments: async () => [],
  };
});
vi.mock('../../lib/api/returns', () => ({
  getReturnable: async () => returnable,
  listReturnReasons: async () => [],
  listMyReturns: async () => cases,
  getMyReturn: async () => detail,
  addReturnComment: async () => undefined,
  createReturnCase: async () => detail,
}));
vi.mock('../../lib/api/invoices', () => ({
  listMyOrderInvoices: async () => [],
  invoiceDownloadUrl: () => '#',
}));
vi.mock('../../lib/api/payments', () => ({ retryOrderPayment: async () => ({ opened: false }) }));
vi.mock('../../components/analytics/EcommerceTrackers', () => ({ PurchaseTracker: () => null }));

const { default: OrderPage } = await import('../../app/(account)/orders/[id]/page');
const { default: ReturnsPage } = await import('../../app/(account)/returns/page');
const { default: NewReturnPage } = await import('../../app/(account)/returns/new/page');
const { default: ReturnPage } = await import('../../app/(account)/returns/[id]/page');

async function html(element: unknown): Promise<string> {
  return renderToString(<>{(await element) as React.ReactElement}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  locale = 'en-US';
  permissions = ['returns.create'];
  meFails = false;
  returnable = { eligible: true, freeReturnEligible: false, lines: [] };
  cases = [];
  detail = returnCase();
});

describe('order detail — starting a return (FR-052, FR-057)', () => {
  const render = (): Promise<string> =>
    html(OrderPage({ params: Promise.resolve({ id: order.id }), searchParams: Promise.resolve({}) }));

  it('offers the return as today to a member holding returns.create', async () => {
    const out = await render();
    expect(out).toContain('href="/returns/new?orderId=11111111-2222-4333-8444-555555555555"');
    expect(visibleText(out)).toContain('Request return / complaint');
  });

  it('offers the complaint as today to a member holding returns.create', async () => {
    returnable = { eligible: false, reason: 'no_returnable_lines', freeReturnEligible: false, lines: [] };
    expect(visibleText(await render())).toContain('File a complaint');
  });

  it.each<[string, ReturnableResponse]>([
    ['an eligible order', { eligible: true, freeReturnEligible: false, lines: [] }],
    ['a complaint-only order', { eligible: false, reason: 'no_returnable_lines', freeReturnEligible: false, lines: [] }],
  ])('renders neither entry on %s for a member without returns.create', async (_l, answer) => {
    permissions = ['orders.view_organization'];
    returnable = answer;
    const out = await render();
    expect(out).not.toContain('/returns/new');
    expect(visibleText(out)).not.toContain('Request return / complaint');
    expect(visibleText(out)).not.toContain('File a complaint');
  });

  it('keeps the entry when the session could not be read — the server judges', async () => {
    meFails = true;
    expect(await render()).toContain('/returns/new?orderId=');
  });
});

describe('/returns/new — without returns.create (FR-052, FR-057)', () => {
  it.each([
    ['en-US', 'Create returns and complaints'],
    ['pl-PL', 'Zgłaszanie zwrotów i reklamacji'],
  ])('%s: names the permission instead of the form, with no submit', async (l, label) => {
    locale = l;
    permissions = [];
    for (const searchParams of [{}, { orderId: order.id }]) {
      const out = await html(NewReturnPage({ searchParams: Promise.resolve(searchParams) }));
      expect(visibleText(out)).toContain(label);
      expect(out).not.toContain('<form');
      expect(out).not.toContain('type="submit"');
      expect(out).not.toContain('ORD-2001-2026');
      expect(out).toContain('href="/returns"');
    }
  });

  it('shows the form as today to a holder', async () => {
    const out = await html(NewReturnPage({ searchParams: Promise.resolve({ orderId: order.id }) }));
    expect(out).toContain('<form');
    expect(out).toContain('type="submit"');
    expect(visibleText(out)).not.toContain('Create returns and complaints');
  });
});

describe('returns list (FR-053, FR-057)', () => {
  it.each([
    ['en-US', 'Filed by a colleague'],
    ['pl-PL', 'Zgłoszone przez współpracownika'],
  ])('%s: marks a colleague’s case and only that one', async (l, marker) => {
    locale = l;
    permissions = ['returns.create', 'returns.view_organization'];
    cases = [
      returnCase({ id: 'mine', rmaNumber: 'RMA-MINE' }),
      returnCase({ id: 'theirs', rmaNumber: 'RMA-THEIRS', customerAccountId: COLLEAGUE }),
    ];
    const text = visibleText(await html(ReturnsPage()));
    expect(text.split(marker)).toHaveLength(2);
    expect(text.indexOf(marker)).toBeGreaterThan(text.indexOf('RMA-THEIRS'));
    expect(text.indexOf('RMA-MINE')).toBeLessThan(text.indexOf('RMA-THEIRS'));
  });

  it('renders the page as today for a member without returns.view_organization', async () => {
    cases = [returnCase()];
    const out = await html(ReturnsPage());
    expect(visibleText(out)).not.toContain('Filed by a colleague');
    expect(out).toContain('href="/returns/new"');
  });

  it('hides "Start a new return" from a member without returns.create', async () => {
    permissions = ['returns.view_organization'];
    cases = [returnCase()];
    const out = await html(ReturnsPage());
    expect(out).not.toContain('href="/returns/new"');
    expect(visibleText(out)).not.toContain('Start a new return');
    // The cases themselves stay reachable.
    expect(out).toContain('href="/returns/r1"');
  });
});

describe('return case detail — a colleague’s case is read-only (Q-R2 = A)', () => {
  const render = (): Promise<string> => html(ReturnPage({ params: Promise.resolve({ id: '00000000-0000-4000-8000-0000000000e1' }) }));

  it.each([
    ['en-US', 'This case was filed by a colleague'],
    ['pl-PL', 'To zgłoszenie złożył współpracownik'],
  ])('%s: renders no follow-up action and says why', async (l, sentence) => {
    locale = l;
    permissions = ['returns.view_organization'];
    detail = returnCase({ customerAccountId: COLLEAGUE });
    const out = await render();
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<textarea');
    expect(out).not.toContain('type="file"');
    expect(out).not.toContain('type="submit"');
    expect(out).not.toMatch(/name="deliveryMethod/);
    expect(visibleText(out)).not.toMatch(/Cancel|Anuluj/);
    expect(visibleText(out)).toContain(sentence);
  });

  it.each([
    ['en-US', 'Colleague', 'You'],
    ['pl-PL', 'Współpracownik', 'Ty'],
  ])('%s: does not credit the colleague’s messages to the reader', async (l, colleague, you) => {
    locale = l;
    permissions = ['returns.view_organization'];
    detail = returnCase({
      customerAccountId: COLLEAGUE,
      comments: [
        { id: 'c1', authorKind: 'customer', body: 'Box arrived crushed.', isCustomerVisible: true, createdAt: '2026-08-23T10:00:00.000Z' },
      ],
    });
    const text = visibleText(await render());
    expect(text).toContain(`${colleague} ·`);
    expect(text).not.toContain(`${you} ·`);
  });

  it('keeps the message form on the member’s own case', async () => {
    permissions = ['returns.view_organization'];
    const out = await render();
    expect(out).toContain('<textarea');
    expect(visibleText(out)).not.toContain('filed by a colleague');
  });

  it('renders the page as today for a member without the code', async () => {
    permissions = [];
    const out = await render();
    expect(out).toContain('<textarea');
    expect(visibleText(out)).toContain('Add a message');
  });
});
