import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * `payment_methods` owns its authority — the screen.
 *
 * The module's six admin routes moved from `catalog:read` / `catalog:write` to
 * `payment_methods:read` / `payment_methods:write`, so an operator who can edit
 * a product no longer configures how the shop takes money. Three admin surfaces
 * carried the old code as a literal and none of them is read by
 * `check:action-route-permissions`, which sees the manifest action and the
 * backend route and nothing in this application. Two of them — the sidebar
 * entry and the ⌘K Navigate row — are covered where they are declared, by
 * `test/components/AppShell.permission-gating.test.tsx`, which renders the real
 * shell rather than restating its literals. This file is the third: the screen
 * itself, which a denied operator can still navigate to directly, the admin
 * router carrying no permission guard of its own.
 *
 * Denied means **absent**, not disabled and not a 403 panel — the treatment
 * `AppShell.tsx`'s `PALETTE_ITEMS` comment argues for at length and the one
 * module presence already gets.
 */

const rows = [
  {
    id: '00000000-0000-4000-8000-00000000bb01',
    code: 'pm_gating_row',
    adapter: 'bank_transfer',
    kind: 'bank_transfer' as const,
    name: { default: 'Bank transfer' },
    status: 'active' as const,
    additionalPrice: 0,
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'cancelled',
    salesChannelIds: [],
    rendererKey: null,
    availability: { ownerModule: null, available: true, ownerPresence: null },
  },
];

const list = vi.fn(async () => rows);
const orderStatuses = vi.fn(async () => []);
const adapters = vi.fn(async () => []);

vi.mock('@/modules/payment_methods/api/payment-methods-client', () => ({
  paymentMethodsClient: {
    list: (...args: unknown[]) => list(...(args as [])),
    orderStatuses: (...args: unknown[]) => orderStatuses(...(args as [])),
    adapters: (...args: unknown[]) => adapters(...(args as [])),
    upsert: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
  },
}));

const hasPermission = vi.fn((_code: string) => false);
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ hasPermission: (code: string) => hasPermission(code) }),
}));

const KEYS = [
  'legacyMethods.payment.title',
  'legacyMethods.payment.description',
  'legacyMethods.payment.empty',
  'legacyMethods.payment.noPermission',
  'legacyMethods.columns.code',
  'legacyMethods.columns.name',
  'legacyMethods.columns.adapter',
  'legacyMethods.columns.status',
  'legacyMethods.fields.status',
  'legacyMethods.status.active',
  'legacyMethods.status.inactive',
  'legacyMethods.formTitle',
  'legacyMethods.editTitle',
  'common.state.loading',
  'common.action.edit',
  'common.action.delete',
];

describe('the payment-methods screen is gated on the module’s own code', () => {
  it('renders a refusal instead of the screen for a catalogue editor, and asks the API nothing', async () => {
    list.mockClear();
    orderStatuses.mockClear();
    adapters.mockClear();
    hasPermission.mockImplementation((code) => code === 'catalog:read' || code === 'catalog:write');

    const { PaymentMethodsPage } = await import('@/modules/payment_methods/PaymentMethodsPage');
    renderWithI18n(
      <MemoryRouter initialEntries={['/payment-methods']}>
        <PaymentMethodsPage />
      </MemoryRouter>,
      passthroughBundle('core', KEYS),
    );

    await waitFor(() =>
      expect(screen.getByText('legacyMethods.payment.noPermission')).toBeInTheDocument(),
    );
    expect(screen.queryByText('pm_gating_row')).not.toBeInTheDocument();
    // Absent, not 403: the screen never asks the questions it would be refused.
    expect(list).not.toHaveBeenCalled();
    expect(orderStatuses).not.toHaveBeenCalled();
    expect(adapters).not.toHaveBeenCalled();
  });

  it('renders the screen for a role holding payment_methods:read', async () => {
    list.mockClear();
    hasPermission.mockImplementation((code) => code === 'payment_methods:read');

    const { PaymentMethodsPage } = await import('@/modules/payment_methods/PaymentMethodsPage');
    renderWithI18n(
      <MemoryRouter initialEntries={['/payment-methods']}>
        <PaymentMethodsPage />
      </MemoryRouter>,
      passthroughBundle('core', KEYS),
    );

    await waitFor(() => expect(screen.getByText('pm_gating_row')).toBeInTheDocument());
    expect(screen.queryByText('legacyMethods.payment.noPermission')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalled();
  });
});
