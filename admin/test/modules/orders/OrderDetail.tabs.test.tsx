import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1445 (UX audit 2026-11-17, DS-12) — the order's sections are the kit's
 * `RecordTabs`, not a hand-written strip: the strip is named, one tab is in the
 * tab order (roving `tabindex`), ←/→/Home/End move and select, every tab
 * controls the one panel and the panel is labelled by the selected tab.
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

const ORDER = {
  id: 'o1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'on_hold',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'DM' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'PM' }, kind: 'gateway' },
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

const BUNDLE = {
  ...passthroughBundle('core', [
    'orderDetail.tabs.overview',
    'orderDetail.tabs.payment',
    'orderDetail.tabs.delivery',
    'orderDetail.tabs.comments',
    'orderDetail.sections.comments',
  ]),
  ...passthroughBundle('orders', ['detail.tabs.label']),
};

function renderDetail(withPayments: boolean): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: { statuses: [{ code: 'on_hold', name: { en: 'On Hold' }, isTerminal: false }], transitions: [] },
      });
    }
    return Promise.resolve({ data: [] });
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['orders', 'payments'] }),
        contributions: withPayments ? [{ moduleId: 'payments', contributions: payments.contributions }] : [],
      },
    ),
    BUNDLE,
  );
}

beforeEach(() => {
  cleanup();
  getSpy.mockReset();
});

describe('OrderDetail — the sections are the kit RecordTabs (issue #1445)', () => {
  it('names the strip and links every tab to the one panel', async () => {
    renderDetail(true);
    const list = await screen.findByRole('tablist', { name: 'detail.tabs.label' });
    expect(list).toHaveClass('b2b-tabs');
    const overview = screen.getByRole('tab', { name: 'orderDetail.tabs.overview' });
    expect(overview.id).toBe('order-detail-tab-overview');
    expect(overview).toHaveAttribute('aria-selected', 'true');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-controls', 'order-detail-tabpanel');
    }
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe('order-detail-tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'order-detail-tab-overview');
  });

  it('keeps one tab in the tab order and moves with the arrow keys, Home and End', async () => {
    renderDetail(true);
    const overview = await screen.findByRole('tab', { name: 'orderDetail.tabs.overview' });
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toEqual([overview]);

    const user = userEvent.setup();
    overview.focus();
    await user.keyboard('{ArrowRight}');
    const payment = screen.getByRole('tab', { name: 'orderDetail.tabs.payment' });
    expect(payment).toHaveFocus();
    expect(payment).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'order-detail-tab-payment');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'orderDetail.tabs.comments' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'orderDetail.sections.comments' })).toBeInTheDocument();

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'orderDetail.tabs.overview' })).toHaveFocus();
  });

  it('skips the absent Payment tab: Overview → Delivery', async () => {
    renderDetail(false);
    const overview = await screen.findByRole('tab', { name: 'orderDetail.tabs.overview' });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(3));
    const user = userEvent.setup();
    overview.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'orderDetail.tabs.delivery' })).toHaveFocus();
  });
});
