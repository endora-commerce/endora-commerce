import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { OpportunityDetail as OpportunityDetailData } from '@endora-commerce/contracts';
import {
  CHANNEL_ID,
  CONTACT_ID,
  OPPORTUNITY_ID,
  ORDER_STATUS_GRAPH,
  ORGANIZATION_ID,
  WORKFLOW,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
} from './crm-fixtures';

/**
 * Creating an Order or a Quote Request from within an Opportunity
 * (`specs/143-crm-sales-opportunities/`, User Story 10 — FR-026): the two
 * buttons, who is offered them, where they lead, and what the Opportunity says
 * when its creator comes back from the owner's create screen.
 */

const getSpy = vi.fn();

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
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const NEW_ORDER_ID = '00000000-0000-4000-8000-0000000000c9';
const NEW_QUOTE_ID = '00000000-0000-4000-8000-0000000000a9';
const EVERYTHING = ['crm:read', 'crm:write', 'orders:read', 'orders:write', 'rfqs:handle'];

type Link = OpportunityDetailData['links'][number];

const createdLink = (overrides: Partial<Link>): Link => ({
  id: '00000000-0000-4000-8000-0000000000d9',
  documentKind: 'order',
  documentId: NEW_ORDER_ID,
  available: true,
  number: 'ORD-2001',
  status: 'new',
  total: '19.99',
  currency: 'PLN',
  syncStatus: true,
  linkSource: 'created_from_opportunity',
  createdAt: '2026-10-06T10:05:00.000Z',
  ...overrides,
});

/** What `GET …/opportunities/:id` answers, read by read. */
let reads: OpportunityDetailData[];

beforeEach(() => {
  getSpy.mockReset();
  reads = [detail({ links: [] })];
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) {
      const next = reads.length > 1 ? reads.shift() : reads[0];
      return Promise.resolve({ data: next });
    }
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith('/api/v1/admin/orders?')) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/crm/lookups/quote-requests?')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function openOpportunity(
  options: {
    permissions?: readonly string[];
    quotes?: boolean;
    search?: string;
    state?: unknown;
  } = {},
): Promise<void> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}${options.search ?? ''}`,
    pattern: '/crm/opportunities/:id',
    permissions: options.permissions ?? EVERYTHING,
    ...(options.quotes === false ? {} : { alsoPresent: ['quote_requests'] }),
    ...(options.state === undefined ? {} : { state: options.state }),
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
}

/** The Overview is a lazy chunk: a section is waited for, not assumed. */
const section = async (title: string): Promise<HTMLElement> =>
  (await screen.findByRole('heading', { level: 2, name: title })).closest('section') as HTMLElement;

const paramsOf = (link: HTMLElement): URLSearchParams =>
  new URLSearchParams((link.getAttribute('href') ?? '').split('?')[1] ?? '');

describe('“Create order” on an Opportunity', () => {
  it('opens the create-order screen for this Opportunity’s organization, naming the Opportunity as the origin', async () => {
    await openOpportunity();
    const orders = await section(en('links.title'));
    const link = within(orders).getByRole('link', { name: en('origin.order.create') });

    expect(link.getAttribute('href')).toMatch(/^\/orders\/new\?/);
    const params = paramsOf(link);
    expect(Object.fromEntries(params)).toEqual({
      originType: 'crm_opportunity',
      originId: OPPORTUNITY_ID,
      organizationId: ORGANIZATION_ID,
      returnTo: `/crm/opportunities/${OPPORTUNITY_ID}?created=order`,
    });
  });

  it('hands over the contact person and the sales channel when the Opportunity has them', async () => {
    reads = [
      detail({
        links: [],
        salesChannelId: CHANNEL_ID,
        customerAccount: { id: CONTACT_ID, name: 'Jan Kowalski', email: 'jan@acme.example' },
      }),
    ];
    await openOpportunity();
    const orders = await section(en('links.title'));
    const params = paramsOf(within(orders).getByRole('link', { name: en('origin.order.create') }));
    expect(params.get('customerAccountId')).toBe(CONTACT_ID);
    expect(params.get('salesChannelId')).toBe(CHANNEL_ID);
  });

  it.each([
    ['may not create orders', ['crm:read', 'crm:write', 'orders:read']],
    ['may not change opportunities', ['crm:read', 'orders:read', 'orders:write']],
  ])('is not offered to somebody who %s', async (_label, permissions) => {
    await openOpportunity({ permissions });
    const orders = await section(en('links.title'));
    expect(within(orders).queryByRole('link', { name: en('origin.order.create') })).toBeNull();
  });
});

describe('coming back from the create-order screen', () => {
  const arrival = {
    search: '?created=order',
    state: { createdDocument: { id: NEW_ORDER_ID } },
  };

  it('says the new order is linked once it is — reading again until the link is there', async () => {
    // The link is written just after the order commits: the first read may be too early.
    reads = [detail({ links: [] }), detail({ links: [] }), detail({ links: [createdLink({})] })];
    await openOpportunity(arrival);
    const orders = await section(en('links.title'));
    expect(within(orders).getByText(en('origin.order.linking'))).toBeInTheDocument();

    expect(
      await within(orders).findByText(en('origin.order.linked', { number: 'ORD-2001' }), undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(within(orders).getByRole('link', { name: 'ORD-2001' })).toHaveAttribute(
      'href',
      `/orders/${NEW_ORDER_ID}`,
    );
    expect(within(orders).queryByText(en('origin.order.linking'))).toBeNull();
  });

  it('says so at once when the link is already there', async () => {
    reads = [detail({ links: [createdLink({})] })];
    await openOpportunity(arrival);
    const orders = await section(en('links.title'));
    expect(within(orders).getByText(en('origin.order.linked', { number: 'ORD-2001' }))).toBeInTheDocument();
    expect(getSpy.mock.calls.filter(([path]) => path === DETAIL_PATH)).toHaveLength(1);
  });

  it('says the order was created but is not linked here when the link never comes, and where to find it', async () => {
    reads = [detail({ links: [] })];
    await openOpportunity(arrival);
    const orders = await section(en('links.title'));
    const notice = await within(orders).findByText(en('origin.order.notLinked'), undefined, { timeout: 9000 });
    expect(notice).toBeInTheDocument();
    expect(within(orders).getByRole('link', { name: en('origin.order.open') })).toHaveAttribute(
      'href',
      `/orders/${NEW_ORDER_ID}`,
    );
  }, 12_000);

  it('says nothing on an ordinary visit', async () => {
    await openOpportunity();
    const orders = await section(en('links.title'));
    await waitFor(() => expect(within(orders).getByRole('link', { name: en('origin.order.create') })).toBeInTheDocument());
    expect(within(orders).queryByText(en('origin.order.linking'))).toBeNull();
    expect(getSpy.mock.calls.filter(([path]) => path === DETAIL_PATH)).toHaveLength(1);
  });
});

describe('“Create quote request” on an Opportunity', () => {
  it('opens the create-quote-request screen for this Opportunity’s organization, naming the Opportunity as the origin', async () => {
    reads = [
      detail({
        links: [],
        customerAccount: { id: CONTACT_ID, name: 'Jan Kowalski', email: 'jan@acme.example' },
      }),
    ];
    await openOpportunity();
    const quotes = await section(en('links.quote.title'));
    const link = within(quotes).getByRole('link', { name: en('origin.quote.create') });

    expect(link.getAttribute('href')).toMatch(/^\/quote-requests\/new\?/);
    expect(Object.fromEntries(paramsOf(link))).toEqual({
      originType: 'crm_opportunity',
      originId: OPPORTUNITY_ID,
      organizationId: ORGANIZATION_ID,
      customerAccountId: CONTACT_ID,
      returnTo: `/crm/opportunities/${OPPORTUNITY_ID}?created=quote_request`,
    });
  });

  it.each([
    ['may not handle quote requests', ['crm:read', 'crm:write', 'orders:read', 'orders:write']],
    ['may not change opportunities', ['crm:read', 'orders:read', 'rfqs:handle']],
  ])('is not offered to somebody who %s', async (_label, permissions) => {
    await openOpportunity({ permissions });
    const quotes = await section(en('links.quote.title'));
    expect(within(quotes).queryByRole('link', { name: en('origin.quote.create') })).toBeNull();
  });

  it('is not offered while the Quote Requests module is off — with nothing linked the section is not there at all', async () => {
    await openOpportunity({ quotes: false });
    await section(en('links.title'));
    expect(screen.queryByRole('link', { name: en('origin.quote.create') })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: en('links.quote.title') })).toBeNull();
    // Orders are not that module's: their button stays.
    expect(screen.getByRole('link', { name: en('origin.order.create') })).toBeInTheDocument();
  });

  it('is not offered while the module is off even where a request linked earlier keeps the section on screen', async () => {
    reads = [
      detail({
        links: [
          createdLink({ documentKind: 'quote_request', documentId: NEW_QUOTE_ID, available: false, number: undefined }),
        ],
      }),
    ];
    await openOpportunity({ quotes: false });
    const quotes = await section(en('links.quote.title'));
    expect(within(quotes).getByText(en('links.quote.moduleOff'))).toBeInTheDocument();
    expect(within(quotes).queryByRole('link', { name: en('origin.quote.create') })).toBeNull();
  });
});

describe('coming back from the create-quote-request screen', () => {
  it('says the new quote request is linked, in its own section and not under Orders', async () => {
    reads = [
      detail({ links: [] }),
      detail({
        links: [
          createdLink({
            documentKind: 'quote_request',
            documentId: NEW_QUOTE_ID,
            number: 'RFQ-0042',
            status: 'Created from admin',
          }),
        ],
      }),
    ];
    await openOpportunity({
      search: '?created=quote_request',
      state: { createdDocument: { id: NEW_QUOTE_ID } },
    });
    const quotes = await section(en('links.quote.title'));
    expect(
      await within(quotes).findByText(en('origin.quote.linked', { number: 'RFQ-0042' }), undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    const orders = await section(en('links.title'));
    expect(within(orders).queryByRole('status', { name: /./ })).toBeNull();
    expect(within(orders).queryByText(en('origin.order.linking'))).toBeNull();
    expect(within(orders).queryByText(en('origin.order.notLinked'))).toBeNull();
  });
});
