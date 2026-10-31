import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { RfqDetail, RfqSummary } from '../../../lib/api/rfq';
import { POLISH_DIACRITIC, visibleText, withoutZloty } from './text';

/**
 * Issue #85 — the account's quote-request pages render the shop's language.
 *
 * Both pages were Polish-only: an English shop showed "Zapytania ofertowe",
 * "Oczekuje akceptacji" and Polish history events. Each is rendered here in
 * `en-US` and `pl-PL`, through the page component the router calls.
 */

let locale = 'en-US';

const summary: RfqSummary = {
  id: '11111111-2222-4333-8444-555555555555',
  businessId: 'RFQ-0001',
  organizationId: 'org-1',
  customerAccountId: 'acc-1',
  status: 'Pending',
  awaitingCustomerRevisionAcceptance: false,
  lineCount: 2,
  totalAtCustomerPrice: null,
  totalAtAgreedPrice: null,
  currency: 'PLN',
  submittedAt: '2026-10-01T10:00:00.000Z',
  expiresAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  version: 1,
};

const detail: RfqDetail = {
  id: summary.id,
  businessId: 'RFQ-0001',
  organizationId: 'org-1',
  customerAccountId: 'acc-1',
  status: 'Approved',
  awaitingCustomerRevisionAcceptance: false,
  currentRevisionNumber: 1,
  lastCustomerSeenRevisionNumber: 1,
  headerNote: 'Deliver on Monday',
  cancellationReason: null,
  items: [
    {
      id: 'l1',
      productId: 'p1',
      productName: 'Widget',
      productSlug: 'widget',
      variantId: null,
      variantLabel: null,
      quantity: 2,
      desiredUnitPrice: 10,
      agreedUnitPrice: 9,
      lineNote: null,
      lineCurrency: 'PLN',
      discountPercent: null,
    },
  ],
  events: [
    {
      id: 'e1',
      eventType: 'customer-accepted-revision',
      actorCustomerAccountId: null,
      actorRoleLabel: null,
      payload: {},
      revisionId: null,
      createdAt: '2026-10-02T10:00:00.000Z',
    },
  ],
  comparisonAgainstLastSeen: null,
  submittedAt: '2026-10-01T10:00:00.000Z',
  approvedAt: null,
  canceledAt: null,
  completedAt: null,
  expiredAt: null,
  expiresAt: null,
  convertedOrderId: null,
  taxRate: 0.23,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  version: 1,
};

let rows: RfqSummary[] = [];

vi.mock('../../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../../lib/api/rfq', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api/rfq')>('../../../lib/api/rfq');
  return { ...actual, listRfqs: async () => rows, getRfqById: async () => detail };
});

async function renderList(): Promise<string> {
  const { default: Page } = await import('../../../app/(account)/quote-requests/page');
  return visibleText(renderToString((await Page()) as React.ReactElement));
}

async function renderDetail(): Promise<string> {
  const { default: Page } = await import('../../../app/(account)/quote-requests/[id]/page');
  const element = await Page({ params: Promise.resolve({ id: detail.id }), searchParams: Promise.resolve({}) });
  return visibleText(renderToString(element as React.ReactElement));
}

describe('account quote-request list — the shop language (issue #85)', () => {
  beforeEach(() => {
    rows = [];
  });

  it('renders the empty list in English', async () => {
    locale = 'en-US';
    const text = await renderList();
    expect(text).toContain('Quote requests');
    expect(text).toContain('Browse the catalog');
    expect(text).toContain('You don’t have any quote requests yet.');
    expect(text).not.toMatch(POLISH_DIACRITIC);
  });

  it('renders the empty list in Polish', async () => {
    locale = 'pl-PL';
    const text = await renderList();
    expect(text).toContain('Zapytania ofertowe');
    expect(text).toContain('Przeglądaj katalog');
    expect(text).toContain('Nie masz jeszcze żadnych zapytań ofertowych.');
  });

  it('renders the table headings and the status badge in both languages', async () => {
    rows = [summary, { ...summary, id: 'x', awaitingCustomerRevisionAcceptance: true }];
    locale = 'en-US';
    const en = await renderList();
    expect(en).toContain('Number Date Items Value Status');
    expect(en).toContain('Pending');
    expect(en).toContain('Awaiting your acceptance');
    expect(en).toContain('Details');
    expect(en).not.toMatch(POLISH_DIACRITIC);

    locale = 'pl-PL';
    const pl = await renderList();
    expect(pl).toContain('Numer Data Pozycji Wartość Status');
    expect(pl).toContain('Oczekuje akceptacji');
    expect(pl).toContain('Szczegóły');
  });
});

describe('account quote-request detail — the shop language (issue #85)', () => {
  it('renders the detail in English', async () => {
    locale = 'en-US';
    const text = await renderDetail();
    expect(text).toContain('← All quote requests');
    expect(text).toContain('Quote request #RFQ-0001');
    expect(text).toContain('Approved');
    expect(text).toContain('Notes: Deliver on Monday');
    expect(text).toContain('Product Quantity Requested price Agreed price Total');
    expect(text).toContain('Net total');
    expect(text).toContain('VAT (23%)');
    expect(text).toContain('Gross total');
    expect(text).toContain('Change history');
    expect(text).toContain('Customer accepted the changes');
    expect(text).toMatch(/Created \S/);
    expect(withoutZloty(text)).not.toMatch(POLISH_DIACRITIC);
  });

  it('renders the detail in Polish', async () => {
    locale = 'pl-PL';
    const text = await renderDetail();
    expect(text).toContain('← Lista zapytań');
    expect(text).toContain('Zapytanie #RFQ-0001');
    expect(text).toContain('Zatwierdzone');
    expect(text).toContain('Uwagi: Deliver on Monday');
    expect(text).toContain('Produkt Ilość Cena żądana Cena uzgodniona Razem');
    expect(text).toContain('Suma netto');
    expect(text).toContain('Suma brutto');
    expect(text).toContain('Historia zmian');
    expect(text).toContain('Klient zaakceptował zmiany');
    expect(text).toMatch(/Utworzone \S/);
  });
});
