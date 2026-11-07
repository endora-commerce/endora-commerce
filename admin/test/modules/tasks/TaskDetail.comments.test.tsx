import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskComment, TaskDetail as TaskDetailData } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { ANNA_ID, ME_ID, TASK_ID, core, en, historyPage, renderTasks, taskDetail, workflow } from './tasks-fixtures';

/**
 * The comment thread of a Task (`specs/165-task-management/` User Story 4,
 * T057; `contracts/admin-surfaces.md` §2): the kit's `CommentThread`, notes
 * only — oldest first with author and time, the body drawn with its
 * references, the composer with the reference triggers, *Edit* and *Delete*
 * only on the reader's own comments, and a deleted comment kept in its place,
 * marked. Whoever may see the Task may comment; someone else's private Task is
 * read only.
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

const { TaskDetail } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskDetail');

const BASE = '/api/v1/admin/tasks';
const TASK_PATH = `${BASE}/${TASK_ID}`;
const COMMENTS_PATH = `${TASK_PATH}/comments`;
const PROJECT_ID = '00000000-0000-4000-8000-0000000000c3';
const MINE = '00000000-0000-4000-8000-0000000c0001';
const THEIRS = '00000000-0000-4000-8000-0000000c0002';
const GONE = '00000000-0000-4000-8000-0000000c0003';

function comment(overrides: Partial<TaskComment> = {}): TaskComment {
  return {
    id: MINE,
    author: { id: ME_ID, name: 'Ada Min' },
    body: 'Racking ordered.',
    references: [],
    editedAt: null,
    deletedAt: null,
    createdAt: '2026-10-21T10:00:00.000Z',
    ...overrides,
  };
}

let current: TaskDetailData = taskDetail();
let thread: TaskComment[] = [];

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = taskDetail({ commentsCount: 2 });
  thread = [
    comment({
      body: `Ordered for [[project:${PROJECT_ID}]]`,
      references: [{ type: 'project', id: PROJECT_ID, available: true, label: 'PRJ-000007', url: `/projects/${PROJECT_ID}` }],
    }),
    comment({ id: THEIRS, author: { id: ANNA_ID, name: 'Anna Nowak' }, body: 'Thanks!' }),
    comment({ id: GONE, author: { id: ANNA_ID, name: 'Anna Nowak' }, body: '', deletedAt: '2026-10-22T10:00:00.000Z' }),
  ];
  getSpy.mockImplementation((path: string) => {
    if (path === TASK_PATH) return Promise.resolve({ data: current });
    if (path === COMMENTS_PATH) return Promise.resolve({ data: thread });
    if (path === `${BASE}/workflow`) return Promise.resolve({ data: workflow() });
    if (path === `${BASE}/priorities`) return Promise.resolve({ data: [] });
    if (path === `${BASE}/tags`) return Promise.resolve({ data: [] });
    if (path === `${TASK_PATH}/attachments`) return Promise.resolve({ data: [] });
    if (path.startsWith(`${BASE}/lookups/mentionable`)) {
      return Promise.resolve({ data: [{ id: ANNA_ID, name: 'Anna Nowak', email: 'anna@example.com' }] });
    }
    if (path.startsWith(`${TASK_PATH}/history`)) return Promise.resolve(historyPage([]));
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(permissions: readonly string[] = ['tasks:read', 'tasks:write']): Promise<HTMLElement> {
  renderTasks(<TaskDetail />, { path: `/tasks/${TASK_ID}`, pattern: '/tasks/:id', permissions });
  await screen.findByRole('heading', { name: /Order the racking/ });
  return screen.getByRole('region', { name: en('detail.comments') });
}

async function entries(section: HTMLElement): Promise<HTMLElement[]> {
  return within(await within(section).findByRole('list', { name: en('detail.comments') })).getAllByRole('listitem');
}

describe('TaskDetail — comments (US4)', () => {
  it('lists the thread oldest first, with author, references as links, and a deleted comment marked', async () => {
    const section = await renderPage();
    const items = await entries(section);
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Ada Min');
    expect(within(items[0]!).getByRole('link', { name: /PRJ-000007/ })).toHaveAttribute('href', `/projects/${PROJECT_ID}`);
    expect(items[1]).toHaveTextContent('Thanks!');
    expect(items[2]).toHaveTextContent(core('comments.removedEntry'));
    expect(within(section).getByText(en('comments.hint'))).toBeInTheDocument();
    // A comment's time is written as every date on the Tasks screens is (T095).
    expect(within(items[0]!).getByText(new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-10-21T10:00:00.000Z')))).toBeInTheDocument();
  });

  it('offers Edit and Delete only on the reader’s own comments', async () => {
    const section = await renderPage();
    const items = await entries(section);
    expect(within(items[0]!).getByRole('button', { name: core('comments.edit') })).toBeInTheDocument();
    expect(within(items[0]!).getByRole('button', { name: core('comments.delete') })).toBeInTheDocument();
    expect(within(items[1]!).queryByRole('button')).toBeNull();
    expect(within(items[2]!).queryByRole('button')).toBeNull();
  });

  it('adds a comment, `@` offering the people who may see this Task', async () => {
    postSpy.mockImplementation((_path: string, body: { body: string }) =>
      Promise.resolve({ data: comment({ id: '00000000-0000-4000-8000-0000000c0009', body: body.body }) }),
    );
    const section = await renderPage();
    await entries(section);
    const field = within(section).getByLabelText(en('comments.composer.label'));
    await userEvent.type(field, 'Over to @');
    const list = await screen.findByRole('listbox', { name: core('references.suggest.title.person') });
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Anna Nowak'),
    ]);
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(section).getByRole('button', { name: en('comments.composer.submit') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(COMMENTS_PATH, { body: `Over to [[admin_user:${ANNA_ID}]]` });
    expect(getSpy.mock.calls.map(([path]) => String(path))).toContainEqual(
      expect.stringContaining(`${BASE}/lookups/mentionable?taskId=${TASK_ID}`),
    );
    expect(await within(section).findByText(en('comments.added'))).toBeInTheDocument();
    expect(await entries(section)).toHaveLength(4);
  });

  it('edits and deletes the reader’s own comment through the Task’s comment routes', async () => {
    patchSpy.mockImplementation((_path: string, body: { body: string }) =>
      Promise.resolve({ data: comment({ body: body.body, editedAt: '2026-10-23T10:00:00.000Z' }) }),
    );
    deleteSpy.mockResolvedValue(undefined);
    thread[0] = comment();
    const section = await renderPage();
    const [mine] = await entries(section);
    // The edit field focuses itself with the caret after the text, and the
    // editor applies that focus in an animation frame. A loaded runner can run
    // that frame after the first keystroke (issue #250): hold every frame back
    // past the typing, so this case meets that order on every run.
    const lateFrames = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 200));
    try {
      await userEvent.click(within(mine!).getByRole('button', { name: core('comments.edit') }));
      const editor = within(section).getByLabelText(core('comments.edit.label'));
      await userEvent.type(editor, ' Delivered.');
    } finally {
      lateFrames.mockRestore();
    }
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(`${COMMENTS_PATH}/${MINE}`, { body: 'Racking ordered. Delivered.' }),
    );
    expect(await within(section).findByText('Racking ordered. Delivered.')).toBeInTheDocument();

    await userEvent.click(within((await entries(section))[0]!).getByRole('button', { name: core('comments.delete') }));
    const dialog = screen.getByRole('dialog', { name: core('comments.delete.title') });
    expect(dialog).toHaveTextContent(en('comments.delete.body'));
    await userEvent.click(within(dialog).getByRole('button', { name: core('comments.delete.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${COMMENTS_PATH}/${MINE}`));
    // A synchronous query inside the `waitFor`: an awaited one would leave its
    // retry loop dead (`test/unit/nested-async-utilities.test.ts`).
    await waitFor(() =>
      expect(
        within(within(section).getByRole('list', { name: en('detail.comments') })).getAllByRole('listitem')[0],
      ).toHaveTextContent(core('comments.removedEntry')),
    );
  });

  it('lets a reader without tasks:write comment', async () => {
    const section = await renderPage(['tasks:read']);
    await entries(section);
    expect(within(section).getByLabelText(en('comments.composer.label'))).toBeInTheDocument();
  });

  it('offers no composer and no Edit on someone else’s private Task, which is read only', async () => {
    current = taskDetail({
      private: true,
      createdBy: { id: ANNA_ID, name: 'Anna Nowak' },
      permissions: { canChange: false, canDelete: true, canPublish: false },
    });
    const section = await renderPage(['tasks:read', 'tasks:write', 'tasks:see_private']);
    const items = await entries(section);
    expect(within(section).queryByLabelText(en('comments.composer.label'))).toBeNull();
    expect(within(items[0]!).queryByRole('button')).toBeNull();
    // No form, so no "Type @ to mention someone" either (T095).
    expect(within(section).queryByText(en('comments.hint'))).toBeNull();
    expect(within(section).getByText(en('comments.hintReadOnly'))).toBeTruthy();
  });
});
