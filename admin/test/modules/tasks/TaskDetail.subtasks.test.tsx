import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { TaskDetail as TaskDetailData, TaskSummary } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  ANNA_ID,
  OTHER_TASK_ID,
  STATUS,
  TASK_ID,
  core,
  en,
  historyPage,
  renderTasks,
  taskDetail,
  taskSummary,
  workflow,
} from './tasks-fixtures';

/**
 * Sub-tasks and related Tasks on a Task's screen (`specs/165-task-management/`
 * User Story 5, T061; `contracts/admin-surfaces.md` §2).
 *
 * The main column carries the sub-tasks: the parent this Task is a sub-task
 * of (a link, or a plain mention when the reader may not see it), the
 * progress line, the visible sub-tasks with status, assignees and due date,
 * *Add sub-task* (the create form with `?parent=`) and *Make sub-task of…*
 * (a picker over the Tasks list). The side column carries the related Tasks,
 * each removable, and a picker to add one. Closing a Task with open sub-tasks
 * succeeds and warns; deleting one says its sub-tasks stay.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: (...args: unknown[]) => putSpy(...args),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { TaskDetail } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskDetail');
const { TaskCreate } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskCreate');

const BASE = '/api/v1/admin/tasks';
const TASK_PATH = `${BASE}/${TASK_ID}`;
const PARENT_ID = '00000000-0000-4000-8000-0000000007b1';
const CHILD_DONE = '00000000-0000-4000-8000-0000000007c1';
const CHILD_OPEN = '00000000-0000-4000-8000-0000000007c2';

const other: TaskSummary = taskSummary({ id: OTHER_TASK_ID, number: 'TSK-000002', title: 'Book the crane', context: null });

let current: TaskDetailData = taskDetail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = taskDetail({
    subtasks: { closed: 1, total: 2 },
    subtaskItems: [
      taskSummary({
        id: CHILD_DONE,
        number: 'TSK-000011',
        title: 'Measure the bays',
        status: STATUS.done,
        closed: true,
        context: null,
      }),
      taskSummary({
        id: CHILD_OPEN,
        number: 'TSK-000012',
        title: 'Order the bolts',
        dueOn: '2026-11-07',
        assignees: [{ id: ANNA_ID, name: 'Anna Nowak', active: true }],
        context: null,
      }),
    ],
    relatedTasks: [],
  });
  getSpy.mockImplementation((path: string) => {
    if (path === TASK_PATH) return Promise.resolve({ data: current });
    if (path === `${BASE}/${PARENT_ID}`) {
      return Promise.resolve({ data: taskDetail({ id: PARENT_ID, number: 'TSK-000009', title: 'Fit out the warehouse' }) });
    }
    if (path === `${BASE}/workflow`) return Promise.resolve({ data: workflow() });
    if (path === `${BASE}/priorities`) return Promise.resolve({ data: [] });
    if (path === `${BASE}/tags`) return Promise.resolve({ data: [] });
    if (path === `${TASK_PATH}/attachments`) return Promise.resolve({ data: [] });
    if (path === `${TASK_PATH}/comments`) return Promise.resolve({ data: [] });
    if (path.startsWith(`${TASK_PATH}/history`)) return Promise.resolve(historyPage([]));
    // The pickers search the Tasks list.
    if (path.startsWith(`${BASE}?`)) {
      return Promise.resolve({ items: [taskSummary({ context: null }), other], nextCursor: null });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(permissions: readonly string[] = ['tasks:read', 'tasks:write']): Promise<void> {
  renderTasks(<TaskDetail />, { path: `/tasks/${TASK_ID}`, pattern: '/tasks/:id', permissions });
  await screen.findByRole('heading', { name: /Order the racking/ });
}

const subtasksSection = (): HTMLElement => screen.getByRole('region', { name: en('detail.subtasks') });
const relatedSection = (): HTMLElement => screen.getByRole('region', { name: en('detail.related') });
const searches = (): string[] =>
  getSpy.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith(`${BASE}?`));

describe('TaskDetail — sub-tasks (US5)', () => {
  it('shows the progress line and the visible sub-tasks with status, assignees and due date', async () => {
    await renderPage();
    const section = subtasksSection();
    expect(within(section).getByText(en('subtasks.progress', { closed: 1, total: 2 }))).toBeInTheDocument();
    const items = within(within(section).getByRole('list', { name: en('detail.subtasks') })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole('link', { name: /TSK-000011/ })).toHaveAttribute('href', `/tasks/${CHILD_DONE}`);
    expect(items[0]).toHaveTextContent('Done');
    expect(items[1]).toHaveTextContent('Order the bolts');
    expect(items[1]).toHaveTextContent('Anna Nowak');
    expect(items[1]).toHaveTextContent(new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(2026, 10, 7)));
    // No list is asked for on load: the detail carries the sub-tasks.
    expect(searches()).toEqual([]);
  });

  it('says when there is no sub-task', async () => {
    current = taskDetail();
    await renderPage();
    expect(within(subtasksSection()).getByText(en('subtasks.empty'))).toBeInTheDocument();
  });

  it('names the parent with a link, or without one when the reader may not see it', async () => {
    current = taskDetail({ parent: { id: PARENT_ID, number: 'TSK-000009', available: true } });
    await renderPage();
    expect(within(subtasksSection()).getByRole('link', { name: 'TSK-000009' })).toHaveAttribute(
      'href',
      `/tasks/${PARENT_ID}`,
    );
  });

  it('names an unavailable parent as such', async () => {
    current = taskDetail({ parent: { id: PARENT_ID, number: null, available: false } });
    await renderPage();
    expect(within(subtasksSection()).getByText(en('subtasks.parentUnavailable'))).toBeInTheDocument();
    expect(within(subtasksSection()).queryByRole('link', { name: /TSK-000009/ })).toBeNull();
  });

  it('offers Add sub-task, which opens the create form with ?parent=', async () => {
    await renderPage();
    expect(within(subtasksSection()).getByRole('link', { name: en('subtasks.add') })).toHaveAttribute(
      'href',
      `/tasks/new?parent=${TASK_ID}`,
    );
  });

  it('makes the Task a sub-task of another through the picker, and shows a refusal in the server’s words', async () => {
    patchSpy.mockRejectedValueOnce(
      new ApiError(422, { error: { code: 'TASK_PARENT_CYCLE', message: 'That task is one of this task’s own sub-tasks.' } }),
    );
    patchSpy.mockImplementation((_path: string, body: { parentTaskId: string | null }) =>
      Promise.resolve({
        data: { ...current, parent: { id: body.parentTaskId!, number: 'TSK-000002', available: true } },
      }),
    );
    await renderPage();
    await userEvent.click(within(subtasksSection()).getByRole('button', { name: en('subtasks.makeChild') }));
    const picker = await within(subtasksSection()).findByRole('combobox', { name: en('subtasks.parentPicker') });
    await userEvent.type(picker, 'crane');
    await waitFor(() => expect(searches().some((path) => path.includes('q=crane'))).toBe(true));
    // The Task itself is never offered as its own parent.
    const options = await within(subtasksSection()).findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([expect.stringContaining('Book the crane')]);
    await userEvent.click(options[0]!);
    await userEvent.click(within(subtasksSection()).getByRole('button', { name: core('common.action.save') }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { parentTaskId: OTHER_TASK_ID }));
    expect(await within(subtasksSection()).findByText('That task is one of this task’s own sub-tasks.')).toBeInTheDocument();

    await userEvent.click(within(subtasksSection()).getByRole('button', { name: core('common.action.save') }));
    expect(await within(subtasksSection()).findByRole('link', { name: 'TSK-000002' })).toHaveAttribute(
      'href',
      `/tasks/${OTHER_TASK_ID}`,
    );
  });

  it('offers Make sub-task of… on the Sub-task of line, beside Remove from parent, when there is a parent (#512)', async () => {
    current = taskDetail({ parent: { id: PARENT_ID, number: 'TSK-000009', available: true } });
    await renderPage();
    const line = within(subtasksSection()).getByRole('link', { name: 'TSK-000009' }).parentElement as HTMLElement;
    expect(within(line).getByRole('button', { name: en('subtasks.makeChild') })).toBeInTheDocument();
    expect(within(line).getByRole('button', { name: en('subtasks.detach') })).toBeInTheDocument();
    expect(within(subtasksSection()).getAllByRole('button', { name: en('subtasks.makeChild') })).toHaveLength(1);
  });

  it('detaches the Task from its parent', async () => {
    current = taskDetail({ parent: { id: PARENT_ID, number: 'TSK-000009', available: true } });
    patchSpy.mockResolvedValue({ data: { ...current, parent: null } });
    await renderPage();
    await userEvent.click(within(subtasksSection()).getByRole('button', { name: en('subtasks.detach') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { parentTaskId: null }));
    await waitFor(() => expect(within(subtasksSection()).queryByRole('link', { name: 'TSK-000009' })).toBeNull());
    // The pressed button unmounted with the parent line: focus moves to the section's opener (WCAG 2.4.3).
    await waitFor(() =>
      expect(within(subtasksSection()).getByRole('button', { name: en('subtasks.makeChild') })).toHaveFocus(),
    );
  });

  it('moves focus into the parent picker when it opens and back to its opener when it closes (WCAG 2.4.3)', async () => {
    await renderPage();
    const section = subtasksSection();
    await userEvent.click(within(section).getByRole('button', { name: en('subtasks.makeChild') }));
    await waitFor(() =>
      expect(within(section).getByRole('combobox', { name: en('subtasks.parentPicker') })).toHaveFocus(),
    );
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.cancel') }));
    await waitFor(() => expect(within(section).getByRole('button', { name: en('subtasks.makeChild') })).toHaveFocus());
  });

  it('offers no change to a reader', async () => {
    current = taskDetail({ parent: { id: PARENT_ID, number: 'TSK-000009', available: true } });
    await renderPage(['tasks:read']);
    const section = subtasksSection();
    expect(within(section).queryByRole('link', { name: en('subtasks.add') })).toBeNull();
    expect(within(section).queryByRole('button', { name: en('subtasks.makeChild') })).toBeNull();
    expect(within(section).queryByRole('button', { name: en('subtasks.detach') })).toBeNull();
    expect(within(relatedSection()).queryByRole('button', { name: en('related.add') })).toBeNull();
  });

  it('warns, after closing a Task, how many of its sub-tasks are still open', async () => {
    postSpy.mockResolvedValue({
      data: { task: { ...current, status: STATUS.done, closed: true }, openSubtasks: 1 },
    });
    await renderPage();
    const move = core('kanban.moveTo.label', { title: 'Order the racking' });
    await userEvent.click(await screen.findByRole('button', { name: move }));
    await userEvent.click(within(screen.getByRole('group', { name: move })).getByRole('button', { name: STATUS.done.name }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${TASK_PATH}/status`, { from: 'todo', to: 'done' }));
    expect(await screen.findByText(en('detail.openSubtasks', { count: 1 }))).toBeInTheDocument();
  });

  it('says, before deleting, that the sub-tasks stay as top-level Tasks', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.delete') }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(en('delete.subtasks', { count: 2 }))).toBeInTheDocument();
  });
});

describe('TaskDetail — related Tasks (US5)', () => {
  it('lists the related Tasks and removes one', async () => {
    current = taskDetail({ relatedTasks: [other] });
    deleteSpy.mockResolvedValue(undefined);
    await renderPage();
    const section = relatedSection();
    expect(within(section).getByRole('link', { name: /TSK-000002/ })).toHaveAttribute('href', `/tasks/${OTHER_TASK_ID}`);
    current = taskDetail({ relatedTasks: [] });
    await userEvent.click(within(section).getByRole('button', { name: en('related.remove', { number: 'TSK-000002' }) }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${TASK_PATH}/relations/${OTHER_TASK_ID}`));
    expect(await within(section).findByText(en('related.empty'))).toBeInTheDocument();
    // The removed row's button is gone: focus rests on the section's heading (WCAG 2.4.3).
    expect(within(section).getByRole('heading', { name: en('detail.related') })).toHaveFocus();
  });

  it('relates another Task through the picker', async () => {
    putSpy.mockResolvedValue(undefined);
    await renderPage();
    const section = relatedSection();
    expect(within(section).getByText(en('related.empty'))).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: en('related.add') }));
    const picker = await within(section).findByRole('combobox', { name: en('related.picker') });
    await userEvent.type(picker, 'crane');
    const option = await within(section).findByRole('option', { name: /Book the crane/ });
    current = taskDetail({ relatedTasks: [other] });
    await userEvent.click(option);
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledWith(`${TASK_PATH}/relations/${OTHER_TASK_ID}`, {}));
    expect(await within(section).findByRole('link', { name: /TSK-000002/ })).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByRole('button', { name: en('related.add') })).toHaveFocus());
  });

  it('moves focus into the related-task picker and back to Add related task on Cancel (WCAG 2.4.3)', async () => {
    await renderPage();
    const section = relatedSection();
    await userEvent.click(within(section).getByRole('button', { name: en('related.add') }));
    await waitFor(() => expect(within(section).getByRole('combobox', { name: en('related.picker') })).toHaveFocus());
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.cancel') }));
    await waitFor(() => expect(within(section).getByRole('button', { name: en('related.add') })).toHaveFocus());
  });
});

describe('TaskCreate — ?parent= (US5)', () => {
  it('names the parent and creates the Task under it', async () => {
    postSpy.mockResolvedValue({ data: taskDetail() });
    renderTasks(
      <Routes>
        <Route path="/tasks/new" element={<TaskCreate />} />
        <Route path="/tasks/:id" element={<p>task screen</p>} />
      </Routes>,
      { path: `/tasks/new?parent=${PARENT_ID}` },
    );
    expect(
      await screen.findByText(en('create.parent', { number: 'TSK-000009', title: 'Fit out the warehouse' })),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Order the bolts');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(BASE, { title: 'Order the bolts', parentTaskId: PARENT_ID }),
    );
    expect(await screen.findByText('task screen')).toBeInTheDocument();
  });
});
