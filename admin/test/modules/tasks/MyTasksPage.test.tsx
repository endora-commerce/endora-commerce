import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskBoard } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { OTHER_TASK_ID, TASK_ID, core, en, renderTasks, taskSummary, STATUS, workflow } from './tasks-fixtures';

/**
 * *My Tasks* (`specs/165-task-management/` User Story 3 scenario 6, FR-018;
 * 163's FR-033): the caller's open Tasks, the soonest due first, in list or
 * board form — the choice remembered under `listViewModes['tasks-mine']` —
 * with the list's filters. Who, open and published are implied: the screen
 * offers no assignee, category or draft filter, and the board is asked for
 * them.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

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
      post: vi.fn(),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { MyTasksPage } = await import('../../../../packages/modules/tasks/src/admin/pages/MyTasksPage');

const MINE_PATH = '/api/v1/admin/tasks/mine';
const BOARD_PATH = '/api/v1/admin/tasks/board';
const PREFERENCES_PATH = '/api/v1/admin/me/preferences';

const OVERDUE = taskSummary({
  id: OTHER_TASK_ID,
  number: 'TSK-000002',
  title: 'Sign the handover',
  dueOn: '2026-10-01',
  overdue: true,
});
const UNDATED = taskSummary({
  id: '00000000-0000-4000-8000-0000000007a3',
  number: 'TSK-000003',
  title: 'Photograph the hall',
  dueOn: null,
  context: null,
});

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

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  patchSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === MINE_PATH || path.startsWith(`${MINE_PATH}?`)) return Promise.resolve({ data: [OVERDUE, taskSummary(), UNDATED] });
    if (path === '/api/v1/admin/tasks/workflow') return Promise.resolve({ data: workflow() });
    // The *Daily digest* control (User Story 7) reads the caller's digest: off.
    if (path === '/api/v1/admin/tasks/me/digest') return Promise.resolve({ data: null });
    if (path === '/api/v1/admin/tasks/board/card-fields') return Promise.resolve({ data: { fields: [], available: [], maxFields: 6 } });
    if (path.startsWith(BOARD_PATH)) return Promise.resolve({ data: board() });
    if (path.startsWith('/api/v1/admin/tasks/priorities')) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/tasks/tags')) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/tasks/custom-field-filters')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  patchSpy.mockImplementation((_path: string, body: unknown) => Promise.resolve({ data: body }));
});

function lastQuery(prefix: string): URLSearchParams | null {
  const paths = getSpy.mock.calls.map(([path]) => path as string).filter((path) => path === prefix || path.startsWith(`${prefix}?`));
  const last = paths[paths.length - 1];
  return last === undefined ? null : new URLSearchParams(last.split('?')[1] ?? '');
}

function viewButton(name: 'list' | 'board'): HTMLElement {
  return within(screen.getByRole('group', { name: core('common.viewMode.label') })).getByRole('button', { name: core(`common.viewMode.${name}`) });
}

describe('MyTasksPage', () => {
  it("reads the caller's open Tasks and keeps the server's order, overdue marked in words", async () => {
    renderTasks(<MyTasksPage />, { path: '/tasks/mine', pattern: '/tasks/mine' });
    await screen.findByText('Sign the handover');
    const numbers = screen
      .getAllByRole('link')
      .map((link) => link.textContent)
      .filter((text) => text?.startsWith('TSK-'));
    expect(numbers).toEqual(['TSK-000002', 'TSK-000001', 'TSK-000003']);
    expect(screen.getByRole('link', { name: 'TSK-000001' }).getAttribute('href')).toBe(`/tasks/${TASK_ID}`);
    expect(screen.getByRole('link', { name: 'TSK-000001' })).toHaveClass('whitespace-nowrap');
    const row = screen.getByText('Sign the handover').closest('tr') as HTMLElement;
    expect(within(row).getByText(en('list.overdue'))).toBeTruthy();
  });

  it('filters as the list does, offering nothing that is implied', async () => {
    renderTasks(<MyTasksPage />, { path: '/tasks/mine', pattern: '/tasks/mine' });
    await screen.findByText('Sign the handover');
    expect(screen.queryByLabelText(en('list.filter.assignee'))).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
    expect(screen.getByLabelText(en('filter.creator'))).toBeTruthy();
    expect(screen.queryByLabelText(en('filter.statusCategory'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('filter.draft') })).toBeNull();
    await screen.findByRole('option', { name: STATUS.in_progress.name });
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.status')), 'in_progress');
    await waitFor(() => expect(lastQuery(MINE_PATH)?.getAll('status')).toEqual(['in_progress']));
  });

  it('switches to the board under its own list id, asking the board for what My Tasks implies', async () => {
    renderTasks(<MyTasksPage />, { path: '/tasks/mine', pattern: '/tasks/mine', preferences: { listViewModes: { tasks: 'board' } } });
    // The Tasks screen's choice is not My Tasks': this one opens as a list.
    await screen.findByText('Sign the handover');
    expect(viewButton('list')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(viewButton('board'));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(PREFERENCES_PATH, { listViewModes: { 'tasks-mine': 'board' } }),
    );
    await waitFor(() => expect(lastQuery(BOARD_PATH)).not.toBeNull());
    const query = lastQuery(BOARD_PATH)!;
    expect(query.getAll('assignee')).toEqual(['me']);
    expect(query.getAll('statusCategory')).toEqual(['open']);
    expect(query.get('draft')).toBe('false');
  });

  it('says when nothing open is assigned to the caller', async () => {
    const answer = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) => (path.startsWith(MINE_PATH) ? Promise.resolve({ data: [] }) : answer(path)));
    renderTasks(<MyTasksPage />, { path: '/tasks/mine', pattern: '/tasks/mine' });
    expect(await screen.findByText(en('mine.empty.title'))).toBeTruthy();
    // The empty state offers the next step to a writer (T092).
    expect(screen.getByRole('link', { name: en('list.new') })).toHaveAttribute('href', '/tasks/new');
  });

  it('clears a filter that found nothing from the empty state, and puts focus on the search box (WCAG 2.4.3)', async () => {
    const answer = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) => (path.startsWith(MINE_PATH) ? Promise.resolve({ data: [] }) : answer(path)));
    renderTasks(<MyTasksPage />, { path: '/tasks/mine', pattern: '/tasks/mine' });
    expect(await screen.findByText(en('mine.empty.title'))).toBeTruthy();
    await screen.findByRole('option', { name: STATUS.in_progress.name });
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.status')), 'in_progress');
    const block = await waitFor(() => document.querySelector<HTMLElement>('[data-empty-state="no-results"]')!);
    expect(block).not.toBeNull();
    await userEvent.click(within(block).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(en('list.search'))));
  });

  it('offers no New task in the empty state to a reader', async () => {
    const answer = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) => (path.startsWith(MINE_PATH) ? Promise.resolve({ data: [] }) : answer(path)));
    renderTasks(<MyTasksPage />, { path: '/tasks/mine', pattern: '/tasks/mine', permissions: ['tasks:read'] });
    expect(await screen.findByText(en('mine.empty.title'))).toBeTruthy();
    expect(screen.queryByRole('link', { name: en('list.new') })).toBeNull();
  });

  it('is aria-busy and says so while it reads again after a filter change (WCAG 4.1.3)', async () => {
    const answer = getSpy.getMockImplementation()!;
    let pending: ((value: unknown) => void) | null = null;
    getSpy.mockImplementation((path: string) => {
      if (path.startsWith(`${MINE_PATH}?`) && path.includes('status=')) return new Promise((resolve) => (pending = resolve));
      return answer(path);
    });
    renderTasks(<MyTasksPage />, { path: '/tasks/mine', pattern: '/tasks/mine' });
    const table = (await screen.findByText('Sign the handover')).closest('[aria-busy]') as HTMLElement;
    expect(table).toHaveAttribute('aria-busy', 'false');
    await screen.findByRole('option', { name: STATUS.in_progress.name });
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.status')), 'in_progress');
    await waitFor(() => expect(table).toHaveAttribute('aria-busy', 'true'));
    expect(within(table).getByText(en('mine.loading'))).toHaveClass('sr-only');
    // The rows already shown stay while the new answer is on its way.
    expect(screen.getByText('Sign the handover')).toBeTruthy();
    await act(async () => pending?.({ data: [UNDATED] }));
    await waitFor(() => expect(table).toHaveAttribute('aria-busy', 'false'));
    expect(screen.queryByText('Sign the handover')).toBeNull();
  });

  it("shows the server's sentence when the read fails", async () => {
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    const answer = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) =>
      path.startsWith(MINE_PATH)
        ? Promise.reject(new ApiError(503, { error: { code: 'MODULE_DISABLED', message: 'Tasks is switched off.' } }))
        : answer(path),
    );
    renderTasks(<MyTasksPage />, { path: '/tasks/mine', pattern: '/tasks/mine' });
    expect(await screen.findByText('Tasks is switched off.')).toBeTruthy();
  });
});
