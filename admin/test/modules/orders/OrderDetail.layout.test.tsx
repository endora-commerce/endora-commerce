import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1545 (UX audit 2026-11-17, SALES-21) — the Overview tab read Status,
 * External references, Organization, Customer, Delivery and Billing before it
 * reached the items, the block an operator opens an order for. Items and totals
 * now come first (Serial Position), the parties and both addresses are one
 * section of one two-column description list instead of four cards (Common
 * Region), the Payment tab says it holds the invoices too, and the Comments tab
 * says how many comments it holds.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OrderDetail } = await import('../../../../packages/modules/orders/src/admin/pages/OrderDetail');
const payments = await import('@endora-commerce/mod-payments/admin');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const corePl = read('../packages/modules/_i18n/i18n/pl.json');
const ordersEn = read('../packages/modules/orders/i18n/en.json');
const ordersPl = read('../packages/modules/orders/i18n/pl.json');
const C = (key: string): string => {
  const value = coreEn[key];
  if (value === undefined) throw new Error(`missing core key ${key}`);
  return value;
};
const O = (key: string): string => {
  const value = ordersEn[key];
  if (value === undefined) throw new Error(`missing orders key ${key}`);
  return value;
};

const ORDER = {
  id: 'o1',
  businessId: 'ORD-1545',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  organization: {
    id: '00000000-0000-4000-8000-0000000000a1',
    name: 'Acme',
    legalName: null,
    taxId: '5260250274',
    isPersonal: false,
    vatStatus: 'vat_payer',
  },
  customer: { firstName: 'Ola', lastName: 'Kowal', email: 'ola@acme.test' },
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { recipientName: 'Ola Kowal', street: 'Dock 4', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
  billingAddress: { companyName: 'Acme Sp. z o.o.', street: 'Main 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'Courier' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'Transfer' }, kind: 'bank_transfer' },
  items: [
    {
      id: 'i1',
      productId: 'p1',
      productSnapshot: { name: 'Pallet jack', sku: 'PJ-1' },
      variantSnapshot: null,
      quantity: 2,
      unitPrice: 5,
      taxRate: 0.23,
      lineTotal: 10,
    },
  ],
  subtotal: 10,
  taxTotal: 2.3,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 12.3,
  currency: 'PLN',
  customerNote: 'Deliver before noon.',
  placedAt: '2026-05-22T12:00:00Z',
};

const COMMENT = {
  id: 'c1',
  body: 'Called the buyer.',
  isCustomerVisible: false,
  authorCustomerAccountId: null,
  systemNote: null,
  createdAt: '2026-05-22T13:00:00Z',
};

function renderDetail(comments: unknown[], language: 'en' | 'pl' = 'en'): HTMLElement {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] },
      });
    }
    if (path === '/api/v1/admin/orders/o1/comments') return Promise.resolve({ data: comments });
    return Promise.resolve({ data: [] });
  });
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['orders', 'payments'] }),
        contributions: [{ moduleId: 'payments', contributions: payments.contributions }],
      },
    ),
    { ...shippedCoreBundle(language), ...shippedModuleBundle('orders', language) },
    { language },
  );
  return container;
}

beforeEach(() => {
  cleanup();
  getSpy.mockReset();
});

describe('OrderDetail — Overview leads with the items (issue #1545, SALES-21)', () => {
  it('puts Items and totals first, then the buyer note, the parties and addresses, then Status', async () => {
    renderDetail([]);
    const panel = await screen.findByRole('tabpanel');
    await within(panel).findByText('Pallet jack');
    const headings = within(panel)
      .getAllByRole('heading')
      .map((heading) => heading.textContent);
    const order = [
      C('orderDetail.sections.items'),
      C('orderDetail.sections.buyerNote'),
      O('detail.sections.parties'),
      C('orderDetail.sections.status'),
    ].map((title) => headings.indexOf(title));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBe(0);
  });

  it('shows the parties and both addresses as one two-column description list', async () => {
    renderDetail([]);
    const heading = await screen.findByRole('heading', { name: O('detail.sections.parties') });
    const section = heading.closest('section') ?? heading.parentElement!.parentElement!;
    const list = section.querySelector('dl');
    expect(list).not.toBeNull();
    expect(list).toHaveClass('md:grid-cols-2');
    const terms = Array.from(list!.querySelectorAll('dt')).map((term) => term.textContent);
    expect(terms).toEqual([
      C('orderDetail.sections.organization'),
      C('orderDetail.sections.customer'),
      C('orderDetail.sections.delivery'),
      C('orderDetail.sections.billing'),
    ]);
    // The four cards they were are gone: no heading of their own.
    for (const old of ['organization', 'customer', 'delivery', 'billing']) {
      expect(screen.queryByRole('heading', { name: C(`orderDetail.sections.${old}`) })).toBeNull();
    }
    const definitions = within(list!);
    expect(definitions.getByText('Acme')).toBeInTheDocument();
    expect(definitions.getByText('ola@acme.test')).toBeInTheDocument();
    expect(definitions.getByText(/Dock 4/)).toBeInTheDocument();
    expect(definitions.getByText(/Acme Sp\. z o\.o\./)).toBeInTheDocument();
  });

  it('passes axe on the Overview', async () => {
    const container = renderDetail([COMMENT]);
    await screen.findByText('Pallet jack');
    await expectNoAxeViolations(container);
  });
});

describe('OrderDetail — tab labels (issue #1545, SALES-21)', () => {
  it('names the Payment tab "Payment & invoices", in English and Polish', async () => {
    expect(C('orderDetail.tabs.payment')).toBe('Payment & invoices');
    expect(corePl['orderDetail.tabs.payment']).toBe('Płatności i faktury');
    renderDetail([]);
    expect(await screen.findByRole('tab', { name: 'Payment & invoices' })).toBeInTheDocument();
  });

  it('counts the comments in the Comments tab', async () => {
    renderDetail([COMMENT, { ...COMMENT, id: 'c2' }, { ...COMMENT, id: 'c3' }]);
    const tab = await screen.findByRole('tab', { name: new RegExp(`^${C('orderDetail.tabs.comments')}`) });
    await waitFor(() => expect(within(tab).getByText('3')).toBeInTheDocument());
    expect(tab).toHaveAccessibleName(
      C('common.tabs.counted').replace('{label}', C('orderDetail.tabs.comments')).replace('{count}', '3'),
    );
    await userEvent.click(tab);
    expect(screen.getAllByTestId('order-comment')).toHaveLength(3);
  });

  it('shows no count while the order has no comments', async () => {
    renderDetail([]);
    const tab = await screen.findByRole('tab', { name: C('orderDetail.tabs.comments') });
    expect(tab.textContent).toBe(C('orderDetail.tabs.comments'));
  });

  it('ships the parties section title in Polish', () => {
    expect(ordersPl['detail.sections.parties']).toBe('Klient i adresy');
  });
});
