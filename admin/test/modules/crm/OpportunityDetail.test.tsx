import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {
  LINK_ID,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORDER_STATUS_GRAPH,
  ORGANIZATION_ID,
  PROPAGATION_ID,
  WORKFLOW,
  detail,
  en,
  propagation,
  renderCrm,
  core,
  crmLookupResponse,
} from './crm-fixtures';

/**
 * The Opportunity screen (`specs/143-crm-sales-opportunities/`, User Story 1 —
 * tasks T036 and T054; FR-015, FR-020 – FR-023 — and User Story 20, tasks
 * T300 – T306; FR-110 – FR-121).
 *
 * Its first three subjects are User Story 1's: the status control offers the
 * transitions the server allows and nothing else; a refused Order change is
 * shown per Order, with its reason, until it is retried or dismissed; and an
 * Order is linked, toggled and unlinked from here. User Story 20 moved where
 * each of them is on the screen — the control became the stage bar, the linked
 * documents a tab of their own — and added the rest: the bar's picture of the
 * workflow, the tabs and their address, the header and the sidebar.
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
const WORKFLOW_PATH = '/api/v1/admin/crm/workflow';
const SECOND_ORDER_ID = '00000000-0000-4000-8000-0000000000c2';

let current = detail();

/** What every case's server answers, unless `first` answers the path itself. */
function answerWith(first: (path: string) => Promise<unknown> | undefined = () => undefined) {
  return (path: string): Promise<unknown> => {
    const own = first(path);
    if (own) return own;
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === WORKFLOW_PATH) return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    return crmLookupResponse(path) ?? Promise.reject(new Error(`unexpected GET ${path}`));
  };
}

beforeEach(() => {
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = detail();
  getSpy.mockImplementation((path: string) => {
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === WORKFLOW_PATH) return Promise.resolve({ data: WORKFLOW });
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

/** The address the screen is on, so a case can read what a tab press wrote to it. */
function AddressProbe(): ReactElement {
  const location = useLocation();
  return <output data-testid="address">{`${location.pathname}${location.search}`}</output>;
}

const address = (): string => screen.getByTestId('address').textContent ?? '';

async function renderPage(
  permissions?: readonly string[],
  options: { search?: string; alsoPresent?: readonly string[] } = {},
): Promise<void> {
  renderCrm(
    <>
      <OpportunityDetail />
      <AddressProbe />
    </>,
    {
      path: `/crm/opportunities/${OPPORTUNITY_ID}${options.search ?? ''}`,
      pattern: '/crm/opportunities/:id',
      ...(permissions ? { permissions } : {}),
      ...(options.alsoPresent ? { alsoPresent: options.alsoPresent } : {}),
    },
  );
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  // A tab is a lazy component: its panel arrives one tick after the header.
  const panel = await screen.findByRole('tabpanel');
  await waitFor(() => expect(within(panel).queryByText(core('common.state.loading'))).toBeNull());
  // …and so does the workflow's order, which sorts the bar's moves into back and forward.
  await waitFor(() => expect(stageBar()).not.toHaveAttribute('aria-busy', 'true'));
}

/** The linked documents have a tab of their own (User Story 20): open the screen on it. */
async function renderLinks(permissions?: readonly string[]): Promise<void> {
  await renderPage(permissions, { search: '?tab=links' });
  await screen.findByRole('region', { name: en('links.title') });
}

function stageBar(): HTMLElement {
  return screen.getByRole('region', { name: en('opportunity.section.status') });
}

/** The statuses the bar lets the operator move to — its only buttons — by what they show. */
function transitionButtons(): string[] {
  return within(stageBar())
    .queryAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '');
}

/** The name of the bar's button for a later open status: what pressing it does. */
const moveTo = (status: string): string => en('opportunity.stage.moveForward', { status });

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
    expect(transitionButtons()).toEqual([]);
    expect(screen.getByText(en('opportunity.status.none'))).toBeInTheDocument();
  });

  it('offers no transition to an operator who may only read', async () => {
    await renderPage(['crm:read', 'orders:read']);
    expect(transitionButtons()).toEqual([]);
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
    await userEvent.click(screen.getByRole('button', { name: moveTo('Qualified') }));

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
    await userEvent.click(screen.getByRole('button', { name: moveTo('Qualified') }));
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
    await userEvent.click(screen.getByRole('button', { name: moveTo('Qualified') }));
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
    await renderLinks();
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
    await renderLinks();
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
    await renderLinks();
    const region = linksRegion();
    await userEvent.type(within(region).getByLabelText(en('links.add.label')), '1002');
    await userEvent.click(await screen.findByRole('option', { name: /ORD-1002/ }));
    await userEvent.click(within(region).getByRole('button', { name: en('links.add.submit') }));
    expect(await within(region).findByText(refusal)).toBeInTheDocument();
  });

  it('switches status following off for one order', async () => {
    patchSpy.mockResolvedValue({ data: { ...detail().links[0], syncStatus: false } });
    await renderLinks();
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
    await renderLinks();
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
    await renderLinks(['crm:read', 'orders:read']);
    const region = linksRegion();
    expect(within(region).queryByLabelText(en('links.add.label'))).toBeNull();
    expect(
      within(region).queryByRole('button', { name: en('links.unlink.label', { number: 'ORD-1001' }) }),
    ).toBeNull();
  });
});

describe('OpportunityDetail — the stage bar (User Story 20)', () => {
  const NEW = { code: 'new', name: 'New', color: '#64748b', kind: 'open' } as const;
  const QUALIFIED = { code: 'qualified', name: 'Qualified', color: '#3b82f6', kind: 'open' } as const;
  const NEGOTIATION = { code: 'negotiation', name: 'Negotiation', color: '#f59e0b', kind: 'open' } as const;
  const WON = { code: 'won', name: 'Won', color: '#10b981', kind: 'won' } as const;
  const LOST = { code: 'lost', name: 'Lost', color: '#ef4444', kind: 'lost' } as const;

  const WON_SPOKEN = `Won (${en('opportunity.stage.kind.won')})`;
  const LOST_SPOKEN = `Lost (${en('opportunity.stage.kind.lost')})`;
  const toLost = en('opportunity.stage.moveToClosing', {
    status: 'Lost',
    outcome: en('opportunity.stage.kind.lost'),
  });

  /** The statuses listed on one side of the bar, as they read; `null` when the side is not drawn. */
  function side(key: 'back' | 'forward' | 'other'): string[] | null {
    const group = within(stageBar()).queryByRole('group', { name: en(`opportunity.stage.${key}`) });
    return group
      ? within(group)
          .getAllByRole('listitem')
          .map((item) => item.textContent ?? '')
      : null;
  }

  /** What the bar says the current status is. */
  function currentStatus(): string {
    const label = within(stageBar()).getByText(en('opportunity.stage.current'));
    return label.nextElementSibling?.textContent ?? '';
  }

  /** Every status named anywhere in the bar. */
  function everyStatusShown(): string {
    return stageBar().textContent ?? '';
  }

  it('names the current status and offers both ways out of it, each on its side', async () => {
    current = detail({ status: QUALIFIED, allowedTransitions: [NEW, NEGOTIATION, LOST] });
    await renderPage();
    const bar = stageBar();
    expect(within(bar).getByText(en('opportunity.stage.current'))).toBeInTheDocument();
    expect(currentStatus()).toBe('Qualified');
    expect(side('back')).toEqual(['New']);
    expect(side('forward')).toEqual(['Negotiation', 'Lost']);
    expect(side('other')).toBeNull();
    // A status the workflow has and does not allow from here is not on screen at all.
    expect(everyStatusShown()).not.toContain('Won');
    // The bar draws no line, so it counts no stage.
    expect(everyStatusShown()).not.toMatch(/\d+ of \d+/);
  });

  it('names each button by what pressing it does, its visible label included', async () => {
    current = detail({ status: QUALIFIED, allowedTransitions: [NEW, NEGOTIATION, LOST] });
    await renderPage();
    const buttons = within(stageBar()).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      en('opportunity.stage.moveBack', { status: 'New' }),
      en('opportunity.stage.moveForward', { status: 'Negotiation' }),
      toLost,
    ]);
    // WCAG 2.5.3: what is read on the button is part of what it is called.
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toContain(button.textContent?.trim());
    }
  });

  it('draws only the forward side where the workflow leads nowhere back', async () => {
    await renderPage();
    expect(side('back')).toBeNull();
    expect(side('forward')).toEqual(['Qualified', 'Lost']);
    expect(transitionButtons()).toEqual(['Qualified', 'Lost']);
  });

  it('draws only the back side where the workflow only returns', async () => {
    current = detail({ status: NEGOTIATION, allowedTransitions: [NEW, QUALIFIED] });
    await renderPage();
    expect(side('back')).toEqual(['New', 'Qualified']);
    expect(side('forward')).toBeNull();
  });

  it('draws no side for a closed opportunity the workflow lets nowhere, and says how and when it closed', async () => {
    current = detail({
      status: WON,
      allowedTransitions: [],
      closedKind: 'won',
      closedAt: '2026-10-05T12:00:00.000Z',
    });
    await renderPage();
    const bar = stageBar();
    expect(currentStatus()).toBe(WON_SPOKEN);
    expect(within(bar).getByText(/^Closed as won on /)).toBeInTheDocument();
    expect(within(bar).queryAllByRole('group')).toEqual([]);
    expect(within(bar).getByText(en('opportunity.status.none'))).toBeInTheDocument();
    // Nothing to sort, so the workflow's order is not asked for.
    expect(getSpy.mock.calls.map(([path]) => path)).not.toContain(WORKFLOW_PATH);
  });

  it('offers reopening a closed opportunity as a move back', async () => {
    current = detail({
      status: LOST,
      allowedTransitions: [NEGOTIATION, WON],
      closedKind: 'lost',
      closedAt: '2026-10-05T12:00:00.000Z',
    });
    await renderPage();
    expect(currentStatus()).toBe(LOST_SPOKEN);
    expect(side('back')).toEqual(['Negotiation']);
    expect(side('forward')).toEqual(['Won']);
  });

  it('shows a reader the same moves as text, with no button among them', async () => {
    current = detail({ status: QUALIFIED, allowedTransitions: [NEW, NEGOTIATION, LOST] });
    await renderPage(['crm:read', 'orders:read']);
    expect(side('back')).toEqual(['New']);
    // A closing status is still told apart in words, with no button to carry the name.
    expect(side('forward')).toEqual(['Negotiation', LOST_SPOKEN]);
    expect(within(stageBar()).queryAllByRole('button')).toEqual([]);
    expect(screen.queryByLabelText(en('opportunity.status.reason'))).toBeNull();
    expect(screen.queryByText(en('opportunity.stage.hint'))).toBeNull();
    expect(screen.getByText(en('opportunity.status.noPermission'))).toBeInTheDocument();
  });

  it('moves by keyboard alone, through the one transition endpoint, with the reason typed under it', async () => {
    postSpy.mockResolvedValue({
      data: {
        opportunity: detail({ status: LOST, allowedTransitions: [] }),
        from: 'new',
        to: 'lost',
        propagation: [],
      },
    });
    await renderPage();
    // The reason is still asked for where a move is possible, and still goes with it.
    await userEvent.type(screen.getByLabelText(en('opportunity.status.reason')), 'Budget cut.');
    const lost = within(stageBar()).getByRole('button', { name: toLost });
    lost.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/transition`, {
        to: 'lost',
        reason: 'Budget cut.',
      }),
    );
    expect(postSpy).toHaveBeenCalledTimes(1);
    // Announced, and the bar now shows where the opportunity is.
    expect(await screen.findByText(en('opportunity.status.moved', { status: 'Lost' }))).toBeInTheDocument();
    await waitFor(() => expect(transitionButtons()).toEqual([]));
    expect(currentStatus()).toBe(LOST_SPOKEN);
  });

  it('still offers every allowed move when the workflow`s order cannot be read, without guessing a direction', async () => {
    current = detail({ status: QUALIFIED, allowedTransitions: [NEW, NEGOTIATION, LOST] });
    getSpy.mockImplementation(
      answerWith((path) =>
        path === WORKFLOW_PATH ? Promise.reject(new Error('offline')) : undefined,
      ),
    );
    await renderPage();
    // Closing is forward by what it is; the two open statuses could be either.
    expect(side('forward')).toEqual(['Lost']);
    expect(side('other')).toEqual(['New', 'Negotiation']);
    expect(side('back')).toBeNull();
    expect(transitionButtons().sort()).toEqual(['Lost', 'Negotiation', 'New']);
    expect(
      within(stageBar()).getByRole('button', { name: en('opportunity.stage.moveTo', { status: 'New' }) }),
    ).toBeInTheDocument();
    expect(screen.getByText(en('opportunity.stage.partial'))).toBeInTheDocument();
  });

  it('says nothing about an unread order when every move has a direction of its own', async () => {
    current = detail({ status: NEW, allowedTransitions: [LOST] });
    getSpy.mockImplementation(
      answerWith((path) =>
        path === WORKFLOW_PATH ? Promise.reject(new Error('offline')) : undefined,
      ),
    );
    await renderPage();
    expect(side('forward')).toEqual(['Lost']);
    expect(screen.queryByText(en('opportunity.stage.partial'))).toBeNull();
  });
});

describe('OpportunityDetail — tabs and their address (User Story 20)', () => {
  function tabs(): HTMLElement[] {
    return within(screen.getByRole('tablist', { name: en('opportunity.tabs.label') })).getAllByRole('tab');
  }

  function selectedTab(): string {
    return tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent ?? '';
  }

  it('offers the tabs in the decided order and opens on the Overview', async () => {
    await renderPage();
    expect(tabs().map((tab) => tab.textContent)).toEqual([
      en('opportunity.tabs.overview'),
      `${en('opportunity.tabs.links')} 1`,
      // User Story 21 (FR-133): Events stands third. Nothing is planned on this
      // Opportunity, so its label carries no number.
      en('opportunity.tabs.events'),
      en('opportunity.tabs.notes'),
      en('opportunity.tabs.messages'),
      en('opportunity.tabs.attachments'),
      en('opportunity.tabs.history'),
    ]);
    expect(selectedTab()).toBe(en('opportunity.tabs.overview'));
    expect(screen.getByRole('tabpanel', { name: en('opportunity.tabs.overview') })).toBeInTheDocument();
  });

  it('keeps the linked documents on the Links tab and nowhere else', async () => {
    await renderPage();
    expect(screen.queryByRole('region', { name: en('links.title') })).toBeNull();
    expect(screen.queryByRole('link', { name: 'ORD-1001' })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /^Links/ }));
    const panel = await screen.findByRole('tabpanel', { name: /^Links/ });
    const orders = await within(panel).findByRole('region', { name: en('links.title') });
    expect(within(orders).getByRole('link', { name: 'ORD-1001' })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}`,
    );
    // The Quote Requests module is off here and nothing of it is linked: no section.
    expect(within(panel).queryByRole('heading', { name: en('links.quote.title') })).toBeNull();
  });

  it('shows the Quote Requests section beside the Orders on that tab when the module is present', async () => {
    getSpy.mockImplementation(
      answerWith((path) =>
        path.startsWith('/api/v1/admin/crm/lookups/quote-requests')
          ? Promise.resolve({ data: [] })
          : undefined,
      ),
    );
    await renderPage(undefined, { search: '?tab=links', alsoPresent: ['quote_requests'] });
    const panel = screen.getByRole('tabpanel', { name: /^Links/ });
    expect(await within(panel).findByRole('region', { name: en('links.title') })).toBeInTheDocument();
    expect(
      await within(panel).findByRole('region', { name: en('links.quote.title') }),
    ).toBeInTheDocument();
  });

  it('counts the linked documents on the tab, and shows no number when there is none', async () => {
    current = detail({
      links: [
        ...detail().links,
        {
          id: '00000000-0000-4000-8000-0000000000d2',
          documentKind: 'quote_request',
          documentId: '00000000-0000-4000-8000-0000000000c9',
          available: false,
          syncStatus: false,
          linkSource: 'manual',
          createdAt: '2026-10-05T10:06:00.000Z',
        },
      ],
    });
    await renderPage();
    // Part of the tab's accessible name: what the number is of.
    const links = screen.getByRole('tab', { name: 'Links, items: 2' });
    expect(links).toHaveTextContent(/^Links 2$/);
  });

  it('shows a number beside five labels — items on Links, Notes and Attachments, Events ahead, Messages unread — each from the Opportunity it has read, no tab opened', async () => {
    current = detail({ upcomingEventCount: 2, noteCount: 3, unreadMessageCount: 4, attachmentCount: 12 });
    await renderPage();
    const shown = tabs().map((tab) => [tab.textContent, tab.getAttribute('aria-label')]);
    expect(shown).toEqual([
      ['Overview', null],
      ['Links 1', 'Links, items: 1'],
      ['Events 2', 'Events, upcoming: 2'],
      ['Notes 3', 'Notes, items: 3'],
      ['Messages 4', 'Messages, unread: 4'],
      ['Attachments 12', 'Attachments, items: 12'],
      ['Change history', null],
    ]);
    // A number is read aloud with what it counts, and the name still starts with the words on screen.
    expect(screen.getByRole('tab', { name: 'Notes, items: 3' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Messages, unread: 4' })).toBeInTheDocument();
    // No list was asked for and nothing was marked read: the numbers came with the Opportunity.
    const asked = getSpy.mock.calls.map(([path]) => String(path));
    expect(asked.filter((path) => /\/(comments|attachments|events|messages)/.test(path))).toEqual([]);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('shows no number, and no zero, on a tab with nothing behind it', async () => {
    current = detail({ links: [], upcomingEventCount: 0, noteCount: 0, attachmentCount: 0, unreadMessageCount: 0 });
    await renderPage();
    expect(tabs().map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Links',
      'Events',
      'Notes',
      'Messages',
      'Attachments',
      'Change history',
    ]);
    for (const tab of tabs()) expect(tab).not.toHaveAttribute('aria-label');
  });

  it('shows the Links tab without a number for an opportunity with no links', async () => {
    current = detail({ links: [] });
    await renderPage();
    expect(screen.getByRole('tab', { name: en('opportunity.tabs.links') })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: en('opportunity.tabs.links') }));
    expect(await screen.findByText(en('links.empty'))).toBeInTheDocument();
  });

  it('opens the tab its address names, so a reload and a saved link land where they left', async () => {
    await renderPage(undefined, { search: '?tab=links' });
    expect(selectedTab()).toMatch(/^Links/);
    expect(await screen.findByRole('region', { name: en('links.title') })).toBeInTheDocument();
  });

  it('writes the chosen tab to the address, and leaves the default tab as the bare one', async () => {
    await renderPage();
    expect(address()).toBe(`/crm/opportunities/${OPPORTUNITY_ID}`);
    await userEvent.click(screen.getByRole('tab', { name: /^Links/ }));
    await waitFor(() => expect(address()).toBe(`/crm/opportunities/${OPPORTUNITY_ID}?tab=links`));
    await userEvent.click(screen.getByRole('tab', { name: en('opportunity.tabs.overview') }));
    await waitFor(() => expect(address()).toBe(`/crm/opportunities/${OPPORTUNITY_ID}`));
  });

  it('opens the Overview for an address naming a tab that does not exist', async () => {
    await renderPage(undefined, { search: '?tab=calendar' });
    expect(selectedTab()).toBe(en('opportunity.tabs.overview'));
  });

  it('lands a return from creating a document on the Links tab — the address the create screens were handed', async () => {
    await renderPage(undefined, { search: '?created=order' });
    expect(selectedTab()).toMatch(/^Links/);
    expect(await screen.findByRole('region', { name: en('links.title') })).toBeInTheDocument();
  });

  it('is one stop for the keyboard, walked with the arrow keys', async () => {
    await renderPage();
    expect(tabs().filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    const overview = screen.getByRole('tab', { name: en('opportunity.tabs.overview') });
    overview.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(selectedTab()).toMatch(/^Links/));
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Links/ }));
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(selectedTab()).toBe(en('opportunity.tabs.history')));
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(selectedTab()).toBe(en('opportunity.tabs.overview')));
  });

  it('gives the history tab a heading its entries hang from', async () => {
    getSpy.mockImplementation(
      answerWith((path) =>
        path.startsWith(`${DETAIL_PATH}/history`)
          ? Promise.resolve({ data: [], pagination: { nextCursor: null }, truncated: false })
          : undefined,
      ),
    );
    await renderPage(undefined, { search: '?tab=history' });
    const panel = screen.getByRole('tabpanel', { name: en('opportunity.tabs.history') });
    expect(
      await within(panel).findByRole('heading', { level: 2, name: en('opportunity.tabs.history') }),
    ).toBeInTheDocument();
  });
});

describe('OpportunityDetail — the header and the sidebar (User Story 20)', () => {
  const FULL = {
    assignee: { id: '00000000-0000-4000-8000-0000000000aa', name: 'Anna Nowak', active: true },
    customerAccount: {
      id: '00000000-0000-4000-8000-0000000000f1',
      name: 'Jan Kowalski',
      email: 'jan@acme.example',
    },
    tags: [
      { id: '00000000-0000-4000-8000-000000000071', name: 'Tender', color: '#3b82f6' },
      { id: '00000000-0000-4000-8000-000000000072', name: 'Key account', color: '#10b981' },
    ],
  };

  function sidebar(): HTMLElement {
    return screen.getByRole('complementary', { name: en('opportunity.section.details') });
  }

  function group(key: string): HTMLElement {
    return within(sidebar()).getByRole('region', { name: en(key) });
  }

  /** The value shown under a fact's label. */
  function fact(container: HTMLElement, labelKey: string): HTMLElement {
    const term = within(container).getByText(en(labelKey), { selector: 'dt' });
    return term.nextElementSibling as HTMLElement;
  }

  it('says in one quiet line under the title what it is, who it is for and who holds it', async () => {
    current = detail(FULL);
    await renderPage();
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    expect(within(header).getByText('OPP-000001')).toBeInTheDocument();
    expect(within(header).getByText('Acme')).toBeInTheDocument();
    expect(within(header).getByText('Anna Nowak')).toBeInTheDocument();
  });

  it('says in that line that nobody holds an unassigned opportunity', async () => {
    await renderPage();
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    expect(within(header).getByText(en('assignment.unassigned'))).toBeInTheDocument();
  });

  it('groups the facts under four headings, in the order they are asked for', async () => {
    current = detail(FULL);
    await renderPage();
    expect(
      within(sidebar())
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      en('opportunity.facts.valueAndDeadline'),
      en('opportunity.facts.customer'),
      en('opportunity.facts.classification'),
      en('opportunity.facts.record'),
    ]);
  });

  it('puts each fact in its group', async () => {
    current = detail(FULL);
    await renderPage();

    const value = group('opportunity.facts.valueAndDeadline');
    const figure = within(value).getByRole('group', { name: en('value.title') });
    expect(figure).toHaveTextContent(/12[\s ]500,00/);
    expect(within(figure).getByText(en('value.mode.manual'))).toBeInTheDocument();
    expect(fact(value, 'opportunity.field.expectedCloseDate')).not.toHaveTextContent(
      en('opportunity.facts.notSet'),
    );

    const customer = group('opportunity.facts.customer');
    expect(within(fact(customer, 'opportunity.field.organization')).getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      `/organizations/${ORGANIZATION_ID}`,
    );
    expect(fact(customer, 'opportunity.field.contact')).toHaveTextContent('Jan Kowalski');
    expect(fact(customer, 'opportunity.field.contact')).toHaveTextContent('jan@acme.example');
    expect(within(customer).getByRole('group', { name: en('assignment.label') })).toHaveTextContent(
      'Anna Nowak',
    );

    const classification = group('opportunity.facts.classification');
    expect(fact(classification, 'opportunity.field.source')).toHaveTextContent(
      en('opportunity.source.manual'),
    );
    const tags = within(classification).getByRole('group', { name: en('tags.section') });
    expect(within(tags).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Tender',
      'Key account',
    ]);

    const record = group('opportunity.facts.record');
    expect(fact(record, 'opportunity.field.number')).toHaveTextContent('OPP-000001');
    expect(within(record).getByText(en('opportunity.field.created'))).toBeInTheDocument();
    expect(within(record).getByText(en('opportunity.field.updated'))).toBeInTheDocument();
    // Open: there is no closing date to show, and no empty row for one.
    expect(within(record).queryByText(en('opportunity.field.closed'))).toBeNull();
  });

  it('shows an empty fact as empty, and says so, instead of leaving it out', async () => {
    current = detail({ expectedCloseDate: null });
    await renderPage();
    for (const [groupKey, labelKey] of [
      ['opportunity.facts.valueAndDeadline', 'opportunity.field.expectedCloseDate'],
      ['opportunity.facts.customer', 'opportunity.field.contact'],
      ['opportunity.facts.classification', 'opportunity.field.salesChannel'],
    ] as const) {
      expect(fact(group(groupKey), labelKey)).toHaveTextContent(
        `—${en('opportunity.facts.notSet')}`,
      );
    }
  });

  it('adds the closing date to the record of a closed opportunity', async () => {
    current = detail({
      status: { code: 'lost', name: 'Lost', color: '#ef4444', kind: 'lost' },
      allowedTransitions: [],
      closedKind: 'lost',
      closedAt: '2026-10-05T12:00:00.000Z',
    });
    await renderPage();
    expect(
      within(group('opportunity.facts.record')).getByText(en('opportunity.field.closed')),
    ).toBeInTheDocument();
  });

  it('is one card, placed after the stage bar and before the tabs — where a narrow screen stacks it', async () => {
    current = detail({ unresolvedPropagations: [propagation()] });
    await renderPage();
    const order = (earlier: HTMLElement, later: HTMLElement): boolean =>
      Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
    const outcomes = screen.getByRole('region', { name: en('propagation.title') });
    const tablist = screen.getByRole('tablist', { name: en('opportunity.tabs.label') });
    expect(order(stageBar(), outcomes)).toBe(true);
    expect(order(outcomes, sidebar())).toBe(true);
    expect(order(sidebar(), tablist)).toBe(true);
    // One bordered card holds all four groups; the stage bar and the tabs are not inside it.
    const card = sidebar().firstElementChild as HTMLElement;
    expect(sidebar().children).toHaveLength(1);
    expect(card.className).toContain('bg-card');
    expect(within(card).getAllByRole('heading', { level: 2 })).toHaveLength(4);
    expect(sidebar().contains(stageBar())).toBe(false);
    expect(sidebar().contains(tablist)).toBe(false);
  });

  it('stays beside whichever tab is open', async () => {
    await renderPage(undefined, { search: '?tab=links' });
    expect(group('opportunity.facts.valueAndDeadline')).toBeInTheDocument();
  });

  it('lets a reader read every fact and change none', async () => {
    current = detail(FULL);
    await renderPage(['crm:read', 'orders:read']);
    expect(within(sidebar()).queryAllByRole('button')).toEqual([]);
    expect(within(sidebar()).queryAllByRole('combobox')).toEqual([]);
    expect(group('opportunity.facts.customer')).toHaveTextContent('Anna Nowak');
    expect(screen.queryByRole('button', { name: en('opportunity.edit.open') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('opportunity.delete.open') })).toBeNull();
  });

  it('opens the edit form on the Overview from any tab, with the keyboard in its first field', async () => {
    await renderPage(undefined, { search: '?tab=links' });
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.edit.open') }));
    const form = await screen.findByRole('form', { name: en('opportunity.edit.title') });
    expect(screen.getByRole('tab', { name: en('opportunity.tabs.overview') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(within(form).getByLabelText(/^Title/)),
    );
    // One way in at a time: the button is back once the form is closed.
    expect(screen.queryByRole('button', { name: en('opportunity.edit.open') })).toBeNull();
    await userEvent.click(within(form).getByRole('button', { name: core('common.action.cancel') }));
    expect(await screen.findByRole('button', { name: en('opportunity.edit.open') })).toBeInTheDocument();
  });

  it('keeps one h1, and no heading that skips a level', async () => {
    current = detail(FULL);
    await renderPage();
    const levels = screen
      .getAllByRole('heading')
      .map((heading) => Number(heading.tagName.slice(1)));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    levels.reduce((previous, level) => {
      expect(level - previous).toBeLessThanOrEqual(1);
      return level;
    }, 0);
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
