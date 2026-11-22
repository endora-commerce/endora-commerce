import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { OpportunityBoard, SavedListView } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { WORKFLOW, crmLookupResponse, en, renderCrm, summary } from './crm-fixtures';

/**
 * Issue #1734 — saved views on the Opportunities page, through the kit's
 * control (feature 147). One set of views serves the list and the board, as
 * the page's address does: *Save view* stores every filter of both views and
 * the list's sort, never the view; choosing a view replaces them all while the
 * page stays in the view it is in. The control's own behaviour is
 * `admin/test/components/SavedViewsControl*.test.tsx`.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { DEFAULT_BOARD_CARD_FIELDS } = await import(
  '../../../../packages/modules/crm/src/admin/lib/board-fields'
);
const { OpportunitiesPage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunitiesPage'
);

const LIST_PATH = '/api/v1/admin/crm/opportunities';
const BOARD_PATH = '/api/v1/admin/crm/board';
const VIEWS_PATH = '/api/v1/admin/crm/opportunities/list-views';
const NEW = { code: 'new', name: 'New', color: '#64748b', kind: 'open' } as const;

const WON_VIPS: SavedListView = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Won VIPs',
  shared: false,
  ownerAdminUserId: '00000000-0000-4000-8000-0000000000b1',
  ownedByCaller: true,
  canModify: true,
  filters: { state: 'won', assignee: 'me', 'f.custom:vip.is': 'true', colour: 'red' },
  sort: { field: 'value', dir: 'desc' },
};

function board(): OpportunityBoard {
  return {
    columns: [
      { status: NEW, count: 1, valueTotals: [], items: [summary({ title: 'Fleet renewal', status: NEW })], hasMore: false },
    ],
    cardFields: DEFAULT_BOARD_CARD_FIELDS,
  };
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  postSpy.mockImplementation((_path: string, body: Record<string, unknown>) =>
    Promise.resolve({ data: { ...WON_VIPS, id: '22222222-2222-4222-8222-222222222222', ...body } }),
  );
  getSpy.mockImplementation((path: string) => {
    if (path === VIEWS_PATH) return Promise.resolve({ data: [WON_VIPS] });
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return Promise.resolve({ data: [summary()], pagination: { cursor: null, hasMore: false, limit: 20 } });
    }
    if (path === BOARD_PATH || path.startsWith(`${BOARD_PATH}?`)) return Promise.resolve({ data: board() });
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function queries(endpoint: string): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path === endpoint || path.startsWith(`${endpoint}?`))
    .map((path) => new URLSearchParams(path.split('?')[1] ?? ''));
}

function last(endpoint: string): URLSearchParams | undefined {
  const all = queries(endpoint);
  return all[all.length - 1];
}

function Address(): React.ReactNode {
  const location = useLocation();
  return <output data-testid="address">{`${location.pathname}${location.search}`}</output>;
}

const address = (): string => decodeURIComponent(screen.getByTestId('address').textContent ?? '');

function renderPage(path: string): void {
  renderCrm(
    <>
      <Routes>
        <Route path="/crm/opportunities" element={<OpportunitiesPage />} />
      </Routes>
      <Address />
    </>,
    { path },
  );
}

const savedViews = (): HTMLSelectElement => screen.getByRole('combobox', { name: 'Saved views' }) as HTMLSelectElement;

async function viewsLoaded(): Promise<void> {
  await waitFor(() => expect(within(savedViews()).getAllByRole('option')).toHaveLength(2));
}

describe('the Opportunities page — saved views (#1734)', () => {
  it('saves every filter of both views and the list sort from the list, and not the view', async () => {
    const user = userEvent.setup();
    renderPage('/crm/opportunities?state=open&q=fleet&sort=value:desc&f.custom:vip.is=true');
    await screen.findByRole('link', { name: 'OPP-000001' });
    await viewsLoaded();
    expect(getSpy).toHaveBeenCalledWith(VIEWS_PATH);

    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save view' });
    await user.type(within(dialog).getByLabelText('Name'), 'Open fleet{Enter}');
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const [path, sent] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(VIEWS_PATH);
    expect(sent).toMatchObject({
      name: 'Open fleet',
      filters: { state: 'open', q: 'fleet', 'f.custom:vip.is': 'true' },
      sort: { field: 'value', dir: 'desc' },
    });
  });

  it('applies a view on the list: every filter and the sort replaced, the list kept', async () => {
    const user = userEvent.setup();
    renderPage('/crm/opportunities?state=open&q=fleet');
    await screen.findByRole('link', { name: 'OPP-000001' });
    await viewsLoaded();

    await user.selectOptions(savedViews(), WON_VIPS.id);

    await waitFor(() => expect(last(LIST_PATH)?.get('state')).toBe('won'));
    expect(last(LIST_PATH)?.get('assignedAdminUserId')).toBe('me');
    expect(last(LIST_PATH)?.get('sort')).toBe('value');
    expect(last(LIST_PATH)?.has('q')).toBe(false);
    expect(address()).not.toContain('view=');
    expect(address()).not.toContain('colour');
    expect(address()).toContain('f.custom:vip.is=true');
    expect(screen.getByLabelText<HTMLInputElement>(en('opportunity.list.filter.search')).value).toBe('');
  });

  it('applies the same view on the board, which stays the board', async () => {
    const user = userEvent.setup();
    renderPage('/crm/opportunities?view=board');
    await screen.findByRole('group', { name: en('board.column.label', { status: 'New' }) });
    await viewsLoaded();

    await user.selectOptions(savedViews(), WON_VIPS.id);

    await waitFor(() => expect(last(BOARD_PATH)?.get('assignedAdminUserId')).toBe('me'));
    expect(address()).toContain('view=board');
    expect(address()).toContain('state=won');
    expect(address()).toContain('sort=value:desc');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
