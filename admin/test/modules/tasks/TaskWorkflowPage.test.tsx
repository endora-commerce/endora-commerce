import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskBoardCardConfig, TaskWorkflow } from '@endora-commerce/contracts';
import { core, en, renderTasks, workflow } from './tasks-fixtures';

/**
 * The Task workflow screen (`specs/165-task-management/`, User Story 2 — T044,
 * T047; `contracts/admin-surfaces.md` §1).
 *
 * The statuses table and the status dialog (names in both languages, category,
 * colour, position, initial); the kit's `StatusTransitionGraph`, whose add and
 * remove each send one delta to `PUT /tasks/transitions`; the removal dialog,
 * which asks for a replacement when the status is in use; and the screen is
 * the configurators' — hidden from everybody else by its route and nav gate.
 *
 * The graph's canvas is ECharts', which jsdom cannot draw: its From/To form
 * adds a move, and an edge is selected by calling the click handler the
 * component bound, captured from the mocked chart.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();
const chartHandlers = new Map<string, (event: unknown) => void>();

vi.mock('echarts', () => {
  const chart = {
    setOption: (): void => {},
    resize: (): void => {},
    dispose: (): void => {},
    on: (name: string, handler: (event: unknown) => void): void => {
      chartHandlers.set(name, handler);
    },
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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { TaskWorkflowPage } = await import(
  '../../../../packages/modules/tasks/src/admin/pages/settings/TaskWorkflowPage'
);
const { contributions } = await import('../../../../packages/modules/tasks/src/admin/index');

const API = '/api/v1/admin/tasks';
const CONFIGURER = ['tasks:read', 'tasks:write', 'tasks:configure'];

/** The seeded workflow, with Tasks in *In progress*. */
function seeded(): TaskWorkflow {
  const flow = workflow();
  return {
    ...flow,
    statuses: flow.statuses.map((status) => ({
      ...status,
      name: { en: status.defaultName, pl: `${status.defaultName} (pl)` },
      inUseCount: status.code === 'in_progress' ? 3 : 0,
    })),
  };
}

/** `GET /tasks/board/card-fields`: the chosen fields, and everything offered — two built-ins and one custom field. */
function cardConfig(chosen: readonly string[]): TaskBoardCardConfig {
  const available: TaskBoardCardConfig['available'] = [
    { ref: 'builtin:number', source: 'builtin', key: 'number', label: {}, labelDefault: null },
    { ref: 'builtin:due', source: 'builtin', key: 'due', label: {}, labelDefault: null },
    { ref: 'builtin:priority', source: 'builtin', key: 'priority', label: {}, labelDefault: null },
    { ref: 'custom:region', source: 'custom', key: 'region', label: { en: 'Region' }, labelDefault: 'Region' },
  ];
  return {
    fields: chosen.map((ref) => available.find((field) => field.ref === ref)!),
    available,
    maxFields: 6,
  };
}

beforeEach(() => {
  chartHandlers.clear();
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy]) spy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === `${API}/workflow`) return Promise.resolve({ data: seeded() });
    if (path === `${API}/board/card-fields`) return Promise.resolve({ data: cardConfig(['builtin:number', 'builtin:due']) });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  postSpy.mockResolvedValue({ data: seeded() });
  putSpy.mockImplementation((path: string, body: { fields?: string[] }) =>
    Promise.resolve({ data: path === `${API}/board/card-fields` ? cardConfig(body.fields ?? []) : seeded() }),
  );
  patchSpy.mockResolvedValue({ data: seeded() });
  deleteSpy.mockResolvedValue({ data: seeded() });
});

async function renderPage(): Promise<void> {
  renderTasks(<TaskWorkflowPage />, { permissions: CONFIGURER });
  await screen.findByRole('button', { name: en('workflow.status.add') });
}

/** The row of the statuses table that carries `code`. */
function statusRow(code: string): HTMLElement {
  const table = screen.getByRole('table', { name: en('workflow.statuses.title') });
  return within(table).getByText(code, { selector: 'td' }).closest('tr') as HTMLElement;
}

describe('TaskWorkflowPage — the statuses', () => {
  it('lists every status with its category, how many Tasks hold it, and marks the initial one', async () => {
    await renderPage();
    expect(getSpy).toHaveBeenCalledWith(`${API}/workflow`);
    expect(within(statusRow('todo')).getByText(en('workflow.flag.initial'))).toBeInTheDocument();
    expect(within(statusRow('done')).getByText(en('workflow.category.done'))).toBeInTheDocument();
    expect(within(statusRow('cancelled')).getByText(en('workflow.category.cancelled'))).toBeInTheDocument();
    expect(within(statusRow('in_progress')).getByText(en('workflow.category.open'))).toBeInTheDocument();
    expect(within(statusRow('in_progress')).getByText('3')).toBeInTheDocument();
    expect(within(statusRow('in_progress')).queryByText(en('workflow.flag.initial'))).toBeNull();
  });

  it('adds a status with both names, a category, a colour, a position and the initial flag', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.code')), 'in_review');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), 'In review');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.pl')), 'Do przeglądu');
    await userEvent.selectOptions(within(dialog).getByLabelText(en('workflow.field.category')), 'open');
    const weight = within(dialog).getByLabelText(en('workflow.field.weight'));
    await userEvent.clear(weight);
    await userEvent.type(weight, '25');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: en('workflow.field.initial') }));
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(`${API}/statuses`, {
      code: 'in_review',
      name: { en: 'In review', pl: 'Do przeglądu' },
      category: 'open',
      color: '#64748b',
      weight: 25,
      isInitial: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses a malformed code or a missing name before it reaches the server', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.code')), 'In Review');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(await within(dialog).findByText(en('workflow.error.code'))).toBeInTheDocument();
    expect(within(dialog).getByText(en('workflow.error.name'))).toBeInTheDocument();
    // Focus goes to the first invalid field, whose description is the error (WCAG 3.3.1, #512).
    await waitFor(() => expect(within(dialog).getByLabelText(en('workflow.field.code'))).toHaveFocus());
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('edits a status and sends only what changed — never the code', async () => {
    await renderPage();
    await userEvent.click(
      within(statusRow('in_progress')).getByRole('button', {
        name: en('workflow.status.editLabel', { name: 'In progress' }),
      }),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(en('workflow.field.code'))).toBeNull();
    const polish = within(dialog).getByLabelText(en('workflow.field.name.pl'));
    await userEvent.clear(polish);
    await userEvent.type(polish, 'W realizacji');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(`${API}/statuses/in_progress`, {
        name: { en: 'In progress', pl: 'W realizacji' },
      }),
    );
  });

  it('shows the server’s refusal in the dialog and keeps it open', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'TASK_WORKFLOW_INVALID',
          message: 'The start status must be an open status.',
          details: { rule: 'initial_must_be_open' },
        },
      }),
    );
    await renderPage();
    await userEvent.click(
      within(statusRow('done')).getByRole('button', { name: en('workflow.status.editLabel', { name: 'Done' }) }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: en('workflow.field.initial') }));
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(await within(dialog).findByText('The start status must be an open status.')).toBeInTheDocument();
    expect(patchSpy).toHaveBeenCalledWith(`${API}/statuses/done`, { isInitial: true });
  });
});

describe('TaskWorkflowPage — the moves', () => {
  it('adds a move through the graph as a delta', async () => {
    // Every move exists in the seed: one is left out so it can be added.
    const flow = seeded();
    const answer = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) =>
      path === `${API}/workflow`
        ? Promise.resolve({
            data: { ...flow, transitions: flow.transitions.filter((edge) => !(edge.from === 'done' && edge.to === 'in_progress')) },
          })
        : answer(path),
    );
    await renderPage();
    await userEvent.selectOptions(screen.getByLabelText(core('orderStatusConfig.col.from')), 'done');
    await userEvent.selectOptions(screen.getByLabelText(core('orderStatusConfig.col.to')), 'in_progress');
    await userEvent.click(screen.getByRole('button', { name: core('orderStatusConfig.addTransition') }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(`${API}/transitions`, { add: [{ from: 'done', to: 'in_progress' }] }),
    );
  });

  it('removes a selected move as a delta', async () => {
    await renderPage();
    await waitFor(() => expect(chartHandlers.has('click')).toBe(true));
    act(() => {
      chartHandlers.get('click')!({ dataType: 'edge', name: '', data: { source: 'in_progress', target: 'done' } });
    });
    await userEvent.click(await screen.findByRole('button', { name: core('orderStatusConfig.graph.removeTransition') }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(`${API}/transitions`, { remove: [{ from: 'in_progress', to: 'done' }] }),
    );
  });

  it('names the statuses of the moves form and the selected move, keeping the codes as values (T095)', async () => {
    await renderPage();
    const from = screen.getByLabelText(core('orderStatusConfig.col.from'));
    const inProgress = within(from).getByRole('option', { name: 'In progress' });
    expect(inProgress).toHaveValue('in_progress');
    expect(within(from).queryByRole('option', { name: 'in_progress' })).toBeNull();
    await waitFor(() => expect(chartHandlers.has('click')).toBe(true));
    act(() => {
      chartHandlers.get('click')!({ dataType: 'edge', name: '', data: { source: 'in_progress', target: 'done' } });
    });
    expect(await screen.findByText('In progress → Done')).toBeInTheDocument();
    expect(screen.queryByText('in_progress → done')).toBeNull();
  });

  it('shows a refused change of the moves', async () => {
    putSpy.mockRejectedValue(
      new ApiError(422, {
        error: { code: 'TASK_WORKFLOW_INVALID', message: 'A move names a status that does not exist.', details: {} },
      }),
    );
    await renderPage();
    await waitFor(() => expect(chartHandlers.has('click')).toBe(true));
    act(() => {
      chartHandlers.get('click')!({ dataType: 'edge', name: '', data: { source: 'todo', target: 'done' } });
    });
    await userEvent.click(await screen.findByRole('button', { name: core('orderStatusConfig.graph.removeTransition') }));
    // Said beside the graph it is about, not above the statuses table.
    const moves = screen.getByRole('region', { name: en('workflow.transitions.title') });
    expect(await within(moves).findByText('A move names a status that does not exist.')).toBeInTheDocument();
  });
});

describe('TaskWorkflowPage — removing a status', () => {
  it('asks for a replacement among the reachable statuses when Tasks hold the status', async () => {
    await renderPage();
    await userEvent.click(
      within(statusRow('in_progress')).getByRole('button', {
        name: en('workflow.status.deleteLabel', { name: 'In progress' }),
      }),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(en('workflow.delete.inUse', { count: 3 }))).toBeInTheDocument();
    const replacement = within(dialog).getByLabelText(en('workflow.delete.replacement'));
    expect(within(replacement).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual([
      '',
      'todo',
      'done',
      'cancelled',
    ]);
    // Without a choice nothing is sent.
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(within(dialog).getByText(en('workflow.delete.replacementRequired'))).toBeInTheDocument();

    await userEvent.selectOptions(replacement, 'done');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${API}/statuses/in_progress?replacement=done`));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('removes a status nobody holds without asking for a replacement', async () => {
    await renderPage();
    await userEvent.click(
      within(statusRow('cancelled')).getByRole('button', {
        name: en('workflow.status.deleteLabel', { name: 'Cancelled' }),
      }),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(en('workflow.delete.replacement'))).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${API}/statuses/cancelled`));
  });

  it('asks for a replacement after all when the server says Tasks the operator cannot see hold the status', async () => {
    deleteSpy.mockRejectedValueOnce(
      new ApiError(422, {
        error: {
          code: 'TASK_WORKFLOW_INVALID',
          message: 'Tasks are in this status: choose the status they move to.',
          details: { rule: 'replacement_required', code: 'replacement_required' },
        },
      }),
    );
    await renderPage();
    await userEvent.click(
      within(statusRow('cancelled')).getByRole('button', {
        name: en('workflow.status.deleteLabel', { name: 'Cancelled' }),
      }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    expect(await within(dialog).findByText('Tasks are in this status: choose the status they move to.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(en('workflow.delete.replacement'))).toBeInTheDocument();
  });
});

describe('TaskWorkflowPage — the board card (FR-022)', () => {
  it('lists the fields a card shows, in order, and saves a new choice through `PUT /tasks/board/card-fields`', async () => {
    await renderPage();
    const section = await screen.findByRole('region', { name: en('boardCard.title') });
    const shown = await within(section).findByRole('list', { name: en('boardCard.shown.title') });
    expect(within(shown).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining(en('board.field.number')),
      expect.stringContaining(en('board.field.due')),
    ]);
    await userEvent.click(within(section).getByRole('button', { name: en('boardCard.add', { field: 'Region' }) }));
    await userEvent.click(within(section).getByRole('button', { name: en('boardCard.moveUp', { field: 'Region' }) }));
    await userEvent.click(within(section).getByRole('button', { name: en('boardCard.remove', { field: en('board.field.number') }) }));
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(`${API}/board/card-fields`, { fields: ['custom:region', 'builtin:due'] }),
    );
    expect(await within(section).findByText(en('boardCard.saved'))).toBeInTheDocument();
  });

  it('scrolls to the board card when opened at #board-card, once the workflow has loaded (#512)', async () => {
    // jsdom lays nothing out and has no `scrollIntoView`: what is held is which element is asked.
    const original = Element.prototype.scrollIntoView;
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element): void {
      scrolled.push(this);
    };
    try {
      renderTasks(<TaskWorkflowPage />, { permissions: CONFIGURER, path: '/tasks/settings/workflow#board-card' });
      const section = await screen.findByRole('region', { name: en('boardCard.title') });
      await waitFor(() => expect(scrolled).toContain(section));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('asks before a link leaves the screen with an unsaved card choice (#512)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      await renderPage();
      const section = await screen.findByRole('region', { name: en('boardCard.title') });
      await within(section).findByRole('list', { name: en('boardCard.shown.title') });
      await userEvent.click(within(section).getByRole('button', { name: en('boardCard.add', { field: 'Region' }) }));
      await userEvent.click(screen.getByRole('link', { name: en('settings.tags.link') }));
      expect(confirmSpy).toHaveBeenCalledWith(core('form.unsavedChanges.confirm'));
      expect(screen.getByRole('region', { name: en('boardCard.title') })).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('keeps focus on the moved row, or its neighbour, as the two lists change (WCAG 2.4.3)', async () => {
    await renderPage();
    const section = await screen.findByRole('region', { name: en('boardCard.title') });
    await within(section).findByRole('list', { name: en('boardCard.shown.title') });
    const button = (key: string, field: string): HTMLElement => within(section).getByRole('button', { name: en(key, { field }) });
    const number = en('board.field.number');
    const due = en('board.field.due');
    const priority = en('board.field.priority');

    // Down into the last place, where Move down is disabled: the row's Move up.
    await userEvent.click(button('boardCard.moveDown', number));
    expect(button('boardCard.moveUp', number)).toHaveFocus();
    // Up into the first place, where Move up is disabled: the row's Move down.
    await userEvent.click(button('boardCard.moveUp', number));
    expect(button('boardCard.moveDown', number)).toHaveFocus();
    // A removed row: the row that took its place.
    await userEvent.click(button('boardCard.remove', number));
    expect(button('boardCard.remove', due)).toHaveFocus();
    // The last row removed: the field's own Add, back in the offer.
    await userEvent.click(button('boardCard.remove', due));
    expect(button('boardCard.add', due)).toHaveFocus();
    // An added field's chip goes: the next one offered in its group.
    await userEvent.click(button('boardCard.add', due));
    expect(button('boardCard.add', priority)).toHaveFocus();
    // The last chip of its group: the added row.
    await userEvent.click(button('boardCard.add', 'Region'));
    expect(button('boardCard.moveUp', 'Region')).toHaveFocus();
  });
});

describe('TaskWorkflowPage — who sees it', () => {
  it('is a route and a nav entry on tasks:configure only, and a palette action on the same code', async () => {
    const route = (contributions.routes ?? []).find((candidate) => candidate.path === '/tasks/settings/workflow');
    expect(route?.requiredPermission).toBe('tasks:configure');
    const nav = (contributions.nav ?? []).find((row) => row.to === '/tasks/settings/workflow');
    expect(nav?.requiredPermission).toBe('tasks:configure');
    expect(nav?.labelKey).toBe('nav.settings.label');
    expect(en('nav.settings.label')).toBe('Task settings');
  });
});
