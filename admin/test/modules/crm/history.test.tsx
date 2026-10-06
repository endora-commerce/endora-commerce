import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityHistoryEntry } from '@endora-commerce/contracts';
import {
  ADMIN_ID,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORDER_STATUS_GRAPH,
  WORKFLOW,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
} from './crm-fixtures';

/**
 * The *Change history* tab of an Opportunity
 * (`specs/143-crm-sales-opportunities/`, User Story 11 — task T122; FR-052):
 * the entries of `GET /opportunities/:id/history` as sentences — the audited
 * action's label, who and when, a status change in the statuses' names with
 * the Order that caused it, an edit field by field — a page at a time.
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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);
const { historyChanges } = await import(
  '../../../../packages/modules/crm/src/admin/components/OpportunityHistory'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const HISTORY_PATH = `${DETAIL_PATH}/history`;
const UNLINKED_ORDER_ID = '00000000-0000-4000-8000-0000000000c9';

function entry(overrides: Partial<OpportunityHistoryEntry>): OpportunityHistoryEntry {
  return {
    id: 'audit-1',
    actedAt: '2026-10-05T12:00:00.000Z',
    action: 'crm.opportunity.update',
    actor: { kind: 'admin', id: ADMIN_ID, name: 'Anna Nowak' },
    before: null,
    after: null,
    ...overrides,
  };
}

const FIRST_PAGE: OpportunityHistoryEntry[] = [
  entry({
    id: 'audit-5',
    action: 'crm.opportunity.transition',
    actor: { kind: 'system', id: null, name: null },
    before: { status: 'qualified' },
    after: { status: 'won', cause: 'order_status', causeOrderId: ORDER_ID },
  }),
  entry({
    id: 'audit-4',
    action: 'crm.opportunity.transition',
    before: { status: 'new' },
    after: { status: 'qualified', cause: 'manual', reason: 'Budget confirmed' },
  }),
  entry({
    id: 'audit-3',
    action: 'crm.opportunity.update',
    before: { title: 'Fleet', valueMode: 'manual', description: null, version: 1 },
    after: { title: 'Fleet renewal', valueMode: 'computed', description: null, version: 2 },
  }),
  entry({
    id: 'audit-2',
    action: 'crm.opportunity.link_add',
    before: null,
    after: { linkId: 'l1', documentKind: 'order', documentId: UNLINKED_ORDER_ID, syncStatus: true, linkSource: 'manual' },
  }),
];

let pages: Record<string, { data: OpportunityHistoryEntry[]; pagination: { cursor: string | null; hasMore: boolean; limit: number } }>;
let failHistory = false;

beforeEach(() => {
  getSpy.mockReset();
  failHistory = false;
  pages = {
    '': { data: FIRST_PAGE, pagination: { cursor: 'next-1', hasMore: true, limit: 50 } },
    'next-1': {
      data: [
        entry({
          id: 'audit-1',
          action: 'crm.opportunity.create',
          actor: { kind: 'admin', id: 'gone', name: null },
          before: null,
          after: { title: 'Fleet', source: 'manual', currency: 'PLN', manualValue: null },
        }),
      ],
      pagination: { cursor: null, hasMore: false, limit: 50 },
    },
  };
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: detail() });
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith('/api/v1/admin/orders?')) return Promise.resolve({ data: [] });
    if (path.startsWith(HISTORY_PATH)) {
      if (failHistory) {
        return Promise.reject(new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } }));
      }
      const cursor = new URLSearchParams(path.split('?')[1] ?? '').get('cursor') ?? '';
      return Promise.resolve(pages[cursor]);
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function openHistory(): Promise<HTMLElement> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    permissions: ['crm:read', 'orders:read'],
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  await userEvent.click(screen.getByRole('tab', { name: en('opportunity.tabs.history') }));
  return screen.findByRole('tabpanel', { name: en('opportunity.tabs.history') });
}

const item = (panel: HTMLElement, index: number): HTMLElement =>
  within(within(panel).getByRole('list', { name: en('history.title') })).getAllByRole('listitem')[
    index
  ] as HTMLElement;

describe('the Change history tab', () => {
  it('is named as the owner named it, and reads the history with nothing but crm:read', async () => {
    expect(en('opportunity.tabs.history')).toBe('Change history');
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: en('history.title') });
    expect(getSpy).toHaveBeenCalledWith(`${HISTORY_PATH}?limit=50`);
  });

  it('labels each entry from auditLog.<action>, with who did it and when', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: en('history.title') });
    const moved = item(panel, 1);
    expect(within(moved).getByRole('heading', { name: en('auditLog.crm.opportunity.transition') })).toBeInTheDocument();
    expect(within(moved).getByText('Anna Nowak')).toBeInTheDocument();
    expect(moved.querySelector('time')).toHaveAttribute('dateTime', '2026-10-05T12:00:00.000Z');
    expect(within(item(panel, 3)).getByRole('heading', { name: en('auditLog.crm.opportunity.link_add') })).toBeInTheDocument();
  });

  it('shows a status change in the statuses` names, never their codes, with the reason', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: en('history.title') });
    const moved = item(panel, 1);
    await within(moved).findByText('Qualified');
    expect(within(moved).getByText('New')).toBeInTheDocument();
    expect(moved).not.toHaveTextContent('qualified');
    expect(within(moved).getByText('Budget confirmed')).toBeInTheDocument();
    // A manual move says nothing about a cause.
    expect(within(moved).queryByText(en('history.cause.order'))).toBeNull();
  });

  it('names the Order that moved the Opportunity, links to it, and says the system did it', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: en('history.title') });
    const caused = item(panel, 0);
    expect(within(caused).getByText(en('history.actor.system'))).toBeInTheDocument();
    await within(caused).findByText('Won');
    expect(caused).toHaveTextContent(en('history.cause.order'));
    expect(within(caused).getByRole('link', { name: /ORD-1001/ })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}`,
    );
    // The identifier itself is never on screen.
    expect(caused).not.toHaveTextContent(ORDER_ID);
  });

  it('lists what an edit changed, as it was and as it is, and nothing that did not change', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: en('history.title') });
    const edited = item(panel, 2);
    expect(within(edited).getByText(en('history.field.title'))).toBeInTheDocument();
    expect(within(edited).getByText('Fleet')).toBeInTheDocument();
    expect(within(edited).getByText('Fleet renewal')).toBeInTheDocument();
    expect(within(edited).getByText(en('value.mode.computed'))).toBeInTheDocument();
    expect(within(edited).queryByText(en('history.field.description'))).toBeNull();
    expect(edited).not.toHaveTextContent('version');
  });

  it('links a document it cannot name any more instead of printing its id', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: en('history.title') });
    const linked = item(panel, 3);
    expect(within(linked).getByRole('link', { name: en('history.document.open.order') })).toHaveAttribute(
      'href',
      `/orders/${UNLINKED_ORDER_ID}`,
    );
    expect(linked).not.toHaveTextContent(UNLINKED_ORDER_ID);
    expect(linked).not.toHaveTextContent('l1');
  });

  it('appends the next page under the ones already read, and says where the history ends', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: en('history.title') });
    await userEvent.click(within(panel).getByRole('button', { name: en('history.more') }));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(`${HISTORY_PATH}?cursor=next-1&limit=50`));
    await waitFor(() =>
      expect(within(within(panel).getByRole('list', { name: en('history.title') })).getAllByRole('listitem')).toHaveLength(5),
    );
    const created = item(panel, 4);
    expect(within(created).getByRole('heading', { name: en('auditLog.crm.opportunity.create') })).toBeInTheDocument();
    // An administrator who has since been deleted is said to be one, not left blank.
    expect(within(created).getByText(en('history.actor.deleted'))).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: en('history.more') })).toBeNull();
    expect(within(panel).getByText(en('history.end'))).toBeInTheDocument();
  });

  it('says there is no history yet', async () => {
    pages[''] = { data: [], pagination: { cursor: null, hasMore: false, limit: 50 } };
    const panel = await openHistory();
    expect(await within(panel).findByText(en('history.empty'))).toBeInTheDocument();
  });

  it('offers a retry when the history cannot be read', async () => {
    failHistory = true;
    const panel = await openHistory();
    expect(await within(panel).findByText('Boom.')).toBeInTheDocument();
    failHistory = false;
    await userEvent.click(within(panel).getByRole('button', { name: core('common.action.retry') }));
    expect(await within(panel).findByRole('list', { name: en('history.title') })).toBeInTheDocument();
  });
});

describe('historyChanges', () => {
  it('answers the fields that differ for an edit', () => {
    expect(historyChanges({ before: { a: 1, b: 2 }, after: { a: 1, b: 3 } })).toEqual([
      { field: 'b', before: 2, after: 3 },
    ]);
  });

  it('answers what arrived for a creation and what went for a removal, without the empty fields', () => {
    expect(historyChanges({ before: null, after: { title: 'T', note: null, empty: '' } })).toEqual([
      { field: 'title', after: 'T' },
    ]);
    expect(historyChanges({ before: { fileName: 'a.pdf' }, after: null })).toEqual([
      { field: 'fileName', after: 'a.pdf' },
    ]);
  });

  it('never lists a bare identifier or the status a status change already says', () => {
    expect(
      historyChanges({
        before: { status: 'new' },
        after: { status: 'won', cause: 'manual', causeOrderId: 'x', linkId: 'y', reason: 'r' },
      }),
    ).toEqual([{ field: 'reason', before: null, after: 'r' }]);
  });
});
