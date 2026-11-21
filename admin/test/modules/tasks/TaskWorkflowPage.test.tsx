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

/** The codes of the statuses table, top to bottom. */
function tableCodes(): string[] {
  const table = screen.getByRole('table', { name: en('workflow.statuses.title') });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '');
}

/** The seeded workflow with its statuses in `codes`' order. */
function inOrder(codes: readonly string[]): TaskWorkflow {
  const flow = seeded();
  return {
    ...flow,
    statuses: codes.map((code, index) => ({ ...flow.statuses.find((s) => s.code === code)!, weight: (index + 1) * 10 })),
  };
}

describe('TaskWorkflowPage — one save model per card (issue #1559, WORK-08)', () => {
  it('puts the statuses and the moves in one card, both marked as applied immediately', async () => {
    await renderPage();
    const statuses = screen.getByRole('region', { name: en('workflow.statuses.title') });
    const moves = screen.getByRole('region', { name: en('workflow.transitions.title') });
    expect(statuses.parentElement).toBe(moves.parentElement);
    for (const section of [statuses, moves]) {
      expect(within(section).getByText(core('saveSession.immediateBadge'))).toBeInTheDocument();
    }
  });

  it('keeps the board card, the one part with a Save, in a card of its own without the badge', async () => {
    await renderPage();
    const board = await screen.findByRole('region', { name: en('boardCard.title') });
    const moves = screen.getByRole('region', { name: en('workflow.transitions.title') });
    expect(board.contains(moves)).toBe(false);
    expect(moves.parentElement?.contains(board)).toBe(false);
    expect(within(board).queryByText(core('saveSession.immediateBadge'))).toBeNull();
  });
});

describe('TaskWorkflowPage — reordering the statuses (issue #1560)', () => {
  const moveDown = (code: string, name: string) =>
    userEvent.click(within(statusRow(code)).getByRole('button', { name: en('reorder.moveDown', { name }) }));

  it('moves the row at once and sends one PUT of the whole order, every move waiting until it settles', async () => {
    let answer: (value: { data: TaskWorkflow }) => void = () => {};
    putSpy.mockImplementation(
      (path: string) =>
        path === `${API}/statuses/order` ? new Promise((resolve) => (answer = resolve)) : Promise.resolve({ data: seeded() }),
    );
    await renderPage();
    await moveDown('todo', 'To do');

    expect(tableCodes()).toEqual(['in_progress', 'todo', 'done', 'cancelled']);
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(`${API}/statuses/order`, {
      orderedCodes: ['in_progress', 'todo', 'done', 'cancelled'],
    });
    const down = within(statusRow('done')).getByRole('button', { name: en('reorder.moveDown', { name: 'Done' }) });
    expect(down).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(down);
    // `aria-disabled` does not block activation: the handler returns early, by keyboard too.
    down.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(tableCodes()).toEqual(['in_progress', 'todo', 'done', 'cancelled']);

    await act(async () => answer({ data: inOrder(['in_progress', 'todo', 'done', 'cancelled']) }));
    await waitFor(() => expect(down).not.toHaveAttribute('aria-disabled'));
    expect(tableCodes()).toEqual(['in_progress', 'todo', 'done', 'cancelled']);
  });

  it('puts the list back and says so when the server refuses the move', async () => {
    putSpy.mockRejectedValue(new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } }));
    await renderPage();
    await moveDown('done', 'Done');
    await waitFor(() => expect(tableCodes()).toEqual(['todo', 'in_progress', 'done', 'cancelled']));
    expect(await screen.findByText('Boom.')).toBeInTheDocument();
  });

  it('reloads the list and says somebody else changed it on 409 ORDER_STALE', async () => {
    putSpy.mockRejectedValue(new ApiError(409, { error: { code: 'ORDER_STALE', message: 'Stale.' } }));
    await renderPage();
    getSpy.mockImplementation((path: string) =>
      path === `${API}/workflow`
        ? Promise.resolve({ data: inOrder(['cancelled', 'todo', 'in_progress', 'done']) })
        : Promise.resolve({ data: cardConfig([]) }),
    );
    await moveDown('todo', 'To do');
    expect(await screen.findByText(en('reorder.stale'))).toBeInTheDocument();
    await waitFor(() => expect(tableCodes()).toEqual(['cancelled', 'todo', 'in_progress', 'done']));
  });

  it('offers no move up on the first row and no move down on the last', async () => {
    await renderPage();
    expect(within(statusRow('todo')).getByRole('button', { name: en('reorder.moveUp', { name: 'To do' }) })).toBeDisabled();
    expect(
      within(statusRow('cancelled')).getByRole('button', { name: en('reorder.moveDown', { name: 'Cancelled' }) }),
    ).toBeDisabled();
  });
});

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

  it('adds a status with both names, a category, a colour and the initial flag — last, with no position field (#1560)', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.code')), 'in_review');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), 'In review');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.pl')), 'Do przeglądu');
    await userEvent.selectOptions(within(dialog).getByLabelText(en('workflow.field.category')), 'open');
    expect(within(dialog).queryByRole('spinbutton')).toBeNull();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: en('workflow.field.initial') }));
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(`${API}/statuses`, {
      code: 'in_review',
      name: { en: 'In review', pl: 'Do przeglądu' },
      category: 'open',
      color: '#64748b',
      weight: 50,
      isInitial: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses a code with a leading digit or a missing name before it reaches the server', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.code')), '2nd review');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    // Normalised on blur, and still refused: a code starts with a letter.
    expect(within(dialog).getByLabelText(en('workflow.field.code'))).toHaveValue('2nd_review');
    expect(await within(dialog).findByText(en('workflow.error.code'))).toBeInTheDocument();
    expect(within(dialog).getByText(en('workflow.error.name'))).toBeInTheDocument();
    // Focus goes to the first invalid field, whose description is the error (WCAG 3.3.1, #512).
    await waitFor(() => expect(within(dialog).getByLabelText(en('workflow.field.code'))).toHaveFocus());
    expect(postSpy).not.toHaveBeenCalled();
  });
});

/** Issue #1560 (WORK-09) and the architect ruling on #512 — the code comes from the English name. */
describe('TaskWorkflowPage — the code of a new status', () => {
  async function openCreate(): Promise<HTMLElement> {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
    return screen.getByRole('dialog');
  }

  it('follows the English name, Polish diacritics folded, and says where it comes from', async () => {
    const dialog = await openCreate();
    const code = within(dialog).getByLabelText(en('workflow.field.code'));
    expect(code).toHaveAccessibleDescription(en('workflow.field.codeHint'));
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), 'Gotowe do wysyłki');
    expect(code).toHaveValue('gotowe_do_wysylki');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.pl')), 'Gotowe do wysyłki');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![1]).toMatchObject({ code: 'gotowe_do_wysylki' });
  });

  it('stops following once the operator edits the code', async () => {
    const dialog = await openCreate();
    const code = within(dialog).getByLabelText(en('workflow.field.code'));
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), 'Review');
    await userEvent.type(code, '_qa');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), ' later');
    expect(code).toHaveValue('review_qa');
  });

  it('normalises a typed code on blur instead of refusing it', async () => {
    const dialog = await openCreate();
    const code = within(dialog).getByLabelText(en('workflow.field.code'));
    await userEvent.type(code, 'In Review');
    await userEvent.tab();
    expect(code).toHaveValue('in_review');
    expect(within(dialog).queryByText(en('workflow.error.code'))).toBeNull();
  });

  it('refuses a code already in the workflow, without suffixing it, before it reaches the server', async () => {
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), 'Done');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.pl')), 'Zrobione');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    const code = within(dialog).getByLabelText(en('workflow.field.code'));
    expect(code).toHaveValue('done');
    expect(code).toHaveAccessibleDescription(en('workflow.error.codeTaken'));
    await waitFor(() => expect(code).toHaveFocus());
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('says the server’s collision at the code', async () => {
    postSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'TASK_WORKFLOW_INVALID',
          message: 'A status with the code "in_review" already exists.',
          details: { rule: 'status_code_taken', code: 'status_code_taken' },
        },
      }),
    );
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.en')), 'In review');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.name.pl')), 'Do przeglądu');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    const code = within(dialog).getByLabelText(en('workflow.field.code'));
    await waitFor(() => expect(code).toHaveAccessibleDescription(en('workflow.error.codeTaken')));
    expect(code).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(code).toHaveFocus());
    expect(screen.getByRole('dialog')).toBe(dialog);
  });
});

describe('TaskWorkflowPage — editing a status', () => {
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
    const shown = await within(section).findByRole('list', { name: core('boardCardFields.shown.title') });
    expect(within(shown).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining(en('board.field.number')),
      expect.stringContaining(en('board.field.due')),
    ]);
    await userEvent.click(within(section).getByRole('button', { name: core('boardCardFields.add', { field: 'Region' }) }));
    await userEvent.click(within(section).getByRole('button', { name: core('boardCardFields.moveUp', { field: 'Region' }) }));
    await userEvent.click(within(section).getByRole('button', { name: core('boardCardFields.remove', { field: en('board.field.number') }) }));
    await userEvent.click(within(section).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(`${API}/board/card-fields`, { fields: ['custom:region', 'builtin:due'] }),
    );
    expect(await within(section).findByText(core('boardCardFields.saved'))).toBeInTheDocument();
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
      // The anchor wraps the section's card.
      await waitFor(() => expect(scrolled.some((element) => element.id === 'board-card' && element.contains(section))).toBe(true));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('asks before a link leaves the screen with an unsaved card choice (#512)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      await renderPage();
      const section = await screen.findByRole('region', { name: en('boardCard.title') });
      await within(section).findByRole('list', { name: core('boardCardFields.shown.title') });
      await userEvent.click(within(section).getByRole('button', { name: core('boardCardFields.add', { field: 'Region' }) }));
      await userEvent.click(screen.getByRole('tab', { name: en('configuration.tab.tags') }));
      expect(confirmSpy).toHaveBeenCalledWith(core('form.unsavedChanges.confirm'));
      expect(screen.getByRole('region', { name: en('boardCard.title') })).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('keeps focus on the moved row, or its neighbour, as the two lists change (WCAG 2.4.3)', async () => {
    await renderPage();
    const section = await screen.findByRole('region', { name: en('boardCard.title') });
    await within(section).findByRole('list', { name: core('boardCardFields.shown.title') });
    const button = (key: string, field: string): HTMLElement => within(section).getByRole('button', { name: core(key, { field }) });
    const number = en('board.field.number');
    const due = en('board.field.due');
    const priority = en('board.field.priority');

    // Down into the last place, where Move down is disabled: the row's Move up.
    await userEvent.click(button('boardCardFields.moveDown', number));
    expect(button('boardCardFields.moveUp', number)).toHaveFocus();
    // Up into the first place, where Move up is disabled: the row's Move down.
    await userEvent.click(button('boardCardFields.moveUp', number));
    expect(button('boardCardFields.moveDown', number)).toHaveFocus();
    // A removed row: the row that took its place.
    await userEvent.click(button('boardCardFields.remove', number));
    expect(button('boardCardFields.remove', due)).toHaveFocus();
    // The last row removed: the field's own Add, back in the offer.
    await userEvent.click(button('boardCardFields.remove', due));
    expect(button('boardCardFields.add', due)).toHaveFocus();
    // An added field's chip goes: the next one offered in its group.
    await userEvent.click(button('boardCardFields.add', due));
    expect(button('boardCardFields.add', priority)).toHaveFocus();
    // The last chip of its group: the added row.
    await userEvent.click(button('boardCardFields.add', 'Region'));
    expect(button('boardCardFields.moveUp', 'Region')).toHaveFocus();
  });
});

describe('TaskWorkflowPage — who sees it', () => {
  it('is a route and a nav entry on tasks:configure only, and a palette action on the same code', async () => {
    // The configuration's first tab, at the row's own address (issue #1557).
    const route = (contributions.routes ?? []).find((candidate) => candidate.path === '/tasks/settings');
    expect(route?.requiredPermission).toBe('tasks:configure');
    const nav = (contributions.nav ?? []).find((row) => row.to === '/tasks/settings');
    expect(nav?.requiredPermission).toBe('tasks:configure');
    expect(nav?.labelKey).toBe('nav.configuration.label');
  });
});
