import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskAttachment, TaskDetail as TaskDetailData } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  ANNA_ID,
  ME_ID,
  TASK_ID,
  core,
  en,
  historyPage,
  renderTasks,
  taskDetail,
  workflow,
} from './tasks-fixtures';

/**
 * A Task as a full work item on its screen (`specs/165-task-management/`
 * User Story 1, T031; `contracts/admin-surfaces.md` §2): every assignee, the
 * due date with its time and the start date, the priority and the tags, the
 * description drawn with its references as links and edited in the kit's
 * reference editor, the `task` custom fields and the attachments.
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
const ORDER_ID = '00000000-0000-4000-8000-0000000000c1';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-0000000000c2';
const INSTALL = { id: '00000000-0000-4000-8000-0000000000e1', name: 'Installation', color: '#0ea5e9' };
const URGENT = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Urgent', color: '#dc2626' };

const ATTACHMENT: TaskAttachment = {
  id: '00000000-0000-4000-8000-0000000000f1',
  assetId: '00000000-0000-4000-8000-0000000000f2',
  fileName: 'plan.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  url: '/api/v1/admin/assets/file/x?download=1',
  uploadedBy: { id: ME_ID, name: 'Ada Min' },
  createdAt: '2026-10-21T10:00:00.000Z',
};

const PRIORITIES = [
  { code: 'urgent', name: { en: 'Urgent' }, defaultName: 'Urgent', color: '#dc2626', weight: 10, inUseCount: 0 },
  { code: 'high', name: { en: 'High' }, defaultName: 'High', color: '#f97316', weight: 20, inUseCount: 0 },
];

const DEFINITIONS = [
  {
    id: '00000000-0000-4000-8000-0000000000d1',
    entityType: 'task',
    key: 'region',
    label: { en: 'Region' },
    labelDefault: 'Region',
    valueType: 'text',
    required: false,
    sortOrder: 0,
    config: {},
    options: [],
    listFilter: true,
    audience: 'internal',
    deletedAt: null,
  },
];

let current: TaskDetailData = taskDetail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = taskDetail({
    assignees: [
      { id: ANNA_ID, name: 'Anna Nowak', active: true },
      { id: ME_ID, name: 'Ada Min', active: true },
    ],
    dueOn: '2026-11-05',
    dueAt: '2026-11-05T13:30:00.000Z',
    startOn: '2026-11-01',
    priority: { code: 'high', name: 'High', color: '#f97316' },
    tags: [INSTALL],
    description: `**Bring** the plan for [[order:${ORDER_ID}]] and [[opportunity:${OPPORTUNITY_ID}]]`,
    references: [
      { type: 'order', id: ORDER_ID, available: true, label: 'ORD-1001', url: `/orders/${ORDER_ID}` },
      { type: 'opportunity', id: OPPORTUNITY_ID, available: false, label: null, url: null },
    ],
    customFieldValues: { region: 'North' },
    attachmentsCount: 1,
  });
  getSpy.mockImplementation((path: string) => {
    if (path === TASK_PATH) return Promise.resolve({ data: current });
    if (path === `${BASE}/workflow`) return Promise.resolve({ data: workflow() });
    if (path === `${BASE}/priorities`) return Promise.resolve({ data: PRIORITIES });
    if (path === `${BASE}/tags`) {
      return Promise.resolve({ data: [INSTALL, URGENT].map((tag) => ({ ...tag, usageCount: 0 })) });
    }
    if (path === `${TASK_PATH}/attachments`) return Promise.resolve({ data: [ATTACHMENT] });
    if (path.startsWith('/api/v1/admin/custom-fields/definitions')) return Promise.resolve({ data: DEFINITIONS });
    if (path.startsWith(`${TASK_PATH}/history`)) return Promise.resolve(historyPage([]));
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

const PERMISSIONS = ['tasks:read', 'tasks:write', 'custom_fields:read'];

async function renderPage(permissions: readonly string[] = PERMISSIONS): Promise<void> {
  renderTasks(<TaskDetail />, { path: `/tasks/${TASK_ID}`, pattern: '/tasks/:id', permissions });
  await screen.findByRole('heading', { name: /Order the racking/ });
}

/** The attachments are a tab of the Task's screen (issue #1524). */
async function openTab(label: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${label}`) }));
  return screen.getByRole('tabpanel', { name: new RegExp(`^${label}`) });
}

describe('TaskDetail — the fields of a full work item (US1)', () => {
  it('shows every assignee, the due date with its time, the start date, the priority and the tags', async () => {
    await renderPage();
    const details = screen.getByRole('region', { name: en('detail.details') });
    const assignees = within(details).getByRole('list', { name: en('field.assignee') });
    expect(within(assignees).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Anna Nowak', 'Ada Min']);
    expect(within(details).getByText(en('field.dueAt'))).toBeTruthy();
    // The admin UI language's medium date and short time — no seconds (T095).
    expect(
      within(details).getByText(
        new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-11-05T13:30:00.000Z')),
      ),
    ).toBeTruthy();
    expect(within(details).getByText(en('field.startOn'))).toBeTruthy();
    expect(within(details).getByText('High')).toBeTruthy();
    expect(within(details).getByText('Installation').closest('ul')).not.toBeNull();
  });

  it('draws the description with its formatting and its references — a link for what the reader may open', async () => {
    await renderPage();
    const details = screen.getByRole('region', { name: en('detail.details') });
    expect(within(details).getByText('Bring').tagName).toBe('STRONG');
    expect(within(details).getByRole('link', { name: `${core('references.kind.order')}ORD-1001` })).toBeTruthy();
    expect(within(details).getByText(core('references.unavailable.opportunity'))).toBeTruthy();
  });

  /** Opens one fact's editor through its pencil (the kit's `InlineEdit`, issue #1525). */
  async function edit(field: string): Promise<void> {
    await userEvent.click(screen.getByRole('button', { name: core('common.inlineEdit.edit', { field: en(field) }) }));
  }
  async function save(): Promise<Record<string, unknown>> {
    await userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const [path, body] = patchSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(TASK_PATH);
    return body;
  }

  it('edits the description in the reference editor, in place, and sends it alone', async () => {
    patchSpy.mockResolvedValue({ data: current });
    await renderPage();
    await edit('field.description');
    const description = screen.getByLabelText(en('field.description'));
    // The reference editor, not a plain textarea, with the focus in it.
    expect(description.getAttribute('contenteditable')).toBe('true');
    await waitFor(() => expect(description).toHaveFocus());
    await userEvent.type(description, ' today');
    const body = await save();
    expect(Object.keys(body)).toEqual(['description']);
  });

  it('edits the due time in place and sends the due moment alone', async () => {
    patchSpy.mockResolvedValue({ data: current });
    await renderPage();
    await edit('field.dueAt');
    expect(screen.getByLabelText(en('field.dueAt'))).toHaveFocus();
    const time = screen.getByLabelText(en('field.dueTime'));
    await userEvent.clear(time);
    await userEvent.type(time, '09:15');
    expect(await save()).toEqual({ dueAt: new Date('2026-11-05T09:15').toISOString() });
  });

  it('edits the start date in place and sends it alone', async () => {
    patchSpy.mockResolvedValue({ data: current });
    await renderPage();
    await edit('field.startOn');
    const start = screen.getByLabelText(en('field.startOn'));
    await userEvent.clear(start);
    await userEvent.type(start, '2026-11-02');
    expect(await save()).toEqual({ startOn: '2026-11-02' });
  });

  it('edits the priority in place and sends it alone', async () => {
    patchSpy.mockResolvedValue({ data: current });
    await renderPage();
    await edit('field.priority');
    await userEvent.selectOptions(screen.getByLabelText(en('field.priority')), 'urgent');
    expect(await save()).toEqual({ priorityCode: 'urgent' });
  });

  it('edits the tags in place — the picker named by the field — and sends them alone', async () => {
    patchSpy.mockResolvedValue({ data: current });
    await renderPage();
    await edit('field.tags');
    const tags = screen.getByRole('button', { name: en('field.tags') });
    await waitFor(() => expect(tags).not.toBeDisabled());
    await userEvent.click(tags);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Urgent' }));
    expect(await save()).toEqual({ tagIds: [INSTALL.id, URGENT.id] });
  });

  it('edits the assignees in place, every one of them in the multi-select', async () => {
    patchSpy.mockResolvedValue({ data: current });
    await renderPage();
    await edit('field.assignee');
    await screen.findByRole('combobox', { name: en('field.assignee') });
    expect(screen.getAllByText('Anna Nowak').length).toBeGreaterThan(1);
    // Unchanged, Save is no request.
    await userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
    expect(patchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox', { name: en('field.assignee') })).toBeNull();
  });

  it('announces a saved field by its name', async () => {
    patchSpy.mockResolvedValue({ data: { ...current, startOn: '2026-11-02' } });
    await renderPage();
    await edit('field.startOn');
    const start = screen.getByLabelText(en('field.startOn'));
    await userEvent.clear(start);
    await userEvent.type(start, '2026-11-02{Enter}');
    expect(
      await screen.findByText(core('common.inlineEdit.saved', { field: en('field.startOn') })),
    ).toHaveAttribute('role', 'status');
  });

  it('shows the task custom fields, and saves them through the Task', async () => {
    patchSpy.mockResolvedValue({ data: { ...current, customFieldValues: { region: 'South' } } });
    await renderPage();
    const field = await screen.findByLabelText(/Region/);
    expect((field as HTMLInputElement).value).toBe('North');
    await userEvent.clear(field);
    await userEvent.type(field, 'South');
    await userEvent.click(screen.getByRole('button', { name: core('customFields.save') }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { customFieldValues: { region: 'South' } }),
    );
  });

  it('sends only the field the operator changed — never a null for a stored value it did not touch (issue #1007)', async () => {
    // `erp_ref` has no definition the panel renders, so the panel never offers it: the write must
    // leave it to the server's merge rather than send it cleared.
    current = { ...current, customFieldValues: { region: 'North', erp_ref: 'ERP-7' } };
    patchSpy.mockResolvedValue({ data: { ...current, customFieldValues: { region: 'South', erp_ref: 'ERP-7' } } });
    await renderPage();
    const field = await screen.findByLabelText(/Region/);
    await userEvent.clear(field);
    await userEvent.type(field, 'South');
    await userEvent.click(screen.getByRole('button', { name: core('customFields.save') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]).toEqual([TASK_PATH, { customFieldValues: { region: 'South' } }]);
  });

  it('lists the attachments with name, size and uploader, and offers the upload to a writer', async () => {
    await renderPage();
    const section = await openTab(en('attachments.title'));
    expect(await within(section).findByText('plan.pdf')).toBeTruthy();
    expect(within(section).getByText('Ada Min')).toBeTruthy();
    expect(within(section).getByRole('button', { name: en('attachments.upload') })).toBeTruthy();
  });

  it('reads the Task again after a file is added or removed, and the history tab shows the change (T095, #1524)', async () => {
    const taskReads = (): number => getSpy.mock.calls.filter(([path]) => path === TASK_PATH).length;
    const historyReads = (): number =>
      getSpy.mock.calls.filter(([path]) => String(path).startsWith(`${TASK_PATH}/history`)).length;
    const added: TaskAttachment = { ...ATTACHMENT, id: '00000000-0000-4000-8000-0000000000f3', fileName: 'notes.txt' };
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ data: added }), { status: 201, headers: { 'Content-Type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    deleteSpy.mockResolvedValue(undefined);
    try {
      await renderPage();
      const section = await openTab(en('attachments.title'));
      await within(section).findByText('plan.pdf');
      const before = taskReads();

      const input = section.querySelector('input[type="file"]') as HTMLInputElement;
      await userEvent.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
      expect(await within(section).findByText('notes.txt')).toBeTruthy();
      // The tab's count is the Task's: it is read again.
      await waitFor(() => expect(taskReads()).toBe(before + 1));

      await userEvent.click(within(section).getByRole('button', { name: en('attachments.remove', { name: 'plan.pdf' }) }));
      await userEvent.click(await screen.findByRole('button', { name: en('attachments.removeConfirm') }));
      await waitFor(() => expect(within(section).queryByText('plan.pdf')).toBeNull());
      await waitFor(() => expect(taskReads()).toBe(before + 2));

      // The history tab reads the history when it opens, so it holds both writes.
      const reads = historyReads();
      await openTab(en('detail.history'));
      await waitFor(() => expect(historyReads()).toBe(reads + 1));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a reader sees the fields and the files, and none of the controls', async () => {
    await renderPage(['tasks:read']);
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    const section = await openTab(en('attachments.title'));
    expect(await within(section).findByText('plan.pdf')).toBeTruthy();
    expect(within(section).queryByRole('button', { name: en('attachments.upload') })).toBeNull();
  });
});
