import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1473 (UX audit SALES-08) — the Customers list had no pager. The API
 * always paged (20 a page, with `meta.total`), so every customer past the
 * first 20 could be reached only by searching for them. The screen is the
 * kit's `ListPage` now (issue #1439, DS-05): a toolbar row, one table, the
 * pager, a distinct "no results — clear filters" state, and the organization
 * filter is the searchable picker instead of a `<select>` of the first 50.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: (...a: unknown[]) => postSpy(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});
const { CustomersList, customersListPath } = await import('../../../../packages/modules/customers/src/admin/pages/CustomersList');

const en = { ...shippedCoreBundle('en'), ...shippedModuleBundle('customers', 'en') };
const own = en.customers!;
const core = en.core!;

const ORG_ID = '00000000-0000-4000-8000-0000000000b1';
const customer = (n: number) => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  email: `buyer${n}@example.com`,
  firstName: 'Buyer',
  lastName: String(n),
  organizationId: ORG_ID,
  organizationName: 'Acme',
  customerGroupId: null,
  customerGroupName: null,
  blocked: false,
  deleted: false,
  createdAt: '2026-05-01T09:00:00.000Z',
  lastLoginAt: null,
});

function answer(total: number): void {
  getSpy.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/organizations')) {
      return {
        data: [{ id: ORG_ID, name: 'Acme', legalName: null, status: 'active' }],
        meta: { page: 1, pageSize: 20, total: 1 },
        pagination: { cursor: null, hasMore: false, limit: 20 },
      };
    }
    const page = Number(new URL(url, 'http://x').searchParams.get('page'));
    const filtered = url.includes('q=') || url.includes('status=');
    const count = filtered ? 0 : total;
    const first = (page - 1) * 20 + 1;
    const rows = Array.from({ length: Math.max(0, Math.min(20, count - first + 1)) }, (_, i) => customer(first + i));
    return { data: rows, meta: { page, pageSize: 20, total: count } };
  });
}

function renderList(permissions: string[] = ['*']): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <CustomersList />
      </MemoryRouter>,
      { session: adminSession({ permissions }) },
    ),
    en,
  );
}

const listCalls = (): string[] =>
  getSpy.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/api/v1/admin/customers'));

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
});
afterEach(() => cleanup());

describe('customersListPath', () => {
  it('names the set filters and the one-based page', () => {
    expect(customersListPath({ status: '', q: '  ', organizationId: null, page: 1, pageSize: 20 })).toBe(
      '/api/v1/admin/customers?page=1&pageSize=20',
    );
    expect(customersListPath({ status: 'blocked', q: ' kowal ', organizationId: ORG_ID, page: 3, pageSize: 50 })).toBe(
      `/api/v1/admin/customers?status=blocked&q=kowal&organizationId=${ORG_ID}&page=3&pageSize=50`,
    );
  });
});

describe('Customers list — paging (#1473)', () => {
  it('pages past the first 20 customers', async () => {
    answer(45);
    renderList();
    await screen.findByRole('link', { name: 'Buyer 1' });
    expect(listCalls()).toEqual(['/api/v1/admin/customers?page=1&pageSize=20']);
    // The organization picker carries a live region of its own; the count's is the list's.
    expect(screen.getByText(own['list.count']!.replace('{count}', '45'))).toHaveAttribute('role', 'status');
    expect(screen.getByText('Showing 1–20 of 45')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    await screen.findByRole('link', { name: 'Buyer 21' });
    expect(listCalls().at(-1)).toBe('/api/v1/admin/customers?page=2&pageSize=20');
  });

  it('opens a customer from the name, with no separate Open button in each row', async () => {
    answer(1);
    renderList();
    const link = await screen.findByRole('link', { name: 'Buyer 1' });
    expect(link).toHaveAttribute('href', '/customers/00000000-0000-4000-8000-000000000001');
    expect(screen.queryByRole('link', { name: own['list.action.open']! })).toBeNull();
  });

  it('goes back to the first page when the search changes, and says no customer matches', async () => {
    answer(45);
    renderList();
    await screen.findByRole('link', { name: 'Buyer 1' });
    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    await screen.findByRole('link', { name: 'Buyer 21' });

    await userEvent.type(screen.getByRole('searchbox', { name: own['list.field.search']! }), 'z');
    await screen.findByText(own['list.emptyFiltered']!);
    expect(listCalls().at(-1)).toBe('/api/v1/admin/customers?q=z&page=1&pageSize=20');
    expect(screen.queryByText(own['list.empty']!)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    await screen.findByRole('link', { name: 'Buyer 1' });
    expect(screen.getByRole('searchbox', { name: own['list.field.search']! })).toHaveValue('');
  });

  it('says there are no customers yet when nothing is filtered', async () => {
    answer(0);
    renderList();
    await screen.findByText(own['list.empty']!);
    expect(screen.queryByRole('button', { name: core['common.emptyState.clearFilters']! })).toBeNull();
  });

  it('shows the server message and a retry when the list cannot be loaded', async () => {
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    getSpy.mockRejectedValueOnce(
      new ApiError(403, { error: { code: 'FORBIDDEN', message: 'Outside your reach.' } } as never),
    );
    renderList();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Outside your reach.');
    answer(1);
    await userEvent.click(within(alert).getByRole('button', { name: core['common.action.retry']! }));
    await screen.findByRole('link', { name: 'Buyer 1' });
  });
});

describe('Customers list — organization 2FA reset (feature 042 US6)', () => {
  async function chooseOrganization(): Promise<void> {
    const picker = screen.getByRole('combobox', { name: own['list.field.organization']! });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));
    await waitFor(() => expect(listCalls().at(-1)).toBe(`/api/v1/admin/customers?organizationId=${ORG_ID}&page=1&pageSize=20`));
  }

  it('asks before resetting every account in the organization, and reports the outcome', async () => {
    answer(3);
    postSpy.mockResolvedValue({ data: { requested: 3, affected: 2, skipped: 1 } });
    renderList(['customers:read', 'mfa:reset']);
    await screen.findByRole('link', { name: 'Buyer 1' });
    await chooseOrganization();

    await userEvent.click(screen.getByRole('button', { name: own['list.action.resetOrgMfa']! }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(own['list.action.resetOrgMfaConfirm']!);
    await answerConfirm(false);
    expect(postSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: own['list.action.resetOrgMfa']! }));
    await answerConfirm(true);
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/mfa/reset-bulk', { organizationId: ORG_ID });
    expect(
      await screen.findByText(
        own['list.action.resetOrgMfaResult']!.replace('{affected}', '2').replace('{requested}', '3'),
      ),
    ).toBeInTheDocument();
  });

  it('offers no reset to an operator without mfa:reset', async () => {
    answer(3);
    renderList(['customers:read']);
    await screen.findByRole('link', { name: 'Buyer 1' });
    await chooseOrganization();
    expect(screen.queryByRole('button', { name: own['list.action.resetOrgMfa']! })).toBeNull();
  });
});
