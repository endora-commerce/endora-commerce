import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityWorkflow } from '@endora-commerce/contracts';
import { ORDER_STATUS_GRAPH, WORKFLOW, core, en, renderCrm } from './crm-fixtures';

/**
 * The Opportunity workflow configuration screen
 * (`specs/143-crm-sales-opportunities/`, User Story 1 — tasks T036 and T052;
 * FR-010 – FR-014).
 *
 * The collaborator is the kit's `apiClient` — the seam every packaged screen's
 * test names. The canvas of the transition graph is ECharts', which jsdom
 * cannot draw; its From/To form is the accessible path and the one driven here.
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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { WorkflowConfigPage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/WorkflowConfigPage'
);

const WORKFLOW_PATH = '/api/v1/admin/crm/workflow';

beforeEach(() => {
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy]) spy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === WORKFLOW_PATH) return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    // The *Board card* section (User Story 19) is proven in `board-card-fields.test.tsx`.
    if (path === '/api/v1/admin/crm/board/card-fields') {
      return Promise.resolve({ data: { fields: [], available: [], maxFields: 6 } });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  postSpy.mockResolvedValue({ data: WORKFLOW });
  putSpy.mockResolvedValue({ data: WORKFLOW });
  patchSpy.mockResolvedValue({ data: WORKFLOW });
  deleteSpy.mockResolvedValue(undefined);
});

async function renderPage(): Promise<void> {
  renderCrm(<WorkflowConfigPage />, { path: '/crm/workflow' });
  await screen.findByRole('button', { name: en('workflow.status.add') });
}

/** The *Order sync* tab, both mapping tables loaded. */
async function renderOrderSync(): Promise<void> {
  renderCrm(<WorkflowConfigPage />, { path: '/crm/workflow/order-sync' });
  await screen.findByRole('table', { name: en('workflow.mapping.title') });
}

const TAB_PATHS = {
  'workflow.tab.statuses': '/crm/workflow',
  'workflow.tab.orderSync': '/crm/workflow/order-sync',
  'workflow.tab.value': '/crm/workflow/value',
  'workflow.tab.boardCard': '/crm/workflow/board-card',
  // The tag list, the configuration's last tab (issue #1557), on the same strip.
  'configuration.tab.tags': '/crm/workflow/tags',
} as const;

describe('WorkflowConfigPage — one save model per tab (issue #1559, WORK-08)', () => {
  it('splits the configuration into route tabs — four of the workflow, then Tags — and shows one at a time', async () => {
    await renderPage();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('href')])).toEqual(
      Object.entries(TAB_PATHS).map(([key, path]) => [en(key), path]),
    );
    expect(screen.getByRole('tab', { name: en('workflow.tab.statuses') })).toHaveAttribute('aria-selected', 'true');
    // The other tabs' content is not on this one.
    expect(screen.queryByRole('table', { name: en('workflow.mapping.title') })).toBeNull();
    expect(screen.queryByText(en('value.counting.title'))).toBeNull();
    expect(screen.queryByRole('region', { name: en('boardCard.title') })).toBeNull();
  });

  it('marks Statuses & moves as applied immediately, in one card with no Save', async () => {
    await renderPage();
    const statuses = screen.getByRole('region', { name: en('workflow.statuses.title') });
    const moves = screen.getByRole('region', { name: en('workflow.transitions.title') });
    // Two sections of one card, not two cards.
    expect(statuses.parentElement).toBe(moves.parentElement);
    for (const section of [statuses, moves]) {
      expect(within(section).getByText(core('saveSession.immediateBadge'))).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: core('common.action.save') })).toBeNull();
  });

  it('holds both directions of the order sync under one Save, with no immediate badge', async () => {
    await renderOrderSync();
    expect(screen.getByRole('tab', { name: en('workflow.tab.orderSync') })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: en('workflow.mapping.title') })).toBeInTheDocument();
    const reverse = screen.getByRole('region', { name: en('workflow.reverse.title') });
    // The one rule the tables do not show stays, as the section's line.
    expect(reverse).toHaveAccessibleDescription(en('workflow.reverse.description'));
    expect(screen.getAllByRole('button', { name: en('workflow.mapping.save') })).toHaveLength(1);
    expect(screen.queryByText(core('saveSession.immediateBadge'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('workflow.status.add') })).toBeNull();
  });

  it('says a mapping was saved beside its Save, and says unsaved changes before it', async () => {
    await renderOrderSync();
    await userEvent.selectOptions(
      screen.getByLabelText(en('workflow.mapping.orderStatusFor', { name: 'Qualified' })),
      'paid',
    );
    expect(screen.getByText(core('form.unsavedChanges.hint'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.mapping.save') }));
    expect(await screen.findByText(en('workflow.mapping.saved'))).toBeInTheDocument();
  });

  it('asks before a tab switch drops an unsaved mapping', async () => {
    await renderOrderSync();
    await userEvent.selectOptions(
      screen.getByLabelText(en('workflow.mapping.orderStatusFor', { name: 'Qualified' })),
      'paid',
    );
    await userEvent.click(screen.getByRole('tab', { name: en('workflow.tab.value') }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: en('workflow.mapping.title') })).toBeInTheDocument();
  });

  it('opens the value tab with its one Save', async () => {
    renderCrm(<WorkflowConfigPage />, { path: '/crm/workflow/value' });
    const region = await screen.findByRole('region', { name: en('value.counting.title') });
    expect(within(region).getByRole('group', { name: en('value.counting.order.legend') })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: en('value.counting.save') })).toHaveLength(1);
    expect(screen.queryByRole('table', { name: en('workflow.statuses.title') })).toBeNull();
  });

  it('sends the board\'s old #board-card link to the Board card tab', async () => {
    renderCrm(<WorkflowConfigPage />, { path: '/crm/workflow#board-card' });
    expect(await screen.findByRole('tab', { name: en('workflow.tab.boardCard') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('region', { name: core('boardCardFields.shown.title') })).toBeInTheDocument();
  });
});

describe('WorkflowConfigPage — the counting statuses (issue #1561)', () => {
  it('sends the opportunity value\'s #value-counting link to the Value tab, under its anchor', async () => {
    renderCrm(<WorkflowConfigPage />, { path: '/crm/workflow#value-counting' });
    expect(await screen.findByRole('tab', { name: en('workflow.tab.value') })).toHaveAttribute('aria-selected', 'true');
    const heading = await screen.findByText(en('value.counting.title'));
    expect(heading.closest('#value-counting')).not.toBeNull();
  });
});

describe('WorkflowConfigPage — the Board card tab (User Story 19)', () => {
  it('shows the board-card editor in a section of its own', async () => {
    renderCrm(<WorkflowConfigPage />, { path: '/crm/workflow/board-card' });
    expect(await screen.findByRole('region', { name: en('boardCard.title') })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: core('boardCardFields.shown.title') })).toBeInTheDocument();
  });
});

/** The row of the statuses table that carries `code`. */
function statusRow(code: string): HTMLElement {
  const table = screen.getByRole('table', { name: en('workflow.statuses.title') });
  const cell = within(table).getByText(code, { selector: 'td' });
  return cell.closest('tr') as HTMLElement;
}

/** The codes of the statuses table, top to bottom. */
function tableCodes(): string[] {
  const table = screen.getByRole('table', { name: en('workflow.statuses.title') });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '');
}

function inOrder(codes: readonly string[]): OpportunityWorkflow {
  return {
    ...WORKFLOW,
    statuses: codes.map((code, index) => ({ ...WORKFLOW.statuses.find((s) => s.code === code)!, weight: (index + 1) * 10 })),
  };
}

describe('WorkflowConfigPage — reordering the statuses (issue #1560)', () => {
  const DEFAULT = ['new', 'qualified', 'negotiation', 'won', 'lost'];
  const moveUp = (code: string, name: string) =>
    userEvent.click(within(statusRow(code)).getByRole('button', { name: en('reorder.moveUp', { name }) }));

  it('has no position field in the status dialog, and a new status goes last', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('spinbutton')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.defaultName')), 'In delivery');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({ weight: 110 });
  });

  it('moves the row at once and sends one PUT of the whole order, every move waiting until it settles', async () => {
    let answer: (value: { data: OpportunityWorkflow }) => void = () => {};
    putSpy.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await renderPage();
    await moveUp('negotiation', 'Negotiation');

    const next = ['new', 'negotiation', 'qualified', 'won', 'lost'];
    expect(tableCodes()).toEqual(next);
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/crm/statuses/order', { orderedCodes: next });
    const up = within(statusRow('won')).getByRole('button', { name: en('reorder.moveUp', { name: 'Won' }) });
    expect(up).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(up);
    // `aria-disabled` does not block activation: the handler returns early, by keyboard too.
    up.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(tableCodes()).toEqual(next);

    await act(async () => answer({ data: inOrder(next) }));
    await waitFor(() => expect(up).not.toHaveAttribute('aria-disabled'));
    expect(tableCodes()).toEqual(next);
  });

  it('puts the list back and says so when the server refuses the move', async () => {
    putSpy.mockRejectedValue(new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } }));
    await renderPage();
    await moveUp('lost', 'Lost');
    expect(await screen.findByText('Boom.')).toBeInTheDocument();
    expect(tableCodes()).toEqual(DEFAULT);
  });

  it('reloads the list and says somebody else changed it on 409 ORDER_STALE', async () => {
    putSpy.mockRejectedValue(new ApiError(409, { error: { code: 'ORDER_STALE', message: 'Stale.' } }));
    await renderPage();
    const reloaded = ['qualified', 'new', 'negotiation', 'won', 'lost'];
    getSpy.mockImplementation((path: string) => {
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: inOrder(reloaded) });
      if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
      return Promise.resolve({ data: { fields: [], available: [], maxFields: 6 } });
    });
    await moveUp('lost', 'Lost');
    expect(await screen.findByText(en('reorder.stale'))).toBeInTheDocument();
    await waitFor(() => expect(tableCodes()).toEqual(reloaded));
  });
});

describe('WorkflowConfigPage', () => {
  it('lists every status with its kind and marks the start status', async () => {
    await renderPage();
    expect(getSpy).toHaveBeenCalledWith(WORKFLOW_PATH);
    expect(within(statusRow('new')).getByText(en('workflow.flag.initial'))).toBeInTheDocument();
    expect(within(statusRow('won')).getByText(en('workflow.kind.won'))).toBeInTheDocument();
    expect(within(statusRow('lost')).getByText(en('workflow.kind.lost'))).toBeInTheDocument();
    expect(within(statusRow('qualified')).queryByText(en('workflow.flag.initial'))).toBeNull();
  });

  it('adds a status', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.code')), 'in_delivery');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.defaultName')), 'In delivery');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(
      '/api/v1/admin/crm/statuses',
      expect.objectContaining({ code: 'in_delivery', defaultName: 'In delivery', kind: 'open' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses a code with a leading digit before it reaches the server', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.code')), '2 In Delivery');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.defaultName')), 'In delivery');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));

    expect(within(dialog).getByLabelText(en('workflow.field.code'))).toHaveValue('2_in_delivery');
    expect(await within(dialog).findByText(en('workflow.error.code'))).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  describe('the code of a new status (issue #1560, WORK-09)', () => {
    async function openCreate(): Promise<HTMLElement> {
      await renderPage();
      await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
      return screen.getByRole('dialog');
    }

    it('follows the default name, diacritics folded, until the operator edits it', async () => {
      const dialog = await openCreate();
      const code = within(dialog).getByLabelText(en('workflow.field.code'));
      expect(code).toHaveAccessibleDescription(en('workflow.field.codeHint'));
      const name = within(dialog).getByLabelText(en('workflow.field.defaultName'));
      await userEvent.type(name, 'Wysłana oferta');
      expect(code).toHaveValue('wyslana_oferta');
      await userEvent.type(code, '_x');
      await userEvent.type(name, ' 2');
      expect(code).toHaveValue('wyslana_oferta_x');
    });

    it('normalises a typed code on blur instead of refusing it', async () => {
      const dialog = await openCreate();
      const code = within(dialog).getByLabelText(en('workflow.field.code'));
      await userEvent.type(code, 'In Delivery');
      await userEvent.tab();
      expect(code).toHaveValue('in_delivery');
    });

    it('refuses a taken code at the code — from the list and from the server — never suffixing it', async () => {
      const dialog = await openCreate();
      const code = within(dialog).getByLabelText(en('workflow.field.code'));
      await userEvent.type(within(dialog).getByLabelText(en('workflow.field.defaultName')), 'Won');
      await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
      expect(code).toHaveValue('won');
      expect(code).toHaveAccessibleDescription(en('workflow.error.codeTaken'));
      await waitFor(() => expect(code).toHaveFocus());
      expect(postSpy).not.toHaveBeenCalled();

      postSpy.mockRejectedValue(
        new ApiError(409, {
          error: {
            code: 'CRM_STATUS_CODE_TAKEN',
            message: 'An opportunity status with the code "won_big" already exists.',
            details: { statusCode: 'won_big' },
          },
        }),
      );
      await userEvent.clear(code);
      await userEvent.type(code, 'won_big');
      await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
      await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(code).toHaveAccessibleDescription(en('workflow.error.codeTaken')));
      expect(code).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(code).toHaveFocus());
    });
  });

  it('marks an existing status as closing-won', async () => {
    await renderPage();
    await userEvent.click(
      within(statusRow('negotiation')).getByRole('button', {
        name: en('workflow.status.editLabel', { name: 'Negotiation' }),
      }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(en('workflow.field.kind')), 'won');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(
      '/api/v1/admin/crm/statuses/negotiation',
      expect.objectContaining({ kind: 'won' }),
    );
    // The code is immutable and the schema is strict: a body naming it is refused.
    expect(patchSpy.mock.calls[0]?.[1]).not.toHaveProperty('code');
  });

  it('adds a transition in the graph', async () => {
    await renderPage();
    await userEvent.selectOptions(
      screen.getByLabelText(core('orderStatusConfig.col.from')),
      'qualified',
    );
    await userEvent.selectOptions(screen.getByLabelText(core('orderStatusConfig.col.to')), 'lost');
    await userEvent.click(
      screen.getByRole('button', { name: core('orderStatusConfig.addTransition') }),
    );
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/crm/transitions', {
        add: [{ fromStatusCode: 'qualified', toStatusCode: 'lost' }],
      }),
    );
  });

  it('sets a forward mapping from an opportunity status to an order status', async () => {
    await renderOrderSync();
    const select = await screen.findByLabelText(
      en('workflow.mapping.orderStatusFor', { name: 'Qualified' }),
    );
    await userEvent.selectOptions(select, 'paid');
    await userEvent.click(screen.getByRole('button', { name: en('workflow.mapping.save') }));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/crm/order-status-mappings', {
        mappings: [
          {
            direction: 'opportunity_to_order',
            opportunityStatusCode: 'qualified',
            orderStatusCode: 'paid',
          },
        ],
      }),
    );
  });

  describe('the reverse direction — an order status moves the opportunity (User Story 2)', () => {
    const reverseTable = (): HTMLElement =>
      screen.getByRole('table', { name: en('workflow.reverse.title') });

    const targetFor = (orderStatus: string): HTMLElement =>
      screen.getByLabelText(en('workflow.reverse.opportunityStatusFor', { name: orderStatus }));

    const everyOrderFor = (orderStatus: string): HTMLElement =>
      screen.getByRole('checkbox', {
        name: en('workflow.reverse.requireAllFor', { name: orderStatus }),
      });

    it('offers one row per order status, with nothing mapped and the toggle unavailable', async () => {
      await renderOrderSync();
      await waitFor(() => expect(reverseTable()).toBeInTheDocument());
      for (const name of ['New', 'Paid', 'Completed']) {
        expect(targetFor(name)).toHaveValue('');
        expect(everyOrderFor(name)).toBeDisabled();
        expect(everyOrderFor(name)).not.toBeChecked();
      }
    });

    it('turns "only when every linked order is there" on by default when the target closes the opportunity', async () => {
      await renderOrderSync();
      await waitFor(() => expect(reverseTable()).toBeInTheDocument());
      await userEvent.selectOptions(targetFor('Completed'), 'won');
      expect(everyOrderFor('Completed')).toBeEnabled();
      expect(everyOrderFor('Completed')).toBeChecked();

      // An open target does not wait for the other orders unless the operator says so.
      await userEvent.selectOptions(targetFor('Paid'), 'qualified');
      expect(everyOrderFor('Paid')).not.toBeChecked();

      await userEvent.click(screen.getByRole('button', { name: en('workflow.mapping.save') }));
      await waitFor(() =>
        expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/crm/order-status-mappings', {
          mappings: [
            {
              direction: 'order_to_opportunity',
              orderStatusCode: 'paid',
              opportunityStatusCode: 'qualified',
              requireAllOrders: false,
            },
            {
              direction: 'order_to_opportunity',
              orderStatusCode: 'completed',
              opportunityStatusCode: 'won',
              requireAllOrders: true,
            },
          ],
        }),
      );
    });

    it('sends the toggle as the operator left it, and both directions in one write', async () => {
      await renderOrderSync();
      await waitFor(() => expect(reverseTable()).toBeInTheDocument());
      await userEvent.selectOptions(
        screen.getByLabelText(en('workflow.mapping.orderStatusFor', { name: 'Won' })),
        'completed',
      );
      await userEvent.selectOptions(targetFor('Completed'), 'won');
      await userEvent.click(everyOrderFor('Completed'));
      expect(everyOrderFor('Completed')).not.toBeChecked();
      await userEvent.click(screen.getByRole('button', { name: en('workflow.mapping.save') }));

      await waitFor(() =>
        expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/crm/order-status-mappings', {
          mappings: [
            { direction: 'opportunity_to_order', opportunityStatusCode: 'won', orderStatusCode: 'completed' },
            {
              direction: 'order_to_opportunity',
              orderStatusCode: 'completed',
              opportunityStatusCode: 'won',
              requireAllOrders: false,
            },
          ],
        }),
      );
    });

    it('shows the stored reverse mappings, flags an order status that no longer exists, and can remove it', async () => {
      const stored = {
        ...WORKFLOW,
        orderStatusMappings: [
          { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified', requireAllOrders: true, orderStatusKnown: true },
          { direction: 'order_to_opportunity', orderStatusCode: 'archived', opportunityStatusCode: 'lost', requireAllOrders: false, orderStatusKnown: true },
        ],
      };
      getSpy.mockImplementation((path: string) => {
        if (path === WORKFLOW_PATH) return Promise.resolve({ data: stored });
        if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
      await renderOrderSync();
      await waitFor(() => expect(reverseTable()).toBeInTheDocument());

      expect(targetFor('Paid')).toHaveValue('qualified');
      // The stored choice wins over the default for an open target.
      expect(everyOrderFor('Paid')).toBeChecked();

      // `archived` is not among the order statuses the Orders module answers.
      const gone = en('workflow.mapping.unknown', { code: 'archived' });
      const row = within(reverseTable()).getByText(gone).closest('tr') as HTMLElement;
      expect(within(row).getByText(en('workflow.reverse.unknownStatus'))).toBeInTheDocument();
      expect(targetFor(gone)).toHaveValue('lost');

      // Nothing was changed yet: the table is not dirty.
      expect(screen.getByRole('button', { name: en('workflow.mapping.save') })).toBeDisabled();

      await userEvent.selectOptions(targetFor(gone), '');
      await userEvent.click(screen.getByRole('button', { name: en('workflow.mapping.save') }));
      await waitFor(() =>
        expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/crm/order-status-mappings', {
          mappings: [
            {
              direction: 'order_to_opportunity',
              orderStatusCode: 'paid',
              opportunityStatusCode: 'qualified',
              requireAllOrders: true,
            },
          ],
        }),
      );
    });
  });

  it('shows the refusal when an in-use status is deleted', async () => {
    const refusal = 'The status "new" is used by opportunities (3). Move them to another status first.';
    deleteSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'CRM_STATUS_IN_USE', message: refusal } }),
    );
    await renderPage();
    await userEvent.click(
      within(statusRow('new')).getByRole('button', {
        name: en('workflow.status.deleteLabel', { name: 'New' }),
      }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));

    await waitFor(() =>
      expect(deleteSpy).toHaveBeenCalledWith('/api/v1/admin/crm/statuses/new'),
    );
    expect(await screen.findByText(refusal)).toBeInTheDocument();
    // Nothing was removed: the row is still there.
    expect(statusRow('new')).toBeInTheDocument();
  });

  it('shows the sentence of the broken rule when a change would leave the workflow invalid', async () => {
    const rule = 'The workflow needs at least one status that closes an opportunity as won.';
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'CRM_WORKFLOW_INVALID',
          message: rule,
          details: { rule: 'won_status_required', code: 'won_status_required' },
        },
      }),
    );
    await renderPage();
    await userEvent.click(
      within(statusRow('won')).getByRole('button', {
        name: en('workflow.status.editLabel', { name: 'Won' }),
      }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(en('workflow.field.kind')), 'open');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));

    expect(await within(dialog).findByText(rule)).toBeInTheDocument();
  });

  it('says why mappings cannot be edited when the order statuses are not readable', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: WORKFLOW });
      return Promise.reject(
        new ApiError(403, { error: { code: 'FORBIDDEN', message: 'Missing permission.' } }),
      );
    });
    renderCrm(<WorkflowConfigPage />, { path: '/crm/workflow/order-sync' });
    expect(await screen.findByText(en('workflow.mapping.ordersUnavailable'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en('workflow.mapping.save') })).toBeNull();
  });

  it('offers a retry when the workflow cannot be loaded', async () => {
    getSpy.mockRejectedValueOnce(new Error('offline'));
    renderCrm(<WorkflowConfigPage />);
    await userEvent.click(await screen.findByRole('button', { name: core('common.action.retry') }));
    expect(await screen.findByRole('button', { name: en('workflow.status.add') })).toBeInTheDocument();
  });
});
