import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type {
  CheckoutPayer,
  CustomerRelatedPayerLink,
  PaidOrderSummary,
  RelatedPayerIncomingRequest,
  RelatedPayerSentRequest,
} from '@endora-commerce/contracts';
import type { MeResult } from '../../lib/api/account';
import type { PaymentMethodSummary } from '../../lib/api/methods';

/**
 * `specs/182-related-payers/` — every storefront read the feature added, through the **real**
 * transport (`apiGetAuthed`, which already unwraps `{ data }`), with only `fetch` stubbed to answer
 * as the backend does. The earlier tests replaced the read helpers wholesale, so none of them saw
 * the helpers read `.data` a second time — `undefined` on a live backend, and the *Payers* page
 * crashing on `awaiting.filter` (owner's manual test, 2026-11-20). The paid-orders list keeps its
 * `pagination` envelope, which `apiGetAuthed` drops, so the cursor is followed end to end here.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/account',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getAnonCartCookie: async () => undefined,
  clearSessionCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { locale: 'en-US', salesChannelCode: 'pl_retail' },
    modules: { isPresent: () => true, presentIds: [], absentIds: [] },
    urlState: { languages: [], aliases: [], current: 'en-US' },
  }),
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () =>
    ({
      customerAccount: {
        id: 'acc-1',
        organizationId: 'org-1',
        email: 'anna@example.com',
        firstName: 'Anna',
        lastName: 'Nowak',
        organizationRole: { id: 'r1', kind: 'administrator', name: 'Administrator' },
        permissions: [],
        emailVerifiedAt: null,
        twoFactorEnabled: false,
      },
      organization: { id: 'org-1', name: 'Acme', isPersonal: false },
      impersonation: null,
    }) as unknown as MeResult,
}));

const api = await import('../../lib/api/related-payers');
const { listPaymentMethodsForPayer } = await import('../../lib/api/methods');
const { setCartBuyingFor } = await import('../../lib/api/cart');
const { default: PayersPage } = await import('../../app/(account)/payers/page');
const { default: PaidOrdersPage } = await import('../../app/(account)/paid-orders/page');

const CTX = { locale: 'en-US', salesChannelCode: 'pl_retail' };

const LINK = {
  id: '00000000-0000-4000-8000-0000000000c1',
  organizationId: '00000000-0000-4000-8000-0000000000b2',
  name: 'Payer SA',
  taxId: 'PL1234567890',
  state: 'active',
  addressScope: 'all',
  billingAddressId: null,
  validFrom: null,
  validTo: null,
  commercialTerms: 'buyer',
} satisfies CustomerRelatedPayerLink;

const SENT = {
  id: '00000000-0000-4000-8000-0000000000d1',
  direction: 'buyer_request',
  taxId: 'PL5260001246',
  contactEmail: 'contact@example.com',
  comment: null,
  state: 'pending',
  rejectionReason: null,
  createdAt: '2026-11-19T09:00:00.000Z',
  decidedAt: null,
  expiresAt: '2026-12-19T09:00:00.000Z',
} satisfies RelatedPayerSentRequest;

const INCOMING = {
  id: '00000000-0000-4000-8000-0000000000d3',
  direction: 'buyer_request',
  senderOrganizationId: '00000000-0000-4000-8000-0000000000b1',
  senderName: 'Buyer X',
  senderTaxId: 'PL9990001111',
  comment: null,
  createdAt: '2026-11-19T09:00:00.000Z',
  expiresAt: '2026-12-19T09:00:00.000Z',
} satisfies RelatedPayerIncomingRequest;

const INVITATION = { ...INCOMING, id: '00000000-0000-4000-8000-0000000000d4', direction: 'payer_invitation', senderName: 'Investor Y' } satisfies RelatedPayerIncomingRequest;

const ORDER = (n: number): PaidOrderSummary => ({
  id: `00000000-0000-4000-8000-0000000000e${n}`,
  businessId: `ORD-18${n}`,
  placedAt: '2026-11-18T10:00:00.000Z',
  status: 'new',
  statusLabel: 'New',
  paymentStatus: 'awaiting_payment',
  buyerOrganizationId: '00000000-0000-4000-8000-0000000000b1',
  buyerName: 'Buyer X',
  total: 49.18,
  currency: 'PLN',
});

const PAYER = { payerOrganizationId: '00000000-0000-4000-8000-0000000000b2', name: 'Payer SA' } as unknown as CheckoutPayer;
const METHOD = { id: 'pm-1', code: 'bank_transfer', name: 'Bank transfer' } as unknown as PaymentMethodSummary;

/** What the backend answers, by path (query string included); an unlisted path answers `404`. */
let routes: Record<string, { status: number; body: unknown }> = {};
let requested: Array<{ url: string; cookie: string | undefined }> = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  routes = {};
  requested = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const key = `${parsed.pathname}${parsed.search}`;
    requested.push({ url: key, cookie: (init?.headers as Record<string, string> | undefined)?.['Cookie'] });
    const route = routes[key] ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    return new Response(JSON.stringify(route.body), { status: route.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ok = (body: unknown) => ({ status: 200, body });

describe('related payers reads, through the real transport', () => {
  it('listCheckoutPayers answers the payers array', async () => {
    routes['/api/v1/checkout/payers'] = ok({ data: [PAYER] });
    expect(await api.listCheckoutPayers('session-cookie', CTX)).toEqual([PAYER]);
    expect(requested[0]!.cookie).toBe('b2b_session=session-cookie');
  });

  it('listCheckoutPayers answers none where the capability is off on the channel (404)', async () => {
    expect(await api.listCheckoutPayers('session-cookie', CTX)).toEqual([]);
  });

  it('listPaidOrders answers the page with its cursor, and follows it', async () => {
    routes['/api/v1/account/paid-orders'] = ok({ data: [ORDER(1)], pagination: { cursor: 'c-2', hasMore: true, limit: 20 } });
    routes['/api/v1/account/paid-orders?cursor=c-2'] = ok({ data: [ORDER(2)], pagination: { cursor: null, hasMore: false, limit: 20 } });

    expect(await api.listPaidOrders('session-cookie', CTX)).toEqual({ orders: [ORDER(1)], cursor: 'c-2', hasMore: true });
    expect(await api.listPaidOrders('session-cookie', CTX, 'c-2')).toEqual({ orders: [ORDER(2)], cursor: null, hasMore: false });
  });

  it('listPaidOrders answers null when the list is not the caller\'s (404)', async () => {
    expect(await api.listPaidOrders('session-cookie', CTX)).toBeNull();
  });

  it('getPaidOrder answers the order', async () => {
    const order = { ...ORDER(1), items: [] };
    routes[`/api/v1/account/paid-orders/${order.id}`] = ok({ data: order });
    expect(await api.getPaidOrder('session-cookie', CTX, order.id)).toEqual(order);
    expect(await api.getPaidOrder('session-cookie', CTX, '00000000-0000-4000-8000-000000000999')).toBeNull();
  });

  it('the four Payers lists answer their arrays, and none when refused', async () => {
    routes['/api/v1/account/related-payers'] = ok({ data: [LINK] });
    routes['/api/v1/account/related-payers/requests'] = ok({ data: [SENT] });
    routes['/api/v1/account/related-payers/incoming'] = ok({ data: [INCOMING] });
    routes['/api/v1/account/payees'] = { status: 403, body: { error: { code: 'FORBIDDEN', message: 'no' } } };

    expect(await api.listPayerLinks('session-cookie', CTX)).toEqual([LINK]);
    expect(await api.listSentPayerRequests('session-cookie', CTX)).toEqual([SENT]);
    expect(await api.listIncomingPayerRequests('session-cookie', CTX)).toEqual([INCOMING]);
    expect(await api.listPayees('session-cookie', CTX)).toEqual([]);
  });

  it('listPayeeInvitations answers the invitations, and null when the route is absent', async () => {
    expect(await api.listPayeeInvitations('session-cookie', CTX)).toBeNull();
    routes['/api/v1/account/payees/invitations'] = ok({ data: [SENT] });
    expect(await api.listPayeeInvitations('session-cookie', CTX)).toEqual([SENT]);
  });

  it('listPaymentMethodsForPayer answers the payer\'s methods', async () => {
    routes[`/api/v1/payment-methods?payerOrganizationId=${PAYER.payerOrganizationId}`] = ok({ data: [METHOD] });
    expect(await listPaymentMethodsForPayer('session-cookie', CTX, PAYER.payerOrganizationId)).toEqual([METHOD]);
  });

  it('setCartBuyingFor counts the repriced and the unpriced lines of the cart the API answers', async () => {
    const line = (before: number | null, after: number | null, unpriced = false) => ({
      before: before === null ? null : { amount: before },
      after: after === null ? null : { amount: after },
      unpriced,
    });
    routes['/api/v1/cart/buying-for'] = ok({
      data: { id: 'cart-1', repricing: { lines: [line(10, 9), line(5, 5), line(7, null, true)] } },
    });
    expect(await setCartBuyingFor({ session: 'session-cookie' }, PAYER.payerOrganizationId, CTX)).toEqual({ repriced: 1, unpriced: 1 });
  });
});

describe('the pages, on what the backend answers', () => {
  it('the Payers page renders on empty lists — the owner\'s crash (`awaiting.filter` of undefined)', async () => {
    routes['/api/v1/related-payers/availability'] = ok({ data: { enabled: true } });
    for (const path of [
      '/api/v1/account/related-payers',
      '/api/v1/account/related-payers/requests',
      '/api/v1/account/related-payers/incoming',
      '/api/v1/account/payees',
      '/api/v1/account/payees/invitations',
    ]) {
      routes[path] = ok({ data: [] });
    }
    const html = renderToString(<>{(await PayersPage({ searchParams: Promise.resolve({}) })) as ReactNode}</>);
    expect(html).toContain('Ask a company to pay for our orders');
  });

  it('the Payers page splits what awaits it into requests and invitations', async () => {
    routes['/api/v1/related-payers/availability'] = ok({ data: { enabled: true } });
    routes['/api/v1/account/related-payers'] = ok({ data: [LINK] });
    routes['/api/v1/account/related-payers/requests'] = ok({ data: [] });
    routes['/api/v1/account/related-payers/incoming'] = ok({ data: [INCOMING, INVITATION] });
    routes['/api/v1/account/payees'] = ok({ data: [] });
    routes['/api/v1/account/payees/invitations'] = ok({ data: [] });
    const html = renderToString(<>{(await PayersPage({ searchParams: Promise.resolve({}) })) as ReactNode}</>);
    expect(html).toContain('Payer SA');
    expect(html).toContain('Buyer X');
    expect(html).toContain('Investor Y');
  });

  it('Orders we pay for links to the next page by the cursor the API answered, and the next page reads it', async () => {
    routes['/api/v1/account/paid-orders'] = ok({ data: [ORDER(1)], pagination: { cursor: 'c-2', hasMore: true, limit: 20 } });
    routes['/api/v1/account/paid-orders?cursor=c-2'] = ok({ data: [ORDER(2)], pagination: { cursor: null, hasMore: false, limit: 20 } });

    const first = renderToString(<>{(await PaidOrdersPage({ searchParams: Promise.resolve({}) })) as ReactNode}</>);
    expect(first).toContain('ORD-181');
    expect(first).toContain('href="/paid-orders?cursor=c-2"');

    const second = renderToString(<>{(await PaidOrdersPage({ searchParams: Promise.resolve({ cursor: 'c-2' }) })) as ReactNode}</>);
    expect(second).toContain('ORD-182');
    expect(second).not.toContain('?cursor=');
  });
});
