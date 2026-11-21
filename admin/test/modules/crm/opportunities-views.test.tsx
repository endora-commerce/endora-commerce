import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { OpportunityBoard } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { WORKFLOW, core, crmLookupResponse, en, renderCrm, summary } from './crm-fixtures';

/**
 * Issue #1558 (UX audit 2026-11-17, WORK-07; owner decision DEC-13) — the
 * Opportunities list and the board are **one page**, `/crm/opportunities`,
 * switched by the kit's *List | Board* toggle as Tasks is, the board at
 * `?view=board`. The two views share the address: a filter the two have in
 * common set on one view is the other's when the view changes, and each view's
 * own filters wait in the address. The board's former address redirects.
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

const { DEFAULT_BOARD_CARD_FIELDS } = await import(
  '../../../../packages/modules/crm/src/admin/lib/board-fields'
);
const { OpportunitiesPage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunitiesPage'
);
const { OpportunityBoardRedirect } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityBoardRedirect'
);

const LIST_PATH = '/api/v1/admin/crm/opportunities';
const BOARD_PATH = '/api/v1/admin/crm/board';
const NEW = { code: 'new', name: 'New', color: '#64748b', kind: 'open' } as const;

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
  getSpy.mockImplementation((path: string) => {
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
        <Route path="/crm/board" element={<OpportunityBoardRedirect />} />
      </Routes>
      <Address />
    </>,
    { path },
  );
}

function viewButton(name: 'list' | 'board'): HTMLElement {
  return within(screen.getByRole('group', { name: core('common.viewMode.label') })).getByRole('button', {
    name: core(`common.viewMode.${name}`),
  });
}

describe('the one Opportunities page', () => {
  it('opens on the list, its switch saying so, under the one page title', async () => {
    renderPage('/crm/opportunities');
    await screen.findByRole('link', { name: 'OPP-000001' });
    expect(screen.getByRole('heading', { level: 1, name: en('opportunity.list.title') })).toBeTruthy();
    expect(viewButton('list')).toHaveAttribute('aria-pressed', 'true');
    expect(viewButton('board')).toHaveAttribute('aria-pressed', 'false');
    expect(queries(BOARD_PATH)).toHaveLength(0);
  });

  it('switches to the board at `?view=board`, the shared filters carried over and the list\'s own kept for it', async () => {
    const user = userEvent.setup();
    renderPage('/crm/opportunities?assignee=me&state=won');
    await screen.findByRole('link', { name: 'OPP-000001' });
    expect(last(LIST_PATH)?.get('assignedAdminUserId')).toBe('me');
    expect(last(LIST_PATH)?.get('state')).toBe('won');

    await user.click(viewButton('board'));

    await screen.findByRole('group', { name: en('board.column.label', { status: 'New' }) });
    expect(viewButton('board')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 1, name: en('opportunity.list.title') })).toBeTruthy();
    await waitFor(() => expect(last(BOARD_PATH)?.get('assignedAdminUserId')).toBe('me'));
    // The board has no use for the state (its columns are the statuses), so it is not sent — but it waits.
    expect(last(BOARD_PATH)?.has('state')).toBe(false);
    expect(address()).toContain('view=board');
    expect(address()).toContain('state=won');
    expect(address()).toContain('assignee=me');
  });

  it('carries a filter set on the board back to the list', async () => {
    const user = userEvent.setup();
    renderPage('/crm/opportunities?view=board');
    await screen.findByRole('group', { name: en('board.column.label', { status: 'New' }) });

    await user.type(screen.getByLabelText(en('opportunity.list.filter.search')), 'fleet');
    await waitFor(() => expect(address()).toContain('q=fleet'));

    await user.click(viewButton('list'));

    await screen.findByRole('link', { name: 'OPP-000001' });
    expect(address()).not.toContain('view=');
    expect(screen.getByLabelText<HTMLInputElement>(en('opportunity.list.filter.search')).value).toBe('fleet');
    await waitFor(() => expect(last(LIST_PATH)?.get('q')).toBe('fleet'));
  });

  it('puts the list\'s filters and sort in the address, so a reload or a link keeps them', async () => {
    const user = userEvent.setup();
    renderPage('/crm/opportunities');
    await screen.findByRole('link', { name: 'OPP-000001' });

    await user.selectOptions(screen.getByLabelText(en('opportunity.list.filter.state')), 'open');
    await user.selectOptions(screen.getByLabelText(en('opportunity.list.sort')), 'value:desc');

    await waitFor(() => expect(address()).toContain('state=open'));
    expect(address()).toContain('sort=value:desc');
    await waitFor(() => expect(last(LIST_PATH)?.get('sort')).toBe('value'));
    expect(last(LIST_PATH)?.get('state')).toBe('open');
  });

  it('clears every filter of both views from either, keeping the view and the sort', async () => {
    const user = userEvent.setup();
    renderPage('/crm/opportunities?view=board&assignee=me&state=won&sort=value:desc&f.custom:vip.is=true');
    await screen.findByRole('group', { name: en('board.column.label', { status: 'New' }) });

    await user.click(screen.getByRole('button', { name: core('common.listToolbar.clearAll') }));

    await waitFor(() => expect(address()).toBe('/crm/opportunities?view=board&sort=value:desc'));
  });
});

describe('the board\'s former address', () => {
  it('lands a bookmark on the board view of the one page, its filters kept', async () => {
    renderPage('/crm/board?assignee=me&f.custom:lead_source.in=referral');
    await screen.findByRole('group', { name: en('board.column.label', { status: 'New' }) });
    expect(address()).toBe('/crm/opportunities?assignee=me&f.custom:lead_source.in=referral&view=board');
    expect(viewButton('board')).toHaveAttribute('aria-pressed', 'true');
  });
});
