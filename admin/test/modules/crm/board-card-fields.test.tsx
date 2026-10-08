import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import type {
  OpportunityBoard,
  OpportunityBoardCardConfig,
  OpportunityBoardCardField,
} from '@endora-commerce/contracts';
import { core, crmLookupResponse, en, renderCrm, summary, WORKFLOW } from './crm-fixtures';

/**
 * What a board card shows, and filtering the board by it
 * (`specs/143-crm-sales-opportunities/`, User Story 19 — task T233; FR-090 –
 * FR-093).
 *
 * Three subjects: the board's filters as its address carries them (pure), the
 * *Board card* section of the configuration, and the board itself — the card
 * rendering the chosen fields, a filter per kind of field, and the address
 * following every change.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { BoardCardFieldsEditor } = await import(
  '../../../../packages/modules/crm/src/admin/components/BoardCardFieldsEditor'
);
const { OpportunityBoardPage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityBoardPage'
);
const { activeFieldFilters, readBoardFilters, writeBoardFilters } = await import(
  '../../../../packages/modules/crm/src/admin/lib/board-fields'
);

const CONFIG_PATH = '/api/v1/admin/crm/board/card-fields';
const BOARD_PATH = '/api/v1/admin/crm/board';
const LIST_PATH = '/api/v1/admin/crm/opportunities';
const WORKFLOW_PATH = '/api/v1/admin/crm/workflow';
const UUID = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';

const builtin = (key: string, kind: OpportunityBoardCardField['kind']): OpportunityBoardCardField => ({
  ref: `builtin:${key}`,
  source: 'builtin',
  key,
  kind,
  label: {},
  labelDefault: null,
  options:
    key === 'source'
      ? ['manual', 'order', 'quote_request'].map((value) => ({ value, label: {}, labelDefault: value }))
      : [],
});

const custom = (
  key: string,
  kind: OpportunityBoardCardField['kind'],
  labelDefault: string,
  options: string[] = [],
): OpportunityBoardCardField => ({
  ref: `custom:${key}`,
  source: 'custom',
  key,
  kind,
  label: {},
  labelDefault,
  options: options.map((value) => ({ value, label: { en: value.replace('_', ' ') }, labelDefault: value })),
});

const FIELD = {
  number: builtin('number', 'text'),
  organization: builtin('organization', 'organization'),
  contact: builtin('contact', 'contact'),
  assignee: builtin('assignee', 'assignee'),
  value: builtin('value', 'money'),
  salesChannel: builtin('salesChannel', 'salesChannel'),
  tags: builtin('tags', 'tags'),
  expectedCloseDate: builtin('expectedCloseDate', 'date'),
  source: builtin('source', 'select'),
  linkedOrders: builtin('linkedOrders', 'number'),
  leadSource: custom('lead_source', 'select', 'Lead source', ['referral', 'trade_fair']),
  vip: custom('vip', 'boolean', 'VIP'),
  competitor: custom('competitor', 'text', 'Competitor'),
  seats: custom('seats', 'number', 'Seats'),
};

const DEFAULT = [FIELD.number, FIELD.organization, FIELD.value, FIELD.assignee, FIELD.tags];
const AVAILABLE = Object.values(FIELD);

function configOf(fields: OpportunityBoardCardField[]): OpportunityBoardCardConfig {
  return { fields, available: AVAILABLE, maxFields: 6 };
}

describe('the board\'s filters in its address', () => {
  it('reads what it wrote', () => {
    const filters = {
      shared: {
        q: 'fleet',
        organizationId: UUID,
        assignee: 'person' as const,
        assigneeId: UUID,
        tagIds: [UUID],
        salesChannelId: UUID,
        createdFrom: '2026-01-01',
        createdTo: '2026-12-31',
      },
      fields: {
        'custom:lead_source': { in: ['referral', 'trade_fair'] },
        'builtin:value': { min: '100', max: '2500.50' },
        'custom:vip': { is: false },
        'custom:competitor': { contains: 'acme' },
        'builtin:expectedCloseDate': { from: '2026-03-01', to: '2026-03-31' },
      },
    };
    expect(readBoardFilters(writeBoardFilters(filters))).toEqual(filters);
    expect(writeBoardFilters(readBoardFilters(new URLSearchParams())).toString()).toBe('');
  });

  it('leaves out what is not of its shape instead of refusing the address', () => {
    const read = readBoardFilters(
      new URLSearchParams(
        'organizationId=acme&assignee=somebody&createdFrom=yesterday&f.builtin:value.min=ten&f.custom:vip.is=maybe&f.custom:x.like=1&other=1&assignee=me',
      ),
    );
    expect(read.shared).toMatchObject({ organizationId: null, assignee: '', createdFrom: '' });
    expect(read.fields).toEqual({});
    expect(readBoardFilters(new URLSearchParams('assignee=unassigned')).shared.assignee).toBe('unassigned');
  });

  it('reads nothing the server would refuse the whole board for (N-BFR2)', async () => {
    const { OpportunityBoardQuerySchema } = await import('@endora-commerce/contracts');
    const { sharedFilterParams } = await import(
      '../../../../packages/modules/crm/src/admin/components/OpportunityFilterFields'
    );
    const addresses = [
      // A date no calendar has.
      'f.builtin:expectedCloseDate.from=2026-02-31',
      'createdFrom=2026-02-31&createdTo=2026-13-01',
      // A text of spaces alone, and one option longer than an option can be.
      'f.custom:competitor.contains=%20%20',
      `f.custom:lead_source.in=${'x'.repeat(201)}&f.custom:lead_source.in=referral`,
      // References no field can have.
      'f.custom:Lead_Source.in=referral',
      'f.builtin:value2.min=1',
      `f.custom:${'a'.repeat(65)}.is=true`,
      `f.builtin:${'a'.repeat(41)}.is=true`,
      // More fields than a request may name.
      Array.from({ length: 25 }, (_, index) => `f.custom:field_${index}.is=true`).join('&'),
    ];
    for (const address of addresses) {
      const read = readBoardFilters(new URLSearchParams(address));
      const query = {
        ...sharedFilterParams(read.shared),
        ...(Object.keys(read.fields).length > 0 ? { fieldFilters: JSON.stringify(read.fields) } : {}),
      };
      const parsed = OpportunityBoardQuerySchema.safeParse(query);
      expect(parsed.success, `${address.slice(0, 80)} -> ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
    // What is of its shape beside what is not is kept.
    expect(
      readBoardFilters(
        new URLSearchParams(`f.custom:lead_source.in=${'x'.repeat(201)}&f.custom:lead_source.in=referral`),
      ).fields,
    ).toEqual({ 'custom:lead_source': { in: ['referral'] } });
    expect(readBoardFilters(new URLSearchParams('f.custom:competitor.contains=%20acme%20')).fields).toEqual({
      'custom:competitor': { contains: 'acme' },
    });
  });

  it('keeps "a person" while nobody is chosen yet, so the picker can open', () => {
    const pending = { ...readBoardFilters(new URLSearchParams()).shared, assignee: 'person' as const };
    const address = writeBoardFilters({ shared: pending, fields: {} });
    expect(address.toString()).toBe('assignee=person');
    expect(readBoardFilters(address).shared).toMatchObject({ assignee: 'person', assigneeId: null });
  });

  it('sends only the filters of a field the card shows, with the operators of its kind', () => {
    const filters = {
      'custom:lead_source': { in: ['referral'] },
      'custom:seats': { contains: '5', min: '2' },
      'custom:gone': { contains: 'x' },
      'builtin:organization': { contains: 'x' },
    };
    expect(activeFieldFilters(filters, [FIELD.leadSource, FIELD.seats, FIELD.organization])).toEqual({
      'custom:lead_source': { in: ['referral'] },
      'custom:seats': { min: '2' },
    });
    expect(activeFieldFilters(filters, DEFAULT)).toEqual({});
    // The number is found by the search box and has no filter of its own.
    expect(activeFieldFilters({ 'builtin:number': { contains: '42' } }, [FIELD.number])).toEqual({});
  });
});

describe('BoardCardFieldsEditor', () => {
  let stored = configOf(DEFAULT);

  beforeEach(() => {
    getSpy.mockReset();
    putSpy.mockReset();
    stored = configOf(DEFAULT);
    getSpy.mockImplementation((path: string) =>
      path === CONFIG_PATH ? Promise.resolve({ data: stored }) : Promise.reject(new Error(`unexpected GET ${path}`)),
    );
    putSpy.mockImplementation((_path: string, body: { fields: string[] }) => {
      stored = configOf(body.fields.map((ref) => AVAILABLE.find((field) => field.ref === ref)!));
      return Promise.resolve({ data: stored });
    });
  });

  async function renderEditor(): Promise<HTMLElement> {
    renderCrm(<BoardCardFieldsEditor />);
    return screen.findByRole('region', { name: en('boardCard.shown.title') });
  }

  const shownNames = (region: HTMLElement): string[] =>
    within(region)
      .getAllByRole('listitem')
      .map((item) => (item.textContent ?? '').replace(/^\d+\./, '').trim());

  const add = (name: string): HTMLElement =>
    screen.getByRole('button', { name: en('boardCard.add', { field: name }) });

  it('shows the stored choice in its order, says how many of how many, and that the title is always shown', async () => {
    const region = await renderEditor();
    expect(shownNames(region)).toEqual(
      ['number', 'organization', 'value', 'assignee', 'tags'].map((key) => en(`board.field.${key}`)),
    );
    expect(within(region).getByText(en('boardCard.shown.count', { count: 5, max: 6 }))).toBeInTheDocument();
    expect(within(region).getByText(en('boardCard.shown.titleAlways'))).toBeInTheDocument();
    // Built-in fields are named from the bundle, custom ones by their own label.
    expect(add(en('board.field.contact'))).toBeEnabled();
    expect(add('Lead source')).toBeEnabled();
    expect(screen.getByRole('button', { name: core('common.action.save') })).toBeDisabled();
  });

  it('stops at six, saying why, and offers the field again once one is removed', async () => {
    const region = await renderEditor();
    await userEvent.click(add('Lead source'));
    expect(within(region).getByText(en('boardCard.shown.count', { count: 6, max: 6 }))).toBeInTheDocument();
    expect(screen.getByText(en('boardCard.available.full', { max: 6 }))).toBeInTheDocument();
    expect(add('VIP')).toBeDisabled();

    await userEvent.click(
      within(region).getByRole('button', { name: en('boardCard.remove', { field: en('board.field.tags') }) }),
    );
    expect(add('VIP')).toBeEnabled();
    expect(add(en('board.field.tags'))).toBeEnabled();
  });

  it('orders with buttons and saves the references in that order', async () => {
    const region = await renderEditor();
    await userEvent.click(add('Lead source'));
    const up = (): HTMLElement =>
      within(region).getByRole('button', { name: en('boardCard.moveUp', { field: 'Lead source' }) });
    for (let step = 0; step < 5; step += 1) await userEvent.click(up());
    expect(up()).toBeDisabled();
    expect(shownNames(region)[0]).toBe('Lead source');
    await userEvent.click(
      within(region).getByRole('button', { name: en('boardCard.moveDown', { field: 'Lead source' }) }),
    );

    await userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy).toHaveBeenCalledWith(CONFIG_PATH, {
      fields: [
        'builtin:number',
        'custom:lead_source',
        'builtin:organization',
        'builtin:value',
        'builtin:assignee',
        'builtin:tags',
      ],
    });
    expect(await screen.findByText(en('boardCard.saved'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: core('common.action.save') })).toBeDisabled();
  });

  it('shows the server\'s own sentence when the save is refused, and keeps the edit', async () => {
    putSpy.mockRejectedValueOnce(
      new ApiError(422, {
        error: { code: 'VALIDATION_FAILED', message: 'A board card cannot show a field that does not exist.' },
      }),
    );
    const region = await renderEditor();
    await userEvent.click(add('VIP'));
    await userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
    expect(
      await screen.findByText('A board card cannot show a field that does not exist.'),
    ).toBeInTheDocument();
    expect(shownNames(region)).toContain('VIP');
    expect(screen.getByRole('button', { name: core('common.action.save') })).toBeEnabled();
  });

  it('says where custom fields come from when none is defined', async () => {
    stored = { fields: DEFAULT, available: AVAILABLE.filter((field) => field.source === 'builtin'), maxFields: 6 };
    await renderEditor();
    expect(screen.getByText(en('boardCard.available.noCustom'))).toBeInTheDocument();
  });

  it('offers a retry when the choice cannot be read', async () => {
    getSpy.mockRejectedValueOnce(new Error('offline'));
    renderCrm(<BoardCardFieldsEditor />);
    expect(await screen.findByText(en('boardCard.error.load'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: core('common.action.retry') }));
    expect(await screen.findByRole('region', { name: en('boardCard.shown.title') })).toBeInTheDocument();
  });
});

describe('OpportunityBoardPage — the fields a card shows', () => {
  const ID = (n: number): string => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
  const STATUS = { code: 'new', name: 'New', color: '#64748b', kind: 'open' } as const;
  const CARD = [FIELD.leadSource, FIELD.vip, FIELD.competitor, FIELD.seats, FIELD.value, FIELD.expectedCloseDate];

  const FLEET = summary({
    id: ID(1),
    title: 'Fleet renewal',
    cardValues: {
      'custom:lead_source': 'trade_fair',
      'custom:vip': false,
      'custom:competitor': 'Globex',
      'custom:seats': 40,
    },
  });
  const TYRES = summary({
    id: ID(2),
    number: 'OPP-000002',
    title: 'Winter tyres',
    expectedCloseDate: null,
    cardValues: {
      'custom:lead_source': null,
      'custom:vip': null,
      'custom:competitor': null,
      'custom:seats': null,
    },
  });

  let cardFields: OpportunityBoardCardField[] = CARD;

  function boardData(): OpportunityBoard {
    return {
      columns: [
        { status: STATUS, count: 2, valueTotals: [], items: [FLEET, TYRES], hasMore: true },
      ],
      cardFields,
    };
  }

  function Address(): React.ReactNode {
    return <output data-testid="address">{useLocation().search}</output>;
  }

  const address = (): string => decodeURIComponent(screen.getByTestId('address').textContent ?? '');

  /** The `fieldFilters` of the last read of `path`, parsed; `null` when it carried none. */
  function lastFieldFilters(path: string = BOARD_PATH): unknown {
    const calls = getSpy.mock.calls.map(([url]) => url as string).filter((url) => url.split('?')[0] === path);
    const raw = new URLSearchParams(calls.at(-1)?.split('?')[1] ?? '').get('fieldFilters');
    return raw === null ? null : JSON.parse(raw);
  }

  async function renderBoard(path = '/crm/board', permissions?: readonly string[]): Promise<void> {
    renderCrm(
      <>
        <OpportunityBoardPage />
        <Address />
      </>,
      { path, pattern: '/crm/board', ...(permissions ? { permissions } : {}) },
    );
    await screen.findByRole('link', { name: 'Fleet renewal' });
  }

  const card = (title: string): HTMLElement =>
    screen.getByRole('link', { name: title }).closest('[data-kanban-card]') ??
    (screen.getByRole('link', { name: title }).parentElement?.parentElement as HTMLElement);

  beforeEach(() => {
    getSpy.mockReset();
    cardFields = CARD;
    getSpy.mockImplementation((path: string) => {
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: WORKFLOW });
      if (path.startsWith(`${BOARD_PATH}`) && !path.startsWith(CONFIG_PATH)) {
        return Promise.resolve({ data: boardData() });
      }
      if (path.startsWith(LIST_PATH)) {
        return Promise.resolve({ data: [], pagination: { cursor: null, hasMore: false, limit: 200 } });
      }
      const lookup = crmLookupResponse(path);
      if (lookup) return lookup;
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
  });

  it('renders the chosen fields with their labels, and leaves out what the opportunity has no value for', async () => {
    await renderBoard();
    const fleet = within(card('Fleet renewal'));
    // A choice by its option's label, a yes/no in words.
    expect(fleet.getByText('trade fair')).toBeInTheDocument();
    expect(fleet.getByText(en('board.card.field', { label: 'Lead source' }))).toBeInTheDocument();
    expect(fleet.getByText(en('customFields.value.no'))).toBeInTheDocument();
    expect(fleet.getByText('Globex')).toBeInTheDocument();
    expect(fleet.getByText('40')).toBeInTheDocument();
    expect(fleet.getByText(en('board.card.field', { label: en('board.field.expectedCloseDate') }))).toBeInTheDocument();
    // The number and the Organization are not on this card.
    expect(fleet.queryByText('OPP-000001', { exact: false })).not.toBeInTheDocument();

    const tyres = within(card('Winter tyres'));
    for (const label of ['Lead source', 'VIP', 'Competitor', 'Seats', en('board.field.expectedCloseDate')]) {
      expect(tyres.queryByText(en('board.card.field', { label }))).not.toBeInTheDocument();
    }
  });

  it('offers a filter of its own kind for each field shown, and none for a field that is not', async () => {
    await renderBoard();
    expect(screen.getByRole('button', { name: 'Lead source' })).toBeInTheDocument();
    expect(screen.getByLabelText('VIP')).toBeInTheDocument();
    expect(screen.getByLabelText('Competitor')).toBeInTheDocument();
    for (const [label, bound] of [
      ['Seats', 'min'],
      ['Seats', 'max'],
      [en('board.field.value'), 'min'],
      [en('board.field.value'), 'max'],
      [en('board.field.expectedCloseDate'), 'from'],
      [en('board.field.expectedCloseDate'), 'to'],
    ] as const) {
      expect(screen.getByLabelText(en(`board.filter.${bound}`, { label }))).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(en('board.field.source'))).not.toBeInTheDocument();
    // The filters the board always had are still there.
    expect(screen.getByLabelText(en('opportunity.list.filter.organization'))).toBeInTheDocument();
  });

  it('sends each filter to the server, combined, and carries them in the address', async () => {
    await renderBoard();
    expect(lastFieldFilters()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Lead source' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'referral' }));
    await waitFor(() => expect(lastFieldFilters()).toEqual({ 'custom:lead_source': { in: ['referral'] } }));

    await userEvent.selectOptions(screen.getByLabelText('VIP'), 'true');
    await userEvent.type(screen.getByLabelText('Competitor'), 'acme');
    await userEvent.type(screen.getByLabelText(en('board.filter.min', { label: 'Seats' })), '5');
    await userEvent.type(
      screen.getByLabelText(en('board.filter.from', { label: en('board.field.expectedCloseDate') })),
      '2026-03-01',
    );
    await waitFor(() =>
      expect(lastFieldFilters()).toEqual({
        'custom:lead_source': { in: ['referral'] },
        'custom:vip': { is: true },
        'custom:competitor': { contains: 'acme' },
        'custom:seats': { min: '5' },
        'builtin:expectedCloseDate': { from: '2026-03-01' },
      }),
    );
    expect(address()).toContain('f.custom:lead_source.in=referral');
    expect(address()).toContain('f.custom:vip.is=true');
    expect(address()).toContain('f.custom:seats.min=5');

    // A lane is continued from the list under the same filters, card values asked for.
    await userEvent.click(screen.getByRole('button', { name: en('board.column.more', { status: 'New' }) }));
    await waitFor(() => expect(lastFieldFilters(LIST_PATH)).toMatchObject({ 'custom:vip': { is: true } }));
    const listCall = getSpy.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith(LIST_PATH)).at(-1);
    expect(listCall).toContain('cardValues=true');
  });

  it('opens an address that carries filters with them applied, and Clear empties it', async () => {
    await renderBoard('/crm/board?q=fleet&assignee=me&f.custom:lead_source.in=referral&f.custom:seats.max=9');
    const first = getSpy.mock.calls.map(([url]) => url as string).find((url) => url.startsWith(`${BOARD_PATH}?`));
    expect(first).toContain('q=fleet');
    expect(first).toContain('assignedAdminUserId=me');
    expect(JSON.parse(new URLSearchParams(first?.split('?')[1]).get('fieldFilters') ?? 'null')).toEqual({
      'custom:lead_source': { in: ['referral'] },
      'custom:seats': { max: '9' },
    });
    expect(screen.getByLabelText(en('opportunity.list.filter.search'))).toHaveValue('fleet');
    expect(screen.getByLabelText(en('board.filter.max', { label: 'Seats' }))).toHaveValue(9);

    await userEvent.click(screen.getByRole('button', { name: en('opportunity.list.filter.clear') }));
    await waitFor(() => expect(address()).toBe(''));
    await waitFor(() => expect(lastFieldFilters()).toBeNull());
    expect(screen.getByLabelText(en('opportunity.list.filter.search'))).toHaveValue('');
    expect(screen.getByLabelText(en('board.filter.max', { label: 'Seats' }))).toHaveValue(null);
    expect(screen.queryByRole('button', { name: en('opportunity.list.filter.clear') })).not.toBeInTheDocument();
  });

  it('reads the board once for an address whose filters are not in the card\'s order (N-BFR3)', async () => {
    // `seats` is the card's fourth field and `lead_source` its first; `max` is written before `min`.
    await renderBoard('/crm/board?f.custom:seats.max=9&f.custom:seats.min=2&f.custom:lead_source.in=referral');
    await waitFor(() => expect(screen.getByLabelText(en('board.filter.max', { label: 'Seats' }))).toHaveValue(9));
    // Long enough for a second read to have been asked for.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reads = getSpy.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith(`${BOARD_PATH}?`));
    expect(reads).toHaveLength(1);
  });

  it('does not send a filter left in the address for a field the card no longer shows', async () => {
    cardFields = DEFAULT;
    await renderBoard('/crm/board?f.custom:lead_source.in=referral');
    await waitFor(() => expect(lastFieldFilters()).toBeNull());
    // Nothing is filtered, so there is nothing to clear.
    expect(screen.queryByRole('button', { name: en('opportunity.list.filter.clear') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lead source' })).not.toBeInTheDocument();
  });

  it('opens the person picker when "a person" is chosen, before anybody is', async () => {
    await renderBoard();
    await userEvent.selectOptions(screen.getByLabelText(en('assignment.filter.label')), 'person');
    expect(await screen.findByLabelText(en('assignment.filter.person'))).toBeInTheDocument();
    expect(address()).toBe('?assignee=person');
    // Nobody is chosen: the server is asked for nothing new.
    const last = getSpy.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith(BOARD_PATH)).at(-1);
    expect(last).not.toContain('assignedAdminUserId');
  });

  it('links to the card\'s configuration for whoever may change it, and for nobody else', async () => {
    await renderBoard();
    expect(screen.getByRole('link', { name: en('board.configureCard') })).toHaveAttribute(
      'href',
      '/crm/workflow#board-card',
    );
  });

  it('offers no configuration link to a reader', async () => {
    await renderBoard('/crm/board', ['crm:read', 'orders:read']);
    expect(screen.queryByRole('link', { name: en('board.configureCard') })).not.toBeInTheDocument();
  });

  it('offers the contact-person filter only within an Organization', async () => {
    cardFields = [FIELD.contact];
    await renderBoard();
    expect(screen.getByLabelText(en('board.field.contact'))).toBeDisabled();
  });

  it('does not offer the contact-person filter to a reader, who may not read the contacts list', async () => {
    cardFields = [FIELD.contact];
    await renderBoard('/crm/board', ['crm:read', 'orders:read']);
    expect(screen.queryByLabelText(en('board.field.contact'))).not.toBeInTheDocument();
  });
});
