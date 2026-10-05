import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import { OPPORTUNITY_ID, WORKFLOW, core, en, renderCrm, summary } from './crm-fixtures';

/**
 * The Opportunities list (`specs/143-crm-sales-opportunities/`, User Story 1 —
 * tasks T037 and T053; FR-001 – FR-005).
 *
 * The subject is that **the filters drive the query**: each control changes the
 * request the list makes, and the two filters whose stories have not landed
 * (assignee, tags) are never sent — the endpoint answers 422 for them.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OpportunitiesList } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunitiesList'
);

const LIST_PATH = '/api/v1/admin/crm/opportunities';
const SECOND_ID = '00000000-0000-4000-8000-0000000000b2';

let page: { data: unknown[]; pagination: { cursor: string | null; hasMore: boolean; limit: number } };

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  page = {
    data: [
      summary(),
      summary({
        id: SECOND_ID,
        number: 'OPP-000002',
        title: 'Warehouse racking',
        status: { code: 'qualified', name: 'Qualified', color: '#3b82f6', kind: 'open' },
        value: null,
      }),
    ],
    pagination: { cursor: null, hasMore: false, limit: 20 },
  };
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith(`${LIST_PATH}?`) || path === LIST_PATH) return Promise.resolve(page);
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path.startsWith('/api/v1/admin/sales-channels')) return Promise.resolve({ items: [] });
    if (path.startsWith('/api/v1/admin/organizations')) {
      return Promise.resolve({ data: [], pagination: { cursor: null, hasMore: false, limit: 20 } });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

/** Every list request made so far, as parsed query strings. */
function listQueries(): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path === LIST_PATH || path.startsWith(`${LIST_PATH}?`))
    .map((path) => new URLSearchParams(path.split('?')[1] ?? ''));
}

function lastQuery(): URLSearchParams {
  const all = listQueries();
  return all[all.length - 1] as URLSearchParams;
}

async function renderList(permissions?: readonly string[]): Promise<void> {
  renderCrm(<OpportunitiesList />, {
    path: '/crm/opportunities',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByText('Fleet renewal');
}

describe('OpportunitiesList', () => {
  it('lists opportunities with number, title, organization, status and value', async () => {
    await renderList();
    const row = screen.getByText('Fleet renewal').closest('tr') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'OPP-000001' })).toHaveAttribute(
      'href',
      `/crm/opportunities/${OPPORTUNITY_ID}`,
    );
    expect(within(row).getByText('Acme')).toBeInTheDocument();
    expect(within(row).getByText('New')).toBeInTheDocument();
    expect(within(row).getByText(/12\s?500,00/)).toBeInTheDocument();
    expect(screen.getByText('Warehouse racking')).toBeInTheDocument();
  });

  it('asks for the page size it shows and never sends the filters of later stories', async () => {
    await renderList();
    const query = lastQuery();
    expect(query.get('limit')).toBe('20');
    for (const all of listQueries()) {
      expect(all.has('assignedAdminUserId')).toBe(false);
      expect(all.has('tagId')).toBe(false);
    }
  });

  it('sends the search term to the server', async () => {
    await renderList();
    await userEvent.type(screen.getByLabelText(en('opportunity.list.filter.search')), 'acme');
    await waitFor(() => expect(lastQuery().get('q')).toBe('acme'));
  });

  it('filters by state', async () => {
    await renderList();
    await userEvent.selectOptions(screen.getByLabelText(en('opportunity.list.filter.state')), 'won');
    await waitFor(() => expect(lastQuery().get('state')).toBe('won'));
  });

  it('filters by a status of the configured workflow', async () => {
    await renderList();
    const select = screen.getByLabelText(en('opportunity.list.filter.status'));
    await within(select).findByRole('option', { name: 'Negotiation' });
    await userEvent.selectOptions(select, 'negotiation');
    await waitFor(() => expect(lastQuery().getAll('statusCode')).toEqual(['negotiation']));
  });

  it('filters by creation date and sorts', async () => {
    await renderList();
    await userEvent.type(screen.getByLabelText(en('opportunity.list.filter.createdFrom')), '2026-10-01');
    await waitFor(() => expect(lastQuery().get('createdFrom')).toBe('2026-10-01'));
    await userEvent.selectOptions(screen.getByLabelText(en('opportunity.list.sort')), 'value:desc');
    await waitFor(() => {
      expect(lastQuery().get('sort')).toBe('value');
      expect(lastQuery().get('order')).toBe('desc');
    });
    // Filters combine rather than replace one another.
    expect(lastQuery().get('createdFrom')).toBe('2026-10-01');
  });

  it('clears every filter at once', async () => {
    await renderList();
    await userEvent.selectOptions(screen.getByLabelText(en('opportunity.list.filter.state')), 'lost');
    await waitFor(() => expect(lastQuery().get('state')).toBe('lost'));
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.list.filter.clear') }));
    await waitFor(() => expect(lastQuery().has('state')).toBe(false));
  });

  it('pages forward and back with the cursor the server issued', async () => {
    page.pagination = { cursor: 'next-cursor', hasMore: true, limit: 20 };
    await renderList();
    const previous = screen.getByRole('button', { name: core('common.pagination.previous') });
    expect(previous).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: core('common.pagination.next') }));
    await waitFor(() => expect(lastQuery().get('cursor')).toBe('next-cursor'));

    await userEvent.click(screen.getByRole('button', { name: core('common.pagination.previous') }));
    await waitFor(() => expect(lastQuery().has('cursor')).toBe(false));
  });

  it('explains an empty list and offers the one next step', async () => {
    page.data = [];
    renderCrm(<OpportunitiesList />, { path: '/crm/opportunities' });
    expect(await screen.findByText(en('opportunity.list.empty.title'))).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: en('opportunity.list.new') });
    expect(links[0]).toHaveAttribute('href', '/crm/opportunities/new');
  });

  it('tells an empty result of a filter apart from an empty list', async () => {
    await renderList();
    page.data = [];
    await userEvent.selectOptions(screen.getByLabelText(en('opportunity.list.filter.state')), 'won');
    expect(await screen.findByText(en('opportunity.list.noResults.title'))).toBeInTheDocument();
    expect(screen.queryByText(en('opportunity.list.empty.title'))).toBeNull();
  });

  it('hides "New opportunity" from an operator who may only read', async () => {
    await renderList(['crm:read', 'orders:read']);
    expect(screen.queryByRole('link', { name: en('opportunity.list.new') })).toBeNull();
  });

  it('offers a retry when the list cannot be loaded', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
      if (path.startsWith(LIST_PATH)) return Promise.reject(new Error('offline'));
      return Promise.resolve({ items: [], data: [], pagination: { cursor: null, hasMore: false, limit: 20 } });
    });
    renderCrm(<OpportunitiesList />, { path: '/crm/opportunities' });
    expect(await screen.findByText(en('opportunity.list.error'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: core('common.action.retry') })).toBeInTheDocument();
  });
});
