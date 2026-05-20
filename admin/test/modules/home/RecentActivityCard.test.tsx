import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { ApiError } from '@b2b/api-client';

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

const BUNDLE = passthroughBundle('core', [
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
  'home.activity.verb.product.update',
  'home.activity.verb.price_list.activate',
]);

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
    expect(screen.getByText('home.activity.verb.product.update')).toBeInTheDocument();
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

  it('renders a summary tooltip on bulk rows (never raw JSON)', async () => {
    getSpy.mockResolvedValue({
      data: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          actedAt: new Date().toISOString(),
          action: 'stock_level.bulk_import',
          module: 'inventory',
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
