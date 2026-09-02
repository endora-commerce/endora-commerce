import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `inventory` owns its authority — the screens.
 *
 * The module's 21 admin routes moved from `orders:read` / `catalog:write` to
 * `inventory:read` / `inventory:write`, so an operator who can edit a product
 * no longer deletes a warehouse and one who can read an order no longer
 * enumerates every warehouse address. Five sidebar entries and one palette row
 * carried the old codes and none is read by
 * `check:action-route-permissions`, which sees the manifest action and the
 * backend route and nothing in this application. The sidebar and the palette
 * are covered where they are declared, by
 * `test/components/AppShell.permission-gating.test.tsx`. This file is the
 * other: the screens themselves, which a denied operator can still navigate to
 * directly, the admin router carrying no permission guard of its own.
 *
 * Denied means **absent**, not disabled and not a 403 panel — the treatment
 * `AppShell.tsx`'s `PALETTE_ITEMS` comment argues for at length.
 *
 * Both axes are exercised, because they are two different refusals over one
 * screen: a permission the role does not hold, and the module not being present
 * (Constitution XVII item 5). For `inventory` the second axis is a **real
 * operator switch** — `inventory.enabled`, default on — and not merely platform
 * availability, which is what makes it worth its own case here. Nothing is
 * stubbed: since feature 091's P3 both providers are mounted for real over a
 * session and a projection each case chooses, so the real
 * `useSurfaceVisibility` is the thing under test — and so is the
 * `hasPermission` underneath it, which the mocks used to stand in for.
 */

const kpis = {
  data: {
    totalProductsTracked: 1,
    totalOnHand: 5,
    outOfStockCount: 0,
    lowStockCount: 0,
    perWarehouseTotals: [],
  },
};

const roster = {
  items: [
    {
      productId: '00000000-0000-4000-8000-0000000000f1',
      productSku: 'GATING-SKU',
      productName: 'Gating product',
      cumulativeOnHand: 5,
      displayBand: 'high',
      lowStockThreshold: 1,
      perWarehouse: [],
    },
  ],
  page: 0,
  pageSize: 25,
  total: 1,
};

const get = vi.fn(async (url: string) =>
  url.includes('/levels') ? roster : kpis,
);

vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  apiClient: {
    get: (...args: unknown[]) => get(...(args as [string])),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

/** The codes the signed-in operator holds, per case. */
let permissions: readonly string[] = [];

/** The modules the projection reports present, per case. */
let presentModules: readonly string[] = [];

const KEYS = [
  'inventory.page.title',
  'inventory.page.subPrefix',
  'inventory.page.subSuffix',
  'inventory.noPermission',
  'inventory.action.import',
  'inventory.action.editStock',
  'inventory.error.load',
];

function mount(): Promise<void> {
  return import('@/modules/inventory/InventoryPage').then(({ InventoryPage }) => {
    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/inventory']}>
          <InventoryPage />
        </MemoryRouter>,
        { session: adminSession({ permissions }), presence: modulePresence({ present: presentModules }) },
      ),
      passthroughBundle('core', KEYS),
    );
  });
}

describe('the inventory landing is gated on the module’s own codes', () => {
  it('renders a refusal instead of the screen for an orders reader, and asks the API nothing', async () => {
    get.mockClear();
    presentModules = ['inventory'];
    // The role the old read gate handed the whole stock and warehouse surface
    // to. `orders:read` is a fact about orders; a warehouse address is not one.
    permissions = ['orders:read'];

    await mount();

    await waitFor(() => expect(screen.getByText('inventory.noPermission')).toBeInTheDocument());
    expect(screen.queryByText('GATING-SKU')).not.toBeInTheDocument();
    // Absent, not 403: the screen never asks the question it would be refused.
    expect(get).not.toHaveBeenCalled();
  });

  it('renders a refusal for a catalogue editor too', async () => {
    get.mockClear();
    presentModules = ['inventory'];
    permissions = ['catalog:read', 'catalog:write'];

    await mount();

    await waitFor(() => expect(screen.getByText('inventory.noPermission')).toBeInTheDocument());
    expect(get).not.toHaveBeenCalled();
  });

  it('renders the screen for a role holding inventory:read', async () => {
    get.mockClear();
    presentModules = ['inventory'];
    permissions = ['inventory:read'];

    await mount();

    await waitFor(() => expect(screen.getByText('GATING-SKU')).toBeInTheDocument());
    expect(screen.queryByText('inventory.noPermission')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalled();
  });

  it('offers no import affordance to a role holding inventory:read alone', async () => {
    // The capability the pair creates. The import link led to a screen the old
    // model gated on `catalog:write` while this page was `orders:read` — two
    // codes nobody grants together on purpose.
    get.mockClear();
    presentModules = ['inventory'];
    permissions = ['inventory:read'];

    await mount();

    await waitFor(() => expect(screen.getByText('GATING-SKU')).toBeInTheDocument());
    expect(screen.queryByText('inventory.action.import')).not.toBeInTheDocument();
  });

  it('offers the import affordance to a role holding the pair', async () => {
    get.mockClear();
    presentModules = ['inventory'];
    permissions = ['inventory:read', 'inventory:write'];

    await mount();

    await waitFor(() => expect(screen.getByText('GATING-SKU')).toBeInTheDocument());
    expect(screen.getByText('inventory.action.import')).toBeInTheDocument();
  });

  it('renders no screen when the module is switched off, whatever the role holds', async () => {
    // The other axis, and for this module it is an operator's own switch
    // (`inventory.enabled`) rather than platform availability. A permission gate
    // alone would leave this page rendering and answering 503.
    get.mockClear();
    permissions = ['inventory:read', 'inventory:write'];
    presentModules = [];

    await mount();

    await waitFor(() => expect(screen.getByText('inventory.noPermission')).toBeInTheDocument());
    expect(get).not.toHaveBeenCalled();
  });
});
