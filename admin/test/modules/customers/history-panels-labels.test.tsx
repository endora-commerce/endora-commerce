import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1476 (SALES-11), under the pattern of #1434 (DS-17) — the customer
 * detail's history panels printed the raw status of each order, quote request
 * and cart, and the addresses card the raw address kind.
 *
 * The labels are this module's own copy (a module does not read another
 * module's bundle), except the order status, whose per-language name the
 * orders list row already carries.
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { OrdersPanel, QuoteRequestsPanel, CartsPanel } = await import(
  '../../../../packages/modules/customers/src/admin/panels/HistoryPanels'
);
const { AddressesPanel } = await import('../../../../packages/modules/customers/src/admin/panels/ManagementPanels');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const CATALOGUES = {
  en: { customers: read('../packages/modules/customers/i18n/en.json'), core: read('../packages/modules/_i18n/i18n/en.json') },
  pl: { customers: read('../packages/modules/customers/i18n/pl.json'), core: read('../packages/modules/_i18n/i18n/pl.json') },
};

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const RFQ_STATUSES = ['Created from admin', 'Pending', 'Canceled', 'Approved', 'Completed', 'Expired'];
const RFQ_KEYS = ['createdFromAdmin', 'pending', 'canceled', 'approved', 'completed', 'expired'];
const CART_STATUSES = ['active', 'abandoned', 'completed', 'rejected'];

function render(language: 'en' | 'pl', ui: ReactElement): void {
  renderWithI18n(<MemoryRouter>{ui}</MemoryRouter>, CATALOGUES[language], { language });
}

beforeEach(() => getSpy.mockReset());
afterEach(() => cleanup());

describe.each(['en', 'pl'] as const)('customer history panel labels (%s)', (language) => {
  const { customers: own } = CATALOGUES[language];

  it('ships a label for every quote request and cart status, and both address kinds', () => {
    for (const key of RFQ_KEYS) expect(own[`detail.rfqs.status.${key}`], key).toBeTruthy();
    for (const status of CART_STATUSES) expect(own[`detail.carts.status.${status}`], status).toBeTruthy();
    for (const kind of ['delivery', 'billing']) expect(own[`detail.addresses.kind.${kind}`], kind).toBeTruthy();
  });

  it("names an order's status in the admin's language", async () => {
    getSpy.mockResolvedValue({
      data: [
        {
          id: 'o1',
          businessId: 'ORD-1',
          status: 'in_progress',
          statusName: { en: 'In progress', pl: 'W realizacji' },
          total: 10,
          currency: 'PLN',
          placedAt: '2026-05-22T12:00:00Z',
        },
      ],
    });
    render(language, <OrdersPanel customerId={CUSTOMER_ID} />);
    expect(await screen.findByText(language === 'pl' ? 'W realizacji' : 'In progress')).toBeInTheDocument();
    expect(screen.queryByText('in_progress')).not.toBeInTheDocument();
  });

  it("labels each quote request's status", async () => {
    getSpy.mockResolvedValue({
      data: RFQ_STATUSES.map((status, i) => ({ id: `r${i}`, businessId: `RFQ-${i}`, status })),
    });
    render(language, <QuoteRequestsPanel customerId={CUSTOMER_ID} />);
    await screen.findByText('RFQ-0');
    for (const key of RFQ_KEYS) expect(screen.getByText(own[`detail.rfqs.status.${key}`]!)).toBeInTheDocument();
    if (language === 'pl') for (const raw of RFQ_STATUSES) expect(screen.queryByText(raw)).not.toBeInTheDocument();
  });

  it("labels each cart's status", async () => {
    getSpy.mockResolvedValue({
      data: {
        current: { id: 'c1', status: 'active', items: [] },
        abandoned: [{ id: 'c2', status: 'abandoned', items: [] }],
      },
    });
    render(language, <CartsPanel customerId={CUSTOMER_ID} />);
    expect(await screen.findByText(new RegExp(own['detail.carts.status.active']!))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(own['detail.carts.status.abandoned']!))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bactive\b|\babandoned\b/);
  });

  it('labels the address kind', async () => {
    getSpy.mockResolvedValue({
      data: {
        organization: [
          {
            id: 'a1',
            kind: 'billing',
            recipientName: 'Anna Nowak',
            street: 'ul. Długa 5',
            city: 'Gdańsk',
            postalCode: '80-001',
            country: 'PL',
            isDefault: false,
          },
        ],
        personal: [],
      },
    });
    render(language, <AddressesPanel customerId={CUSTOMER_ID} onChanged={(): void => undefined} />);
    expect(await screen.findByText(own['detail.addresses.kind.billing']!)).toBeInTheDocument();
    expect(screen.queryByText('billing')).not.toBeInTheDocument();
  });
});
