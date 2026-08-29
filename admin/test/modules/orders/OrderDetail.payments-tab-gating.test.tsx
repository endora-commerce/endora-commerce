import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * The payments tab is gated, and it was gated by nothing.
 *
 * `payments` now owns `payments:read` / `payments:write` instead of enforcing
 * the catalogue's codes, and `GET /api/v1/admin/orders/:id/payments` is
 * `payments:read`. The tab was mounted unconditionally, so a role without the
 * code saw the tab, clicked it and got a 403 inside the panel — a surface
 * advertised and then refused, which is what `useSurfaceVisibility` exists to
 * stop everywhere else in the admin (issue #230, D-166).
 *
 * Both axes of that predicate matter here and neither is decorative:
 *
 *  * **permission** — the subject of this change;
 *  * **module presence** — Constitution XVII item 5 says a module that is off
 *    contributes no tab, and `payments` carries an activation control
 *    (`payments.enabled`). The order screen belongs to `orders`, so switching
 *    `payments` off used to leave its tab on someone else's screen answering
 *    503.
 *
 * The gate is at the tab strip rather than inside the panel, because the
 * refusal has to be an **absent tab** and the tab button is rendered by
 * `OrderDetail`.
 */

const permissions = new Set<string>();
const presentModules = new Set<string>(['orders', 'payments']);

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    hasPermission: (code: string): boolean => permissions.has(code) || permissions.has('*'),
  }),
}));

vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: [],
    isPresent: (id: string): boolean => presentModules.has(id),
    presenceOf: () => undefined,
    degraded: false,
    isLoading: false,
    error: null,
    refresh: async (): Promise<void> => {},
  }),
}));

const getSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/lib/api-client')>('@/lib/api-client');
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

const { OrderDetail } = await import('../../../src/modules/orders/OrderDetail');

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

const BUNDLE = passthroughBundle('core', [
  'orderDetail.tabs.overview',
  'orderDetail.tabs.payment',
  'orderDetail.tabs.delivery',
  'orderDetail.tabs.comments',
]);

function renderDetail(): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: {
          statuses: [{ code: 'on_hold', name: { en: 'On Hold' }, isTerminal: false }],
          transitions: [],
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
  renderWithI18n(
    <MemoryRouter initialEntries={['/orders/o1']}>
      <Routes>
        <Route path="/orders/:id" element={<OrderDetail />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
}

const tabNames = (): string[] =>
  screen.getAllByRole('tab').map((tab) => tab.textContent?.trim() ?? '');

beforeEach(() => {
  cleanup();
  getSpy.mockReset();
  permissions.clear();
  presentModules.clear();
  presentModules.add('orders');
  presentModules.add('payments');
});

describe('OrderDetail — the payments tab is gated on payments:read', () => {
  it('offers the payments tab to a role holding payments:read', async () => {
    permissions.add('orders:read');
    permissions.add('payments:read');
    renderDetail();

    await waitFor(() => expect(tabNames().length).toBeGreaterThan(0));
    expect(tabNames()).toContain('orderDetail.tabs.payment');
  });

  it('omits the payments tab entirely from a role without payments:read', async () => {
    permissions.add('orders:read');
    renderDetail();

    await waitFor(() => expect(tabNames().length).toBeGreaterThan(0));
    // Absent, not disabled: the operator is never shown a destination that
    // would answer 403.
    expect(tabNames()).not.toContain('orderDetail.tabs.payment');
    // The rest of the screen is untouched — this is a tab gate, not a page gate.
    expect(tabNames()).toContain('orderDetail.tabs.overview');
    expect(tabNames()).toContain('orderDetail.tabs.delivery');
  });

  it('omits the payments tab while the payments module is switched off', async () => {
    permissions.add('*');
    presentModules.delete('payments');
    renderDetail();

    await waitFor(() => expect(tabNames().length).toBeGreaterThan(0));
    expect(tabNames()).not.toContain('orderDetail.tabs.payment');
  });
});
