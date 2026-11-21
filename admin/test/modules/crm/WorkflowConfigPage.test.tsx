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
  renderCrm(<WorkflowConfigPage />);
  await screen.findByRole('button', { name: en('workflow.status.add') });
}

describe('WorkflowConfigPage — the counting statuses section (issue #1561)', () => {
  it('is under the anchor the opportunity`s value links to', async () => {
    await renderPage();
    const heading = screen.getByText(en('value.counting.title'));
    expect(heading.closest('#value-counting')).not.toBeNull();
  });
});

describe('WorkflowConfigPage — the Board card section (User Story 19)', () => {
  it('is on the screen, under the anchor the board links to', async () => {
    await renderPage();
    const heading = screen.getByText(en('boardCard.title'));
    expect(heading.closest('#board-card')).not.toBeNull();
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
    await renderPage();
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
      await renderPage();
      await waitFor(() => expect(reverseTable()).toBeInTheDocument());
      for (const name of ['New', 'Paid', 'Completed']) {
        expect(targetFor(name)).toHaveValue('');
        expect(everyOrderFor(name)).toBeDisabled();
        expect(everyOrderFor(name)).not.toBeChecked();
      }
    });

    it('turns "only when every linked order is there" on by default when the target closes the opportunity', async () => {
      await renderPage();
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
      await renderPage();
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
      await renderPage();
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

  it('keeps an unsaved mapping choice when another part of the workflow is saved', async () => {
    // Every write answers a fresh workflow. One that did not touch the mappings
    // must not throw away what the operator has chosen and not yet saved.
    putSpy.mockResolvedValue({
      data: {
        ...WORKFLOW,
        transitions: [...WORKFLOW.transitions, { fromStatusCode: 'qualified', toStatusCode: 'lost' }],
      },
    });
    await renderPage();
    const select = await screen.findByLabelText(
      en('workflow.mapping.orderStatusFor', { name: 'Qualified' }),
    );
    await userEvent.selectOptions(select, 'paid');
    await userEvent.selectOptions(
      screen.getByLabelText(core('orderStatusConfig.col.from')),
      'qualified',
    );
    await userEvent.selectOptions(screen.getByLabelText(core('orderStatusConfig.col.to')), 'lost');
    await userEvent.click(
      screen.getByRole('button', { name: core('orderStatusConfig.addTransition') }),
    );
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    // Let the answer land before reading the control.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: en('workflow.mapping.save') })).toBeEnabled(),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      screen.getByLabelText(en('workflow.mapping.orderStatusFor', { name: 'Qualified' })),
    ).toHaveValue('paid');
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
    await renderPage();
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
