import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1473 (UX audit SALES-08) — the Organizations list answered its first
 * 50 rows and the screen offered no way past them except the search. The API
 * pages by offset now (`page`, `pageSize`, `meta.total`), and the screen is the
 * kit's `ListPage` (issue #1439, DS-05) with the pager.
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const { OrganizationsList, organizationsListPath } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationsList'
);

const pl = { ...shippedCoreBundle('pl'), ...shippedModuleBundle('organizations', 'pl') };
const en = { ...shippedCoreBundle('en'), ...shippedModuleBundle('organizations', 'en') };

const org = (n: number) => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  name: `Firma ${n}`,
  taxId: `PL${String(n).padStart(10, '0')}`,
  isPersonal: false,
  status: 'active',
  vatStatus: 'vat_payer',
  createdAt: '2026-05-01T09:00:00.000Z',
});

function answer(total: number): void {
  getSpy.mockImplementation(async (url: string) => {
    const params = new URL(url, 'http://x').searchParams;
    const page = Number(params.get('page'));
    const filtered = params.has('q') || params.has('filter[status]');
    const count = filtered ? 0 : total;
    const first = (page - 1) * 20 + 1;
    const rows = Array.from({ length: Math.max(0, Math.min(20, count - first + 1)) }, (_, i) => org(first + i));
    return {
      data: rows,
      meta: { page, pageSize: 20, total: count },
      pagination: { cursor: null, hasMore: page * 20 < count, limit: 20 },
    };
  });
}

function renderList(bundle: typeof en, language: 'en' | 'pl', permissions: string[] = ['customers:read']): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/organizations']}>
        <Routes>
          <Route path="/organizations" element={<OrganizationsList />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['organizations'] }), contributions: [] },
    ),
    bundle,
    { language },
  );
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
});
afterEach(() => cleanup());

describe('organizationsListPath', () => {
  it('names the set filters and the one-based page', () => {
    expect(organizationsListPath({ status: '', q: '', page: 1, pageSize: 20 })).toBe(
      '/api/v1/admin/organizations?page=1&pageSize=20',
    );
    expect(organizationsListPath({ status: 'blocked', q: ' łódź ', page: 2, pageSize: 50 })).toBe(
      `/api/v1/admin/organizations?filter%5Bstatus%5D=blocked&q=${encodeURIComponent('łódź').replace(/%20/g, '+')}&page=2&pageSize=50`,
    );
  });
});

describe('Organizations list — paging (#1473)', () => {
  it('pages past the first page of organizations, in Polish', async () => {
    answer(55);
    renderList(pl, 'pl');
    await screen.findByRole('link', { name: 'Firma 1' });
    expect(screen.getByRole('status')).toHaveTextContent(pl.organizations!['list.count']!.replace('{count}', '55'));
    await userEvent.click(screen.getByRole('button', { name: pl.core!['common.pagination.next']! }));
    await userEvent.click(await screen.findByRole('button', { name: pl.core!['common.pagination.next']! }));
    await screen.findByRole('link', { name: 'Firma 41' });
    expect(getSpy).toHaveBeenLastCalledWith('/api/v1/admin/organizations?page=3&pageSize=20');
    expect(screen.getByRole('button', { name: pl.core!['common.pagination.next']! })).toHaveAttribute('aria-disabled', 'true');
  });

  it('opens an organization from its name, with no separate Open button in each row', async () => {
    answer(1);
    renderList(en, 'en');
    const link = await screen.findByRole('link', { name: 'Firma 1' });
    expect(link).toHaveAttribute('href', '/organizations/00000000-0000-4000-8000-000000000001');
    expect(screen.queryByRole('link', { name: en.core!['organizations.action.open']! })).toBeNull();
  });

  it('goes back to the first page on a filter change, and clears the filters from the empty state', async () => {
    answer(55);
    renderList(en, 'en');
    await screen.findByRole('link', { name: 'Firma 1' });
    await userEvent.click(screen.getByRole('button', { name: en.core!['common.pagination.next']! }));
    await screen.findByRole('link', { name: 'Firma 21' });

    await userEvent.selectOptions(screen.getByLabelText(en.core!['organizations.field.status']!), 'blocked');
    await screen.findByText(en.organizations!['list.emptyFiltered']!);
    expect(getSpy).toHaveBeenLastCalledWith('/api/v1/admin/organizations?filter%5Bstatus%5D=blocked&page=1&pageSize=20');

    await userEvent.click(screen.getByRole('button', { name: en.core!['common.emptyState.clearFilters']! }));
    await screen.findByRole('link', { name: 'Firma 1' });
  });

  it('offers "New organization" from the empty list to an operator who may create one', async () => {
    answer(0);
    renderList(en, 'en', ['customers:read', 'customers:manage']);
    await screen.findByText(en.organizations!['list.empty']!);
    // The header's and the empty state's — the same action, one route.
    const creates = screen.getAllByRole('link', { name: en.organizations!['list.newOrganization']! });
    expect(creates).toHaveLength(2);
    for (const link of creates) expect(link).toHaveAttribute('href', '/organizations/new');
  });
});
