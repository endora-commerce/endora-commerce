import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { TaskDetail as TaskDetailData } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  ANNA_ID,
  ME_ID,
  PROJECT_ID,
  STAGE_ID,
  TASK_ID,
  en,
  historyPage,
  renderTasks,
  taskDetail,
  workflow,
} from './tasks-fixtures';

/**
 * Drafts and private Tasks on the screens (`specs/165-task-management/` User
 * Story 8, FR-037, FR-038; T077).
 *
 * The create form saves a Task as a **draft** beside creating it, and a
 * **Private** switch keeps it to its Creator: while it is on, the Task can be
 * assigned only to the caller, and a Task started inside a record — which a
 * private Task never is — offers no switch at all. A draft is marked *Draft*
 * on its screen, with *Publish* for its Creator. Somebody else's private Task
 * reads as read-only to a holder of *See private tasks*, who may still delete
 * it.
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

const { TaskCreate } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskCreate');
const { TaskDetail } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskDetail');

const TASKS_API = '/api/v1/admin/tasks';
const TASK_PATH = `${TASKS_API}/${TASK_ID}`;

let current: TaskDetailData = taskDetail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = taskDetail();
  getSpy.mockImplementation((path: string) => {
    if (path === TASK_PATH) return Promise.resolve({ data: current });
    if (path === `${TASKS_API}/workflow`) return Promise.resolve({ data: workflow() });
    if (path.startsWith(`${TASK_PATH}/history`)) return Promise.resolve(historyPage([]));
    if (path.startsWith(`${TASKS_API}/lookups/assignees`)) {
      return Promise.resolve({
        data: [
          { id: ANNA_ID, name: 'Anna Nowak', email: 'anna@example.com' },
          { id: ME_ID, name: 'Ada Min', email: 'ada@example.com' },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
});

function renderCreate(path = '/tasks/new'): void {
  renderTasks(
    <Routes>
      <Route path="/tasks/new" element={<TaskCreate />} />
      <Route path="/tasks/:id" element={<p>task screen</p>} />
    </Routes>,
    { path },
  );
}

async function renderDetail(permissions?: readonly string[]): Promise<void> {
  renderTasks(<TaskDetail />, {
    path: `/tasks/${TASK_ID}`,
    pattern: '/tasks/:id',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { name: /Order the racking/ });
}

/** The assignee lookups the screen asked, by query string. */
function assigneeLookups(): string[] {
  return getSpy.mock.calls
    .map(([path]) => String(path))
    .filter((path) => path.startsWith(`${TASKS_API}/lookups/assignees`));
}

describe('the assignee picker asks who may see the Task (#506)', () => {
  it('on the create form inside a record, the lookup names the record', async () => {
    renderCreate(`/tasks/new?context=project:${PROJECT_ID}:${STAGE_ID}`);
    await screen.findByRole('combobox', { name: en('field.assignee') });
    expect(assigneeLookups()).toContain(
      `${TASKS_API}/lookups/assignees?contextType=project&contextId=${PROJECT_ID}`,
    );
  });

  it('on the create form of a free-standing Task, it names nothing', async () => {
    renderCreate();
    await screen.findByRole('combobox', { name: en('field.assignee') });
    expect(assigneeLookups()).toEqual([`${TASKS_API}/lookups/assignees`]);
  });

  it('on a Task’s screen, the lookup names the Task', async () => {
    await renderDetail();
    await userEvent.click(screen.getByRole('button', { name: en('detail.edit') }));
    await screen.findByRole('combobox', { name: en('field.assignee') });
    expect(assigneeLookups()).toContain(`${TASKS_API}/lookups/assignees?taskId=${TASK_ID}`);
  });
});

describe('TaskCreate — drafts and private Tasks', () => {
  it('saves a Task as a draft and opens it', async () => {
    postSpy.mockResolvedValue({ data: taskDetail({ draft: true }) });
    renderCreate();
    await userEvent.type(await screen.findByLabelText(new RegExp(en('field.title'))), 'Think it over');
    await userEvent.click(screen.getByRole('button', { name: en('create.saveDraft') }));
    expect(postSpy).toHaveBeenCalledWith(TASKS_API, { title: 'Think it over', draft: true });
    expect(await screen.findByText('task screen')).toBeTruthy();
  });

  it('the Private switch limits the assignees to the caller and sends the Task private', async () => {
    postSpy.mockResolvedValue({ data: taskDetail({ private: true }) });
    renderCreate();
    await userEvent.type(await screen.findByLabelText(new RegExp(en('field.title'))), 'Mine only');
    // Someone else is chosen first; the switch takes them off.
    await userEvent.click(screen.getByRole('button', { name: en('detail.assignToMe') }));
    expect(screen.getByRole('combobox', { name: en('field.assignee') })).toBeTruthy();
    const privateSwitch = screen.getByRole('switch', { name: en('create.private') });
    await userEvent.click(privateSwitch);
    // The kit Switch (issue #1607): a button whose state is `aria-checked`.
    expect(privateSwitch.tagName).toBe('BUTTON');
    expect(privateSwitch).toHaveAttribute('aria-checked', 'true');
    // No picker of other people while it is on: only the caller, said so.
    expect(screen.queryByRole('combobox', { name: en('field.assignee') })).toBeNull();
    expect(screen.getByText(en('create.privateAssignee'))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    expect(postSpy).toHaveBeenCalledWith(TASKS_API, { title: 'Mine only', assigneeIds: [ME_ID], private: true });
  });

  it('puts the Private switch before the assignees, and says whom turning it on took off (#512)', async () => {
    renderCreate();
    const privateSwitch = await screen.findByRole('switch', { name: en('create.private') });
    const picker = await screen.findByRole('combobox', { name: en('field.assignee') });
    // Reading order: the switch that limits the choice comes before the choice.
    expect(privateSwitch.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The announcement's live region is there, empty, before it has anything to say (WCAG 4.1.3).
    const region = document.getElementById(privateSwitch.getAttribute('aria-describedby')?.split(' ').find((id) => id.endsWith('-removed')) ?? '');
    expect(region).toHaveAttribute('role', 'status');
    expect(region?.textContent).toBe('');
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole('option', { name: /Anna Nowak/ }));
    await userEvent.click(screen.getByRole('button', { name: en('detail.assignToMe') }));
    await userEvent.click(privateSwitch);
    expect(region?.textContent).toBe(en('create.privateRemoved', { names: 'Anna Nowak' }));
    // Turning it off again says nothing more and brings nobody back silently.
    await userEvent.click(privateSwitch);
    expect(region?.textContent).toBe('');
  });

  it('offers no Private switch for a Task started inside a record', async () => {
    renderCreate(`/tasks/new?context=project:${PROJECT_ID}`);
    expect(await screen.findByText(en('create.context'))).toBeTruthy();
    expect(screen.queryByRole('switch', { name: en('create.private') })).toBeNull();
  });
});

describe('TaskDetail — drafts and private Tasks', () => {
  it('marks a draft and lets its Creator publish it', async () => {
    current = taskDetail({ draft: true, publishedAt: null, permissions: { canChange: true, canDelete: true, canPublish: true } });
    postSpy.mockImplementation((path: string) => {
      if (path === `${TASK_PATH}/publish`) {
        current = taskDetail({ draft: false });
        return Promise.resolve({ data: current });
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });
    await renderDetail();
    const header = screen.getByRole('heading', { name: /Order the racking/ });
    expect(within(header).getByText(en('detail.draftBadge'))).toBeTruthy();
    expect(screen.getByText(en('detail.draftHint'))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: en('detail.publish') }));
    expect(postSpy).toHaveBeenCalledWith(`${TASK_PATH}/publish`, {});
    expect(await screen.findByText(en('detail.published'))).toBeTruthy();
    expect(within(header).queryByText(en('detail.draftBadge'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('detail.publish') })).toBeNull();
  });

  it('offers no Publish to somebody who is not the draft’s Creator', async () => {
    current = taskDetail({ draft: true, publishedAt: null });
    await renderDetail();
    expect(screen.queryByRole('button', { name: en('detail.publish') })).toBeNull();
  });

  it('marks a private Task, and its Creator may make it public again', async () => {
    current = taskDetail({ private: true, context: null, assignees: [] });
    patchSpy.mockImplementation((_path: string, body: unknown) => {
      current = taskDetail({ private: false, context: null, assignees: [] });
      return Promise.resolve({ data: { ...current, ...(body as object) } });
    });
    await renderDetail();
    const header = screen.getByRole('heading', { name: /Order the racking/ });
    expect(within(header).getByText(en('detail.privateBadge'))).toBeTruthy();
    const privateSwitch = screen.getByRole('switch', { name: en('detail.private') });
    expect(privateSwitch).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(privateSwitch);
    expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { private: false });
  });

  it('explains what turning Private on does, and is off-limits while other people are assigned (T095)', async () => {
    // Assigned to the Creator alone: offered, with what turning it on would do.
    current = taskDetail({ private: false, context: null, assignees: [{ id: ME_ID, name: 'Ada Min', active: true }] });
    await renderDetail();
    const offered = screen.getByRole('switch', { name: en('detail.private') });
    expect(offered).toBeEnabled();
    expect(offered).toHaveAccessibleDescription(en('detail.privateHint'));
    cleanup();

    // Assigned to somebody else too: turning it on could only be refused, so it is not offered, and says why.
    current = taskDetail({
      private: false,
      context: null,
      assignees: [
        { id: ME_ID, name: 'Ada Min', active: true },
        { id: ANNA_ID, name: 'Anna Nowak', active: true },
      ],
    });
    await renderDetail();
    const blocked = screen.getByRole('switch', { name: en('detail.private') });
    // Blocked, it stays in the tab order so the reason is heard (kit Switch `disabledReason`, #1607).
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked).toBeEnabled();
    expect(blocked).toHaveAccessibleDescription(en('detail.privateBlocked'));
    await userEvent.click(blocked);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('says what a private Task is while it is one', async () => {
    current = taskDetail({ private: true, context: null, assignees: [] });
    await renderDetail();
    expect(screen.getByRole('switch', { name: en('detail.private') })).toHaveAccessibleDescription(
      en('detail.privateOnHint'),
    );
  });

  it('is read-only to a holder of See private tasks, who may still delete it', async () => {
    current = taskDetail({
      private: true,
      context: null,
      assignees: [],
      createdBy: { id: ANNA_ID, name: 'Anna Nowak' },
      permissions: { canChange: false, canDelete: true, canPublish: false },
    });
    deleteSpy.mockResolvedValue({ data: { subtasksDetached: 0 } });
    await renderDetail(['tasks:read', 'tasks:see_private']);
    expect(screen.getByText(en('detail.privateReadOnly', { name: 'Anna Nowak' }))).toBeTruthy();
    expect(screen.queryByLabelText(en('field.status'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('detail.edit') })).toBeNull();
    expect(screen.queryByRole('switch', { name: en('detail.private') })).toBeNull();
    // Nothing that would move it into a record either.
    expect(screen.queryByRole('button', { name: en('context.choose') })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: en('detail.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('delete.title') });
    await userEvent.click(within(dialog).getByRole('button', { name: en('delete.confirm') }));
    expect(deleteSpy).toHaveBeenCalledWith(TASK_PATH);
  });
});
