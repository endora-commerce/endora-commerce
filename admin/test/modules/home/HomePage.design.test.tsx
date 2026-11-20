import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  withSession,
} from '../../helpers/render-with-session';

/**
 * Issue #1556 (UX audit 2026-11-17, SHELL-21) — the Home dashboard's filler.
 *
 * The quick actions were a stack of full-width default buttons inside a card,
 * four controls that each looked like the page's primary action (Von Restorff,
 * Occam's Razor). They are navigation, so they are a compact list of links.
 * The stock-alert thumbnails drew a hard-coded hex gradient that ignored the
 * dark theme; they read the sunken-surface token now.
 *
 * Harness copied from the permission-gating test (issue #230).
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



vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual('@endora-commerce/admin-kit/lib');
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

describe('HomePage — the dashboard draws no filler (issue #1556)', () => {
  it('renders the quick actions as a compact list of links, not buttons', () => {
    renderHome(['*']);
    const region = screen.getByRole('region', { name: 'home.quickActions.title' });
    const list = within(region).getByRole('list');
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/catalog/products/new',
      '/price-lists',
      '/import-export',
      '/quote-requests',
    ]);
    expect(within(region).queryAllByRole('button')).toEqual([]);
  });

  it('gives the stock-alert thumbnails the sunken-surface token, not a hex gradient', async () => {
    getSpy.mockImplementation(async (path: string) =>
      path.startsWith('/api/v1/admin/inventory/low-stock')
        ? {
            items: [
              { productId: 'p1', productSku: 'SKU-1', productName: 'Cable', cumulativeOnHand: 0, lowStockThreshold: 5 },
            ],
          }
        : { data: [], items: [], counts: {} },
    );
    renderHome(['*']);
    const row = await screen.findByRole('link', { name: /Cable/ });
    const thumb = row.querySelector('[data-slot="stock-alert-thumb"]');
    expect(thumb).not.toBeNull();
    expect(thumb?.getAttribute('style')).toBeNull();
    expect(thumb?.className).toContain('bg-[var(--surface-sunken)]');
    expect(document.body.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
