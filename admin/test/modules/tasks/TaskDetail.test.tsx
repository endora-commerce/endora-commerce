import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { TaskDetail as TaskDetailData } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  ME_ID,
  PROJECT_ID,
  TASK_ID,
  core,
  en,
  historyEntry,
  historyPage,
  renderTasks,
  taskDetail,
  STATUS,
  workflow,
} from './tasks-fixtures';

/**
 * One Task (`specs/163-projects-and-tasks/`, User Story 2 — tasks T064 and
 * T067; `contracts/admin-surfaces.md` §2).
 *
 * The header names the Task and its status; the **status control** writes at
 * once; the details are edited in place and only what changed is sent; the
 * **context card** names the record the Task belongs to — linked while it is
 * available, plain text when it is not — with the group (a Project's Stage)
 * and the owner's note; the history lists what happened. A reader sees all of
 * it and can change none of it.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
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
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { TaskDetail } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskDetail');

const TASK_PATH = `/api/v1/admin/tasks/${TASK_ID}`;
const WORKFLOW_PATH = '/api/v1/admin/tasks/workflow';

let current: TaskDetailData = taskDetail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = taskDetail();
  getSpy.mockImplementation((path: string) => {
    if (path === TASK_PATH) return Promise.resolve({ data: current });
    if (path === WORKFLOW_PATH) return Promise.resolve({ data: workflow() });
    if (path.startsWith(`${TASK_PATH}/history`)) {
      return Promise.resolve(
        historyPage([
          historyEntry({ id: 'h2', action: 'tasks.task.status_change', actedAt: '2026-10-21T10:00:00.000Z' }),
          historyEntry(),
        ]),
      );
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(permissions?: readonly string[]): Promise<void> {
  renderTasks(<TaskDetail />, {
    path: `/tasks/${TASK_ID}`,
    pattern: '/tasks/:id',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { name: /Order the racking/ });
}

const contextCard = (): HTMLElement => screen.getByRole('region', { name: en('detail.context') });
const MOVE_LABEL = core('kanban.moveTo.label', { title: 'Order the racking' });
/** The status control: the kit's *Move to…* menu, the board's own (WCAG 3.2.2 — a move is one deliberate press). */
const moveMenu = (): HTMLElement => screen.getByRole('button', { name: MOVE_LABEL });
async function openMoveMenu(): Promise<string[]> {
  await userEvent.click(await screen.findByRole('button', { name: MOVE_LABEL }));
  const list = screen.getByRole('group', { name: MOVE_LABEL });
  return within(list)
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
}
async function moveTo(status: string): Promise<void> {
  await openMoveMenu();
  await userEvent.click(within(screen.getByRole('group', { name: MOVE_LABEL })).getByRole('button', { name: status }));
}
/** The status is said once, in the title (issue #1566). */
const title = (): HTMLElement => screen.getByRole('heading', { level: 1 });
/** The history is a tab of its own (issue #1524). */
async function historyTab(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('tab', { name: en('detail.history') }));
  return screen.getByRole('tabpanel', { name: en('detail.history') });
}

describe('TaskDetail — the header and the context card', () => {
  it('names the Task, its number and its status', async () => {
    await renderPage();
    expect(screen.getAllByText('TSK-000001').length).toBeGreaterThan(0);
    expect(within(title()).getByText(STATUS.todo.name)).toBeInTheDocument();
    // No native select: arrow keys on one would write a move per keypress (WCAG 3.2.2).
    expect(screen.queryByRole('combobox', { name: en('field.status') })).toBeNull();
  });

  it('links the context card to the Project, with its Stage and the owner note', async () => {
    current = taskDetail({ contextNote: 'Responsible role: Installer' });
    await renderPage();
    const link = within(contextCard()).getByRole('link', { name: 'PRJ-000001 Warehouse fit-out' });
    expect(link.getAttribute('href')).toBe(`/projects/${PROJECT_ID}`);
    expect(within(contextCard()).getByText('Design')).toBeTruthy();
    expect(within(contextCard()).getByText('Responsible role: Installer')).toBeTruthy();
  });

  it('names an unavailable context without a link, and says why', async () => {
    current = taskDetail({
      context: {
        type: 'project',
        available: false,
        label: 'Unavailable record',
        href: null,
        groupLabel: null,
        id: PROJECT_ID,
        groupId: null,
        canChangeTasks: false,
      },
    });
    await renderPage();
    expect(within(contextCard()).getByText('Unavailable record')).toBeTruthy();
    expect(within(contextCard()).queryByRole('link')).toBeNull();
    expect(within(contextCard()).getByText(en('detail.contextUnavailable'))).toBeTruthy();
  });

  it('says a Task without a context belongs to no record', async () => {
    current = taskDetail({ context: null });
    await renderPage();
    expect(within(contextCard()).getByText(en('detail.contextNone'))).toBeTruthy();
  });

  it("shows the server's sentence for a Task that does not exist or is hidden", async () => {
    getSpy.mockRejectedValue(
      new ApiError(404, {
        error: { code: 'TASK_NOT_FOUND', message: 'This task does not exist or is not available to you.' },
      }),
    );
    renderTasks(<TaskDetail />, { path: `/tasks/${TASK_ID}`, pattern: '/tasks/:id' });
    expect(await screen.findByText('This task does not exist or is not available to you.')).toBeTruthy();
  });
});

describe('TaskDetail — writing', () => {
  it('changes the status through the Move to… menu, the workflow move, and shows the answer', async () => {
    postSpy.mockResolvedValue({ data: { task: taskDetail({ status: STATUS.in_progress }), openSubtasks: 0 } });
    await renderPage();
    await moveTo(STATUS.in_progress.name);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(`${TASK_PATH}/status`, { from: 'todo', to: 'in_progress' });
    await waitFor(() => expect(within(title()).getByText(STATUS.in_progress.name)).toBeInTheDocument());
    // The chosen target unmounted with the list: focus is back on the menu's trigger (WCAG 2.4.3).
    await waitFor(() => expect(moveMenu()).toHaveFocus());
  });

  it('offers only the moves the workflow permits from the current status (165 US2 scenario 5)', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === TASK_PATH) return Promise.resolve({ data: current });
      if (path === WORKFLOW_PATH) {
        const flow = workflow();
        return Promise.resolve({
          data: { ...flow, transitions: flow.transitions.filter((edge) => !(edge.from === 'todo' && edge.to === 'done')) },
        });
      }
      if (path.startsWith(`${TASK_PATH}/history`)) return Promise.resolve(historyPage([]));
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    await renderPage();
    expect(await openMoveMenu()).toEqual([STATUS.in_progress.name, STATUS.cancelled.name]);
  });

  it('shows the server’s refusal of a move and then offers only the targets it named', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'TASK_TRANSITION_FORBIDDEN',
          message: 'The task workflow does not allow this move. It can move to: Cancelled.',
          details: { allowedTargets: ['cancelled'] },
        },
      }),
    );
    await renderPage();
    await moveTo(STATUS.done.name);
    expect(await screen.findByText('The task workflow does not allow this move. It can move to: Cancelled.')).toBeTruthy();
    expect(within(title()).getByText(STATUS.todo.name)).toBeInTheDocument();
    await waitFor(() => expect(moveMenu()).toBeEnabled());
    expect(await openMoveMenu()).toEqual([STATUS.cancelled.name]);
  });

  it('moves focus into the editor when it opens and back to Edit when it closes (WCAG 2.4.3)', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.edit') }));
    await waitFor(() => expect(screen.getByLabelText(new RegExp(en('field.title')))).toHaveFocus());
    await userEvent.click(screen.getByRole('button', { name: core('common.action.cancel') }));
    await waitFor(() => expect(screen.getByRole('button', { name: en('detail.edit') })).toHaveFocus());
  });

  it('focuses the title when the edit is saved without one, its error as its description (WCAG 3.3.1, #512)', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.edit') }));
    const title = screen.getByLabelText(new RegExp(en('field.title')));
    await userEvent.clear(title);
    await userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveAccessibleDescription(en('create.error.title'));
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('edits the details in place and sends only what changed', async () => {
    patchSpy.mockResolvedValue({ data: taskDetail({ title: 'Order the galvanised racking' }) });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.edit') }));
    const title = screen.getByLabelText(new RegExp(en('field.title')));
    await userEvent.clear(title);
    await userEvent.type(title, 'Order the galvanised racking');
    await userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
    expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { title: 'Order the galvanised racking' });
    expect(await screen.findByRole('heading', { name: /Order the galvanised racking/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: en('detail.edit') })).toHaveFocus());
  });

  it('assigns the Task to the caller in one step', async () => {
    current = taskDetail({ assignees: [] });
    patchSpy.mockResolvedValue({ data: taskDetail({ assignees: [{ id: ME_ID, name: 'Ada Min', active: true }] }) });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.assignToMe') }));
    expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { addAssigneeIds: [ME_ID] });
  });

  it("shows a refusal in the server's words", async () => {
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'TASK_ASSIGNEE_INVALID',
          message: 'This person cannot be assigned: they are not an active administrator.',
        },
      }),
    );
    current = taskDetail({ assignees: [] });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.assignToMe') }));
    expect(
      await screen.findByText('This person cannot be assigned: they are not an active administrator.'),
    ).toBeTruthy();
  });

  it('deletes the Task after a confirmation and returns to the list', async () => {
    // `DELETE /tasks/:id` answers how many sub-tasks became top-level (165 US5).
    deleteSpy.mockResolvedValue({ data: { subtasksDetached: 0 } });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('delete.title') });
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: en('delete.confirm') }));
    expect(deleteSpy).toHaveBeenCalledWith(TASK_PATH);
    expect(await screen.findByText('tasks list screen')).toBeTruthy();
  });

  it('keeps Delete apart from Edit: in the page header, not in the Details section (issue #527)', async () => {
    await renderPage();
    const edit = await screen.findByRole('button', { name: en('detail.edit') });
    const del = screen.getByRole('button', { name: en('detail.delete') });
    const details = screen.getByRole('region', { name: en('detail.details') });
    expect(details).toContainElement(edit);
    expect(details).not.toContainElement(del);
    expect(del.closest('header')).not.toBeNull();
    expect(edit.closest('header')).toBeNull();
  });

  it('opens the delete confirmation on Cancel, so Enter keeps the Task (issue #527)', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('delete.title') });
    expect(dialog).toHaveTextContent(en('delete.body', { number: taskDetail().number }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: core('common.action.cancel') })).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('offers no Delete for a Task whose record does not let the caller remove it, and says why (T147)', async () => {
    current = taskDetail({ context: { ...taskDetail().context!, canChangeTasks: false } });
    await renderPage();
    expect(await screen.findByRole('button', { name: en('detail.edit') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en('detail.delete') })).toBeNull();
    expect(screen.getByText(en('detail.deleteNotAllowed'))).toBeTruthy();
  });

  it('is read-only for a reader: no status control, no edit, no delete', async () => {
    await renderPage(['tasks:read']);
    expect(screen.queryByRole('button', { name: MOVE_LABEL })).toBeNull();
    expect(screen.getAllByText(STATUS.todo.name).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: en('detail.edit') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('detail.delete') })).toBeNull();
    expect(screen.getByText(en('detail.readOnly'))).toBeTruthy();
  });
});

describe('TaskDetail — the way back (`?returnTo=`, #512)', () => {
  const RETURN_TO = `/orders/${PROJECT_ID}?tab=tasks`;

  function renderFrom(returnTo: string): void {
    renderTasks(
      <Routes>
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/orders/:id" element={<p>order screen</p>} />
      </Routes>,
      { path: `/tasks/${TASK_ID}?${new URLSearchParams({ returnTo }).toString()}` },
    );
  }

  it('leads Back to the screen the Task was opened from', async () => {
    renderFrom(RETURN_TO);
    await screen.findByRole('heading', { name: /Order the racking/ });
    expect(screen.getByRole('link', { name: core('common.action.back') })).toHaveAttribute('href', RETURN_TO);
  });

  it('returns there once the Task is deleted', async () => {
    deleteSpy.mockResolvedValue({ data: { subtasksDetached: 0 } });
    renderFrom(RETURN_TO);
    await userEvent.click(await screen.findByRole('button', { name: en('detail.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('delete.title') });
    await userEvent.click(within(dialog).getByRole('button', { name: en('delete.confirm') }));
    expect(await screen.findByText('order screen')).toBeTruthy();
  });

  it('ignores an address that is not a path of this application', async () => {
    renderFrom('https://evil.example/');
    await screen.findByRole('heading', { name: /Order the racking/ });
    expect(screen.getByRole('link', { name: en('detail.back') })).toHaveAttribute('href', '/tasks');
  });
});

describe('TaskDetail — history and the zone', () => {
  it('lists the history, each entry by what happened', async () => {
    await renderPage();
    const history = await historyTab();
    expect(await within(history).findByText(en('auditLog.tasks.task.create'))).toBeTruthy();
    expect(within(history).getByText(en('auditLog.tasks.task.status_change'))).toBeTruthy();
  });

  it('shows what each entry changed, field by field, and reads earlier entries a page at a time (kit RecordHistory)', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === TASK_PATH) return Promise.resolve({ data: current });
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: workflow() });
      if (path.startsWith(`${TASK_PATH}/history`)) {
        const second = path.includes('cursor=');
        return Promise.resolve({
          data: second
            ? [historyEntry({ id: 'h1', after: { title: 'Approve the drawings', status: 'todo' } })]
            : [
                historyEntry({
                  id: 'h2',
                  action: 'tasks.task.status_change',
                  actedAt: '2026-10-21T10:00:00.000Z',
                  before: { title: 'Approve the drawings', status: 'todo', contextId: PROJECT_ID },
                  after: { title: 'Approve the drawings', status: 'done', contextId: PROJECT_ID },
                }),
              ],
          pagination: second ? { cursor: null, hasMore: false, limit: 50 } : { cursor: 'next', hasMore: true, limit: 50 },
          truncated: false,
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    await renderPage();
    const history = await historyTab();
    expect(await within(history).findByRole('heading', { name: en('auditLog.tasks.task.status_change') })).toBeTruthy();
    expect(within(history).getByText(en('history.field.status'))).toBeTruthy();
    // The workflow's own name for the code the entry stored (165 R-1).
    expect(await within(history).findByText(STATUS.done.name)).toBeTruthy();
    // An identifier is never a row.
    expect(within(history).queryByText(PROJECT_ID)).toBeNull();
    await userEvent.click(within(history).getByRole('button', { name: core('history.more') }));
    expect(await within(history).findByRole('heading', { name: en('auditLog.tasks.task.create') })).toBeTruthy();
  });

  it('shows a due moment once, without seconds, and not its derived due date beside it (T095)', async () => {
    const dueAt = '2026-10-30T09:00:00.000Z';
    getSpy.mockImplementation((path: string) => {
      if (path === TASK_PATH) return Promise.resolve({ data: current });
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: workflow() });
      if (path.startsWith(`${TASK_PATH}/history`)) {
        return Promise.resolve(
          historyPage([historyEntry({ id: 'h1', after: { title: 'Approve the drawings', dueOn: '2026-10-30', dueAt } })]),
        );
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    await renderPage();
    const history = await historyTab();
    expect(await within(history).findByText(en('history.field.dueAt'))).toBeTruthy();
    expect(within(history).queryByText(en('history.field.dueOn'))).toBeNull();
    expect(
      within(history).getByText(
        new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dueAt)),
      ),
    ).toBeTruthy();
    // The entry's own time too.
    expect(
      within(history).getByText(
        new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-10-20T10:00:00.000Z')),
        { exact: false },
      ),
    ).toBeTruthy();
  });

  it('mounts the task.detail.after zone with the Task id, naming no contributor', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/tasks/src/admin/pages/TaskDetail.tsx'),
      'utf8',
    );
    // A section of the sidebar card, no card in a card (issue #1524).
    expect(source).toContain('<AdminZone name="task.detail.after" props={{ taskId: task.id }} chrome="section" />');
    expect(source).not.toMatch(/mod-projects|projects:/);
  });
});
