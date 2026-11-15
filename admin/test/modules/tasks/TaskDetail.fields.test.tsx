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

  it('edits the description in the reference editor, the due time, the start date, the priority and the tags', async () => {
    patchSpy.mockResolvedValue({ data: current });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.edit') }));
    // The reference editor, not a plain textarea.
    expect(screen.getByLabelText(en('field.description')).getAttribute('contenteditable')).toBe('true');
    // Every assignee is in the multi-select.
    expect(screen.getAllByText('Anna Nowak').length).toBeGreaterThan(0);

    const time = screen.getByLabelText(en('field.dueTime'));
    await userEvent.clear(time);
    await userEvent.type(time, '09:15');
    const start = screen.getByLabelText(en('field.startOn'));
    await userEvent.clear(start);
    await userEvent.type(start, '2026-11-02');
    await userEvent.selectOptions(screen.getByLabelText(en('field.priority')), 'urgent');
    const tags = screen.getByRole('button', { name: en('field.tags') });
    await waitFor(() => expect(tags).not.toBeDisabled());
    await userEvent.click(tags);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Urgent' }));

    await userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const [path, body] = patchSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(TASK_PATH);
    expect(body).toMatchObject({
      dueAt: new Date('2026-11-05T09:15').toISOString(),
      startOn: '2026-11-02',
      priorityCode: 'urgent',
      tagIds: [INSTALL.id, URGENT.id],
    });
    expect(body).not.toHaveProperty('title');
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
    const section = screen.getByRole('region', { name: en('attachments.title') });
    expect(await within(section).findByText('plan.pdf')).toBeTruthy();
    expect(within(section).getByText('Ada Min')).toBeTruthy();
    expect(within(section).getByRole('button', { name: en('attachments.upload') })).toBeTruthy();
  });

  it('reads the history again after a file is added or removed, as after a reminder (T095)', async () => {
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
      const section = screen.getByRole('region', { name: en('attachments.title') });
      await within(section).findByText('plan.pdf');
      await waitFor(() => expect(historyReads()).toBeGreaterThan(0));
      const before = historyReads();

      const input = section.querySelector('input[type="file"]') as HTMLInputElement;
      await userEvent.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
      expect(await within(section).findByText('notes.txt')).toBeTruthy();
      await waitFor(() => expect(historyReads()).toBe(before + 1));

      await userEvent.click(within(section).getByRole('button', { name: en('attachments.remove', { name: 'plan.pdf' }) }));
      await userEvent.click(await screen.findByRole('button', { name: en('attachments.removeConfirm') }));
      await waitFor(() => expect(within(section).queryByText('plan.pdf')).toBeNull());
      await waitFor(() => expect(historyReads()).toBe(before + 2));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a reader sees the fields and the files, and none of the controls', async () => {
    await renderPage(['tasks:read']);
    expect(screen.queryByRole('button', { name: en('detail.edit') })).toBeNull();
    const section = screen.getByRole('region', { name: en('attachments.title') });
    expect(await within(section).findByText('plan.pdf')).toBeTruthy();
    expect(within(section).queryByRole('button', { name: en('attachments.upload') })).toBeNull();
  });
});
