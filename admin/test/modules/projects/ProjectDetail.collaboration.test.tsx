import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ProjectAttachment,
  ProjectComment,
  ProjectDetail,
  RecordHistoryEntry,
  RecordReference,
} from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { EVERY_PROJECTS_PERMISSION, PROJECT_ID, core, detail, en, renderProjects } from './projects-fixtures';

/**
 * Collaboration on a Project (`specs/163-projects-and-tasks/`, User Story 7 —
 * task T114; `contracts/admin-surfaces.md` §2): the *Notes*, *Messages*
 * (with its unread badge), *Attachments* and *Change history* tabs, and the
 * description editor on *Overview* — every one on the admin kit's components
 * (`CommentThread`, `ReferenceField`, `ReferenceText`, `AttachmentUploader`,
 * `RecordHistory`) with Projects' own adapters and wording.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('echarts', () => {
  const chart = {
    setOption: (): void => {},
    resize: (): void => {},
    dispose: (): void => {},
    on: (): void => {},
    off: (): void => {},
    dispatchAction: (): void => {},
  };
  return { init: () => chart, default: { init: () => chart } };
});

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

const { ProjectDetail: ProjectDetailPage } =
  await import('../../../../packages/modules/projects/src/admin/pages/ProjectDetail');

const DETAIL_PATH = `/api/v1/admin/projects/${PROJECT_ID}`;
/** The session's own administrator (`adminSession`'s default). */
const ME = { id: '00000000-0000-4000-8000-00000000ad01', name: 'Ada Min' };
const COLLEAGUE = { id: '00000000-0000-4000-8000-00000000ad09', name: 'Bob Kowalski' };
const TASK_ID = '00000000-0000-4000-8000-0000000007a1';
const TASK_REFERENCE: RecordReference = {
  type: 'task',
  id: TASK_ID,
  available: true,
  label: 'TSK-000001',
  url: `/tasks/${TASK_ID}`,
};
const ID = (n: number): string => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;

function comment(overrides: Partial<ProjectComment> = {}): ProjectComment {
  return {
    id: ID(1),
    kind: 'note',
    author: ME,
    body: 'Measure the hall first.',
    references: [],
    editedAt: null,
    createdAt: '2026-10-25T10:00:00.000Z',
    ...overrides,
  };
}

const ATTACHMENT: ProjectAttachment = {
  id: ID(50),
  assetId: ID(51),
  fileName: 'floor-plan.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  url: 'https://files.example/floor-plan.pdf?download=1',
  uploadedBy: ME,
  createdAt: '2026-10-25T11:00:00.000Z',
};

function historyEntry(overrides: Partial<RecordHistoryEntry> = {}): RecordHistoryEntry {
  return {
    id: ID(90),
    actedAt: '2026-10-25T12:00:00.000Z',
    action: 'projects.project.update',
    actor: { kind: 'admin', id: ME.id, name: ME.name },
    before: { title: 'Warehouse', descriptionLength: 3 },
    after: { title: 'Warehouse fit-out', descriptionLength: 3 },
    references: [],
    ...overrides,
  };
}

let current: ProjectDetail = detail();
let notes: ProjectComment[] = [];
let messages: ProjectComment[] = [];
let attachments: ProjectAttachment[] = [];

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = detail();
  notes = [
    comment({ body: `Agree the drawings in [[task:${TASK_ID}]].`, references: [TASK_REFERENCE] }),
    comment({ id: ID(2), author: COLLEAGUE, body: 'The crane is booked.' }),
  ];
  messages = [
    comment({ id: ID(10), kind: 'message', author: COLLEAGUE, body: 'Can we start on Monday?' }),
    comment({ id: ID(11), kind: 'message', author: COLLEAGUE, body: 'Please confirm.' }),
  ];
  attachments = [ATTACHMENT];
  getSpy.mockImplementation((path: string) => {
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === `${DETAIL_PATH}/comments?kind=note`) return Promise.resolve({ data: notes });
    if (path === `${DETAIL_PATH}/comments?kind=message`) return Promise.resolve({ data: messages });
    if (path === `${DETAIL_PATH}/attachments`) return Promise.resolve({ data: attachments });
    if (path === `${DETAIL_PATH}/stage-history`) return Promise.resolve({ data: [] });
    if (path.startsWith(`${DETAIL_PATH}/history`)) {
      const second = path.includes('cursor=');
      return Promise.resolve({
        data: second
          ? [
              historyEntry({
                id: ID(92),
                action: 'projects.project.create',
                before: null,
                after: { title: 'Warehouse' },
              }),
            ]
          : [
              historyEntry(),
              historyEntry({
                id: ID(91),
                action: 'projects.project.note_add',
                before: null,
                after: { commentId: ID(1), kind: 'note', length: 20 },
              }),
            ],
        pagination: second ? { cursor: null, hasMore: false, limit: 50 } : { cursor: 'next', hasMore: true, limit: 50 },
        truncated: false,
      });
    }
    if (path.startsWith('/api/v1/admin/projects/lookups/')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(options: { permissions?: readonly string[]; search?: string } = {}): Promise<void> {
  renderProjects(<ProjectDetailPage />, {
    path: `/projects/${PROJECT_ID}${options.search ?? ''}`,
    pattern: '/projects/:id',
    permissions: options.permissions ?? EVERY_PROJECTS_PERMISSION,
  });
  await screen.findByRole('heading', { name: /Warehouse fit-out/ });
}

const tabNames = (): string[] => screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');

describe('ProjectDetail — the collaboration tabs', () => {
  it('offers Notes, Messages, Attachments and Change history', async () => {
    await renderPage();
    const names = tabNames();
    for (const key of ['tabs.notes', 'tabs.messages', 'tabs.attachments', 'tabs.changeHistory']) {
      expect(
        names.some((name) => name.startsWith(en(key))),
        key,
      ).toBe(true);
    }
  });

  it('counts the unread messages on the Messages tab, and opening it marks them read', async () => {
    current = detail({ unreadMessageCount: 2 });
    postSpy.mockResolvedValue({ data: { unreadMessageCount: 0 } });
    await renderPage();
    const tab = screen.getByRole('tab', { name: en('tabs.unread', { label: en('tabs.messages'), count: 2 }) });
    expect(tab.textContent).toBe(`${en('tabs.messages')} 2`);
    await userEvent.click(tab);
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('Please confirm.')).toBeTruthy();
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/messages/read`, { throughMessageId: ID(11) }),
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: en('tabs.messages') }).textContent).toBe(en('tabs.messages')),
    );
  });

  it('lists the notes with their references as chips, edit offered on one’s own note only', async () => {
    await renderPage({ search: '?tab=notes' });
    const panel = await screen.findByRole('tabpanel');
    const chip = await within(panel).findByRole('link', { name: /TSK-000001/ });
    expect(chip.getAttribute('href')).toContain(`/tasks/${TASK_ID}`);
    expect(within(panel).getByText('The crane is booked.')).toBeTruthy();
    expect(within(panel).getAllByRole('button', { name: core('comments.edit') })).toHaveLength(1);
  });

  it('adds a note through the Projects route', async () => {
    const added = comment({ id: ID(5), body: 'Lights arrive Friday.' });
    postSpy.mockImplementation(() => {
      notes = [...notes, added];
      return Promise.resolve({ data: added });
    });
    await renderPage({ search: '?tab=notes' });
    const panel = await screen.findByRole('tabpanel');
    const field = await within(panel).findByLabelText(en('comments.notes.composer.label'));
    await userEvent.type(field, 'Lights arrive Friday.');
    await userEvent.click(within(panel).getByRole('button', { name: en('comments.notes.composer.submit') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/comments`, { kind: 'note', body: 'Lights arrive Friday.' }),
    );
    expect(await within(panel).findByText('Lights arrive Friday.')).toBeTruthy();
  });

  it('a reader sees the notes and no composer', async () => {
    current = detail({ permissions: { canWrite: false, canConfigure: false } });
    await renderPage({ search: '?tab=notes', permissions: ['projects:read'] });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('The crane is booked.')).toBeTruthy();
    expect(within(panel).queryByLabelText(en('comments.notes.composer.label'))).toBeNull();
  });

  it('lists the attachments with a download and, for a writer, a removal behind a confirmation', async () => {
    deleteSpy.mockResolvedValue(undefined);
    await renderPage({ search: '?tab=attachments' });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('floor-plan.pdf')).toBeTruthy();
    expect(
      within(panel).getByRole('button', { name: en('attachments.download', { name: 'floor-plan.pdf' }) }),
    ).toBeTruthy();
    expect(within(panel).getByText(en('attachments.upload'))).toBeTruthy();
    await userEvent.click(
      within(panel).getByRole('button', { name: en('attachments.remove', { name: 'floor-plan.pdf' }) }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: en('attachments.remove.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/attachments/${ATTACHMENT.id}`));
    expect(await within(panel).findByText(en('attachments.empty'))).toBeTruthy();
  });

  it('a reader may download but neither upload nor remove', async () => {
    current = detail({ permissions: { canWrite: false, canConfigure: false } });
    await renderPage({ search: '?tab=attachments', permissions: ['projects:read'] });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('floor-plan.pdf')).toBeTruthy();
    expect(within(panel).queryByText(en('attachments.upload'))).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: en('attachments.remove', { name: 'floor-plan.pdf' }) }),
    ).toBeNull();
  });

  it('draws the change history newest first, field by field, a page at a time', async () => {
    await renderPage({ search: '?tab=history' });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByRole('heading', { name: en('auditLog.projects.project.update') })).toBeTruthy();
    expect(within(panel).getByRole('heading', { name: en('auditLog.projects.project.note_add') })).toBeTruthy();
    expect(within(panel).getByText(en('history.field.title'))).toBeTruthy();
    expect(within(panel).getByText('Warehouse fit-out')).toBeTruthy();
    // An identifier says nothing to a reader: the note's id is not a row.
    expect(within(panel).queryByText(ID(1))).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: core('history.more') }));
    expect(await within(panel).findByRole('heading', { name: en('auditLog.projects.project.create') })).toBeTruthy();
    expect(
      getSpy.mock.calls.some(
        ([path]) => String(path).startsWith(`${DETAIL_PATH}/history?`) && String(path).includes('cursor=next'),
      ),
    ).toBe(true);
  });
});

describe('ProjectDetail — the description', () => {
  it('draws the description with its references as chips', async () => {
    current = detail({ description: `Start with [[task:${TASK_ID}]].`, references: [TASK_REFERENCE] });
    await renderPage();
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByRole('link', { name: /TSK-000001/ })).toBeTruthy();
    expect(within(panel).queryByText(/\[\[task:/)).toBeNull();
  });

  it('a writer edits it in the reference field and saves it against the version read', async () => {
    patchSpy.mockImplementation((_path: string, body: { description: string }) =>
      Promise.resolve({ data: { ...current, description: body.description, version: current.version + 1 } }),
    );
    await renderPage();
    const panel = await screen.findByRole('tabpanel');
    // The tab panel is drawn before the Overview inside it: find the button rather than get it.
    await userEvent.click(await within(panel).findByRole('button', { name: en('overview.editDescription') }));
    const field = within(panel).getByLabelText(en('overview.description'));
    // The field focuses itself with the caret after the text, but the editor applies that focus in
    // an animation frame, which a loaded runner can delay past the first keystroke: the text then
    // landed in front (issue #250). Wait for the focus, then type where the caret is.
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard(' Then the lights.');
    await userEvent.click(within(panel).getByRole('button', { name: en('overview.saveDescription') }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(DETAIL_PATH, {
        description: 'Racking and lighting for the new hall. Then the lights.',
        version: current.version,
      }),
    );
    expect(await within(panel).findByText('Racking and lighting for the new hall. Then the lights.')).toBeTruthy();
  });

  it('a reader is not offered the editor', async () => {
    current = detail({ permissions: { canWrite: false, canConfigure: false } });
    await renderPage({ permissions: ['projects:read'] });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('Racking and lighting for the new hall.')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: en('overview.editDescription') })).toBeNull();
  });
});
