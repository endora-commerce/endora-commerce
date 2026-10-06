import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LINK_ID,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORDER_STATUS_GRAPH,
  ORGANIZATION_ID,
  PROPAGATION_ID,
  detail,
  en,
  propagation,
  renderCrm,
} from './crm-fixtures';

/**
 * The Opportunity screen (`specs/143-crm-sales-opportunities/`, User Story 1 —
 * tasks T036 and T054; FR-015, FR-020 – FR-023).
 *
 * Its three subjects: the status control offers the transitions the server
 * allows and nothing else; a refused Order change is shown per Order, with its
 * reason, until it is retried or dismissed; and an Order is linked, toggled and
 * unlinked from here.
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
const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const SECOND_ORDER_ID = '00000000-0000-4000-8000-0000000000c2';

let current = detail();

beforeEach(() => {
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = detail();
  getSpy.mockImplementation((path: string) => {
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith('/api/v1/admin/orders?')) {
      return Promise.resolve({
        data: [
          { id: ORDER_ID, businessId: 'ORD-1001', status: 'new', total: 990, currency: 'PLN' },
          { id: SECOND_ORDER_ID, businessId: 'ORD-1002', status: 'new', total: 120, currency: 'PLN' },
        ],
        pagination: { page: 1, pageSize: 20, total: 2 },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(permissions?: readonly string[]): Promise<void> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  // The tab is a lazy component: its sections arrive one tick after the header.
  await screen.findByRole('region', { name: en('links.title') });
}

function transitionButtons(): string[] {
  const group = screen.getByRole('group', { name: en('opportunity.status.moveTo') });
  return within(group)
    .getAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '');
}

describe('OpportunityDetail — the status control', () => {
  it('offers exactly the transitions the server allows', async () => {
    await renderPage();
    expect(transitionButtons()).toEqual(['Qualified', 'Lost']);
  });

  it('says so when the status is a dead end', async () => {
    current = detail({
      status: { code: 'won', name: 'Won', color: '#10b981', kind: 'won' },
      allowedTransitions: [],
      closedKind: 'won',
      closedAt: '2026-10-05T12:00:00.000Z',
    });
    await renderPage();
    expect(screen.queryByRole('group', { name: en('opportunity.status.moveTo') })).toBeNull();
    expect(screen.getByText(en('opportunity.status.none'))).toBeInTheDocument();
  });

  it('offers no transition to an operator who may only read', async () => {
    await renderPage(['crm:read', 'orders:read']);
    expect(screen.queryByRole('group', { name: en('opportunity.status.moveTo') })).toBeNull();
    expect(screen.getByText(en('opportunity.status.noPermission'))).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('moves the opportunity and then offers the transitions of the new status', async () => {
    const moved = detail({
      status: { code: 'qualified', name: 'Qualified', color: '#3b82f6', kind: 'open' },
      allowedTransitions: [{ code: 'negotiation', name: 'Negotiation', color: '#f59e0b', kind: 'open' }],
    });
    postSpy.mockResolvedValue({
      data: {
        opportunity: moved,
        from: 'new',
        to: 'qualified',
        propagation: [propagation({ outcome: 'applied', detail: null, orderStatusCode: 'paid' })],
      },
    });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Qualified' }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/transition`, { to: 'qualified' }),
    );
    await waitFor(() => expect(transitionButtons()).toEqual(['Negotiation']));
    // The applied outcome is reported per Order and needs no action.
    const outcomes = screen.getByRole('region', { name: en('propagation.title') });
    expect(
      within(outcomes).getByText(en('propagation.outcome.applied', { status: 'Paid' })),
    ).toBeInTheDocument();
    expect(within(outcomes).queryByRole('button', { name: en('propagation.retry') })).toBeNull();
  });

  it('shows the guard\'s own sentence when a transition is vetoed, and changes nothing', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'CRM_TRANSITION_VETOED',
          message: 'A signed contract is required before qualifying.',
          details: { reason: 'A signed contract is required before qualifying.' },
        },
      }),
    );
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Qualified' }));
    expect(
      await screen.findByText('A signed contract is required before qualifying.'),
    ).toBeInTheDocument();
    expect(transitionButtons()).toEqual(['Qualified', 'Lost']);
  });
});

describe('OpportunityDetail — what became of the linked orders', () => {
  const refused = propagation();

  async function moveWithRefusal(): Promise<HTMLElement> {
    postSpy.mockResolvedValueOnce({
      data: {
        opportunity: detail({
          status: { code: 'qualified', name: 'Qualified', color: '#3b82f6', kind: 'open' },
          allowedTransitions: [],
          unresolvedPropagations: [refused],
        }),
        from: 'new',
        to: 'qualified',
        propagation: [refused],
      },
    });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Qualified' }));
    const outcomes = await screen.findByRole('region', { name: en('propagation.title') });
    await within(outcomes).findByText(refused.detail as string);
    return outcomes;
  }

  it('shows a refused order with its reason, Retry and Dismiss', async () => {
    const outcomes = await moveWithRefusal();
    expect(
      within(outcomes).getByText(en('propagation.outcome.not_permitted', { status: 'Completed' })),
    ).toBeInTheDocument();
    expect(within(outcomes).getByRole('link', { name: /ORD-1001/ })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}`,
    );
    expect(within(outcomes).getByRole('button', { name: en('propagation.retry') })).toBeInTheDocument();
    expect(
      within(outcomes).getByRole('button', { name: en('propagation.dismiss') }),
    ).toBeInTheDocument();
  });

  it('keeps a refusal visible on a later visit, until it is resolved', async () => {
    current = detail({ unresolvedPropagations: [refused] });
    await renderPage();
    const outcomes = screen.getByRole('region', { name: en('propagation.title') });
    expect(within(outcomes).getByText(refused.detail as string)).toBeInTheDocument();
    expect(within(outcomes).getByRole('button', { name: en('propagation.retry') })).toBeInTheDocument();
  });

  it('retries a refused change and reports the new outcome', async () => {
    const outcomes = await moveWithRefusal();
    postSpy.mockResolvedValueOnce({
      data: propagation({ id: '00000000-0000-4000-8000-0000000000e2', outcome: 'applied', detail: null }),
    });
    current = detail({
      status: { code: 'qualified', name: 'Qualified', color: '#3b82f6', kind: 'open' },
      allowedTransitions: [],
    });
    await userEvent.click(within(outcomes).getByRole('button', { name: en('propagation.retry') }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/propagations/${PROPAGATION_ID}/retry`),
    );
    expect(
      await within(outcomes).findByText(en('propagation.outcome.applied', { status: 'Completed' })),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(outcomes).queryByRole('button', { name: en('propagation.retry') })).toBeNull(),
    );
  });

  it('dismisses a refusal', async () => {
    const outcomes = await moveWithRefusal();
    postSpy.mockResolvedValueOnce(undefined);
    current = detail({
      status: { code: 'qualified', name: 'Qualified', color: '#3b82f6', kind: 'open' },
      allowedTransitions: [],
    });
    await userEvent.click(within(outcomes).getByRole('button', { name: en('propagation.dismiss') }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/propagations/${PROPAGATION_ID}/dismiss`),
    );
    await waitFor(() => expect(within(outcomes).queryByText(refused.detail as string)).toBeNull());
  });
});

describe('OpportunityDetail — linked orders', () => {
  function orderSearches(): string[] {
    return getSpy.mock.calls
      .map(([path]) => path as string)
      .filter((path) => path.startsWith('/api/v1/admin/orders?'));
  }

  function linksRegion(): HTMLElement {
    return screen.getByRole('region', { name: en('links.title') });
  }

  it('lists a linked order with its number, status and total', async () => {
    await renderPage();
    const region = linksRegion();
    expect(within(region).getByRole('link', { name: 'ORD-1001' })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}`,
    );
    // The Order's status is shown by its name, not by its code — once the
    // Orders module's statuses have been read, which is a request of its own.
    expect(await within(region).findByText('New')).toBeInTheDocument();
    expect(within(region).getByText(/990,00/)).toBeInTheDocument();
  });

  it('links an order of the same organization, found by search', async () => {
    current = detail({ links: [] });
    postSpy.mockResolvedValue({ data: detail().links[0] });
    await renderPage();
    const region = linksRegion();
    expect(within(region).getByText(en('links.empty'))).toBeInTheDocument();

    await userEvent.type(within(region).getByLabelText(en('links.add.label')), '1002');
    // The search is the server's, and it is scoped to the Opportunity's Organization.
    await waitFor(() => expect(orderSearches().some((path) => path.includes('q=1002'))).toBe(true));
    for (const path of orderSearches()) expect(path).toContain(`organizationId=${ORGANIZATION_ID}`);
    await userEvent.click(await screen.findByRole('option', { name: /ORD-1002/ }));
    await userEvent.click(within(region).getByRole('button', { name: en('links.add.submit') }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/links`, {
        documentKind: 'order',
        documentId: SECOND_ORDER_ID,
      }),
    );
  });

  it('shows the refusal when the order already belongs to another opportunity', async () => {
    const refusal =
      'This document is already linked to an opportunity. A document can belong to one opportunity only.';
    current = detail({ links: [] });
    postSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'CRM_DOCUMENT_ALREADY_LINKED', message: refusal } }),
    );
    await renderPage();
    const region = linksRegion();
    await userEvent.type(within(region).getByLabelText(en('links.add.label')), '1002');
    await userEvent.click(await screen.findByRole('option', { name: /ORD-1002/ }));
    await userEvent.click(within(region).getByRole('button', { name: en('links.add.submit') }));
    expect(await within(region).findByText(refusal)).toBeInTheDocument();
  });

  it('switches status following off for one order', async () => {
    patchSpy.mockResolvedValue({ data: { ...detail().links[0], syncStatus: false } });
    await renderPage();
    const toggle = within(linksRegion()).getByRole('checkbox', {
      name: en('links.following.label', { number: 'ORD-1001' }),
    });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/links/${LINK_ID}`, { syncStatus: false }),
    );
  });

  it('unlinks an order', async () => {
    deleteSpy.mockResolvedValue(undefined);
    await renderPage();
    await userEvent.click(
      within(linksRegion()).getByRole('button', {
        name: en('links.unlink.label', { number: 'ORD-1001' }),
      }),
    );
    await waitFor(() =>
      expect(deleteSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/links/${LINK_ID}`),
    );
  });

  it('offers no link controls to an operator who may only read', async () => {
    await renderPage(['crm:read', 'orders:read']);
    const region = linksRegion();
    expect(within(region).queryByLabelText(en('links.add.label'))).toBeNull();
    expect(
      within(region).queryByRole('button', { name: en('links.unlink.label', { number: 'ORD-1001' }) }),
    ).toBeNull();
  });
});

describe('OpportunityDetail — loading and failure', () => {
  it('shows the server\'s sentence for an opportunity that is not available', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === DETAIL_PATH) {
        return Promise.reject(
          new ApiError(404, {
            error: {
              code: 'CRM_OPPORTUNITY_NOT_FOUND',
              message: 'This opportunity does not exist or is not available to you.',
            },
          }),
        );
      }
      return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    });
    renderCrm(<OpportunityDetail />, {
      path: `/crm/opportunities/${OPPORTUNITY_ID}`,
      pattern: '/crm/opportunities/:id',
    });
    expect(
      await screen.findByText('This opportunity does not exist or is not available to you.'),
    ).toBeInTheDocument();
  });
});
