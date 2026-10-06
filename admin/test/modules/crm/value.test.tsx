import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityDetail as OpportunityDetailData } from '@endora-commerce/contracts';
import {
  OPPORTUNITY_ID,
  ORDER_ID,
  ORDER_STATUS_GRAPH,
  ORGANIZATION_ID,
  WORKFLOW,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
} from './crm-fixtures';

/**
 * The value of an Opportunity and its Quote Requests on the screens
 * (`specs/143-crm-sales-opportunities/`, User Story 8 — task T101;
 * FR-021, FR-030 – FR-033): the mode and the computed figure, the documents
 * left out with their reason, linking a Quote Request through CRM's own
 * lookup, the counting-status configuration and what it says about its 202,
 * and what is left when the Quote Requests module is off.
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
const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);
const { WorkflowConfigPage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/WorkflowConfigPage'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const QUOTE_LOOKUP = '/api/v1/admin/crm/lookups/quote-requests';
const QUOTE_ID = '00000000-0000-4000-8000-0000000000q1'.replace('q', 'a');
const QUOTE_LINK_ID = '00000000-0000-4000-8000-0000000000d2';
const FOREIGN_ORDER_ID = '00000000-0000-4000-8000-0000000000c2';

const quoteLink = (overrides: Partial<OpportunityDetailData['links'][number]> = {}) => ({
  id: QUOTE_LINK_ID,
  documentKind: 'quote_request' as const,
  documentId: QUOTE_ID,
  available: true,
  number: 'RFQ-0007',
  status: 'Approved',
  total: '84.00',
  currency: 'PLN',
  syncStatus: true,
  linkSource: 'manual' as const,
  createdAt: '2026-10-05T10:06:00.000Z',
  ...overrides,
});

const moduleDisabled = (): InstanceType<typeof ApiError> =>
  new ApiError(503, {
    error: {
      code: 'MODULE_DISABLED',
      message: 'Module Disabled.',
      details: { module: 'quote_requests' },
    },
  } as never);

let current: OpportunityDetailData;
let quoteLookup: () => Promise<unknown>;

beforeEach(() => {
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = detail();
  quoteLookup = () =>
    Promise.resolve({ data: [{ id: QUOTE_ID, number: 'RFQ-0007', status: 'Pending' }] });
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith('/api/v1/admin/orders?')) return Promise.resolve({ data: [] });
    if (path.startsWith(`${QUOTE_LOOKUP}?`)) return quoteLookup();
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function openOpportunity(
  options: { permissions?: readonly string[]; quotes?: boolean } = {},
): Promise<void> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    ...(options.permissions ? { permissions: options.permissions } : {}),
    ...(options.quotes === false ? {} : { alsoPresent: ['quote_requests'] }),
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
}

/** The Overview is a lazy chunk: a section is waited for, not assumed. */
const section = async (title: string): Promise<HTMLElement> =>
  (await screen.findByRole('heading', { level: 2, name: title })).closest('section') as HTMLElement;

describe('the value of an Opportunity', () => {
  it('shows a typed-in value as such, and switches to a computed one in one press', async () => {
    patchSpy.mockImplementation(() => {
      current = detail({ valueMode: 'computed', computedValue: '990.00', value: '990.00', version: 2 });
      return Promise.resolve({ data: current });
    });
    await openOpportunity();
    const value = await section(en('value.title'));
    expect(within(value).getByText(en('value.mode.manual'))).toBeInTheDocument();

    await userEvent.click(within(value).getByRole('button', { name: en('value.switch.toComputed') }));

    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(
        DETAIL_PATH,
        { valueMode: 'computed' },
        { headers: { 'If-Match': '"1"' } },
      ),
    );
    expect(await within(value).findByText(en('value.mode.computed'))).toBeInTheDocument();
    // The typed estimate is kept, and said to be.
    expect(within(value).getByText(/is kept and returns/)).toBeInTheDocument();
    expect(within(value).getByRole('button', { name: en('value.switch.toManual') })).toBeInTheDocument();
  });

  it('names every document left out of a computed value, with the reason', async () => {
    current = detail({
      valueMode: 'computed',
      computedValue: '990.00',
      excludedDocuments: [
        { kind: 'order', id: ORDER_ID, reason: 'currency_mismatch' },
        { kind: 'order', id: FOREIGN_ORDER_ID, reason: 'something_new' },
      ],
    });
    await openOpportunity();
    const value = await section(en('value.title'));
    const items = within(value).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // The linked Order is named by its number and links to its own screen.
    expect(within(items[0] as HTMLElement).getByRole('link', { name: 'ORD-1001' })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}`,
    );
    expect(items[0]).toHaveTextContent(en('value.excluded.reason.currency_mismatch', { currency: 'PLN' }));
    // A reason this screen has no sentence for is still said, never shown as a code.
    expect(items[1]).toHaveTextContent(en('value.excluded.reason.other'));
    expect(items[1]).not.toHaveTextContent('something_new');
  });

  it('offers no switch to a reader', async () => {
    await openOpportunity({ permissions: ['crm:read', 'orders:read'] });
    const value = await section(en('value.title'));
    expect(within(value).queryByRole('button', { name: en('value.switch.toComputed') })).toBeNull();
  });

  it('says so when somebody changed the Opportunity meanwhile, instead of switching blind', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'Stale.' } }),
    );
    await openOpportunity();
    const value = await section(en('value.title'));
    await userEvent.click(within(value).getByRole('button', { name: en('value.switch.toComputed') }));
    expect(await within(value).findByText(en('value.error.conflict'))).toBeInTheDocument();
    // Read again: once on arrival, once after the refusal.
    expect(getSpy.mock.calls.filter(([path]) => path === DETAIL_PATH).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Quote Requests on an Opportunity', () => {
  it('links one found through CRM`s own lookup — never through the quote desk`s list', async () => {
    postSpy.mockResolvedValue({ data: quoteLink() });
    await openOpportunity();
    const quotes = await section(en('links.quote.title'));
    expect(within(quotes).getByText(en('links.quote.empty'))).toBeInTheDocument();
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith(`${QUOTE_LOOKUP}?organizationId=${ORGANIZATION_ID}`),
    );

    await userEvent.click(within(quotes).getByRole('combobox', { name: en('links.quote.add.label') }));
    await userEvent.click(await screen.findByRole('option', { name: /RFQ-0007/ }));
    current = detail({ links: [...detail().links, quoteLink()] });
    await userEvent.click(within(quotes).getByRole('button', { name: en('links.quote.add.submit') }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/links`, {
        documentKind: 'quote_request',
        documentId: QUOTE_ID,
      }),
    );
    const row = (await within(quotes).findByRole('link', { name: 'RFQ-0007' })).closest('tr') as HTMLElement;
    expect(within(row).getByText(en('links.quote.status.approved'))).toBeInTheDocument();
    expect(getSpy.mock.calls.some(([path]) => String(path).startsWith('/api/v1/admin/quote-requests'))).toBe(false);
    // The Orders table is still the Orders' alone.
    expect(within(await section(en('links.title'))).queryByText('RFQ-0007')).toBeNull();
  });

  it('unlinks one', async () => {
    current = detail({ links: [quoteLink()] });
    deleteSpy.mockResolvedValue(undefined);
    await openOpportunity();
    const quotes = await section(en('links.quote.title'));
    await userEvent.click(
      within(quotes).getByRole('button', { name: en('links.quote.unlink.label', { number: 'RFQ-0007' }) }),
    );
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/links/${QUOTE_LINK_ID}`));
  });

  it('is absent with the module off and nothing linked: no heading, no picker, no request', async () => {
    await openOpportunity({ quotes: false });
    await section(en('links.title'));
    expect(screen.queryByRole('heading', { level: 2, name: en('links.quote.title') })).toBeNull();
    expect(getSpy.mock.calls.some(([path]) => String(path).startsWith(QUOTE_LOOKUP))).toBe(false);
  });

  it('keeps earlier links listed as unavailable with the module off, and still lets them go', async () => {
    // As the server answers a link whose owner is off: no number, no status, no total.
    const { number: _n, status: _s, total: _t, currency: _c, ...bare } = quoteLink({ available: false });
    current = detail({ links: [bare] });
    await openOpportunity({ quotes: false });
    const quotes = await section(en('links.quote.title'));
    expect(within(quotes).getByText(en('links.quote.moduleOff'))).toBeInTheDocument();
    expect(within(quotes).getByText(en('links.quote.unavailable'))).toBeInTheDocument();
    expect(within(quotes).queryByRole('combobox')).toBeNull();
    expect(
      within(quotes).getByRole('button', {
        name: en('links.quote.unlink.label', { number: en('links.quote.unavailable') }),
      }),
    ).toBeInTheDocument();
  });

  it('degrades the same way when the module is switched off after the page was opened', async () => {
    current = detail({ links: [quoteLink()] });
    quoteLookup = () => Promise.reject(moduleDisabled());
    await openOpportunity();
    const quotes = await section(en('links.quote.title'));
    expect(await within(quotes).findByText(en('links.quote.moduleOff'))).toBeInTheDocument();
    expect(within(quotes).queryByRole('combobox')).toBeNull();
    // Not presented as a failure of the search.
    expect(within(quotes).queryByText(en('links.quote.error.search'))).toBeNull();
  });
});

describe('the statuses that count towards a computed value', () => {
  async function openWorkflow(quotes = true): Promise<void> {
    renderCrm(<WorkflowConfigPage />, quotes ? { alsoPresent: ['quote_requests'] } : {});
    await screen.findByText(en('value.counting.title'));
  }

  it('saves both groups as one set and says the figures follow in the background', async () => {
    putSpy.mockResolvedValue({
      data: { ...WORKFLOW, valueCountingStatuses: { order: ['completed', 'paid'], quoteRequest: ['Approved'] } },
    });
    await openWorkflow();
    const orderGroup = screen.getByRole('group', { name: en('value.counting.order.legend') });
    const quoteGroup = screen.getByRole('group', { name: en('value.counting.quote.legend') });
    const save = screen.getByRole('button', { name: en('value.counting.save') });
    expect(save).toBeDisabled();

    // "Paid and everything after it" in one press.
    await userEvent.click(
      within(orderGroup).getByRole('button', {
        name: en('value.counting.order.andLaterLabel', { status: 'Paid' }),
      }),
    );
    expect(within(orderGroup).getByRole('checkbox', { name: 'Paid' })).toBeChecked();
    expect(within(orderGroup).getByRole('checkbox', { name: 'Completed' })).toBeChecked();
    expect(within(orderGroup).getByRole('checkbox', { name: 'New' })).not.toBeChecked();
    await userEvent.click(
      within(quoteGroup).getByRole('checkbox', { name: en('links.quote.status.approved') }),
    );
    await userEvent.click(save);

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/crm/value-counting-statuses', {
        order: ['completed', 'paid'],
        quoteRequest: ['Approved'],
      }),
    );
    // A 202: accepted, with the recalculation still to come — said in so many words.
    expect(await screen.findByText(en('value.counting.accepted'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en('value.counting.save') })).toBeDisabled();
  });

  it('offers no Quote Request statuses with that module off, and sends back what was saved for them', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/crm/workflow') {
        return Promise.resolve({
          data: { ...WORKFLOW, valueCountingStatuses: { order: [], quoteRequest: ['Approved'] } },
        });
      }
      if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    putSpy.mockResolvedValue({
      data: { ...WORKFLOW, valueCountingStatuses: { order: ['paid'], quoteRequest: ['Approved'] } },
    });
    await openWorkflow(false);
    expect(screen.queryByRole('group', { name: en('value.counting.quote.legend') })).toBeNull();
    expect(screen.getByText(en('value.counting.quote.moduleOff'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Paid' }));
    await userEvent.click(screen.getByRole('button', { name: en('value.counting.save') }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/crm/value-counting-statuses', {
        order: ['paid'],
        quoteRequest: ['Approved'],
      }),
    );
  });

  it('keeps a saved Order status the Orders module no longer lists on screen, marked', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/crm/workflow') {
        return Promise.resolve({
          data: { ...WORKFLOW, valueCountingStatuses: { order: ['shipped_old'], quoteRequest: [] } },
        });
      }
      if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    await openWorkflow();
    const orphan = screen.getByText(en('value.counting.order.gone')).closest('li') as HTMLElement;
    expect(within(orphan).getByRole('checkbox')).toBeChecked();
  });
});
