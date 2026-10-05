import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  OpportunityBoard,
  OpportunityStatusRef,
  OpportunitySummary,
} from '@endora-commerce/contracts';
import type { KanbanBoardProps } from '@endora-commerce/admin-kit/components';
import {
  crmLookupResponse,
  detail,
  en,
  ORDER_ID,
  propagation,
  renderCrm,
  summary,
  WORKFLOW,
} from './crm-fixtures';

/**
 * CRM's board (`specs/143-crm-sales-opportunities/`, User Story 7 — tasks T089
 * and T091; FR-051).
 *
 * The `KanbanBoard` primitive is proven by its own test
 * (`admin/test/components/KanbanBoard.test.tsx`), which drives the library's
 * real sensors. What is proven here is what CRM hands it and what CRM does when
 * it calls back: `canDrop` is the workflow's answer for that card, `onMove` is
 * the transition endpoint, and the **"Move to…" menu is the same move without a
 * drag** — WCAG 2.2 SC 2.5.7's single-pointer path, tested as a first-class
 * path and not as a fallback.
 *
 * The real primitive is rendered; a thin wrapper records the props it was last
 * given, so a test can ask `canDrop` a question and call `onMove` the way a
 * drop does.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

type BoardProps = KanbanBoardProps<OpportunitySummary, { status: OpportunityStatusRef }>;
let handed: BoardProps | null = null;

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  const Real = actual.KanbanBoard as unknown as (props: BoardProps) => React.ReactNode;
  return {
    ...actual,
    KanbanBoard: (props: BoardProps) => {
      handed = props;
      return <Real {...props} />;
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OpportunityBoardPage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityBoardPage'
);

const WORKFLOW_PATH = '/api/v1/admin/crm/workflow';
const BOARD_PATH = '/api/v1/admin/crm/board';
const LIST_PATH = '/api/v1/admin/crm/opportunities';

const ID = (n: number): string => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

const STATUS = {
  new: { code: 'new', name: 'New', color: '#64748b', kind: 'open' },
  qualified: { code: 'qualified', name: 'Qualified', color: '#3b82f6', kind: 'open' },
  negotiation: { code: 'negotiation', name: 'Negotiation', color: '#f59e0b', kind: 'open' },
  won: { code: 'won', name: 'Won', color: '#10b981', kind: 'won' },
  lost: { code: 'lost', name: 'Lost', color: '#ef4444', kind: 'lost' },
} satisfies Record<string, OpportunityStatusRef>;

const FLEET = summary({ id: ID(1), number: 'OPP-000001', title: 'Fleet renewal', value: '12500.00' });
const TYRES = summary({
  id: ID(2),
  number: 'OPP-000002',
  title: 'Winter tyres',
  value: '900.00',
  assignee: { id: ID(90), name: 'Anna Nowak', active: true },
  tags: [{ id: ID(80), name: 'Key account', color: '#3b82f6' }],
});
const LEASE = summary({
  id: ID(3),
  number: 'OPP-000003',
  title: 'Lease extension',
  value: '300.00',
  currency: 'EUR',
  status: STATUS.qualified,
});

function boardData(): OpportunityBoard {
  return {
    columns: [
      {
        status: STATUS.new,
        count: 2,
        valueTotals: [{ currency: 'PLN', total: '13400.00' }],
        items: [FLEET, TYRES],
        hasMore: false,
      },
      {
        status: STATUS.qualified,
        count: 1,
        valueTotals: [{ currency: 'EUR', total: '300.00' }],
        items: [LEASE],
        hasMore: false,
      },
      { status: STATUS.negotiation, count: 0, valueTotals: [], items: [], hasMore: false },
      { status: STATUS.won, count: 0, valueTotals: [], items: [], hasMore: false },
      { status: STATUS.lost, count: 0, valueTotals: [], items: [], hasMore: false },
    ],
  };
}

let current = boardData();

function boardCalls(): string[] {
  return getSpy.mock.calls.map(([path]) => path as string).filter((path) => path.startsWith(BOARD_PATH));
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  handed = null;
  current = boardData();
  getSpy.mockImplementation((path: string) => {
    if (path === WORKFLOW_PATH) return Promise.resolve({ data: WORKFLOW });
    if (path.startsWith(BOARD_PATH)) return Promise.resolve({ data: current });
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function lane(name: string): HTMLElement {
  return screen.getByRole('group', { name: en('board.column.label', { status: name }) });
}

function cardTitles(name: string): string[] {
  return within(lane(name))
    .queryAllByRole('link')
    .map((link) => link.textContent ?? '');
}

async function renderBoard(permissions?: readonly string[]): Promise<void> {
  renderCrm(<OpportunityBoardPage />, {
    path: '/crm/board',
    pattern: '/crm/board',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('link', { name: 'Fleet renewal' });
}

function movedTo(source: OpportunitySummary, status: OpportunityStatusRef, propagationRows: unknown[] = []) {
  return {
    data: {
      opportunity: detail({ ...source, status, allowedTransitions: [], links: [] }),
      from: source.status.code,
      to: status.code,
      propagation: propagationRows,
    },
  };
}

async function openMoveMenu(title: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: en('board.moveTo.label', { title }) }));
  return screen.getByRole('group', { name: en('board.moveTo.label', { title }) });
}

describe('OpportunityBoardPage — columns and cards', () => {
  it('renders one lane per column of the answer, in its order, with count and value totals', async () => {
    await renderBoard();
    expect(
      screen
        .getAllByRole('group')
        .filter((element) => element.hasAttribute('data-kanban-column'))
        .map((element) => element.getAttribute('data-kanban-column')),
    ).toEqual(['new', 'qualified', 'negotiation', 'won', 'lost']);

    const fresh = lane('New');
    expect(within(fresh).getByRole('heading', { name: 'New' })).toBeInTheDocument();
    expect(within(fresh).getByText(en('board.column.count', { count: 2 }))).toBeInTheDocument();
    expect(within(fresh).getByText(/13\s?400,00/)).toBeInTheDocument();
    // The lane's total and its one card's value are the same figure, shown twice.
    expect(within(lane('Qualified')).getAllByText(/300,00/)).toHaveLength(2);
    // A lane with nothing in it says so instead of standing empty.
    expect(within(lane('Won')).getByText(en('board.column.empty'))).toBeInTheDocument();
    expect(within(lane('Won')).getByText(en('board.column.count', { count: 0 }))).toBeInTheDocument();
  });

  it('shows on a card its title, organization, assignee, value and tags', async () => {
    await renderBoard();
    const card = within(lane('New')).getByRole('link', { name: 'Winter tyres' }).closest('li') as HTMLElement;
    expect(within(card).getByRole('link', { name: 'Winter tyres' })).toHaveAttribute(
      'href',
      `/crm/opportunities/${ID(2)}`,
    );
    expect(within(card).getByText(/OPP-000002/)).toBeInTheDocument();
    expect(within(card).getByText(/Acme/)).toBeInTheDocument();
    expect(within(card).getByText('Anna Nowak')).toBeInTheDocument();
    expect(within(card).getByText(/900,00/)).toBeInTheDocument();
    expect(within(card).getByText('Key account')).toBeInTheDocument();
    // An Opportunity nobody is assigned to says so.
    const other = within(lane('New')).getByRole('link', { name: 'Fleet renewal' }).closest('li') as HTMLElement;
    expect(within(other).getByText(en('assignment.unassigned'))).toBeInTheDocument();
  });

  it('names the board and every card handle from the module bundle', async () => {
    await renderBoard();
    expect(screen.getByRole('region', { name: en('board.label') })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: en('board.drag.handle', { title: 'Fleet renewal' }) }),
    ).toBeInTheDocument();
    expect(handed?.labels.instructions).toBe(en('board.drag.instructions'));
    expect(handed?.labels.pickedUp(FLEET, { status: STATUS.new })).toBe(
      en('board.announce.pickedUp', { title: 'Fleet renewal', status: 'New' }),
    );
    expect(handed?.labels.over(FLEET, { status: STATUS.won }, false)).toBe(
      en('board.announce.overRefused', { title: 'Fleet renewal', status: 'Won' }),
    );
  });
});

describe('OpportunityBoardPage — the "Move to…" menu', () => {
  it('lists exactly the transitions the workflow allows from the card’s status', async () => {
    await renderBoard();
    const menu = await openMoveMenu('Fleet renewal');
    expect(within(menu).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Qualified',
      'Lost',
    ]);
    // Another status, another list.
    const other = await openMoveMenu('Lease extension');
    expect(within(other).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Negotiation',
    ]);
  });

  it('moves the card through the transition endpoint, with no drag', async () => {
    postSpy.mockResolvedValue(movedTo(FLEET, STATUS.qualified));
    await renderBoard();
    const menu = await openMoveMenu('Fleet renewal');
    await userEvent.click(within(menu).getByRole('button', { name: 'Qualified' }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${LIST_PATH}/${ID(1)}/transition`, { to: 'qualified' }),
    );
    await waitFor(() => expect(cardTitles('Qualified')).toContain('Fleet renewal'));
    expect(cardTitles('New')).toEqual(['Winter tyres']);
    // The figures follow the card.
    expect(within(lane('New')).getByText(en('board.column.count', { count: 1 }))).toBeInTheDocument();
    expect(within(lane('Qualified')).getByText(en('board.column.count', { count: 2 }))).toBeInTheDocument();
    // 13 400,00 less the card that left: the total is now the remaining card's value.
    expect(within(lane('New')).queryByText(/13\s?400,00/)).toBeNull();
    expect(within(lane('New')).getAllByText(/900,00/)).toHaveLength(2);
    // A second currency in the lane: its total sits beside the first, and the card shows its own.
    expect(within(lane('Qualified')).getAllByText(/12\s?500,00/)).toHaveLength(2);
    expect(
      screen.getByText(en('board.move.done', { title: 'Fleet renewal', status: 'Qualified' })),
    ).toBeInTheDocument();
  });

  it('offers no menu on a card whose status is a dead end', async () => {
    current = boardData();
    current.columns[3]!.items = [summary({ id: ID(4), title: 'Closed deal', status: STATUS.won })];
    current.columns[3]!.count = 1;
    await renderBoard();
    expect(screen.getByRole('link', { name: 'Closed deal' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: en('board.moveTo.label', { title: 'Closed deal' }) }),
    ).toBeNull();
  });

  it('offers neither the menu nor a drag handle to an operator who may only read', async () => {
    await renderBoard(['crm:read', 'orders:read']);
    expect(
      screen.queryByRole('button', { name: en('board.moveTo.label', { title: 'Fleet renewal' }) }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: en('board.drag.handle', { title: 'Fleet renewal' }) }),
    ).toBeNull();
    expect(handed?.disabled).toBe(true);
    expect(screen.getByText(en('board.readOnly'))).toBeInTheDocument();
  });
});

describe('OpportunityBoardPage — what the primitive is handed', () => {
  it('answers canDrop with the workflow’s transitions for that card, and nothing else', async () => {
    await renderBoard();
    const canDrop = handed?.canDrop;
    if (!canDrop) throw new Error('the board handed the primitive no canDrop');
    const accepted = (item: OpportunitySummary): string[] =>
      ['new', 'qualified', 'negotiation', 'won', 'lost'].filter(
        (code) => code !== item.status.code && canDrop(item, code, item.status.code),
      );
    expect(accepted(FLEET)).toEqual(['qualified', 'lost']);
    expect(accepted(LEASE)).toEqual(['negotiation']);
    expect(accepted(summary({ id: ID(4), status: STATUS.won }))).toEqual([]);
  });

  it('turns a drop into the same transition call, moving the card before the server answers', async () => {
    let resolve: (value: unknown) => void = () => {};
    postSpy.mockReturnValue(new Promise((done) => (resolve = done)));
    await renderBoard();

    let outcome: unknown;
    act(() => {
      outcome = handed?.onMove(ID(1), 'new', 'qualified');
    });
    expect(postSpy).toHaveBeenCalledWith(`${LIST_PATH}/${ID(1)}/transition`, { to: 'qualified' });
    // Optimistic: the card is in its new lane while the request is in flight.
    await waitFor(() => expect(cardTitles('Qualified')).toContain('Fleet renewal'));
    expect(cardTitles('New')).toEqual(['Winter tyres']);

    await act(async () => {
      resolve(movedTo(FLEET, STATUS.qualified));
      await outcome;
    });
    expect(cardTitles('Qualified')).toContain('Fleet renewal');
  });

  it('puts the card back and shows the server’s reason when the move is refused', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'CRM_TRANSITION_VETOED',
          message: 'A signed contract is required before qualifying.',
        },
      }),
    );
    await renderBoard();

    let outcome: Promise<unknown> | void = undefined;
    act(() => {
      outcome = handed?.onMove(ID(1), 'new', 'qualified');
    });
    // The rejection is the primitive's rollback signal, so it must reach it.
    await act(async () => {
      await expect(outcome).rejects.toBeInstanceOf(ApiError);
    });

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/A signed contract is required before qualifying\./)).toBeInTheDocument();
    expect(within(alert).getByText(en('board.move.refused', { title: 'Fleet renewal', status: 'Qualified' }))).toBeInTheDocument();
    expect(cardTitles('New')).toEqual(['Fleet renewal', 'Winter tyres']);
    expect(cardTitles('Qualified')).toEqual(['Lease extension']);
    expect(within(lane('New')).getByText(en('board.column.count', { count: 2 }))).toBeInTheDocument();
    // A veto changed nothing on the server, so the board is not read again.
    expect(boardCalls()).toHaveLength(1);
    // What the primitive speaks carries the reason too.
    expect(
      handed?.labels.moveFailed(
        FLEET,
        { status: STATUS.new },
        { status: STATUS.qualified },
        new ApiError(409, { error: { code: 'CRM_TRANSITION_VETOED', message: 'No.' } }),
      ),
    ).toBe(en('board.announce.moveFailed', { title: 'Fleet renewal', status: 'New', reason: 'No.' }));
  });

  it('reads the board again when the server says the opportunity is no longer where the board had it', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'CRM_INVALID_TRANSITION', message: 'The workflow does not allow this move.' },
      }),
    );
    await renderBoard();
    const menu = await openMoveMenu('Fleet renewal');
    await userEvent.click(within(menu).getByRole('button', { name: 'Qualified' }));
    expect(await screen.findByText(/The workflow does not allow this move\./)).toBeInTheDocument();
    await waitFor(() => expect(boardCalls()).toHaveLength(2));
  });
});

describe('OpportunityBoardPage — orders that did not follow', () => {
  it('says so after the move, on the card and beside the board, with a way to the opportunity', async () => {
    const refused = propagation({ orderId: ORDER_ID, orderNumber: 'ORD-1001' });
    postSpy.mockResolvedValue(
      movedTo(FLEET, STATUS.qualified, [
        refused,
        propagation({ id: ID(70), outcome: 'applied', detail: null, orderNumber: 'ORD-1002' }),
      ]),
    );
    await renderBoard();
    const menu = await openMoveMenu('Fleet renewal');
    await userEvent.click(within(menu).getByRole('button', { name: 'Qualified' }));

    // Beside the board: the Opportunity moved, one Order did not, and why.
    const notice = await screen.findByRole('region', { name: en('board.refusals.title') });
    expect(
      within(notice).getByText(
        en('board.refusals.item', { number: 'OPP-000001', status: 'Qualified', count: 1 }),
      ),
    ).toBeInTheDocument();
    expect(within(notice).getByText(new RegExp(refused.detail as string))).toBeInTheDocument();
    expect(within(notice).getByRole('link', { name: en('board.refusals.open', { number: 'OPP-000001' }) })).toHaveAttribute(
      'href',
      `/crm/opportunities/${ID(1)}`,
    );
    // On the card, which is in its new lane — the move stands.
    const card = within(lane('Qualified')).getByRole('link', { name: 'Fleet renewal' }).closest('li') as HTMLElement;
    expect(within(card).getByText(en('board.card.refusals', { count: 1 }))).toBeInTheDocument();

    // Dismissing the notice hides the notice, not the fact.
    await userEvent.click(
      within(notice).getByRole('button', { name: en('board.refusals.dismiss', { number: 'OPP-000001' }) }),
    );
    expect(screen.queryByRole('region', { name: en('board.refusals.title') })).toBeNull();
    expect(within(card).getByText(en('board.card.refusals', { count: 1 }))).toBeInTheDocument();
  });

  it('says nothing of the kind when every order followed', async () => {
    postSpy.mockResolvedValue(
      movedTo(FLEET, STATUS.qualified, [propagation({ outcome: 'applied', detail: null })]),
    );
    await renderBoard();
    const menu = await openMoveMenu('Fleet renewal');
    await userEvent.click(within(menu).getByRole('button', { name: 'Qualified' }));
    await waitFor(() => expect(cardTitles('Qualified')).toContain('Fleet renewal'));
    expect(screen.queryByRole('region', { name: en('board.refusals.title') })).toBeNull();
  });
});

describe('OpportunityBoardPage — filters', () => {
  it('asks for the board without a filter first, and never for the two the endpoint refuses', async () => {
    await renderBoard();
    expect(boardCalls()).toEqual([BOARD_PATH]);
  });

  it('drives the query from the filter bar it shares with the list', async () => {
    await renderBoard();
    await userEvent.type(screen.getByLabelText(en('opportunity.list.filter.search')), 'fleet');
    await waitFor(() => expect(boardCalls().at(-1)).toBe(`${BOARD_PATH}?q=fleet`));

    await userEvent.type(screen.getByLabelText(en('opportunity.list.filter.createdFrom')), '2026-10-01');
    await waitFor(() =>
      expect(boardCalls().at(-1)).toBe(`${BOARD_PATH}?q=fleet&createdFrom=2026-10-01`),
    );
    for (const path of boardCalls()) {
      expect(path).not.toMatch(/tagId|assignedAdminUserId|statusCode|state=/);
    }

    await userEvent.click(screen.getByRole('button', { name: en('opportunity.list.filter.clear') }));
    await waitFor(() => expect(boardCalls().at(-1)).toBe(BOARD_PATH));
    expect(screen.getByLabelText(en('opportunity.list.filter.search'))).toHaveValue('');
  });

  it('says that nothing matches when a filter leaves a lane empty', async () => {
    await renderBoard();
    current = boardData();
    for (const entry of current.columns) Object.assign(entry, { items: [], count: 0, valueTotals: [] });
    await userEvent.type(screen.getByLabelText(en('opportunity.list.filter.search')), 'zzz');
    expect(
      await within(lane('New')).findByText(en('board.column.emptyFiltered')),
    ).toBeInTheDocument();
  });
});

describe('OpportunityBoardPage — loading, failure and more cards', () => {
  it('shows the lanes of the workflow as loading until the board answers', async () => {
    let resolve: (value: unknown) => void = () => {};
    getSpy.mockImplementation((path: string) => {
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: WORKFLOW });
      if (path.startsWith(BOARD_PATH)) return new Promise((done) => (resolve = done));
      return crmLookupResponse(path) ?? Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderCrm(<OpportunityBoardPage />, { path: '/crm/board', pattern: '/crm/board' });
    const fresh = await screen.findByRole('group', { name: en('board.column.label', { status: 'New' }) });
    expect(fresh).toHaveAttribute('aria-busy', 'true');
    expect(within(fresh).getByText(en('board.column.loading'))).toBeInTheDocument();

    await act(async () => {
      resolve({ data: boardData() });
    });
    expect(await screen.findByRole('link', { name: 'Fleet renewal' })).toBeInTheDocument();
    expect(lane('New')).not.toHaveAttribute('aria-busy');
  });

  it('says the board could not be loaded, per lane and with one way to try again', async () => {
    let fail = true;
    getSpy.mockImplementation((path: string) => {
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: WORKFLOW });
      if (path.startsWith(BOARD_PATH)) {
        return fail
          ? Promise.reject(new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } }))
          : Promise.resolve({ data: boardData() });
      }
      return crmLookupResponse(path) ?? Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderCrm(<OpportunityBoardPage />, { path: '/crm/board', pattern: '/crm/board' });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Boom.')).toBeInTheDocument();
    expect(
      within(await screen.findByRole('group', { name: en('board.column.label', { status: 'New' }) })).getByText(
        en('board.column.error'),
      ),
    ).toBeInTheDocument();

    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Fleet renewal' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the workflow could not be loaded when there are no lanes to draw', async () => {
    getSpy.mockImplementation(() =>
      Promise.reject(new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } })),
    );
    renderCrm(<OpportunityBoardPage />, { path: '/crm/board', pattern: '/crm/board' });
    expect(await screen.findByText('Boom.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('continues a lane that holds more cards from the list, under the same filters', async () => {
    current = boardData();
    current.columns[0]!.hasMore = true;
    current.columns[0]!.count = 3;
    const third = summary({ id: ID(5), number: 'OPP-000005', title: 'Depot lighting', value: '50.00' });
    const fourth = summary({ id: ID(6), number: 'OPP-000006', title: 'Fuel cards', value: '10.00' });
    getSpy.mockImplementation((path: string) => {
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: WORKFLOW });
      if (path.startsWith(BOARD_PATH)) return Promise.resolve({ data: current });
      if (path.startsWith(`${LIST_PATH}?`)) {
        return path.includes('cursor=next')
          ? Promise.resolve({ data: [fourth], pagination: { cursor: null, hasMore: false, limit: 200 } })
          : Promise.resolve({
              data: [FLEET, TYRES, third],
              pagination: { cursor: 'next', hasMore: true, limit: 200 },
            });
      }
      return crmLookupResponse(path) ?? Promise.reject(new Error(`unexpected GET ${path}`));
    });
    await renderBoard();
    const fresh = lane('New');
    expect(within(fresh).getByText(en('board.column.shown', { shown: 2, count: 3 }))).toBeInTheDocument();
    await userEvent.click(within(fresh).getByRole('button', { name: en('board.column.more', { status: 'New' }) }));
    await waitFor(() => expect(cardTitles('New')).toEqual(['Fleet renewal', 'Winter tyres', 'Depot lighting']));
    expect(getSpy).toHaveBeenCalledWith(`${LIST_PATH}?statusCode=new&limit=200`);

    await userEvent.click(within(fresh).getByRole('button', { name: en('board.column.more', { status: 'New' }) }));
    await waitFor(() => expect(cardTitles('New')).toHaveLength(4));
    expect(getSpy).toHaveBeenCalledWith(`${LIST_PATH}?statusCode=new&cursor=next&limit=200`);
    // Nothing more to fetch: the control is gone.
    expect(
      within(fresh).queryByRole('button', { name: en('board.column.more', { status: 'New' }) }),
    ).toBeNull();
  });
});
