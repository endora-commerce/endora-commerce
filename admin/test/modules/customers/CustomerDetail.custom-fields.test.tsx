import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The customer screen still renders its custom fields and still saves them,
 * with the panel resolved from `@endora-commerce/admin-kit/components`
 * (feature 091, P4e).
 *
 * A moved component that mounts and silently does nothing passes a smoke test,
 * so the assertions are the two halves of what the screen actually owns: the
 * panel's definition-driven form appears over `c.customFieldValues`, and the
 * save button reaches **this screen's own** endpoint,
 * `PATCH /api/v1/admin/customers/:id/custom-fields`. `custom_fields` serves the
 * definitions and nothing else, which is why publication could not have moved
 * the write.
 *
 * The mock is keyed on `@endora-commerce/admin-kit/lib` rather than on
 * `@/lib/api-client`: the shim re-exports the package's binding, so one spy
 * answers both the screen's own reads and the panel's definitions read, and a
 * spelling that only covered the shim would leave the panel talking to the
 * unstubbed `fetch` in `admin/test/setup.ts`.
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

// The screen's sibling panels each pull their own data chain; none is under
// test here.
vi.mock('@/modules/customers/panels/HistoryPanels', () => ({
  OrdersPanel: () => null,
  QuoteRequestsPanel: () => null,
  CartsPanel: () => null,
}));
vi.mock('@/modules/customers/panels/ManagementPanels', () => ({
  OrganizationAssignmentPanel: () => null,
  CustomerGroupPanel: () => null,
  AddressesPanel: () => null,
}));
// A fourth `vi.mock` stood here until feature 091's P7b — `quick_order`'s
// `DefaultPreferencesPanel`, which this screen imported by path. It is a
// `customer.detail.after` contribution now and its `admin/src` copy is deleted,
// so the mock named a module that no longer exists — and vitest answered that by
// making it **inert** rather than by failing. What replaces it is the empty
// registry below: the zone enumerates nothing here, because this file's subject
// is the custom-field panel and not the zone.

const { CustomerDetail } = await import('../../../src/modules/customers/CustomerDetail');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000d001',
  entityType: 'customer',
  key: 'loyalty_tier',
  label: { en: 'Loyalty tier' },
  labelDefault: 'Loyalty tier',
  valueType: 'text',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const CUSTOMER = {
  id: CUSTOMER_ID,
  email: 'buyer@test.com',
  firstName: 'Bea',
  lastName: 'Uyer',
  organizationId: null,
  organizationName: null,
  customerGroupId: null,
  customerGroupName: null,
  blocked: false,
  deleted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  block: null,
  deletion: null,
  customFieldValues: { loyalty_tier: 'gold' },
};

function renderDetail(): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/customers/${CUSTOMER_ID}`) {
      return Promise.resolve({ data: CUSTOMER });
    }
    if (path === '/api/v1/admin/custom-fields/definitions?entityType=customer') {
      return Promise.resolve({ data: [DEFINITION] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/customers/${CUSTOMER_ID}`]}>
        <Routes>
          <Route path="/customers/:id" element={<CustomerDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['customers'] }),
        contributions: [],
      },
    ),
    bundle,
  );
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: CUSTOMER });
});

describe('CustomerDetail — custom fields, through the published panel', () => {
  it('renders the panel over the customer\'s own stored bag', async () => {
    renderDetail();

    expect(await screen.findByText(CORE_EN['customFields.title'] as string)).toBeTruthy();
    expect(await screen.findByLabelText('Loyalty tier')).toHaveValue('gold');
    expect(
      getSpy.mock.calls.map((call) => call[0]),
    ).toContain('/api/v1/admin/custom-fields/definitions?entityType=customer');
  });

  it('saves through the customer screen\'s own endpoint, and refreshes', async () => {
    renderDetail();

    const input = await screen.findByLabelText('Loyalty tier');
    await userEvent.clear(input);
    await userEvent.type(input, 'silver');
    await userEvent.click(
      screen.getByRole('button', { name: CORE_EN['customFields.save'] as string }),
    );

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[0]).toBe(
      `/api/v1/admin/customers/${CUSTOMER_ID}/custom-fields`,
    );
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({ loyalty_tier: 'silver' });
    // The screen re-reads after the write; that is the host's behaviour and it
    // survives the move.
    await waitFor(() =>
      expect(
        getSpy.mock.calls.filter((call) => call[0] === `/api/v1/admin/customers/${CUSTOMER_ID}`),
      ).toHaveLength(2),
    );
  });
});
