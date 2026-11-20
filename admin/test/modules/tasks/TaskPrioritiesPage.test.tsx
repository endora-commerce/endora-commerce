import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
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
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy]) spy.mockReset();
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

/** The codes of the priorities table, top to bottom. */
function tableCodes(): string[] {
  const table = screen.getByRole('table', { name: en('priorities.title') });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '');
}

function inOrder(codes: readonly string[]): TaskPriorityConfig[] {
  const rows = seeded();
  return codes.map((code, index) => ({ ...rows.find((row) => row.code === code)!, weight: (index + 1) * 10 }));
}

describe('TaskPrioritiesPage — reordering (issue #1560)', () => {
  it('moves the row at once and sends one PUT of the whole order, every move waiting until it settles', async () => {
    let answer: (value: { data: TaskPriorityConfig[] }) => void = () => {};
    putSpy.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await renderPage();
    await userEvent.click(within(priorityRow('low')).getByRole('button', { name: en('reorder.moveUp', { name: 'Low' }) }));

    expect(tableCodes()).toEqual(['urgent', 'high', 'low', 'normal']);
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(`${API}/priorities/order`, { orderedCodes: ['urgent', 'high', 'low', 'normal'] });
    const up = within(priorityRow('high')).getByRole('button', { name: en('reorder.moveUp', { name: 'High' }) });
    expect(up).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(up);
    up.focus();
    await userEvent.keyboard('{Enter}');
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(tableCodes()).toEqual(['urgent', 'high', 'low', 'normal']);

    await act(async () => answer({ data: inOrder(['urgent', 'high', 'low', 'normal']) }));
    await waitFor(() => expect(up).not.toHaveAttribute('aria-disabled'));
  });

  it('puts the list back and says so when the server refuses the move', async () => {
    putSpy.mockRejectedValue(new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } }));
    await renderPage();
    await userEvent.click(within(priorityRow('urgent')).getByRole('button', { name: en('reorder.moveDown', { name: 'Urgent' }) }));
    expect(await screen.findByText('Boom.')).toBeInTheDocument();
    expect(tableCodes()).toEqual(['urgent', 'high', 'normal', 'low']);
  });

  it('reloads the list and says somebody else changed it on 409 ORDER_STALE', async () => {
    putSpy.mockRejectedValue(new ApiError(409, { error: { code: 'ORDER_STALE', message: 'Stale.' } }));
    await renderPage();
    getSpy.mockResolvedValue({ data: inOrder(['low', 'urgent', 'high', 'normal']) });
    await userEvent.click(within(priorityRow('urgent')).getByRole('button', { name: en('reorder.moveDown', { name: 'Urgent' }) }));
    expect(await screen.findByText(en('reorder.stale'))).toBeInTheDocument();
    await waitFor(() => expect(tableCodes()).toEqual(['low', 'urgent', 'high', 'normal']));
  });
});

describe('TaskPrioritiesPage — the dialog', () => {
  it('adds a priority with its code, both names and a colour — last, with no position field (#1560)', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('priorities.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.code')), 'blocker');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), 'Blocker');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.pl')), 'Blokujący');
    expect(within(dialog).queryByRole('spinbutton')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${API}/priorities`, {
        code: 'blocker',
        name: { en: 'Blocker', pl: 'Blokujący' },
        color: '#64748b',
        weight: 50,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses a code with a leading digit, `none` and a missing name before they reach the server', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('priorities.add') }));
    const dialog = screen.getByRole('dialog');
    const codeField = within(dialog).getByLabelText(en('workflow.field.code'));
    await userEvent.type(codeField, '1 Top Priority');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(codeField).toHaveValue('1_top_priority');
    expect(await within(dialog).findByText(en('workflow.error.code'))).toBeInTheDocument();
    expect(within(dialog).getByText(en('workflow.error.name'))).toBeInTheDocument();
    // Focus goes to the first invalid field (WCAG 3.3.1, #512).
    await waitFor(() => expect(codeField).toHaveFocus());
    await userEvent.clear(codeField);
    await userEvent.type(codeField, 'None');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(await within(dialog).findByText(en('priorities.error.codeNone'))).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('derives the code from the English name until it is edited, and says where it comes from (WORK-09)', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('priorities.add') }));
    const dialog = screen.getByRole('dialog');
    const codeField = within(dialog).getByLabelText(en('workflow.field.code'));
    expect(codeField).toHaveAccessibleDescription(en('priorities.field.codeHint'));
    const english = within(dialog).getByLabelText(en('workflow.field.name.en'));
    await userEvent.type(english, 'Pilne — dziś');
    expect(codeField).toHaveValue('pilne_dzis');
    await userEvent.type(codeField, 'x');
    await userEvent.type(english, '!');
    expect(codeField).toHaveValue('pilne_dzisx');
  });

  it('refuses a taken code at the code — from the list and from the server — never suffixing it', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('priorities.add') }));
    const dialog = screen.getByRole('dialog');
    const codeField = within(dialog).getByLabelText(en('workflow.field.code'));
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), 'High');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.pl')), 'Wysoki');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(codeField).toHaveValue('high');
    expect(codeField).toHaveAccessibleDescription(en('priorities.error.codeTaken'));
    expect(postSpy).not.toHaveBeenCalled();

    postSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'TASK_WORKFLOW_INVALID',
          message: 'A priority with the code "blocker" already exists.',
          details: { rule: 'priority_code_taken', code: 'priority_code_taken' },
        },
      }),
    );
    await userEvent.clear(codeField);
    await userEvent.type(codeField, 'blocker');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(codeField).toHaveAccessibleDescription(en('priorities.error.codeTaken')));
    expect(codeField).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(codeField).toHaveFocus());
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
