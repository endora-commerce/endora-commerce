import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import en from '../../../../packages/modules/orders/i18n/en.json';
import pl from '../../../../packages/modules/orders/i18n/pl.json';

/**
 * Issue #1030 — what each external system reported about an order, on the
 * order page: the system, its number for the order, a state badge and the
 * other system's own words. An operator answering a buyer's call reads
 * whether the order reached the ERP, under which number, or why it was
 * refused, without leaving the page.
 *
 * Asserted from the module's own shipped bundles in both languages, as the
 * pending-effects notice is: a key rendered raw would pass a key-shaped
 * assertion.
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

const ORDER = {
  id: 'o1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'DM' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'PM' }, kind: 'bank_transfer' },
  items: [],
  subtotal: 10,
  taxTotal: 0,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 10,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-05-22T12:00:00Z',
};

const REFERENCES = [
  {
    system: 'erp_connector',
    reference: 'ZS/2026/1042',
    state: 'synced',
    message: null,
    updatedAt: '2026-11-10T10:00:00.000Z',
  },
  {
    system: 'wms_connector',
    reference: null,
    state: 'error',
    message: 'Item 1042 is blocked for sale <b>now</b>',
    updatedAt: '2026-11-10T10:05:00.000Z',
  },
];

function serveOrder(externalReferences?: unknown): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') {
      return Promise.resolve({
        data: { ...ORDER, ...(externalReferences ? { externalReferences } : {}) },
      });
    }
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] },
      });
    }
    return Promise.resolve({ data: [] });
  });
}

function renderDetail(bundle: Record<string, string>): { unmount: () => void } {
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['orders', 'payments'] }),
      },
    ),
    { core: {}, orders: bundle },
  );
}

beforeEach(() => {
  getSpy.mockReset();
});

describe('OrderDetail — external references (issue #1030)', () => {
  it('lists each system with its reference, a state badge and its message', async () => {
    serveOrder(REFERENCES);

    renderDetail(en);

    const section = await screen.findByTestId('order-external-references');
    expect(section).toHaveTextContent(en['externalReferences.title']);
    const erp = within(section).getByTestId('order-external-reference-erp_connector');
    expect(erp).toHaveTextContent('erp_connector');
    expect(erp).toHaveTextContent('ZS/2026/1042');
    expect(erp).toHaveTextContent(en['externalReferences.state.synced']);

    const wms = within(section).getByTestId('order-external-reference-wms_connector');
    expect(wms).toHaveTextContent(en['externalReferences.state.error']);
    expect(wms).toHaveTextContent(en['externalReferences.noReference']);
    // The other system's words are shown as text, never as markup.
    expect(wms).toHaveTextContent('Item 1042 is blocked for sale <b>now</b>');
    expect(wms.querySelector('b')).toBeNull();
  });

  it('says the same in Polish', async () => {
    serveOrder(REFERENCES);

    renderDetail(pl);

    const section = await screen.findByTestId('order-external-references');
    expect(section).toHaveTextContent(pl['externalReferences.title']);
    expect(within(section).getByTestId('order-external-reference-erp_connector')).toHaveTextContent(
      pl['externalReferences.state.synced'],
    );
    expect(within(section).getByTestId('order-external-reference-wms_connector')).toHaveTextContent(
      pl['externalReferences.state.error'],
    );
  });

  it('says so when no external system has reported, and for a reply without the field', async () => {
    for (const references of [[], undefined]) {
      serveOrder(references);
      const { unmount } = renderDetail(en);
      const section = await screen.findByTestId('order-external-references');
      expect(section).toHaveTextContent(en['externalReferences.empty']);
      unmount();
    }
  });
});
