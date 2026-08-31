import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `delivery_methods` owns its authority — the screen.
 *
 * The module's three admin routes moved from `catalog:read` / `catalog:write`
 * to `delivery_methods:read` / `delivery_methods:write`, so an operator who can
 * edit a product no longer configures how the shop ships. Three admin surfaces
 * carried the old code as a literal and none of them is read by
 * `check:action-route-permissions`, which sees the manifest action and the
 * backend route and nothing in this application — and this module declares no
 * manifest action at all, so the check sees nothing of it either way. Two of
 * them, the sidebar entry and the ⌘K Navigate row, are covered where they are
 * declared, by `test/components/AppShell.permission-gating.test.tsx`. This file
 * is the third: the screen itself, which a denied operator can still navigate
 * to directly, the admin router carrying no permission guard of its own.
 *
 * Denied means **absent**, not disabled and not a 403 panel — the treatment
 * `AppShell.tsx`'s `PALETTE_ITEMS` comment argues for at length.
 *
 * Both axes are exercised, because they are two different refusals over one
 * screen: a permission the role does not hold, and a module the operator has
 * switched off (Constitution XVII item 5). The mocks stop at `useAuth` and
 * `useModulePresence` deliberately, so the real `useSurfaceVisibility`
 * predicate — the one the sidebar and the palette run — is the thing under
 * test rather than a stub of it.
 */

const rows = [
  {
    id: '00000000-0000-4000-8000-00000000cc01',
    code: 'dm_gating_row',
    adapter: 'in_person_pickup',
    name: { 'en-US': 'Pickup' },
    cost: { amount: 0, currency: 'PLN' },
    status: 'active' as const,
    statusOnSuccess: 'shipment_sent',
    statusOnFailure: 'processing',
    salesChannelIds: [],
    rendererKey: null,
  },
];

const list = vi.fn(async () => rows);
const orderStatuses = vi.fn(async () => []);

vi.mock('@/modules/delivery_methods/api/delivery-methods-client', () => ({
  deliveryMethodsClient: {
    list: (...args: unknown[]) => list(...(args as [])),
    orderStatuses: (...args: unknown[]) => orderStatuses(...(args as [])),
    upsert: vi.fn(),
    remove: vi.fn(),
  },
}));

/** The codes the signed-in operator holds, per case. */
let permissions: readonly string[] = [];

/** The modules the projection reports present, per case. */
let presentModules: readonly string[] = [];

const KEYS = [
  'legacyMethods.delivery.title',
  'legacyMethods.delivery.description',
  'legacyMethods.delivery.empty',
  'legacyMethods.delivery.noPermission',
  'legacyMethods.columns.code',
  'legacyMethods.columns.name',
  'legacyMethods.columns.cost',
  'legacyMethods.columns.status',
  'legacyMethods.fields.code',
  'legacyMethods.fields.nameEn',
  'legacyMethods.fields.namePl',
  'legacyMethods.fields.cost',
  'legacyMethods.fields.currency',
  'legacyMethods.fields.status',
  'legacyMethods.status.active',
  'legacyMethods.status.inactive',
  'legacyMethods.formTitle',
  'common.state.loading',
  'common.action.save',
  'common.action.edit',
  'common.action.delete',
];

function mount(): Promise<void> {
  return import('@/modules/delivery_methods/DeliveryMethodsPage').then(
    ({ DeliveryMethodsPage }) => {
      renderWithI18n(
        withSession(
          <MemoryRouter initialEntries={['/delivery-methods']}>
            <DeliveryMethodsPage />
          </MemoryRouter>,
          { session: adminSession({ permissions }), presence: modulePresence({ present: presentModules }) },
        ),
        passthroughBundle('core', KEYS),
      );
    },
  );
}

describe('the delivery-methods screen is gated on the module’s own code', () => {
  it('renders a refusal instead of the screen for a catalogue editor, and asks the API nothing', async () => {
    list.mockClear();
    orderStatuses.mockClear();
    presentModules = ['delivery_methods'];
    permissions = ['catalog:read', 'catalog:write'];

    await mount();

    await waitFor(() =>
      expect(screen.getByText('legacyMethods.delivery.noPermission')).toBeInTheDocument(),
    );
    expect(screen.queryByText('dm_gating_row')).not.toBeInTheDocument();
    // Absent, not 403: the screen never asks the questions it would be refused.
    expect(list).not.toHaveBeenCalled();
    expect(orderStatuses).not.toHaveBeenCalled();
  });

  it('renders the screen for a role holding delivery_methods:read', async () => {
    list.mockClear();
    orderStatuses.mockClear();
    presentModules = ['delivery_methods'];
    permissions = ['delivery_methods:read'];

    await mount();

    await waitFor(() => expect(screen.getByText('dm_gating_row')).toBeInTheDocument());
    expect(screen.queryByText('legacyMethods.delivery.noPermission')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalled();
  });

  it('renders no screen when the module itself is switched off, whatever the role holds', async () => {
    // The other axis. A permission gate alone would leave this page rendering
    // and answering 503 for an operator whose role is perfectly adequate.
    list.mockClear();
    orderStatuses.mockClear();
    permissions = ['delivery_methods:read'];
    presentModules = [];

    await mount();

    await waitFor(() =>
      expect(screen.getByText('legacyMethods.delivery.noPermission')).toBeInTheDocument(),
    );
    expect(list).not.toHaveBeenCalled();
    expect(orderStatuses).not.toHaveBeenCalled();
  });
});
