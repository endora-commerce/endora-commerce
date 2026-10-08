import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { OpportunityDetail as OpportunityDetailData } from '@endora-commerce/contracts';
import {
  ADMIN_ID,
  LINK_ID,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORDER_STATUS_GRAPH,
  WORKFLOW,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
} from './crm-fixtures';

/**
 * What the Opportunity screen offers somebody who may not read the documents
 * it links (`specs/143-crm-sales-opportunities/research.md` N-R3, N-R13).
 *
 * Choosing an Order to link, and deciding whether it follows, asks for
 * `orders:read` as well as `crm:write`; choosing a Quote Request asks for
 * `rfqs:handle`. The screen does not offer what the server would refuse, does
 * not ask the owner's list for somebody it would refuse, and says why — while
 * unlinking, which shows nothing of the document, stays where it was.
 */

const getSpy = vi.fn();

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
const { historyChanges } = await import(
  '../../../../packages/modules/crm/src/admin/components/OpportunityHistory'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const QUOTE_LOOKUP = '/api/v1/admin/crm/lookups/quote-requests';
const QUOTE_ID = '00000000-0000-4000-8000-0000000000a7';

/** A linked Order and a linked Quote Request, as a reader who may read neither is answered. */
const hiddenLinks: OpportunityDetailData['links'] = [
  {
    id: LINK_ID,
    documentKind: 'order',
    documentId: ORDER_ID,
    available: false,
    syncStatus: true,
    linkSource: 'manual',
    createdAt: '2026-10-05T10:05:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000d2',
    documentKind: 'quote_request',
    documentId: QUOTE_ID,
    available: false,
    syncStatus: true,
    linkSource: 'manual',
    createdAt: '2026-10-05T10:06:00.000Z',
  },
];

let current: OpportunityDetailData;

beforeEach(() => {
  getSpy.mockReset();
  current = detail();
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith('/api/v1/admin/orders?')) return Promise.resolve({ data: [] });
    if (path.startsWith(`${QUOTE_LOOKUP}?`)) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function openOpportunity(permissions: readonly string[]): Promise<void> {
  renderCrm(<OpportunityDetail />, {
    // The linked documents have a tab of their own (User Story 20).
    path: `/crm/opportunities/${OPPORTUNITY_ID}?tab=links`,
    pattern: '/crm/opportunities/:id',
    permissions,
    alsoPresent: ['quote_requests'],
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
}

const section = async (title: string): Promise<HTMLElement> =>
  (await screen.findByRole('heading', { level: 2, name: title })).closest('section') as HTMLElement;

const asked = (prefix: string): boolean =>
  getSpy.mock.calls.some(([path]) => typeof path === 'string' && path.startsWith(prefix));

describe('linked Orders, for somebody who may not read Orders', () => {
  it('offers no Order to link and no following switch, says why, asks the Orders list for nothing, and still unlinks', async () => {
    current = detail({ links: hiddenLinks });
    await openOpportunity(['crm:read', 'crm:write']);
    const orders = await section(en('links.title'));

    expect(within(orders).queryByRole('combobox', { name: en('links.add.label') })).not.toBeInTheDocument();
    expect(within(orders).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(orders).getByText(en('links.add.needsOrdersRead'))).toBeInTheDocument();
    // Removing a link shows nothing of the Order and asks for nothing more.
    expect(within(orders).getByRole('button', { name: /Unlink/ })).toBeInTheDocument();
    expect(asked('/api/v1/admin/orders?')).toBe(false);
  });

  it('offers both to a holder of orders:read — the control', async () => {
    await openOpportunity(['crm:read', 'crm:write', 'orders:read']);
    const orders = await section(en('links.title'));
    expect(await within(orders).findByRole('combobox', { name: en('links.add.label') })).toBeInTheDocument();
    expect(within(orders).getByRole('checkbox')).toBeInTheDocument();
    expect(within(orders).queryByText(en('links.add.needsOrdersRead'))).not.toBeInTheDocument();
  });
});

describe('linked Quote Requests, for somebody who may not read Quote Requests', () => {
  it('offers no Quote Request to link, says why, asks the lookup for nothing, and still unlinks', async () => {
    current = detail({ links: hiddenLinks });
    await openOpportunity(['crm:read', 'crm:write', 'orders:read']);
    const quotes = await section(en('links.quote.title'));

    expect(within(quotes).queryByRole('combobox', { name: en('links.quote.add.label') })).not.toBeInTheDocument();
    expect(within(quotes).getByText(en('links.quote.add.needsQuotePermission'))).toBeInTheDocument();
    expect(within(quotes).getByRole('button', { name: /Unlink/ })).toBeInTheDocument();
    expect(asked(QUOTE_LOOKUP)).toBe(false);
  });

  it('offers it to a holder of rfqs:handle — the control', async () => {
    await openOpportunity(['crm:read', 'crm:write', 'orders:read', 'rfqs:handle']);
    const quotes = await section(en('links.quote.title'));
    expect(await within(quotes).findByRole('combobox', { name: en('links.quote.add.label') })).toBeInTheDocument();
    expect(within(quotes).queryByText(en('links.quote.add.needsQuotePermission'))).not.toBeInTheDocument();
    expect(asked(QUOTE_LOOKUP)).toBe(true);
  });
});

describe('the change history of a note, now that its text is not audited', () => {
  it('shows how long the note was, and no identifier of who wrote it — the entry names its actor already', () => {
    const changes = historyChanges({
      before: null,
      after: { commentId: 'c-1', kind: 'note', authorAdminUserId: ADMIN_ID, length: 42 },
    });
    expect(changes).toEqual([
      { field: 'kind', after: 'note' },
      { field: 'length', after: 42 },
    ]);
    expect(en('history.field.length')).not.toBe('history.field.length');
  });
});
