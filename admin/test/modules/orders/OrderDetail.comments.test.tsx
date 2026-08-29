import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

const getSpy = vi.fn();
const postSpy = vi.fn();

/**
 * `OrderDetail` resolves the payments tab's visibility through
 * `useSurfaceVisibility`, which reads the auth and module-presence contexts.
 * This file is about neither, so both are stubbed permissive; the gate itself is
 * covered in `OrderDetail.payments-tab-gating.test.tsx`.
 */
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: [],
    isPresent: () => true,
    presenceOf: () => undefined,
    degraded: false,
    isLoading: false,
    error: null,
    refresh: async (): Promise<void> => {},
  }),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
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

const BUNDLE = passthroughBundle('core', [
  'orderDetail.tabs.comments',
  'orderDetail.comments.add',
  'orderDetail.comments.customerVisible',
  'orderDetail.comments.notify',
  'orderDetail.comments.internal',
  'orderDetail.reorder.action',
  'orderDetail.cloneToQuote.action',
]);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] } });
    }
    if (path === '/api/v1/admin/orders/o1/comments') {
      return Promise.resolve({
        data: [
          { id: 'c1', body: 'internal note', isCustomerVisible: false, notifyCustomer: false, authorAdminUserId: 'a1', authorCustomerAccountId: null, createdAt: '2026-05-22T12:30:00Z' },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockResolvedValue({ data: { id: 'c2' } });
});

function renderDetail(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/orders/o1']}>
      <Routes>
        <Route path="/orders/:id" element={<OrderDetail />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
}

describe('OrderDetail — comments', () => {
  it('renders existing comments and marks internal ones', async () => {
    renderDetail();
    await userEvent.click(await screen.findByText('orderDetail.tabs.comments'));
    await waitFor(() => expect(screen.getByText('internal note')).toBeInTheDocument());
    expect(screen.getByText('orderDetail.comments.internal')).toBeInTheDocument();
  });

  it('posts a comment with the chosen visibility/notify flags', async () => {
    renderDetail();
    await userEvent.click(await screen.findByText('orderDetail.tabs.comments'));
    await waitFor(() => expect(screen.getByText('internal note')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('comment-body'), 'please pay your invoice');
    // Toggle notify on (customer-visible defaults to checked).
    await userEvent.click(screen.getByLabelText('orderDetail.comments.notify'));
    await userEvent.click(screen.getByText('orderDetail.comments.add'));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders/o1/comments', {
        body: 'please pay your invoice',
        isCustomerVisible: true,
        notifyCustomer: true,
      }),
    );
  });

  it('reorder and clone-to-quote actions hit their endpoints', async () => {
    postSpy.mockResolvedValue({ data: { unavailableItems: [], quoteRequestId: 'q1' } });
    renderDetail();
    await waitFor(() => expect(screen.getByText('orderDetail.reorder.action')).toBeInTheDocument());
    await userEvent.click(screen.getByText('orderDetail.reorder.action'));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders/o1/reorder', {}));
    await userEvent.click(screen.getByText('orderDetail.cloneToQuote.action'));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders/o1/clone-to-quote', {}));
  });
});
