import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { ApiError } from '@/lib/api-client';

function fakeApiError(status: number): ApiError {
  return new ApiError(status, { error: { code: 'INTERNAL', message: 'test' } });
}

/**
 * Feature 024 / T009-T012 — interaction tests for `<RecentActivityCard />`.
 *
 * Covers the four surface states (loading, empty, error+retry, ready+rows)
 * plus the forbidden state (admin without `audit_log:read` sees no card).
 */

const getSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual('@/lib/api-client');
  return {
    ...(actual as Record<string, unknown>),
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { RecentActivityCard } = await import(
  '../../../src/modules/home/RecentActivityCard'
);

const BUNDLE = {
  ...passthroughBundle('core', [
    'home.recentActivity.title',
    'home.recentActivity.subtitle',
    'home.activity.empty',
    'home.activity.error',
    'home.activity.retry',
    'home.activity.viewAll',
    'home.activity.time.justNow',
    'home.activity.time.minutesAgo',
    'home.activity.time.hoursAgo',
    'home.activity.time.yesterday',
    'home.activity.time.daysAgo',
    'home.activity.verb.unknown',
  ]),
  // Since feature 080's T042j the verb lives in the **declaring module's**
  // namespace, not in `core`: that is what lets a packaged module ship its own
  // translation of its own action (D-163.1).
  //
  // The values are scope-prefixed by hand rather than through
  // `passthroughBundle`, which resolves a key to itself: an assertion on the
  // bare key would pass whichever namespace the card looked in, and the
  // namespace is the whole claim.
  catalog: { 'activity.verb.product.update': 'catalog:updated product' },
  inventory: { 'activity.verb.stock_level.bulk_import': 'inventory:imported stock' },
  acceptance_probe: { 'activity.verb.probe.execute': 'probe:ran the probe' },
};

function renderCard(): void {
  renderWithI18n(
    <MemoryRouter>
      <RecentActivityCard />
    </MemoryRouter>,
    BUNDLE,
  );
}

describe('<RecentActivityCard />', () => {
  beforeEach(() => {
    getSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the loading skeleton on first paint', async () => {
    // Never-resolving promise → component stays in loading state.
    getSpy.mockImplementation(() => new Promise(() => {}));
    renderCard();
    expect(screen.getByTestId('recent-activity-loading')).toBeInTheDocument();
    expect(screen.getByText('home.recentActivity.title')).toBeInTheDocument();
  });

  it('renders the empty state when the endpoint returns no rows', async () => {
    getSpy.mockResolvedValue({ data: [], pagination: { limit: 8, fetchedAt: '' } });
    renderCard();
    await waitFor(() =>
      expect(screen.getByText('home.activity.empty')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('recent-activity-loading')).not.toBeInTheDocument();
  });

  it('renders the error state with a Retry button on a non-401 failure', async () => {
    getSpy.mockRejectedValue(fakeApiError(500));
    renderCard();
    await waitFor(() =>
      expect(screen.getByText('home.activity.error')).toBeInTheDocument(),
    );
    const retry = screen.getByRole('button', { name: 'home.activity.retry' });
    expect(retry).toBeInTheDocument();

    // Retry click should re-call the endpoint.
    getSpy.mockResolvedValueOnce({
      data: [],
      pagination: { limit: 8, fetchedAt: '' },
    });
    await userEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByText('home.activity.empty')).toBeInTheDocument(),
    );
    expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('renders rows with actor, verb, target, and time pill', async () => {
    getSpy.mockResolvedValue({
      data: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          actedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
          action: 'product.update',
          module: 'catalog',
          icon: 'Edit',
          labelKey: 'activity.verb.product.update',
          actorDisplayName: 'Anna K.',
          actorKind: 'admin',
          targetType: 'product',
          targetId: 'p1',
          targetDisplayName: 'CABLE-LIY-1.5-50',
          targetUrl: '/catalog/products/p1',
          summary: null,
        },
      ],
      pagination: { limit: 8, fetchedAt: '' },
    });
    renderCard();
    await waitFor(() =>
      expect(screen.getByText('CABLE-LIY-1.5-50')).toBeInTheDocument(),
    );
    expect(screen.getByText('Anna K.')).toBeInTheDocument();
    expect(screen.getByText('catalog:updated product')).toBeInTheDocument();
    // Row is clickable when targetUrl is non-null (anchor element).
    const row = screen.getByTestId('recent-activity-row');
    expect(row.tagName).toBe('A');
    expect(row.getAttribute('href')).toBe('/catalog/products/p1');
  });

  it('renders a disabled (non-anchor) row when targetUrl is null', async () => {
    getSpy.mockResolvedValue({
      data: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          actedAt: new Date().toISOString(),
          action: 'product.update',
          module: 'catalog',
          icon: 'Edit',
          labelKey: 'activity.verb.product.update',
          actorDisplayName: 'Anna K.',
          actorKind: 'admin',
          targetType: 'product',
          targetId: 'deleted-id',
          targetDisplayName: 'Snapshot-only name',
          targetUrl: null,
          summary: null,
        },
      ],
      pagination: { limit: 8, fetchedAt: '' },
    });
    renderCard();
    await waitFor(() =>
      expect(screen.getByText('Snapshot-only name')).toBeInTheDocument(),
    );
    const row = screen.getByTestId('recent-activity-row');
    expect(row.tagName).not.toBe('A');
    expect(row.getAttribute('data-disabled')).toBe('true');
  });

  it('hides the card entirely when the endpoint forbids the admin', async () => {
    getSpy.mockRejectedValue(fakeApiError(403));
    renderCard();
    await waitFor(() => {
      // No card, no skeleton, no error message.
      expect(screen.queryByTestId('recent-activity-card')).not.toBeInTheDocument();
      expect(screen.queryByText('home.activity.error')).not.toBeInTheDocument();
    });
  });

  it('renders a "View all" link to /audit-log in the card header', async () => {
    getSpy.mockResolvedValue({ data: [], pagination: { limit: 8, fetchedAt: '' } });
    renderCard();
    const link = await screen.findByRole('link', { name: 'home.activity.viewAll' });
    expect(link.getAttribute('href')).toBe('/audit-log');
  });

  /**
   * The packaged-module case, at the surface — feature 080, T042j / D-163.1.
   *
   * The four tables this replaced were closed over core module ids, so this row
   * was unrenderable in principle: `ACTIVITY_RENDERING` had no entry for its
   * token, the SPA imported no icon for it, and its verb was in no `core`
   * bundle. It renders here because every one of those three arrives on the
   * row, from the package's own manifest and its own i18n bundle.
   */
  it("renders a packaged module's row, in the package's own namespace", async () => {
    getSpy.mockResolvedValue({
      data: [
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          actedAt: new Date().toISOString(),
          action: 'probe.execute',
          module: 'acceptance_probe',
          icon: 'Boxes',
          labelKey: 'activity.verb.probe.execute',
          actorDisplayName: 'Anna K.',
          actorKind: 'admin',
          targetType: 'acceptance_probe_row',
          targetId: 'probe-1',
          targetDisplayName: 'probe row',
          targetUrl: null,
          summary: null,
        },
      ],
      pagination: { limit: 8, fetchedAt: '' },
    });
    renderCard();
    await waitFor(() => expect(screen.getByText('probe row')).toBeInTheDocument());
    expect(screen.getByText('probe:ran the probe')).toBeInTheDocument();
  });

  it('renders a summary tooltip on bulk rows (never raw JSON)', async () => {
    getSpy.mockResolvedValue({
      data: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          actedAt: new Date().toISOString(),
          action: 'stock_level.bulk_import',
          module: 'inventory',
          icon: 'Upload',
          labelKey: 'activity.verb.stock_level.bulk_import',
          actorDisplayName: 'Tomasz W.',
          actorKind: 'admin',
          targetType: 'bulk_operation',
          targetId: 'bulkop-1',
          targetDisplayName: 'stock.csv → wh-main',
          targetUrl: null,
          summary: { rowsProcessed: 2480, rowsSkipped: 3, rowsErrored: 0 },
        },
      ],
      pagination: { limit: 8, fetchedAt: '' },
    });
    renderCard();
    const row = await screen.findByTestId('recent-activity-row');
    const title = row.getAttribute('title');
    expect(title).toBeTruthy();
    expect(title).toContain('rowsProcessed: 2480');
    expect(title).toContain('rowsSkipped: 3');
    // Must NOT be raw JSON.
    expect(title).not.toContain('{');
    expect(title).not.toContain('}');
  });
});
