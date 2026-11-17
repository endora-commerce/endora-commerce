import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1477 (SALES-20) — the admin order detail showed technical values
 * where names exist: the order's UUID in the header, the delivery method by
 * its code, the payment method by its code and kind (`bank_transfer
 * (bank_transfer)`), and the Organization's or the customer's UUID when their
 * details were not on the order.
 *
 * Rendered against the shipped `core` catalogue in `en` and `pl`.
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { OrderDetail } = await import('../../../../packages/modules/orders/src/admin/pages/OrderDetail');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const CATALOGUES = {
  en: { core: read('../packages/modules/_i18n/i18n/en.json') },
  pl: { core: read('../packages/modules/_i18n/i18n/pl.json') },
};

const ORDER_ID = '00000000-0000-4000-8000-0000000000d1';
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORDER_ID,
    businessId: 'ORD-0001',
    organizationId: ORG_ID,
    placedByCustomerAccountId: CUSTOMER_ID,
    organization: null,
    customer: null,
    status: 'new',
    paymentStatus: 'awaiting_payment',
    deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    // The snapshot stores the name as the buyer saw it, a string.
    deliveryMethod: { code: 'dpd_courier', name: 'DPD courier', cost: 0 },
    paymentMethod: { code: 'bank_transfer', name: 'Bank transfer', kind: 'bank_transfer' },
    items: [],
    subtotal: 10,
    taxTotal: 0,
    discountTotal: 0,
    deliveryTotal: 0,
    total: 10,
    currency: 'PLN',
    customerNote: null,
    placedAt: '2026-05-22T12:00:00Z',
    ...overrides,
  };
}

function renderDetail(language: 'en' | 'pl', payload: Record<string, unknown>): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/orders/${ORDER_ID}`) return Promise.resolve({ data: payload });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] } });
    }
    return Promise.resolve({ data: [] });
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/orders/${ORDER_ID}`]}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['orders', 'payments'] }) },
    ),
    CATALOGUES[language],
    { language },
  );
}

beforeEach(() => getSpy.mockReset());

describe.each(['en', 'pl'] as const)('OrderDetail — names, not technical values (%s)', (language) => {
  const { core } = CATALOGUES[language];

  it('keeps the UUID out of the header', async () => {
    renderDetail(language, order());
    await screen.findByText('DPD courier');
    expect(document.querySelector('header')?.textContent).not.toContain(ORDER_ID);
  });

  it('names the delivery and payment methods instead of their codes', async () => {
    renderDetail(language, order());
    expect(await screen.findByText('DPD courier')).toBeInTheDocument();
    expect(screen.getByText('Bank transfer')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('dpd_courier');
    expect(document.body.textContent).not.toContain('bank_transfer');
  });

  it("reads a per-language name map in the admin's language", async () => {
    renderDetail(
      language,
      order({
        deliveryMethod: { code: 'dpd_courier', name: { en: 'DPD courier', pl: 'Kurier DPD' }, cost: 0 },
      }),
    );
    expect(await screen.findByText(language === 'pl' ? 'Kurier DPD' : 'DPD courier')).toBeInTheDocument();
  });

  it('says the parties are unavailable rather than printing their UUIDs', async () => {
    renderDetail(language, order());
    await screen.findByText('DPD courier');
    expect(document.body.textContent).not.toContain(ORG_ID);
    expect(document.body.textContent).not.toContain(CUSTOMER_ID);
    expect(screen.getByText(core['orderDetail.org.unavailable']!)).toBeInTheDocument();
    expect(screen.getByText(core['orderDetail.customer.unavailable']!)).toBeInTheDocument();
  });
});
