import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskPriorityConfig } from '@endora-commerce/contracts';
import { core, en, renderTasks } from './tasks-fixtures';

/**
 * The Task priorities screen (`specs/165-task-management/`, User Story 9 —
 * T081, T083; `contracts/admin-surfaces.md` §1, §4).
 *
 * The priorities table in the operator's order, with how many Tasks hold each;
 * the priority dialog (code on create only, names in both languages, position,
 * colour); the removal dialog, which asks which priority — or none — the Tasks
 * holding the removed one get; and the screen on `tasks:configure`.
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
const { TaskPrioritiesPage } = await import(
  '../../../../packages/modules/tasks/src/admin/pages/settings/TaskPrioritiesPage'
);
const { contributions } = await import('../../../../packages/modules/tasks/src/admin/index');
const { manifest } = await import('../../../../packages/modules/tasks/src/manifest');

const API = '/api/v1/admin/tasks';
const CONFIGURER = ['tasks:read', 'tasks:write', 'tasks:configure'];

/** The seeded four, with Tasks holding *High*; deliberately out of order, as the server never is. */
function seeded(): TaskPriorityConfig[] {
  const row = (code: string, en: string, weight: number, color: string, inUseCount = 0): TaskPriorityConfig => ({
    code,
    name: { en, pl: `${en} (pl)` },
    defaultName: en,
    color,
    weight,
    inUseCount,
  });
  return [
    row('normal', 'Normal', 30, '#64748b'),
    row('urgent', 'Urgent', 10, '#dc2626'),
    row('high', 'High', 20, '#f59e0b', 3),
    row('low', 'Low', 40, '#94a3b8'),
  ];
}

beforeEach(() => {
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  getSpy.mockImplementation((path: string) =>
    path === `${API}/priorities` ? Promise.resolve({ data: seeded() }) : Promise.reject(new Error(`unexpected GET ${path}`)),
  );
  postSpy.mockResolvedValue({ data: seeded() });
  patchSpy.mockResolvedValue({ data: seeded() });
  deleteSpy.mockResolvedValue({ data: seeded() });
});

async function renderPage(): Promise<void> {
  renderTasks(<TaskPrioritiesPage />, { permissions: CONFIGURER });
  await screen.findByRole('table', { name: en('priorities.title') });
}

function priorityRow(code: string): HTMLElement {
  const table = screen.getByRole('table', { name: en('priorities.title') });
  return within(table).getByText(code, { selector: 'td' }).closest('tr') as HTMLElement;
}

describe('TaskPrioritiesPage — the table', () => {
  it('lists the priorities most urgent first, each with how many Tasks hold it', async () => {
    await renderPage();
    expect(getSpy).toHaveBeenCalledWith(`${API}/priorities`);
    const table = screen.getByRole('table', { name: en('priorities.title') });
    const codes = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
    expect(codes).toEqual(['urgent', 'high', 'normal', 'low']);
    expect(within(priorityRow('high')).getByText('3')).toBeInTheDocument();
  });

  it('says so when there is no priority, explains what one is for and offers one Add priority (issue #527)', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderTasks(<TaskPrioritiesPage />, { permissions: CONFIGURER });
    expect(await screen.findByText(en('priorities.empty.title'))).toBeInTheDocument();
    expect(screen.getByText(en('priorities.empty.body'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    const add = screen.getAllByRole('button', { name: en('priorities.add') });
    expect(add).toHaveLength(1);
    await userEvent.click(add[0]!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('TaskPrioritiesPage — the dialog', () => {
  it('adds a priority with its code, both names, a position and a colour', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('priorities.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.code')), 'blocker');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), 'Blocker');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.pl')), 'Blokujący');
    const weight = within(dialog).getByLabelText(en('workflow.field.weight'));
    await userEvent.clear(weight);
    await userEvent.type(weight, '5');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${API}/priorities`, {
        code: 'blocker',
        name: { en: 'Blocker', pl: 'Blokujący' },
        color: '#64748b',
        weight: 5,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses a malformed code, `none` and a missing name before they reach the server', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('priorities.add') }));
    const dialog = screen.getByRole('dialog');
    const codeField = within(dialog).getByLabelText(en('workflow.field.code'));
    await userEvent.type(codeField, 'Top Priority');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(await within(dialog).findByText(en('workflow.error.code'))).toBeInTheDocument();
    expect(within(dialog).getByText(en('workflow.error.name'))).toBeInTheDocument();
    // Focus goes to the first invalid field (WCAG 3.3.1, #512).
    await waitFor(() => expect(codeField).toHaveFocus());
    await userEvent.clear(codeField);
    await userEvent.type(codeField, 'none');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(await within(dialog).findByText(en('priorities.error.codeNone'))).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('reorders a priority by its position, sending only what changed — never the code', async () => {
    await renderPage();
    await userEvent.click(within(priorityRow('low')).getByRole('button', { name: en('priorities.editLabel', { name: 'Low' }) }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(en('workflow.field.code'))).toBeNull();
    const weight = within(dialog).getByLabelText(en('workflow.field.weight'));
    await userEvent.clear(weight);
    await userEvent.type(weight, '15');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(`${API}/priorities/low`, { weight: 15 }));
  });

  it('renames a priority in Polish', async () => {
    await renderPage();
    await userEvent.click(within(priorityRow('high')).getByRole('button', { name: en('priorities.editLabel', { name: 'High' }) }));
    const dialog = screen.getByRole('dialog');
    const polish = within(dialog).getByLabelText(en('workflow.field.name.pl'));
    await userEvent.clear(polish);
    await userEvent.type(polish, 'Wysoki');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(`${API}/priorities/high`, { name: { en: 'High', pl: 'Wysoki' } }),
    );
  });
});

describe('TaskPrioritiesPage — removing a priority', () => {
  it('asks which priority — or none — the Tasks holding it get', async () => {
    await renderPage();
    await userEvent.click(within(priorityRow('high')).getByRole('button', { name: en('priorities.deleteLabel', { name: 'High' }) }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(en('priorities.delete.inUse', { count: 3 }))).toBeInTheDocument();
    const replacement = within(dialog).getByLabelText(en('priorities.delete.replacement'));
    expect(within(replacement).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual([
      '',
      'none',
      'urgent',
      'normal',
      'low',
    ]);
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(within(dialog).getByText(en('priorities.delete.replacementRequired'))).toBeInTheDocument();

    await userEvent.selectOptions(replacement, 'none');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${API}/priorities/high?replacement=none`));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('removes a priority nobody holds without asking', async () => {
    await renderPage();
    await userEvent.click(within(priorityRow('low')).getByRole('button', { name: en('priorities.deleteLabel', { name: 'Low' }) }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(en('priorities.delete.replacement'))).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${API}/priorities/low`));
  });

  it('asks after all when the server says Tasks the operator cannot see hold it', async () => {
    deleteSpy.mockRejectedValueOnce(
      new ApiError(422, {
        error: {
          code: 'TASK_WORKFLOW_INVALID',
          message: 'Tasks have this priority: choose the priority they get, or no priority.',
          details: { rule: 'priority_replacement_required', code: 'priority_replacement_required' },
        },
      }),
    );
    await renderPage();
    await userEvent.click(within(priorityRow('low')).getByRole('button', { name: en('priorities.deleteLabel', { name: 'Low' }) }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    expect(
      await within(dialog).findByText('Tasks have this priority: choose the priority they get, or no priority.'),
    ).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText(en('priorities.delete.replacement')), 'normal');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenLastCalledWith(`${API}/priorities/low?replacement=normal`));
  });
});

describe('TaskPrioritiesPage — who sees it', () => {
  it('is a route on tasks:configure, and a palette action on the same code', () => {
    const route = (contributions.routes ?? []).find((candidate) => candidate.path === '/tasks/settings/priorities');
    expect(route?.requiredPermission).toBe('tasks:configure');
    const action = (manifest.actions ?? []).find((candidate) => candidate.id === 'open-task-priorities');
    expect(action).toMatchObject({ targetRoute: '/tasks/settings/priorities', requiredPermission: 'tasks:configure' });
  });
});
