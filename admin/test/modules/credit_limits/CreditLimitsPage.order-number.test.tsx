import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CreditLimitView } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1178 (item 1) — the reservation table of the admin credit-limit
 * screen showed the first eight characters of the order's database id, which
 * no operator can search for or recognise. It now shows the order's
 * customer-facing number (`orderBusinessId`) as a link to the admin order, the
 * way the invoices list links its orders; a server that answered no number
 * keeps the shortened id, still linked.
 */

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ORDER_1 = '00000000-0000-4000-8000-0000000000c1';
const ORDER_2 = 'deadbeef-0000-4000-8000-0000000000c2';

const VIEW: CreditLimitView = {
  organizationId: ORG,
  organizationName: 'Acme',
  grantedAmount: 1000,
  availableAmount: 850,
  currency: 'PLN',
  activeReservationCount: 2,
  activeReservations: [
    { orderId: ORDER_1, orderBusinessId: 'ORD-0001-2026', amount: 100, createdAt: '2026-10-01T00:00:00.000Z' },
    { orderId: ORDER_2, orderBusinessId: null, amount: 50, createdAt: '2026-10-01T00:00:00.000Z' },
  ],
  grantedAt: '2026-08-17T10:00:00.000Z',
};

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: async (url: string) => {
        if (url === '/api/v1/admin/credit-limits') return { data: [VIEW] };
        if (url === `/api/v1/admin/organizations/${ORG}/credit-limit`) return { data: VIEW };
        return { data: [] };
      },
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, OrganizationPicker: () => <span data-testid="org-picker" /> };
});

const { CreditLimitsPage } = await import(
  '../../../../packages/modules/credit_limits/src/admin/pages/CreditLimitsPage'
);

describe('CreditLimitsPage — reservation order number (issue #1178)', () => {
  it('links each reservation to its admin order under the customer-facing number', async () => {
    renderWithI18n(
      <MemoryRouter>
        <CreditLimitsPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'core.creditLimits.action.open' }));

    const numbered = await screen.findByRole('link', { name: 'ORD-0001-2026' });
    expect(numbered.getAttribute('href')).toBe(`/orders/${ORDER_1}`);

    const fallback = screen.getByRole('link', { name: 'deadbeef' });
    expect(fallback.getAttribute('href')).toBe(`/orders/${ORDER_2}`);
    expect(screen.queryByText(ORDER_1.slice(0, 8))).toBeNull();
  });
});
