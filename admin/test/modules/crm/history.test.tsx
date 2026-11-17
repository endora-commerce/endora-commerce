import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityHistoryEntry } from '@endora-commerce/contracts';
import {
  ADMIN_ID,
  OTHER_ADMIN_ID,
  CONTACT_ID,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORGANIZATION_ID,
  PROPAGATION_ID,
  ORDER_STATUS_GRAPH,
  WORKFLOW,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
  returningHere,
} from './crm-fixtures';
import crmEn from '../../../../packages/modules/crm/i18n/en.json';
import crmPl from '../../../../packages/modules/crm/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';

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
const DEFINITIONS_PATH = '/api/v1/admin/custom-fields/definitions?entityType=opportunity';

const definitionBase = {
  entityType: 'opportunity',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
/** `GET /custom-fields/definitions?entityType=opportunity` — a choice, a yes/no, a text. */
const DEFINITIONS = [
  {
    ...definitionBase,
    id: '00000000-0000-4000-8000-00000000d101',
    key: 'lead_source',
    label: { en: 'Lead source', pl: 'Źródło kontaktu' },
    labelDefault: 'Lead source',
    valueType: 'select',
    options: [
      { id: 'o1', value: 'referral', label: { en: 'Referral' }, labelDefault: 'Referral', isDefault: false, sortOrder: 0 },
      { id: 'o2', value: 'trade_fair', label: { en: 'Trade fair' }, labelDefault: 'Trade fair', isDefault: false, sortOrder: 1 },
    ],
  },
  {
    ...definitionBase,
    id: '00000000-0000-4000-8000-00000000d102',
    key: 'key_account',
    label: { en: 'Key account' },
    labelDefault: 'Key account',
    valueType: 'boolean',
  },
  {
    ...definitionBase,
    id: '00000000-0000-4000-8000-00000000d103',
    key: 'region',
    label: { en: 'Region' },
    labelDefault: 'Region',
    valueType: 'text',
  },
];

function entry(overrides: Partial<OpportunityHistoryEntry>): OpportunityHistoryEntry {
  return {
    id: 'audit-1',
    actedAt: '2026-10-05T12:00:00.000Z',
    action: 'crm.opportunity.update',
    actor: { kind: 'admin', id: ADMIN_ID, name: 'Anna Nowak' },
    before: null,
    after: null,
    references: [],
    ...overrides,
  };
}

/**
 * An entry as the server serves it to a reader without `custom_fields:read`
 * (feature 162, owner ruling P2): `customFieldValues` left out of `before` and
 * `after`, everything else — `customFieldCarry` included — as it was.
 */
function servedWithoutCustomFields(source: OpportunityHistoryEntry): OpportunityHistoryEntry {
  const strip = (state: unknown): unknown => {
    if (state === null || typeof state !== 'object' || Array.isArray(state)) return state;
    const { customFieldValues: _hidden, ...rest } = state as Record<string, unknown>;
    return rest;
  };
  return { ...source, before: strip(source.before) as never, after: strip(source.after) as never };
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

let pages: Record<
  string,
  {
    data: OpportunityHistoryEntry[];
    pagination: { cursor: string | null; hasMore: boolean; limit: number };
    truncated: boolean;
  }
>;
let failHistory = false;

beforeEach(() => {
  getSpy.mockReset();
  failHistory = false;
  pages = {
    '': { data: FIRST_PAGE, pagination: { cursor: 'next-1', hasMore: true, limit: 50 }, truncated: false },
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
      truncated: false,
    },
  };
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: detail() });
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith('/api/v1/admin/orders?')) return Promise.resolve({ data: [] });
    if (path === DEFINITIONS_PATH) return Promise.resolve({ data: DEFINITIONS });
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

async function openHistory(
  permissions: readonly string[] = ['crm:read', 'orders:read'],
): Promise<HTMLElement> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    permissions,
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  await userEvent.click(screen.getByRole('tab', { name: en('opportunity.tabs.history') }));
  return screen.findByRole('tabpanel', { name: en('opportunity.tabs.history') });
}

const item = (panel: HTMLElement, index: number): HTMLElement =>
  within(within(panel).getByRole('list', { name: core('history.title') })).getAllByRole('listitem')[
    index
  ] as HTMLElement;

describe('the Change history tab', () => {
  it('is named as the owner named it, and reads the history with nothing but crm:read', async () => {
    expect(en('opportunity.tabs.history')).toBe('Change history');
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: core('history.title') });
    expect(getSpy).toHaveBeenCalledWith(`${HISTORY_PATH}?limit=50`);
  });

  it('opens on the entries, with no paragraph explaining what a history is (#1487)', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: core('history.title') });
    expect(within(panel).queryByText(/^Everything that was done/)).toBeNull();
  });

  it('labels each entry from auditLog.<action>, with who did it and when', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: core('history.title') });
    const moved = item(panel, 1);
    expect(within(moved).getByRole('heading', { name: en('auditLog.crm.opportunity.transition') })).toBeInTheDocument();
    expect(within(moved).getByText('Anna Nowak')).toBeInTheDocument();
    expect(moved.querySelector('time')).toHaveAttribute('dateTime', '2026-10-05T12:00:00.000Z');
    expect(within(item(panel, 3)).getByRole('heading', { name: en('auditLog.crm.opportunity.link_add') })).toBeInTheDocument();
  });

  it('shows a status change in the statuses` names, never their codes, with the reason', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: core('history.title') });
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
    await within(panel).findByRole('list', { name: core('history.title') });
    const caused = item(panel, 0);
    expect(within(caused).getByText(core('history.actor.system'))).toBeInTheDocument();
    await within(caused).findByText('Won');
    expect(caused).toHaveTextContent(en('history.cause.order'));
    expect(within(caused).getByRole('link', { name: /ORD-1001/ })).toHaveAttribute(
      'href',
      returningHere(`/orders/${ORDER_ID}`),
    );
    // The identifier itself is never on screen.
    expect(caused).not.toHaveTextContent(ORDER_ID);
  });

  it('lists what an edit changed, as it was and as it is, and nothing that did not change', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: core('history.title') });
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
    await within(panel).findByRole('list', { name: core('history.title') });
    const linked = item(panel, 3);
    expect(within(linked).getByRole('link', { name: en('history.document.open.order') })).toHaveAttribute(
      'href',
      returningHere(`/orders/${UNLINKED_ORDER_ID}`),
    );
    expect(linked).not.toHaveTextContent(UNLINKED_ORDER_ID);
    expect(linked).not.toHaveTextContent('l1');
  });

  it('appends the next page under the ones already read, and says where the history ends', async () => {
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: core('history.title') });
    await userEvent.click(within(panel).getByRole('button', { name: core('history.more') }));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(`${HISTORY_PATH}?cursor=next-1&limit=50`));
    await waitFor(() =>
      expect(within(within(panel).getByRole('list', { name: core('history.title') })).getAllByRole('listitem')).toHaveLength(5),
    );
    const created = item(panel, 4);
    expect(within(created).getByRole('heading', { name: en('auditLog.crm.opportunity.create') })).toBeInTheDocument();
    // An administrator who has since been deleted is said to be one, not left blank.
    expect(within(created).getByText(core('history.actor.deleted'))).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: core('history.more') })).toBeNull();
    expect(within(panel).getByText(en('history.end'))).toBeInTheDocument();
  });

  // Second review: the history reaches a fixed way back, and used to end there in silence.
  it('says that earlier changes exist when the history ends at its reach, instead of calling it whole', async () => {
    pages['next-1'] = { ...pages['next-1']!, truncated: true };
    const panel = await openHistory();
    await within(panel).findByRole('list', { name: core('history.title') });
    // Not on a page that has a next one.
    expect(within(panel).queryByText(en('history.truncated'))).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: core('history.more') }));
    expect(await within(panel).findByText(en('history.truncated'))).toBeInTheDocument();
    expect(within(panel).queryByText(en('history.end'))).toBeNull();
    expect(within(panel).queryByRole('button', { name: core('history.more') })).toBeNull();
  });

  it('says there is no history yet', async () => {
    pages[''] = { data: [], pagination: { cursor: null, hasMore: false, limit: 50 }, truncated: false };
    const panel = await openHistory();
    expect(await within(panel).findByText(en('history.empty'))).toBeInTheDocument();
  });

  it('offers a retry when the history cannot be read', async () => {
    failHistory = true;
    const panel = await openHistory();
    expect(await within(panel).findByText('Boom.')).toBeInTheDocument();
    failHistory = false;
    await userEvent.click(within(panel).getByRole('button', { name: core('common.action.retry') }));
    expect(await within(panel).findByRole('list', { name: core('history.title') })).toBeInTheDocument();
  });
});

/**
 * Nothing of the audited state reaches the reader as it is stored: no state
 * key, no code of an outcome or of an Order status, no JSON, and no "Set"
 * where the screen already holds the name.
 */
describe('the Change history tab, on what an entry carries', () => {
  const CREATED = entry({
    id: 'audit-c',
    action: 'crm.opportunity.create',
    before: null,
    after: {
      title: 'Fleet renewal',
      organizationId: ORGANIZATION_ID,
      customerAccountId: CONTACT_ID,
      salesChannelId: '00000000-0000-4000-8000-0000000000f2',
      customFieldValues: { lead_source: 'trade_fair', key_account: true, retired_field: 'kept' },
    },
  });
  const FIELDS_EDITED = entry({
    id: 'audit-f',
    action: 'crm.opportunity.update',
    before: { title: 'Fleet renewal', customFieldValues: { lead_source: 'referral', region: 'North' } },
    after: { title: 'Fleet renewal', customFieldValues: { lead_source: 'trade_fair', region: 'North' } },
  });
  const RETRIED = entry({
    id: 'audit-r',
    action: 'crm.opportunity.propagation_retry',
    before: { propagationId: PROPAGATION_ID, orderId: ORDER_ID, outcome: 'not_permitted' },
    after: { propagationId: 'p-2', orderId: ORDER_ID, orderStatusCode: 'completed' },
  });
  const NOT_FOLLOWED = entry({
    id: 'audit-s',
    action: 'crm.opportunity.propagation_skip',
    actor: { kind: 'system', id: null, name: null },
    before: { status: 'new' },
    after: {
      status: 'new',
      propagationId: 'p-3',
      orderId: ORDER_ID,
      orderStatusCode: 'paid',
      skippedStatus: 'won',
      outcome: 'skipped',
      reason: 'No move from New to Won.',
    },
  });
  const UNFORESEEN = entry({
    id: 'audit-u',
    action: 'crm.opportunity.update',
    before: { riskProfile: { level: 'low' } },
    after: { riskProfile: { level: 'high' } },
  });

  const only = (...entries: OpportunityHistoryEntry[]): void => {
    pages[''] = { data: entries, pagination: { cursor: null, hasMore: false, limit: 50 }, truncated: false };
  };
  const READER = ['crm:read', 'orders:read', 'custom_fields:read'];
  const row = (entryItem: HTMLElement, label: string): HTMLElement =>
    within(entryItem).getByText(label).parentElement as HTMLElement;

  it('lists custom field values a line per field, under the fields` own labels', async () => {
    only(CREATED);
    const panel = await openHistory(READER);
    const created = item(panel, 0);
    const fields = row(created, en('history.field.customFieldValues'));
    await within(fields).findByText(/Lead source/);
    const lines = within(fields).getAllByRole('listitem');
    expect(lines.map((line) => line.textContent)).toEqual([
      'Lead source: Trade fair',
      `Key account: ${en('customFields.value.yes')}`,
      // A value whose field has since been deleted is shown under its code.
      'retired_field: kept',
    ]);
    expect(created).not.toHaveTextContent('customFieldValues');
    expect(created).not.toHaveTextContent('{');
    expect(created).not.toHaveTextContent('trade_fair');
  });

  it('shows no custom field row to a reader who may not read the fields, as the server serves the entry (P2)', async () => {
    only(servedWithoutCustomFields(CREATED));
    const panel = await openHistory(['crm:read', 'orders:read']);
    const created = item(panel, 0);
    expect(within(created).getByText(en('history.field.title'))).toBeInTheDocument();
    expect(within(created).queryByText(en('history.field.customFieldValues'))).toBeNull();
    // A creation still has its other fields to show: no placeholder.
    expect(within(created).queryByText(en('history.customFieldValuesHidden'))).toBeNull();
    expect(getSpy).not.toHaveBeenCalledWith(DEFINITIONS_PATH);
  });

  it('keeps the values hidden client-side even if a server still sends them to that reader (P2)', async () => {
    // Not what the server sends since P2 — the gate this screen holds on its own.
    only(CREATED, FIELDS_EDITED);
    const panel = await openHistory(['crm:read', 'orders:read']);
    const [created, edited] = [item(panel, 0), item(panel, 1)];
    for (const shown of [created, edited]) {
      expect(within(shown).queryByText(en('history.field.customFieldValues'))).toBeNull();
      expect(shown).not.toHaveTextContent(/trade_fair|referral|lead_source|retired_field/);
    }
    // An edit of values alone says so, rather than standing empty.
    expect(within(edited).getByText(en('history.customFieldValuesHidden'))).toBeInTheDocument();
    expect(getSpy).not.toHaveBeenCalledWith(DEFINITIONS_PATH);
  });

  it.each(['en', 'pl'] as const)(
    'says custom field values changed for an edit of values alone, to a reader who may not read them (P2, %s)',
    async (language) => {
      only(servedWithoutCustomFields(FIELDS_EDITED));
      const bundle = (language === 'pl' ? crmPl : crmEn) as Record<string, string>;
      renderCrm(
        <StrictMode>
          <OpportunityDetail />
        </StrictMode>,
        {
          path: `/crm/opportunities/${OPPORTUNITY_ID}`,
          pattern: '/crm/opportunities/:id',
          permissions: ['crm:read', 'orders:read'],
          language,
        },
      );
      await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
      await userEvent.click(screen.getByRole('tab', { name: bundle['opportunity.tabs.history']! }));
      const panel = await screen.findByRole('tabpanel', { name: bundle['opportunity.tabs.history']! });
      const list = await within(panel).findByRole('list', {
        name: ((language === 'pl' ? corePl : coreEn) as Record<string, string>)['history.title']!,
      });
      const edited = within(list).getAllByRole('listitem')[0] as HTMLElement;
      expect(within(edited).getByText(bundle['history.customFieldValuesHidden']!)).toBeInTheDocument();
      expect(within(edited).queryByText(bundle['history.field.customFieldValues']!)).toBeNull();
    },
  );

  it('shows the values, not the placeholder, to a reader who may read them', async () => {
    only(FIELDS_EDITED);
    const panel = await openHistory(READER);
    const edited = item(panel, 0);
    await within(row(edited, en('history.field.customFieldValues'))).findByText(/Lead source/);
    expect(within(edited).queryByText(en('history.customFieldValuesHidden'))).toBeNull();
  });

  it('does not claim a values change for an edit that shows something else', async () => {
    only(servedWithoutCustomFields(UNFORESEEN));
    const panel = await openHistory(['crm:read', 'orders:read']);
    expect(within(item(panel, 0)).queryByText(en('history.customFieldValuesHidden'))).toBeNull();
  });

  it('shows an edit of custom field values field by field, and only the fields that changed', async () => {
    only(FIELDS_EDITED);
    const panel = await openHistory(READER);
    const edited = item(panel, 0);
    const fields = row(edited, en('history.field.customFieldValues'));
    await within(fields).findByText(/Lead source/);
    const lines = within(fields).getAllByRole('listitem');
    expect(lines).toHaveLength(1);
    expect(within(lines[0] as HTMLElement).getByText('Referral')).toBeInTheDocument();
    expect(within(lines[0] as HTMLElement).getByText('Trade fair')).toBeInTheDocument();
    expect(edited).not.toHaveTextContent('Region');
    expect(edited).not.toHaveTextContent('{');
  });

  it('names the Organization and the contact person the Opportunity carries, and says "set" only for what it cannot name', async () => {
    getSpy.mockImplementation(
      ((previous) => (path: string) =>
        path === DETAIL_PATH
          ? Promise.resolve({
              data: detail({
                customerAccount: { id: CONTACT_ID, name: 'Jan Kowalski', email: 'jan@acme.test' },
              }),
            })
          : previous(path))(getSpy.getMockImplementation() as (path: string) => Promise<unknown>),
    );
    only(CREATED);
    const panel = await openHistory(READER);
    const created = item(panel, 0);
    expect(row(created, en('history.field.organizationId'))).toHaveTextContent('Acme');
    expect(row(created, en('history.field.customerAccountId'))).toHaveTextContent('Jan Kowalski');
    // The detail carries a Sales Channel's id and not its name.
    expect(row(created, en('history.field.salesChannelId'))).toHaveTextContent(en('history.value.set'));
    expect(created).not.toHaveTextContent(ORGANIZATION_ID);
  });

  it('says what a retried refusal was in the propagation panel`s words, with the Order status by name', async () => {
    only(RETRIED);
    const panel = await openHistory(READER);
    const retried = item(panel, 0);
    await within(retried).findByText(en('propagation.outcome.not_permitted', { status: 'Completed' }));
    expect(row(retried, en('history.field.orderStatusCode'))).toHaveTextContent('Completed');
    expect(within(retried).getByRole('link', { name: /ORD-1001/ })).toBeInTheDocument();
    expect(retried).not.toHaveTextContent('not_permitted');
    expect(retried).not.toHaveTextContent('completed');
    // What the retry itself led to is not in this entry: nothing claims a result.
    expect(within(retried).queryByText(en('history.field.outcome'))).toBeNull();
    expect(retried).not.toHaveTextContent('—');
  });

  it('shows no Order status row to a reader without orders:read', async () => {
    only(RETRIED, NOT_FOLLOWED);
    const panel = await openHistory(['crm:read']);
    await within(panel).findByRole('list', { name: core('history.title') });
    for (const index of [0, 1]) {
      expect(within(item(panel, index)).queryByText(en('history.field.orderStatusCode'))).toBeNull();
    }
    // The Order itself is a link that names nothing; the reason stays.
    expect(item(panel, 1)).toHaveTextContent('No move from New to Won.');
  });

  it('says why the Opportunity did not follow an Order, in words', async () => {
    only(NOT_FOLLOWED);
    const panel = await openHistory(READER);
    const skipped = item(panel, 0);
    await within(skipped).findByText('Paid');
    expect(row(skipped, en('history.field.outcome'))).toHaveTextContent(en('history.notFollowed.skipped'));
    expect(row(skipped, en('history.field.skippedStatus'))).toHaveTextContent('Won');
    expect(skipped).toHaveTextContent('No move from New to Won.');
    expect(skipped).not.toHaveTextContent('skipped');
  });

  it('falls back to the Order status code when the status has no name', async () => {
    only({ ...NOT_FOLLOWED, after: { ...(NOT_FOLLOWED.after as object), orderStatusCode: 'on_hold' } });
    const panel = await openHistory(READER);
    expect(await within(item(panel, 0)).findByText('on_hold')).toBeInTheDocument();
  });

  // User Story 18, FR-084 — a description is read as it is on the Overview.
  it('shows the people, Orders and Products a changed description refers to by name, never as tokens', async () => {
    const hidden = '00000000-0000-4000-8000-00000000aa09';
    only(
      entry({
        id: 'audit-d',
        before: { description: `Ask [[admin_user:${ADMIN_ID}]] about [[order:${ORDER_ID}]].` },
        after: { description: `Ask [[admin_user:${OTHER_ADMIN_ID}]] about [[product:${hidden}]].` },
        references: [
          { type: 'admin_user', id: ADMIN_ID, available: true, label: 'Anna Nowak', url: null },
          { type: 'order', id: ORDER_ID, available: true, label: 'ORD-1001', url: `/orders/${ORDER_ID}` },
          { type: 'admin_user', id: OTHER_ADMIN_ID, available: true, label: 'Piotr Zielony', url: null },
          { type: 'product', id: hidden, available: false, label: null, url: null },
        ],
      }),
    );
    const panel = await openHistory(READER);
    const changed = row(item(panel, 0), en('history.field.description'));
    expect(changed).toHaveTextContent('@Anna Nowak about');
    expect(within(changed).getByRole('link', { name: /ORD-1001/ })).toHaveAttribute(
      'href',
      returningHere(`/orders/${ORDER_ID}`),
    );
    expect(changed).toHaveTextContent('@Piotr Zielony about');
    expect(within(changed).getByText(core('references.unavailable.product'))).toBeInTheDocument();
    expect(changed).not.toHaveTextContent('[[');
    expect(changed).not.toHaveTextContent(ADMIN_ID);
    expect(changed).not.toHaveTextContent(hidden);
  });

  it('shows a formatted description by its words, without the formatting markers (specs/158-crm-opportunity-inline-editing/)', async () => {
    only(
      entry({
        id: 'audit-f',
        before: { description: 'Plain' },
        after: { description: '**Bold** and _soft_\n- one' },
        references: [],
      }),
    );
    const panel = await openHistory(READER);
    const changed = row(item(panel, 0), en('history.field.description'));
    expect(changed).toHaveTextContent('Bold and soft');
    expect(changed).toHaveTextContent('- one');
    expect(changed).not.toHaveTextContent('**');
  });

  it('cuts a long description without cutting a mention in two', async () => {
    const token = `[[admin_user:${ADMIN_ID}]]`;
    only(
      entry({
        id: 'audit-l',
        before: null,
        after: { description: `${'x'.repeat(275)} ${token} and a good deal more that is cut away` },
        references: [{ type: 'admin_user', id: ADMIN_ID, available: true, label: 'Anna Nowak', url: null }],
      }),
    );
    const panel = await openHistory(READER);
    const shown = row(item(panel, 0), en('history.field.description'));
    expect(shown).toHaveTextContent('@Anna Nowak');
    expect(shown).toHaveTextContent(/ an…$/);
    expect(shown).not.toHaveTextContent('[[');
    expect(shown).not.toHaveTextContent('good deal');
  });

  it('shows a field it was never told about as "Other change", in words and never as JSON', async () => {
    only(UNFORESEEN);
    const panel = await openHistory(READER);
    const changed = item(panel, 0);
    const other = row(changed, en('history.field.other', { field: 'risk profile' }));
    expect(other).toHaveTextContent('level: low');
    expect(other).toHaveTextContent('level: high');
    expect(changed).not.toHaveTextContent('riskProfile');
    expect(changed).not.toHaveTextContent('{');
  });
});

/**
 * Feature 162 (T049, US2-5, US2-6) — a creation or a join that could not carry
 * every custom-field value into the Opportunity says so: from which kind of
 * record, and a line per field with its reason
 * (`specs/162-custom-fields-value-carry/contracts/admin-surfaces.md` §4).
 *
 * Owner ruling V3 (2026-10-21, T067): the field is named by the label stored
 * with the skip — the reader's language, then the default label, then the key
 * for an entry recorded before labels were stored — and the skip lines show to
 * every reader of the Opportunity, while the values row keeps its own gate.
 */
describe('the Change history tab, on custom-field values not carried', () => {
  const CREATED_WITH_SKIPS = entry({
    id: 'audit-cc',
    action: 'crm.opportunity.create',
    actor: { kind: 'system', id: null, name: null },
    before: null,
    after: {
      title: 'Fleet renewal',
      customFieldValues: { lead_source: 'trade_fair' },
      customFieldCarry: {
        source: { entityType: 'quote_request', recordId: '00000000-0000-4000-8000-0000000000e7' },
        carried: ['lead_source'],
        skipped: [
          // The source field's label, stored with the skip (V3); no Polish label.
          { key: 'region', reason: 'value_type_mismatch', label: { labelDefault: 'Region', labels: { en: 'Region' } } },
          // Recorded before labels were stored.
          { key: 'gone_field', reason: 'target_missing' },
        ],
      },
    },
  });
  const JOINED_WITH_SKIPS = entry({
    id: 'audit-cj',
    action: 'crm.opportunity.link_add',
    actor: { kind: 'system', id: null, name: null },
    before: null,
    after: {
      linkId: 'l9',
      documentKind: 'order',
      documentId: UNLINKED_ORDER_ID,
      linkSource: 'auto',
      customFieldCarry: {
        source: { entityType: 'order', recordId: UNLINKED_ORDER_ID },
        carried: [],
        skipped: [
          {
            key: 'key_account',
            reason: 'audience_mismatch',
            label: { labelDefault: 'Key account', labels: { en: 'Key account', pl: 'Kluczowy klient' } },
          },
        ],
      },
    },
  });
  const CARRIED_ONLY = entry({
    id: 'audit-co',
    action: 'crm.opportunity.create',
    before: null,
    after: {
      title: 'Fleet renewal',
      customFieldValues: { lead_source: 'referral' },
      customFieldCarry: {
        source: { entityType: 'order', recordId: UNLINKED_ORDER_ID },
        carried: ['lead_source'],
        skipped: [],
      },
    },
  });

  const only = (...entries: OpportunityHistoryEntry[]): void => {
    pages[''] = { data: entries, pagination: { cursor: null, hasMore: false, limit: 50 }, truncated: false };
  };
  const READER = ['crm:read', 'orders:read', 'custom_fields:read'];
  const row = (entryItem: HTMLElement, label: string): HTMLElement =>
    within(entryItem).getByText(label).parentElement as HTMLElement;
  const line = (field: string, reason: string): string =>
    en('history.customFieldCarry.line', { field, reason: en(`history.carryReason.${reason}`) });

  it('says a creation could not carry some values, a line per field under its stored label, with the reason', async () => {
    only(CREATED_WITH_SKIPS);
    const panel = await openHistory(READER);
    const created = item(panel, 0);
    const carry = row(created, en('history.field.customFieldCarry'));
    expect(within(carry).getByText(en('history.customFieldCarry.from.quote_request'))).toBeInTheDocument();
    await within(carry).findByText(line('Region', 'value_type_mismatch'));
    expect(within(carry).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      line('Region', 'value_type_mismatch'),
      // A skip recorded without a label is shown under its key.
      line('gone_field', 'target_missing'),
    ]);
    // What it did carry shows as the values themselves, not again here.
    expect(within(row(created, en('history.field.customFieldValues'))).getByText(/Lead source/)).toBeInTheDocument();
    expect(created).not.toHaveTextContent('customFieldCarry');
    expect(created).not.toHaveTextContent('value_type_mismatch');
    expect(created).not.toHaveTextContent('{');
  });

  it('words a skip reason it does not know by the generic sentence, never by its code', async () => {
    only(
      entry({
        id: 'audit-cu',
        action: 'crm.opportunity.create',
        before: null,
        after: {
          title: 'Fleet renewal',
          customFieldCarry: {
            source: { entityType: 'quote_request', recordId: '00000000-0000-4000-8000-0000000000e8' },
            carried: [],
            // A reason a newer server may answer and this screen has no sentence for.
            skipped: [{ key: 'region', reason: 'owner_unreachable', label: { labelDefault: 'Region', labels: {} } }],
          },
        },
      }),
    );
    const panel = await openHistory(READER);
    const carry = row(item(panel, 0), en('history.field.customFieldCarry'));
    expect(await within(carry).findByText(en('history.customFieldCarry.line', { field: 'Region', reason: en('history.carryReasonUnknown') }))).toBeInTheDocument();
    expect(carry).not.toHaveTextContent(/owner.unreachable/i);
  });

  it('says a join could not carry a value from the order', async () => {
    only(JOINED_WITH_SKIPS);
    const panel = await openHistory(READER);
    const joined = item(panel, 0);
    const carry = row(joined, en('history.field.customFieldCarry'));
    expect(within(carry).getByText(en('history.customFieldCarry.from.order'))).toBeInTheDocument();
    expect(await within(carry).findByText(line('Key account', 'audience_mismatch'))).toBeInTheDocument();
  });

  // V3 (T067) — this test asserted the lines were hidden without
  // `custom_fields:read`; the ruling shows them to every reader of the record.
  it('shows the field lines, under their stored labels, to a reader who may not read the fields', async () => {
    only(servedWithoutCustomFields(CREATED_WITH_SKIPS));
    const panel = await openHistory(['crm:read', 'orders:read']);
    const created = item(panel, 0);
    const carry = row(created, en('history.field.customFieldCarry'));
    expect(within(carry).getByText(en('history.customFieldCarry.from.quote_request'))).toBeInTheDocument();
    expect(within(carry).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      line('Region', 'value_type_mismatch'),
      line('gone_field', 'target_missing'),
    ]);
    // The names come with the entry: no field definition is read for them.
    expect(getSpy).not.toHaveBeenCalledWith(DEFINITIONS_PATH);
  });

  it('shows the skip lines without the values row to a reader who may not read the fields (V3, P2)', async () => {
    only(servedWithoutCustomFields(CREATED_WITH_SKIPS));
    const panel = await openHistory(['crm:read', 'orders:read']);
    const created = item(panel, 0);
    // The skip lines name the field by its stored label…
    expect(within(row(created, en('history.field.customFieldCarry'))).getByText(line('Region', 'value_type_mismatch'))).toBeInTheDocument();
    // …while the server sent no values, so there is no values row and no definition read.
    expect(within(created).queryByText(en('history.field.customFieldValues'))).toBeNull();
    expect(created).not.toHaveTextContent(/lead_source|trade_fair|Lead source|Trade fair/);
    expect(getSpy).not.toHaveBeenCalledWith(DEFINITIONS_PATH);
  });

  it('names a skipped field in Polish, falling back to the default label, then to the key', async () => {
    const pl = crmPl as Record<string, string>;
    const plText = (key: string, params: Record<string, string> = {}): string =>
      pl[key]!.replace(/\{(\w+)\}/g, (_m, name: string) => params[name] ?? '');
    const plLine = (field: string, reason: string): string =>
      plText('history.customFieldCarry.line', { field, reason: plText(`history.carryReason.${reason}`) });
    only(servedWithoutCustomFields(CREATED_WITH_SKIPS), servedWithoutCustomFields(JOINED_WITH_SKIPS));
    renderCrm(
      <StrictMode>
        <OpportunityDetail />
      </StrictMode>,
      {
        path: `/crm/opportunities/${OPPORTUNITY_ID}`,
        pattern: '/crm/opportunities/:id',
        permissions: ['crm:read', 'orders:read'],
        language: 'pl',
      },
    );
    await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
    await userEvent.click(screen.getByRole('tab', { name: plText('opportunity.tabs.history') }));
    const panel = await screen.findByRole('tabpanel', { name: plText('opportunity.tabs.history') });
    const list = await within(panel).findByRole('list', {
      name: (corePl as Record<string, string>)['history.title']!,
    });
    const [created, joined] = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
    const carryOf = (entryItem: HTMLElement): HTMLElement =>
      within(entryItem).getByText(plText('history.field.customFieldCarry')).parentElement as HTMLElement;
    expect(within(carryOf(created!)).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      // No Polish label stored: the default label.
      plLine('Region', 'value_type_mismatch'),
      // No label stored at all: the key.
      plLine('gone_field', 'target_missing'),
    ]);
    expect(within(carryOf(joined!)).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      plLine('Kluczowy klient', 'audience_mismatch'),
    ]);
  });

  it('says nothing about a carry that skipped nothing', async () => {
    only(CARRIED_ONLY);
    const panel = await openHistory(READER);
    const created = item(panel, 0);
    expect(within(created).queryByText(en('history.field.customFieldCarry'))).toBeNull();
    expect(created).not.toHaveTextContent('customFieldCarry');
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

  it('reads a retry as one statement: the Order, the status asked of it, and the refusal retried', () => {
    expect(
      historyChanges({
        action: 'crm.opportunity.propagation_retry',
        before: { propagationId: 'p1', orderId: 'o1', outcome: 'vetoed' },
        after: { propagationId: 'p2', orderId: 'o1', orderStatusCode: 'paid' },
      }),
    ).toEqual([
      { field: 'orderId', after: 'o1' },
      { field: 'retriedOutcome', after: 'vetoed' },
      { field: 'orderStatusCode', after: 'paid' },
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
