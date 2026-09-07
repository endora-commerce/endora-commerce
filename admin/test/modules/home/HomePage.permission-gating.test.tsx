import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  withSession,
} from '../../helpers/render-with-session';

/**
 * Issue #230 — the dashboard is the third copy of the same static index.
 *
 * `QUICK_ACTIONS` and the KPI tiles have the shape the palette and the sidebar
 * have: a label, an icon, a route and an owning module. Both were filtered on
 * module presence alone, so a role without the code got a button that jumps
 * into a 403 and a tile that spends a request per page load to collect one and
 * then reads "—" forever.
 *
 * All three surfaces now run `isSurfaceVisible`, and all three **hide** rather
 * than disable — the treatment module absence already had.
 */

let grantedPermissions = new Set<string>();
const getSpy = vi.fn(async (_path: string) => ({ data: [], items: [], counts: {} }));



vi.mock('../../../../packages/admin-shell/src/lib/api-client', async () => {
  const actual = await vi.importActual('../../../../packages/admin-shell/src/lib/api-client');
  return {
    ...(actual as Record<string, unknown>),
    apiClient: {
      get: (path: string) => getSpy(path),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('../../../../packages/admin-shell/src/modules/home/RecentActivityCard', () => ({
  RecentActivityCard: () => <div data-testid="recent-activity" />,
}));

const { HomePage } = await import('../../../../packages/admin-shell/src/modules/home/HomePage');

const BUNDLE = passthroughBundle('core', [
  'home.welcomeBack',
  'home.subtitle',
  'home.defaultName',
  'home.kpi.activeProducts',
  'home.kpi.pendingQuotes',
  'home.kpi.openOrders',
  'home.kpi.outOfStock',
  'home.quickActions.title',
  'home.quickActions.newProduct',
  'home.quickActions.editPricing',
  'home.quickActions.importInventory',
  'home.quickActions.convertQuote',
  'home.stockAlerts.title',
  'home.stockAlerts.subtitle',
  'home.stockAlerts.empty',
  'home.stockAlerts.seeAll',
]);

function renderHome(granted: readonly string[]): void {
  grantedPermissions = new Set(granted);
  getSpy.mockClear();
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/']}>
        <HomePage />
      </MemoryRouter>,
      { session: adminSession({ permissions: [...grantedPermissions] }), presence: modulePresence({ present: everyDeclaredModule() }) },
    ),
    BUNDLE,
  );
}

describe('HomePage — permission gates the quick actions and the KPI tiles (issue #230)', () => {
  it('hides a quick action the role cannot perform', () => {
    // "New product" posts a product: `catalog:write`
    // (`backend/src/modules/catalog/routes.admin.ts:222`), not the
    // `catalog:read` that gates the products list it sits beside.
    renderHome(['catalog:read']);
    expect(screen.queryByText('home.quickActions.newProduct')).toBeNull();
  });

  it('shows it to a role that holds the code', () => {
    renderHome(['catalog:write']);
    expect(screen.queryByText('home.quickActions.newProduct')).not.toBeNull();
  });

  it('folds the quick-actions card away when every action in it is denied', () => {
    renderHome([]);
    expect(screen.queryByText('home.quickActions.title')).toBeNull();
  });

  it('hides a KPI tile the role cannot read and skips its request', async () => {
    renderHome(['catalog:read']);
    expect(screen.queryByText('home.kpi.openOrders')).toBeNull();
    await waitFor(() => {
      expect(getSpy).toHaveBeenCalled();
    });
    const paths = getSpy.mock.calls.map(([path]) => path);
    expect(paths.some((p) => p.startsWith('/api/v1/admin/catalog/products'))).toBe(true);
    expect(
      paths.some((p) => p.startsWith('/api/v1/admin/orders')),
      'a tile that is not rendered must not spend a request collecting a 403',
    ).toBe(false);
  });

  it('renders every tile and action for a wildcard role', () => {
    renderHome(['*']);
    expect(screen.queryByText('home.kpi.openOrders')).not.toBeNull();
    expect(screen.queryByText('home.kpi.outOfStock')).not.toBeNull();
    expect(screen.queryByText('home.quickActions.convertQuote')).not.toBeNull();
    expect(screen.queryByText('home.stockAlerts.title')).not.toBeNull();
  });

  it('hides the stock-alerts card from a role without the inventory read code', () => {
    // `/api/v1/admin/inventory/low-stock` is gated by `orders:read`
    // (`backend/src/modules/inventory/routes.admin.ts:286`).
    renderHome(['catalog:write']);
    expect(screen.queryByText('home.stockAlerts.title')).toBeNull();
  });
});
