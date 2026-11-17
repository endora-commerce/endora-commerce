import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { TaskDetail as TaskDetailData, TaskLink } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  PROJECT_ID,
  STAGE_ID,
  TASK_ID,
  core,
  en,
  historyPage,
  renderTasks,
  taskDetail,
  workflow,
} from './tasks-fixtures';

/**
 * Linked records and the context on a Task's screen, and a Task created from
 * a record (`specs/165-task-management/` User Story 6, FR-031 – FR-033, T067;
 * `contracts/admin-surfaces.md` §1–§2).
 *
 * The side column lists the Opportunities, Orders and Quote Requests the Task
 * is linked to — each a link to its record, or *unavailable* when the reader
 * may not see it or its module is off — and lets a writer remove one and link
 * another through a picker over `GET /tasks/lookups/records`, offering only
 * the kinds whose module is on and whose read code the writer holds. The
 * context card lets a writer place the Task in a record and Stage through
 * `GET /tasks/lookups/contexts`, or take it out. The create form honours
 * `?link=<kind>:<id>` (the record panels' *Add task*) and
 * `?context=<type>:<id>[:<group>]`.
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
const { TaskCreate } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskCreate');

const BASE = '/api/v1/admin/tasks';
const TASK_PATH = `${BASE}/${TASK_ID}`;
const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';
const DEAL_ID = '00000000-0000-4000-8000-0000000000e2';
const QUOTE_ID = '00000000-0000-4000-8000-0000000000e3';
const OTHER_PROJECT = '00000000-0000-4000-8000-0000000000f2';
const OTHER_STAGE = '00000000-0000-4000-8000-000000000d02';

const orderLink: TaskLink = {
  id: '00000000-0000-4000-8000-0000000001a1',
  kind: 'order',
  recordId: ORDER_ID,
  available: true,
  label: 'ORD-0042',
  url: `/orders/${ORDER_ID}`,
};
const hiddenDeal: TaskLink = {
  id: '00000000-0000-4000-8000-0000000001a2',
  kind: 'opportunity',
  recordId: DEAL_ID,
  available: false,
  label: null,
  url: null,
};

let current: TaskDetailData = taskDetail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = taskDetail({ links: [hiddenDeal, orderLink] });
  getSpy.mockImplementation((path: string) => {
    if (path === TASK_PATH) return Promise.resolve({ data: current });
    if (path === `${BASE}/workflow`) return Promise.resolve({ data: workflow() });
    if (path === `${BASE}/priorities`) return Promise.resolve({ data: [] });
    if (path === `${BASE}/tags`) return Promise.resolve({ data: [] });
    if (path === `${TASK_PATH}/attachments`) return Promise.resolve({ data: [] });
    if (path === `${TASK_PATH}/comments`) return Promise.resolve({ data: [] });
    if (path.startsWith(`${TASK_PATH}/history`)) return Promise.resolve(historyPage([]));
    if (path.startsWith(`${BASE}/lookups/records?`)) {
      return Promise.resolve({ data: [{ id: QUOTE_ID, label: 'RFQ-0007' }] });
    }
    if (path.startsWith(`${BASE}/lookups/contexts`)) {
      return Promise.resolve({
        data: [
          {
            contextType: 'project',
            id: OTHER_PROJECT,
            label: 'PRJ-000002 Showroom',
            groups: [{ id: OTHER_STAGE, label: 'Build' }],
          },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

const EVERYTHING = ['tasks:read', 'tasks:write', 'orders:read', 'rfqs:handle', 'crm:read'];

async function renderPage(
  options: { permissions?: readonly string[]; present?: readonly string[] } = {},
): Promise<void> {
  renderTasks(<TaskDetail />, {
    path: `/tasks/${TASK_ID}`,
    pattern: '/tasks/:id',
    permissions: options.permissions ?? EVERYTHING,
    present: options.present ?? ['tasks', 'admin_users', 'orders', 'quote_requests', 'crm'],
  });
  await screen.findByRole('heading', { name: /Order the racking/ });
}

const linksSection = (): HTMLElement => screen.getByRole('region', { name: en('detail.links') });
const contextSection = (): HTMLElement => screen.getByRole('region', { name: en('detail.context') });
const lookups = (kind: string): string[] =>
  getSpy.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith(`${BASE}/lookups/${kind}`));

describe('TaskDetail — linked records (US6)', () => {
  it('lists each link by kind, a named one as a link to its record and a hidden one as unavailable', async () => {
    await renderPage();
    const items = within(within(linksSection()).getByRole('list', { name: en('detail.links') })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(en('links.kind.opportunity'));
    expect(items[0]).toHaveTextContent(en('links.unavailable'));
    expect(within(items[0]!).queryByRole('link')).toBeNull();
    // Why it is unavailable is read with it, not only hovered (a `title` alone reaches neither touch nor keyboard).
    expect(items[0]).toHaveTextContent(en('links.unavailableHint'));
    expect(within(items[0]!).getByRole('button', { name: en('links.removeUnavailable') })).toHaveAccessibleDescription(
      en('links.unavailableHint'),
    );
    expect(items[1]).toHaveTextContent(en('links.kind.order'));
    expect(within(items[1]!).getByRole('link', { name: 'ORD-0042' })).toHaveAttribute('href', `/orders/${ORDER_ID}`);
    // Nothing is asked for on load: the detail carries its links.
    expect(lookups('records')).toEqual([]);
    expect(lookups('contexts')).toEqual([]);
  });

  it('says when nothing is linked', async () => {
    current = taskDetail();
    await renderPage();
    expect(within(linksSection()).getByText(en('links.empty'))).toBeInTheDocument();
  });

  it('removes a link — an unavailable one too', async () => {
    deleteSpy.mockResolvedValue(undefined);
    await renderPage();
    current = taskDetail({ links: [orderLink] });
    await userEvent.click(within(linksSection()).getByRole('button', { name: en('links.removeUnavailable') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${TASK_PATH}/links/${hiddenDeal.id}`));
    await waitFor(() => expect(within(linksSection()).getAllByRole('listitem')).toHaveLength(1));
    expect(within(linksSection()).getByRole('heading', { name: en('detail.links') })).toHaveFocus();
  });

  it('moves focus into the link form when it opens and back to Link a record on Cancel (WCAG 2.4.3)', async () => {
    await renderPage();
    const section = linksSection();
    await userEvent.click(within(section).getByRole('button', { name: en('links.add') }));
    await waitFor(() => expect(within(section).getByLabelText(en('links.kindPicker'))).toHaveFocus());
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.cancel') }));
    await waitFor(() => expect(within(section).getByRole('button', { name: en('links.add') })).toHaveFocus());
  });

  it('links a record through the picker: the kind, then the record by number', async () => {
    const quoteLink: TaskLink = {
      id: '00000000-0000-4000-8000-0000000001a3',
      kind: 'quote_request',
      recordId: QUOTE_ID,
      available: true,
      label: 'RFQ-0007',
      url: `/quote-requests/${QUOTE_ID}`,
    };
    postSpy.mockResolvedValue({ data: quoteLink });
    await renderPage();
    const section = linksSection();
    await userEvent.click(within(section).getByRole('button', { name: en('links.add') }));
    await userEvent.selectOptions(within(section).getByLabelText(en('links.kindPicker')), 'quote_request');
    const picker = await within(section).findByRole('combobox', { name: en('links.recordPicker') });
    await userEvent.type(picker, 'RFQ-0007');
    await waitFor(() =>
      expect(lookups('records').some((path) => path.includes('kind=quote_request') && path.includes('q=RFQ-0007'))).toBe(
        true,
      ),
    );
    current = taskDetail({ links: [hiddenDeal, orderLink, quoteLink] });
    await userEvent.click(await within(section).findByRole('option', { name: /RFQ-0007/ }));
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${TASK_PATH}/links`, { kind: 'quote_request', id: QUOTE_ID }),
    );
    expect(await within(section).findByRole('link', { name: 'RFQ-0007' })).toHaveAttribute(
      'href',
      `/quote-requests/${QUOTE_ID}`,
    );
  });

  it('offers only the kinds whose module is on and whose read code the writer holds', async () => {
    await renderPage({ permissions: ['tasks:read', 'tasks:write', 'orders:read', 'crm:read'], present: ['tasks', 'orders', 'quote_requests'] });
    await userEvent.click(within(linksSection()).getByRole('button', { name: en('links.add') }));
    const kinds = within(within(linksSection()).getByLabelText(en('links.kindPicker'))).getAllByRole('option');
    expect(kinds.map((option) => option.getAttribute('value'))).toEqual(['order']);
  });

  it('offers a reader no change', async () => {
    await renderPage({ permissions: ['tasks:read', 'orders:read'] });
    expect(within(linksSection()).queryByRole('button', { name: en('links.add') })).toBeNull();
    expect(within(linksSection()).queryByRole('button', { name: en('links.removeUnavailable') })).toBeNull();
  });
});

describe('TaskDetail — the context card (US6 scenario 3)', () => {
  it('moves the Task into another record and Stage through the picker', async () => {
    patchSpy.mockImplementation(() =>
      Promise.resolve({
        data: {
          ...current,
          context: { ...current.context!, id: OTHER_PROJECT, label: 'PRJ-000002 Showroom', groupId: OTHER_STAGE, groupLabel: 'Build' },
        },
      }),
    );
    await renderPage();
    const section = contextSection();
    await userEvent.click(within(section).getByRole('button', { name: en('context.change') }));
    const picker = await within(section).findByRole('combobox', { name: en('context.picker') });
    await userEvent.type(picker, 'Show');
    await waitFor(() => expect(lookups('contexts').some((path) => path.includes('q=Show'))).toBe(true));
    await userEvent.click(await within(section).findByRole('option', { name: /PRJ-000002 Showroom/ }));
    expect(within(section).getByLabelText(en('context.groupPicker'))).toHaveValue(OTHER_STAGE);
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, {
        context: { contextType: 'project', contextId: OTHER_PROJECT, contextGroupId: OTHER_STAGE },
      }),
    );
    expect(await within(section).findByRole('link', { name: 'PRJ-000002 Showroom' })).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByRole('button', { name: en('context.change') })).toHaveFocus());
  });

  it('moves focus into the record picker when it opens and back to Move on Cancel (WCAG 2.4.3)', async () => {
    await renderPage();
    const section = contextSection();
    await userEvent.click(within(section).getByRole('button', { name: en('context.change') }));
    await waitFor(() => expect(within(section).getByRole('combobox', { name: en('context.picker') })).toHaveFocus());
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.cancel') }));
    await waitFor(() => expect(within(section).getByRole('button', { name: en('context.change') })).toHaveFocus());
  });

  it('takes the Task out of its record after saying who will then see it (#512)', async () => {
    patchSpy.mockResolvedValue({ data: { ...current, context: null } });
    await renderPage();
    await userEvent.click(within(contextSection()).getByRole('button', { name: en('context.remove') }));
    const dialog = await screen.findByRole('dialog', { name: en('context.removeConfirm.title') });
    expect(dialog).toHaveTextContent(en('context.removeConfirm.body', { record: current.context!.label }));
    expect(patchSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: en('context.remove') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { context: null }));
    expect(await within(contextSection()).findByText(en('detail.contextNone'))).toBeInTheDocument();
    // *Remove from the record* unmounted: focus moves to the opener that is left.
    await waitFor(() => expect(within(contextSection()).getByRole('button', { name: en('context.choose') })).toHaveFocus());
  });

  it('keeps the Task in its record when the removal is cancelled', async () => {
    await renderPage();
    await userEvent.click(within(contextSection()).getByRole('button', { name: en('context.remove') }));
    const dialog = await screen.findByRole('dialog', { name: en('context.removeConfirm.title') });
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('offers no move when the record refuses changes, on a private Task, or to a reader', async () => {
    current = taskDetail({ context: { ...taskDetail().context!, canChangeTasks: false } });
    await renderPage();
    expect(within(contextSection()).queryByRole('button', { name: en('context.change') })).toBeNull();
  });

  it('offers a Task in no record a place', async () => {
    current = taskDetail({ context: null });
    await renderPage();
    expect(within(contextSection()).getByRole('button', { name: en('context.choose') })).toBeInTheDocument();
  });

  it('offers a private Task no place', async () => {
    current = taskDetail({ context: null, private: true });
    await renderPage();
    expect(within(contextSection()).queryByRole('button', { name: en('context.choose') })).toBeNull();
  });
});

describe('TaskCreate — ?link= and ?context= (US6)', () => {
  function renderCreate(query: string): void {
    renderTasks(
      <Routes>
        <Route path="/tasks/new" element={<TaskCreate />} />
        <Route path="/tasks/:id" element={<p>task screen</p>} />
      </Routes>,
      { path: `/tasks/new?${query}` },
    );
  }

  it('creates the Task already linked to the record it was started from', async () => {
    postSpy.mockResolvedValue({ data: taskDetail() });
    renderCreate(`link=order:${ORDER_ID}`);
    expect(await screen.findByText(en('create.link.order'))).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Chase the payment');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(BASE, {
        title: 'Chase the payment',
        links: [{ kind: 'order', id: ORDER_ID }],
      }),
    );
    expect(await screen.findByText('task screen')).toBeInTheDocument();
  });

  it('creates the Task in the record and Stage named by ?context=', async () => {
    postSpy.mockResolvedValue({ data: taskDetail() });
    renderCreate(`context=project:${PROJECT_ID}:${STAGE_ID}`);
    expect(await screen.findByText(en('create.context'))).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Survey the site');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(BASE, {
        title: 'Survey the site',
        context: { contextType: 'project', contextId: PROJECT_ID, contextGroupId: STAGE_ID },
      }),
    );
  });

  it('ignores a malformed ?link=', async () => {
    postSpy.mockResolvedValue({ data: taskDetail() });
    renderCreate('link=project:nope');
    await userEvent.type(await screen.findByLabelText(new RegExp(en('field.title'))), 'Plain');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(BASE, { title: 'Plain' }));
  });
});
