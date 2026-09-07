import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The order screen still renders its custom fields and still saves them, with
 * the panel resolved from `@endora-commerce/admin-kit/components` (feature 091,
 * P4e).
 *
 * `admin-component-contribution.md` §9.1: `order.customFieldValues` is a column
 * on the order's row and `PATCH /api/v1/admin/orders/:id/custom-fields` is the
 * order screen's own endpoint, so what the panel publication moved is the form,
 * never the data or the write. A component that mounts and silently does
 * nothing passes a smoke test, so both halves are asserted here.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { OrderDetail } = await import('../../../../packages/modules/orders/src/admin/pages/OrderDetail');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const ORDER_ID = 'o1';

const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000d002',
  entityType: 'order',
  key: 'po_number',
  label: { en: 'PO number' },
  labelDefault: 'PO number',
  valueType: 'text',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ORDER = {
  id: ORDER_ID,
  businessId: 'ORD-0001',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  organization: null,
  customer: null,
  status: 'on_hold',
  paymentStatus: 'paid',
  customFieldValues: { po_number: 'PO-1' },
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

function renderDetail(): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/orders/${ORDER_ID}`) return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: {
          statuses: [{ code: 'on_hold', name: { en: 'On Hold' }, isTerminal: false }],
          transitions: [],
        },
      });
    }
    if (path === '/api/v1/admin/custom-fields/definitions?entityType=order') {
      return Promise.resolve({ data: [DEFINITION] });
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
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['orders', 'payments', 'custom_fields'] }),
      },
    ),
    bundle,
  );
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: ORDER });
});

describe('OrderDetail — custom fields, through the published panel', () => {
  it('renders the panel over the order\'s own stored bag', async () => {
    renderDetail();

    expect(await screen.findByText(CORE_EN['customFields.title'] as string)).toBeTruthy();
    expect(await screen.findByLabelText('PO number')).toHaveValue('PO-1');
    expect(getSpy.mock.calls.map((call) => call[0])).toContain(
      '/api/v1/admin/custom-fields/definitions?entityType=order',
    );
  });

  it('saves through the order screen\'s own endpoint, and refreshes', async () => {
    renderDetail();

    const input = await screen.findByLabelText('PO number');
    await userEvent.clear(input);
    await userEvent.type(input, 'PO-2');
    await userEvent.click(
      screen.getByRole('button', { name: CORE_EN['customFields.save'] as string }),
    );

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[0]).toBe(`/api/v1/admin/orders/${ORDER_ID}/custom-fields`);
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({ po_number: 'PO-2' });
    await waitFor(() =>
      expect(
        getSpy.mock.calls.filter((call) => call[0] === `/api/v1/admin/orders/${ORDER_ID}`),
      ).toHaveLength(2),
    );
  });
});
