import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AdminSearchCapability, AdminSearchResponse } from '@endora-commerce/contracts';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/150-admin-global-search/` T072 — the results page
 * (contracts/admin-ui.md §2.1): `q` from the address, `limit=20`, typing
 * replacing `q`, the type chips writing `type` and narrowing the search,
 * below-minimum, loading, empty and error states, links to each record's
 * screen, an unavailable type and axe.
 */

let capability: AdminSearchCapability;
const searchSpy = vi.fn();

vi.mock('../../../../packages/modules/admin_search/src/admin/api', () => ({
  getConfiguration: vi.fn(),
  putConfiguration: vi.fn(),
  getCapability: async () => capability,
  searchRecords: (...a: unknown[]) => searchSpy(...a),
}));

const { GlobalSearchPage } = await import('../../../../packages/modules/admin_search/src/admin/pages/GlobalSearchPage');

const KEYS = [
  'page.results.title',
  'page.results.inputLabel',
  'page.results.inputPlaceholder',
  'page.results.typesLabel',
  'page.results.all',
  'page.results.belowMinimum',
  'page.results.empty',
  'page.results.error',
  'page.results.retry',
  'page.results.more',
  'page.results.unavailable',
  'page.results.announce',
];

function response(q: string): AdminSearchResponse {
  return {
    data: {
      query: q,
      groups: [
        {
          entityType: 'orders.order',
          label: 'Orders',
          icon: 'Receipt',
          status: 'ok',
          hits: [{ id: 'o1', title: 'ZAM/1', subtitle: 'ACME', status: { code: 'new', label: 'New' }, targetRoute: '/orders/o1' }],
          hasMore: true,
        },
        { entityType: 'crm.opportunity', label: 'Opportunities', icon: 'CircleDollarSign', status: 'failed', hits: [], hasMore: false },
      ],
    },
    meta: { belowMinimumLength: false, minimumQueryLength: 3, limit: 20, tookMs: 1 },
  };
}

let location = '';
function LocationProbe(): null {
  const l = useLocation();
  location = `${l.pathname}${l.search}`;
  return null;
}

function renderPage(url: string): void {
  renderWithSession(
    <StrictMode>
      <MemoryRouter initialEntries={[url]}>
        <LocationProbe />
        <GlobalSearchPage />
      </MemoryRouter>
    </StrictMode>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      contributions: [],
      bundle: passthroughBundle('admin_search', KEYS),
    },
  );
}

describe('GlobalSearchPage (spec 150)', () => {
  beforeEach(() => {
    capability = {
      minimumQueryLength: 3,
      resultsPerEntity: 5,
      entityTypes: [
        { entityType: 'orders.order', label: 'Orders', icon: 'Receipt' },
        { entityType: 'crm.opportunity', label: 'Opportunities', icon: 'CircleDollarSign' },
      ],
    };
    searchSpy.mockReset();
    searchSpy.mockImplementation(async (query: { q: string }) => response(query.q));
  });

  it('prefills the text from the address and searches with 20 per type, linking each record', async () => {
    renderPage('/global-search?q=acme');
    await waitFor(() => expect(screen.getByText('ZAM/1')).toBeTruthy());
    expect((screen.getByLabelText('page.results.inputLabel') as HTMLInputElement).value).toBe('acme');
    expect(searchSpy.mock.calls[0]?.[0]).toMatchObject({ q: 'acme', limit: 20, entityType: null });
    expect(screen.getByRole('link', { name: /ZAM\/1/ }).getAttribute('href')).toBe('/orders/o1');
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('page.results.more')).toBeTruthy();
    expect(within(screen.getByTestId('results-crm.opportunity')).getByText('page.results.unavailable')).toBeTruthy();
  });

  it('replaces q in the address after typing pauses and searches again', async () => {
    renderPage('/global-search?q=acme');
    await waitFor(() => expect(searchSpy).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('page.results.inputLabel'), { target: { value: 'kowalski' } });
    await waitFor(() => expect(location).toBe('/global-search?q=kowalski'));
    await waitFor(() => expect(searchSpy.mock.calls.at(-1)?.[0]).toMatchObject({ q: 'kowalski' }));
  });

  it('narrows to one record type with a chip that reports its state (FR-030)', async () => {
    renderPage('/global-search?q=acme');
    await waitFor(() => expect(screen.getByText('ZAM/1')).toBeTruthy());
    const all = screen.getByRole('button', { name: 'page.results.all' });
    const orders = screen.getByRole('button', { name: 'Orders' });
    expect(all.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(orders);
    await waitFor(() => expect(location).toBe('/global-search?q=acme&type=orders.order'));
    await waitFor(() => expect(searchSpy.mock.calls.at(-1)?.[0]).toMatchObject({ entityType: 'orders.order' }));
    expect(screen.getByRole('button', { name: 'Orders' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('hints below the minimum length and searches nothing', async () => {
    renderPage('/global-search?q=ac');
    await waitFor(() => expect(screen.getByText('page.results.belowMinimum')).toBeTruthy());
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('shows loading, then an empty state', async () => {
    let release: (() => void) | undefined;
    searchSpy.mockImplementation(
      (query: { q: string }) =>
        new Promise((resolve) => {
          release = () => resolve({ ...response(query.q), data: { query: query.q, groups: [] } });
        }),
    );
    renderPage('/global-search?q=nothing');
    await waitFor(() => expect(screen.getByTestId('results-loading')).toBeTruthy());
    release?.();
    await waitFor(() => expect(screen.getByText('page.results.empty')).toBeTruthy());
  });

  it('shows an error with a retry', async () => {
    searchSpy.mockRejectedValueOnce(new Error('network'));
    renderPage('/global-search?q=acme');
    await waitFor(() => expect(screen.getByText(/page.results.error/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'page.results.retry' }));
    await waitFor(() => expect(screen.getByText('ZAM/1')).toBeTruthy());
  });

  it('has no axe violations with results shown', async () => {
    renderPage('/global-search?q=acme');
    await waitFor(() => expect(screen.getByText('ZAM/1')).toBeTruthy());
    await expectNoAxeViolations(document.body);
  });
});
