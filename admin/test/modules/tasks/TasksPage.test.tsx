import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SavedListView, TaskBoard } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  OTHER_TASK_ID,
  PROJECT_ID,
  TASK_ID,
  core,
  en,
  renderTasks,
  taskSummary,
  STATUS,
  workflow,
} from './tasks-fixtures';

/**
 * The Tasks screen (`specs/165-task-management/` User Story 3, FR-018 –
 * FR-021; `contracts/admin-surfaces.md` §1) — 163's list, grown: a list or a
 * board, the choice remembered for the admin across devices (the preference
 * `listViewModes.tasks`, saved through `PATCH /me/preferences`); filters in the
 * address, the same for both views; saved views; the list sorted by any of
 * FR-020's keys.
 *
 * Every Task the operator may see — the server hides what they may not — so
 * nothing here filters for safety.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  // The preference store is created inside the kit and talks through the kit's
  // own client, which this module mock does not replace: its `patch` is routed
  // to the same spy, so a saved choice is seen.
  actual.apiClient.patch = ((...args: unknown[]) => patchSpy(...args)) as typeof actual.apiClient.patch;
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { TasksPage } = await import('../../../../packages/modules/tasks/src/admin/pages/TasksPage');

const LIST_PATH = '/api/v1/admin/tasks';
const WORKFLOW_PATH = '/api/v1/admin/tasks/workflow';
const BOARD_PATH = '/api/v1/admin/tasks/board';
const CARD_FIELDS_PATH = '/api/v1/admin/tasks/board/card-fields';
const VIEWS_PATH = '/api/v1/admin/tasks/list-views';
const PREFERENCES_PATH = '/api/v1/admin/me/preferences';

const UNAVAILABLE = taskSummary({
  id: OTHER_TASK_ID,
  number: 'TSK-000002',
  title: 'Sign the handover',
  status: STATUS.in_progress,
  dueOn: '2026-10-01',
  overdue: true,
  assignees: [],
  context: { type: 'project', available: false, label: 'Unavailable record', href: null, groupLabel: null },
});

const HIGH_PRIORITY_VIEW: SavedListView = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Urgent installs',
  shared: false,
  ownerAdminUserId: '00000000-0000-4000-8000-00000000ad01',
  ownedByCaller: true,
  canModify: true,
  filters: { status: ['in_progress'], assignee: ['me'] },
  sort: { field: 'due', dir: 'asc' },
};

function board(): TaskBoard {
  return {
    columns: workflow().statuses.map((status) => ({
      status: { code: status.code, name: status.defaultName, color: status.color, category: status.category },
      count: status.code === 'todo' ? 1 : 0,
      items: status.code === 'todo' ? [taskSummary()] : [],
      hasMore: false,
    })),
  };
}

let listAnswer: (path: string) => unknown = () => ({ items: [taskSummary(), UNAVAILABLE], nextCursor: null });

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  patchSpy.mockReset();
  postSpy.mockReset();
  listAnswer = () => ({ items: [taskSummary(), UNAVAILABLE], nextCursor: null });
  getSpy.mockImplementation((path: string) => {
    if (path === WORKFLOW_PATH) return Promise.resolve({ data: workflow() });
    if (path === CARD_FIELDS_PATH) {
      return Promise.resolve({ data: { fields: [], available: [], maxFields: 6 } });
    }
    if (path.startsWith(VIEWS_PATH)) return Promise.resolve({ data: [HIGH_PRIORITY_VIEW] });
    if (path.startsWith(BOARD_PATH)) return Promise.resolve({ data: board() });
    if (path.startsWith(`${LIST_PATH}/priorities`)) return Promise.resolve({ data: [] });
    if (path.startsWith(`${LIST_PATH}/tags`)) return Promise.resolve({ data: [] });
    if (path.startsWith(`${LIST_PATH}/custom-field-filters`)) return Promise.resolve({ data: [] });
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) return Promise.resolve(listAnswer(path));
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  patchSpy.mockImplementation((path: string, body: unknown) =>
    path === PREFERENCES_PATH ? Promise.resolve({ data: body }) : Promise.reject(new Error(`unexpected PATCH ${path}`)),
  );
});

function queryOf(path: string): URLSearchParams {
  return new URLSearchParams(path.split('?')[1] ?? '');
}

/** The query of the last list read. */
function lastListQuery(): URLSearchParams {
  const paths = getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path === LIST_PATH || path.startsWith(`${LIST_PATH}?`));
  return queryOf(paths[paths.length - 1] ?? '');
}

/** The query of the last board read, or `null` when the board was never read. */
function lastBoardQuery(): URLSearchParams | null {
  const paths = getSpy.mock.calls.map(([path]) => path as string).filter((path) => path.startsWith(`${BOARD_PATH}?`) || path === BOARD_PATH);
  const last = paths[paths.length - 1];
  return last === undefined ? null : queryOf(last);
}

/** The filter bar's disclosure while it is collapsed and nothing hidden is in use. */
function moreFilters(): HTMLElement {
  return screen.getByRole('button', { name: en('filter.more') });
}

function viewButton(name: 'list' | 'board'): HTMLElement {
  return within(screen.getByRole('group', { name: en('view.label') })).getByRole('button', { name: en(`view.${name}`) });
}

describe('TasksPage — the list', () => {
  it('lists each Task with its number, title, status, due date and assignee', async () => {
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    const link = await screen.findByRole('link', { name: 'TSK-000001' });
    expect(link.getAttribute('href')).toBe(`/tasks/${TASK_ID}`);
    // The number never breaks at its hyphen into "TSK-" / "000001" (T095).
    expect(link).toHaveClass('whitespace-nowrap');
    expect(screen.getByText('Order the racking')).toBeTruthy();
    expect(screen.getAllByText(STATUS.todo.name).length).toBeGreaterThan(0);
    expect(screen.getByText('Anna Nowak')).toBeTruthy();
    const unassigned = screen.getByText('Sign the handover').closest('tr') as HTMLElement;
    expect(within(unassigned).getByText(en('list.unassigned'))).toBeTruthy();
    expect(within(unassigned).getByText(en('list.overdue'))).toBeTruthy();
  });

  it('marks a draft, a private Task and a sub-task beside the title (T092)', async () => {
    listAnswer = () => ({
      items: [
        taskSummary({ draft: true, private: true, parent: { id: OTHER_TASK_ID, number: 'TSK-000009', available: true } }),
        { ...UNAVAILABLE, parent: { id: TASK_ID, number: null, available: false } },
      ],
      nextCursor: null,
    });
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    const marked = (await screen.findByText('Order the racking')).closest('tr') as HTMLElement;
    expect(within(marked).getByText(en('detail.draftBadge'))).toBeTruthy();
    expect(within(marked).getByText(en('detail.privateBadge'))).toBeTruthy();
    expect(within(marked).getByText(en('list.subtaskOf', { number: 'TSK-000009' }))).toBeTruthy();
    const hiddenParent = screen.getByText('Sign the handover').closest('tr') as HTMLElement;
    expect(within(hiddenParent).getByText(en('list.subtaskOfHidden'))).toBeTruthy();
    expect(within(hiddenParent).queryByText(en('detail.draftBadge'))).toBeNull();
    expect(within(hiddenParent).queryByText(en('detail.privateBadge'))).toBeNull();
  });

  it('names the priority and tag pickers by their visible labels, not by a second copy (T092)', async () => {
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    await screen.findByText('Order the racking');
    await userEvent.click(moreFilters());
    for (const name of [en('filter.priority'), en('filter.tags')]) {
      const trigger = screen.getByRole('button', { name });
      expect(trigger).not.toHaveAttribute('aria-label');
      expect(document.getElementById(trigger.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(name);
    }
  });

  it('links an available context to its record, and names an unavailable one without a link', async () => {
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    const context = await screen.findByRole('link', { name: /PRJ-000001 Warehouse fit-out/ });
    expect(context.getAttribute('href')).toBe(`/projects/${PROJECT_ID}`);
    const row = screen.getByText('Sign the handover').closest('tr') as HTMLElement;
    expect(within(row).queryByRole('link', { name: 'Unavailable record' })).toBeNull();
  });

  it('asks the server for the filters chosen, and keeps them in the address', async () => {
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    await screen.findByText('Order the racking');
    await screen.findByRole('option', { name: STATUS.done.name });
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.status')), 'done');
    await waitFor(() => expect(lastListQuery().getAll('status')).toEqual(['done']));
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.assignee')), 'me');
    await waitFor(() => expect(lastListQuery().getAll('assignee')).toEqual(['me']));
    await userEvent.click(moreFilters());
    await userEvent.selectOptions(screen.getByLabelText(en('filter.statusCategory')), 'closed');
    await waitFor(() => expect(lastListQuery().getAll('statusCategory')).toEqual(['done', 'cancelled']));
    await userEvent.selectOptions(screen.getByLabelText(en('filter.creator')), 'me');
    await waitFor(() => expect(lastListQuery().get('creator')).toBe('me'));
    await userEvent.selectOptions(screen.getByLabelText(en('filter.hierarchy')), 'subtasks');
    await waitFor(() => expect(lastListQuery().get('isSubtask')).toBe('true'));
    await userEvent.click(screen.getByLabelText(en('list.filter.overdue')));
    await waitFor(() => expect(lastListQuery().get('overdue')).toBe('true'));
    await userEvent.click(screen.getByLabelText(en('filter.draft')));
    await waitFor(() => expect(lastListQuery().get('draft')).toBe('true'));
    await userEvent.type(screen.getByLabelText(en('filter.dueFrom')), '2026-11-01');
    await waitFor(() => expect(lastListQuery().get('dueFrom')).toBe('2026-11-01'));
    await userEvent.type(screen.getByLabelText(en('list.search')), 'rack');
    await waitFor(() => expect(lastListQuery().get('q')).toBe('rack'));
  });

  it('reads the filters from the address it was opened at', async () => {
    renderTasks(<TasksPage />, { path: '/tasks?status=done&priority=high&tagId=00000000-0000-4000-8000-0000000000a1', pattern: '/tasks' });
    await screen.findByText('Order the racking');
    const query = lastListQuery();
    expect(query.getAll('status')).toEqual(['done']);
    expect(query.getAll('priority')).toEqual(['high']);
    expect(query.getAll('tagId')).toEqual(['00000000-0000-4000-8000-0000000000a1']);
  });

  it('sorts by any of the list’s keys, in both directions', async () => {
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    await screen.findByText('Order the racking');
    await userEvent.selectOptions(screen.getByLabelText(en('list.sort.label')), 'due:asc');
    await waitFor(() => {
      expect(lastListQuery().get('sort')).toBe('due');
      expect(lastListQuery().get('dir')).toBe('asc');
    });
    await userEvent.selectOptions(screen.getByLabelText(en('list.sort.label')), 'priority:desc');
    await waitFor(() => expect(lastListQuery().get('sort')).toBe('priority'));
  });

  it('pages forward with the cursor the server answered, and back', async () => {
    listAnswer = (path) =>
      path.includes('cursor=c2') ? { items: [UNAVAILABLE], nextCursor: null } : { items: [taskSummary()], nextCursor: 'c2' };
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    await screen.findByText('Order the racking');
    const pages = screen.getByRole('navigation', { name: core('cursorPagination.label') });
    expect(within(pages).getByText(core('cursorPagination.page', { page: 1 }))).toBeTruthy();
    await userEvent.click(within(pages).getByRole('button', { name: core('common.pagination.next') }));
    expect(await screen.findByText('Sign the handover')).toBeTruthy();
    expect(lastListQuery().get('cursor')).toBe('c2');
    expect(within(pages).getByText(core('cursorPagination.page', { page: 2 }))).toBeTruthy();
    await userEvent.click(within(pages).getByRole('button', { name: core('common.pagination.previous') }));
    expect(await screen.findByText('Order the racking')).toBeTruthy();
  });

  it('pages with the kit’s CursorPagination: a rows-per-page choice up to the API’s limit, starting again from page one (#512)', async () => {
    listAnswer = (path) =>
      path.includes('cursor=c2') ? { items: [UNAVAILABLE], nextCursor: null } : { items: [taskSummary()], nextCursor: 'c2' };
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    await screen.findByText('Order the racking');
    const pages = screen.getByRole('navigation', { name: core('cursorPagination.label') });
    const size = within(pages).getByLabelText(core('common.pagination.rowsPerPage'));
    const offered = within(size).getAllByRole('option').map((option) => Number((option as HTMLOptionElement).value));
    expect(Math.max(...offered)).toBeLessThanOrEqual(100);
    expect(lastListQuery().get('limit')).toBe((size as HTMLSelectElement).value);
    await userEvent.click(within(pages).getByRole('button', { name: core('common.pagination.next') }));
    await screen.findByText('Sign the handover');
    await userEvent.selectOptions(size, '50');
    await waitFor(() => expect(lastListQuery().get('limit')).toBe('50'));
    expect(lastListQuery().get('cursor')).toBeNull();
  });

  it('offers "New task" to a writer only', async () => {
    const writer = renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    expect((await screen.findByRole('link', { name: en('list.new') })).getAttribute('href')).toBe('/tasks/new');
    writer.unmount();
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks', permissions: ['tasks:read'] });
    await screen.findByText('Order the racking');
    expect(screen.queryByRole('link', { name: en('list.new') })).toBeNull();
  });

  it('says there is nothing yet, and offers to clear filters when filtering found nothing', async () => {
    listAnswer = () => ({ items: [], nextCursor: null });
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    expect(await screen.findByText(en('list.empty.title'))).toBeTruthy();
    await screen.findByRole('option', { name: STATUS.done.name });
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.status')), 'done');
    expect(await screen.findByText(en('list.noResults.title'))).toBeTruthy();
    // Clearing from the empty state puts focus on the search box, not <body> (WCAG 2.4.3).
    const block = document.querySelector<HTMLElement>('[data-empty-state="no-results"]')!;
    await userEvent.click(within(block).getByRole('button', { name: en('list.filter.clear') }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(en('list.search'))));
  });
});

describe('TasksPage — the filter bar (#512, Hick’s law)', () => {
  it('shows search, status, assignee and due at once, and the rest behind More filters', async () => {
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    await screen.findByText('Order the racking');
    for (const label of ['list.search', 'list.filter.status', 'list.filter.assignee', 'filter.dueFrom', 'filter.dueTo', 'list.filter.overdue']) {
      expect(screen.getByLabelText(en(label))).toBeTruthy();
    }
    for (const label of ['filter.statusCategory', 'filter.creator', 'filter.hierarchy', 'filter.draft', 'filter.private']) {
      expect(screen.queryByLabelText(en(label))).toBeNull();
    }
    const toggle = moreFilters();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    const fewer = screen.getByRole('button', { name: en('filter.fewer') });
    expect(fewer).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(fewer.getAttribute('aria-controls') ?? '')).toContainElement(
      screen.getByLabelText(en('filter.creator')),
    );
    await userEvent.click(fewer);
    expect(screen.queryByLabelText(en('filter.creator'))).toBeNull();
  });

  it('counts the filters it hides that are in use, so a collapsed bar never hides that the list is narrowed', async () => {
    renderTasks(<TasksPage />, {
      path: '/tasks?priority=high&tagId=00000000-0000-4000-8000-0000000000a1&creator=me&status=done',
      pattern: '/tasks',
    });
    await screen.findByText('Order the racking');
    expect(screen.getByRole('button', { name: en('filter.moreCount', { count: 3 }) })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('TasksPage — list or board (FR-018)', () => {
  it('switches to the board and saves the choice as `listViewModes.tasks`', async () => {
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks', preferences: {} });
    await screen.findByText('Order the racking');
    expect(viewButton('list')).toHaveAttribute('aria-pressed', 'true');
    expect(lastBoardQuery()).toBeNull();

    await userEvent.click(viewButton('board'));
    expect(viewButton('board')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(PREFERENCES_PATH, { listViewModes: { tasks: 'board' } }));
    await waitFor(() => expect(lastBoardQuery()).not.toBeNull());
    expect(await screen.findByRole('group', { name: en('board.column.label', { status: 'To do' }) })).toBeTruthy();
  });

  it('opens on the board when that is the admin’s remembered choice', async () => {
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks', preferences: { listViewModes: { tasks: 'board' } } });
    await waitFor(() => expect(lastBoardQuery()).not.toBeNull());
    expect(viewButton('board')).toHaveAttribute('aria-pressed', 'true');
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('carries the filters over from the list to the board and back', async () => {
    renderTasks(<TasksPage />, { path: '/tasks?priority=high', pattern: '/tasks', preferences: {} });
    await screen.findByText('Order the racking');
    await screen.findByRole('option', { name: STATUS.done.name });
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.status')), 'done');
    await waitFor(() => expect(lastListQuery().getAll('status')).toEqual(['done']));

    await userEvent.click(viewButton('board'));
    await waitFor(() => expect(lastBoardQuery()?.getAll('status')).toEqual(['done']));
    expect(lastBoardQuery()?.getAll('priority')).toEqual(['high']);
    // The board takes no sort and no cursor.
    expect(lastBoardQuery()?.has('sort')).toBe(false);

    await userEvent.click(viewButton('list'));
    await waitFor(() => expect(lastListQuery().getAll('status')).toEqual(['done']));
    expect(lastListQuery().getAll('priority')).toEqual(['high']);
  });
});

describe('TasksPage — saved views (FR-021)', () => {
  it('applies a saved view’s filters and sort to the list', async () => {
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    await screen.findByText('Order the racking');
    await screen.findByRole('option', { name: HIGH_PRIORITY_VIEW.name });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: core('savedViews.label') }), HIGH_PRIORITY_VIEW.id);
    await waitFor(() => expect(lastListQuery().getAll('status')).toEqual(['in_progress']));
    expect(lastListQuery().getAll('assignee')).toEqual(['me']);
    expect(lastListQuery().get('sort')).toBe('due');
    expect(lastListQuery().get('dir')).toBe('asc');
  });

  it('drops a saved value that no longer exists, and says so', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: workflow() });
      if (path.startsWith(VIEWS_PATH)) {
        return Promise.resolve({ data: [{ ...HIGH_PRIORITY_VIEW, filters: { status: ['in_review', 'done'] } }] });
      }
      if (path.startsWith(`${LIST_PATH}/priorities`)) return Promise.resolve({ data: [] });
      if (path.startsWith(`${LIST_PATH}/tags`)) return Promise.resolve({ data: [] });
      if (path.startsWith(`${LIST_PATH}/custom-field-filters`)) return Promise.resolve({ data: [] });
      if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) return Promise.resolve(listAnswer(path));
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderTasks(<TasksPage />, { path: '/tasks', pattern: '/tasks' });
    await screen.findByText('Order the racking');
    await screen.findByRole('option', { name: HIGH_PRIORITY_VIEW.name });
    // The notice's live region is on the page, empty, before the notice arrives
    // — one that mounts already carrying its text is not reliably announced
    // (WCAG 4.1.3; `ux-laws` §4; 165 T092).
    const region = document.getElementById('tasks-views-notice');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.textContent).toBe('');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: core('savedViews.label') }), HIGH_PRIORITY_VIEW.id);
    await waitFor(() => expect(lastListQuery().getAll('status')).toEqual(['done']));
    expect(await screen.findByText(en('views.stale', { count: 1 }))).toBeTruthy();
    expect(document.getElementById('tasks-views-notice')).toBe(region);
    expect(region?.textContent).toBe(en('views.stale', { count: 1 }));
  });
});
