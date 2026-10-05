import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

/** The row of the statuses table that carries `code`. */
function statusRow(code: string): HTMLElement {
  const table = screen.getByRole('table', { name: en('workflow.statuses.title') });
  const cell = within(table).getByText(code, { selector: 'td' });
  return cell.closest('tr') as HTMLElement;
}

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

  it('refuses a malformed code before it reaches the server', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('workflow.status.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.code')), 'In Delivery');
    await userEvent.type(within(dialog).getByLabelText(en('workflow.field.defaultName')), 'In delivery');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));

    expect(await within(dialog).findByText(en('workflow.error.code'))).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
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
