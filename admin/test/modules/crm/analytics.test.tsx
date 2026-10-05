import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  OpportunityAverageValueRow,
  OpportunityHandlingTime,
  OpportunityRepEffectivenessRow,
  OpportunitySummary,
  OpportunityTimeInStatusRow,
} from '@endora-commerce/contracts';
import {
  ADMIN_ID,
  OTHER_ADMIN_ID,
  WORKFLOW,
  core,
  crmLookupResponse,
  en,
  renderCrm,
  summary,
} from './crm-fixtures';

/**
 * The CRM analytics screen (`specs/143-crm-sales-opportunities/`, User Story 13
 * — task T132; FR-053): five figures over a range of days, each with its
 * loading, empty and failed state, and each chart with the same numbers in a
 * table beside it.
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

/**
 * ECharts draws on a canvas jsdom does not have. The chart is replaced by a
 * marker carrying the option it was given, so a test can read what would have
 * been drawn — and assert that a table says the same.
 */
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    EChart: (props: { option: unknown }) => (
      <div data-testid="echart" data-option={JSON.stringify(props.option)} />
    ),
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { AnalyticsPage } = await import('../../../../packages/modules/crm/src/admin/pages/AnalyticsPage');
const labels = await import('../../../../packages/modules/crm/src/admin/lib/labels');

/**
 * An amount as the screen writes it. The formatter separates with no-break
 * spaces, which `toHaveTextContent` folds into plain ones on the element's
 * side only — so the expectation is folded the same way.
 */
const moneyLabel = (amount: string, currency: string): string =>
  labels.moneyLabel(amount, currency).replace(/\s+/g, ' ');

const BASE = '/api/v1/admin/crm/analytics';
const DAY = 86_400;
const ID = (n: number): string => `00000000-0000-4000-8000-00000000a${String(n).padStart(3, '0')}`;

const HANDLING: OpportunityHandlingTime = {
  averageSeconds: 23.5 * DAY,
  closedCount: 6,
  byOutcome: {
    won: { averageSeconds: 27.4 * DAY, closedCount: 5 },
    lost: { averageSeconds: 4 * DAY, closedCount: 1 },
  },
};
const STAYS: OpportunityTimeInStatusRow[] = [
  { statusCode: 'new', averageSeconds: 12 * DAY, sampleCount: 7 },
  { statusCode: 'qualified', averageSeconds: 9 * 3600, sampleCount: 3 },
  { statusCode: 'negotiation', averageSeconds: null, sampleCount: 0 },
  { statusCode: 'won', averageSeconds: 40 * DAY, sampleCount: 5 },
  { statusCode: 'lost', averageSeconds: 30 * 60, sampleCount: 1 },
];
const REPS: OpportunityRepEffectivenessRow[] = [
  {
    month: '2026-02',
    adminUser: { id: OTHER_ADMIN_ID, name: 'Piotr Zielony' },
    wonCount: 1,
    wonValue: [{ currency: 'EUR', total: '500.00' }],
  },
  {
    month: '2026-03',
    adminUser: { id: ADMIN_ID, name: 'Anna Nowak' },
    wonCount: 3,
    wonValue: [
      { currency: 'EUR', total: '250.00' },
      { currency: 'PLN', total: '4000.00' },
    ],
  },
  {
    month: '2026-03',
    adminUser: { id: OTHER_ADMIN_ID, name: 'Piotr Zielony' },
    wonCount: 1,
    wonValue: [{ currency: 'PLN', total: '900.00' }],
  },
];
const TOP: OpportunitySummary[] = [
  summary({ id: ID(1), number: 'OPP-000031', title: 'Frankfurt depot', currency: 'EUR', value: '500.00' }),
  summary({ id: ID(2), number: 'OPP-000012', title: 'Fleet renewal', currency: 'PLN', value: '3000.00' }),
  summary({ id: ID(3), number: 'OPP-000019', title: 'Spare parts', currency: 'PLN', value: '2000.00' }),
];
const AVERAGE: OpportunityAverageValueRow[] = [
  { currency: 'EUR', average: '375.00', count: 2 },
  { currency: 'PLN', average: '1675.00', count: 4 },
];

type Figure = 'handling-time' | 'time-in-status' | 'rep-effectiveness' | 'top-opportunities' | 'average-value';
let answers: Record<Figure, () => Promise<unknown>>;

const figureOf = (path: string): Figure | null =>
  path.startsWith(`${BASE}/`) ? (path.slice(BASE.length + 1).split('?')[0] as Figure) : null;

/** The query of every request made for a figure, oldest first. */
function requests(figure: Figure): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([path]) => String(path))
    .filter((path) => figureOf(path) === figure)
    .map((path) => new URLSearchParams(path.split('?')[1] ?? ''));
}
const last = (figure: Figure): URLSearchParams => requests(figure).at(-1) as URLSearchParams;

beforeEach(() => {
  getSpy.mockReset();
  // The middle of a month, so "this month" and "last month" are whole months.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  answers = {
    'handling-time': () => Promise.resolve({ data: HANDLING }),
    'time-in-status': () => Promise.resolve({ data: STAYS }),
    'rep-effectiveness': () => Promise.resolve({ data: REPS }),
    'top-opportunities': () => Promise.resolve({ data: TOP }),
    'average-value': () => Promise.resolve({ data: AVERAGE }),
  };
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    const figure = figureOf(path);
    if (figure) return answers[figure]();
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const ANALYST = ['crm:read', 'crm:analytics', 'orders:read'];

function open(): void {
  renderCrm(<AnalyticsPage />, { path: '/crm/analytics', pattern: '/crm/analytics', permissions: ANALYST });
}

const card = (titleKey: string): HTMLElement =>
  screen.getByRole('region', { name: en(titleKey) });

const refusal = (message: string) =>
  new ApiError(500, { error: { code: 'INTERNAL', message } });

describe('the CRM analytics screen', () => {
  it('asks for the five figures of the current month', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: en('analytics.title') })).toBeInTheDocument();
    await within(card('analytics.handling.title')).findByText(/23[.,]5 days/);
    for (const figure of [
      'handling-time',
      'time-in-status',
      'rep-effectiveness',
      'top-opportunities',
      'average-value',
    ] as const) {
      expect(last(figure).get('from'), figure).toBe('2026-03-01');
      expect(last(figure).get('to'), figure).toBe('2026-03-31');
      expect(last(figure).has('salesChannelId')).toBe(false);
      expect(last(figure).has('assignedAdminUserId')).toBe(false);
    }
  });

  it('shows the average handling time, with won and lost apart', async () => {
    open();
    const handling = card('analytics.handling.title');
    expect(await within(handling).findByText(/23[.,]5 days/)).toBeInTheDocument();
    expect(within(handling).getByText(en('analytics.handling.closed', { count: 6 }))).toBeInTheDocument();
    const won = within(handling).getByText(en('analytics.outcome.won')).closest('div') as HTMLElement;
    expect(won).toHaveTextContent(/27[.,]4 days/);
    expect(won).toHaveTextContent(en('analytics.count.opportunities', { count: 5 }));
    const lost = within(handling).getByText(en('analytics.outcome.lost')).closest('div') as HTMLElement;
    expect(lost).toHaveTextContent(/4 days/);
  });

  it('shows the average value per currency and never one figure for both', async () => {
    open();
    const value = card('analytics.value.title');
    const eur = (await within(value).findByText('EUR')).closest('tr') as HTMLElement;
    expect(eur).toHaveTextContent(moneyLabel('375.00', 'EUR'));
    expect(eur).toHaveTextContent('2');
    const pln = within(value).getByText('PLN').closest('tr') as HTMLElement;
    expect(pln).toHaveTextContent(moneyLabel('1675.00', 'PLN'));
    // 375 + 1675, 2050 / 6 — a sum or a mean across currencies is not a number.
    expect(value).not.toHaveTextContent(/2[\s ,.]?050|341/);
  });

  describe('time in status', () => {
    it('lists each status by its name with the time and the number of stays, in a table', async () => {
      open();
      const stays = card('analytics.status.title');
      const table = await within(stays).findByRole('table', { name: en('analytics.status.title') });
      const row = (name: string): HTMLElement => within(table).getByText(name).closest('tr') as HTMLElement;
      expect(row('New')).toHaveTextContent(/12 days/);
      expect(row('New')).toHaveTextContent('7');
      // Under two days it is said in hours, under an hour in minutes.
      expect(row('Qualified')).toHaveTextContent(/9 hours/);
      expect(row('Lost')).toHaveTextContent(/30 minutes/);
      // Nobody entered it in the range: said, not drawn as zero.
      expect(row('Negotiation')).toHaveTextContent(en('analytics.status.noStays'));
    });

    it('draws what the table says, and hides the drawing from assistive technology', async () => {
      open();
      const stays = card('analytics.status.title');
      await within(stays).findByRole('table');
      const chart = within(stays).getByTestId('echart');
      expect(chart.closest('[aria-hidden="true"]')).not.toBeNull();
      const option = JSON.parse(chart.getAttribute('data-option') ?? '{}') as {
        yAxis: { data: string[] };
        series: Array<{ data: Array<{ value: number }> }>;
      };
      // A status nobody entered has no bar.
      expect(option.yAxis.data).toEqual(['New', 'Qualified', 'Won', 'Lost']);
      expect(option.series[0]?.data.map((point) => point.value)).toEqual([12, 0.38, 40, 0.02]);
    });

    it('asks for the selected statuses only', async () => {
      open();
      const stays = card('analytics.status.title');
      await within(stays).findByRole('table');
      expect(last('time-in-status').getAll('statusCode')).toEqual([]);

      await userEvent.click(within(stays).getByRole('button', { name: en('analytics.status.select') }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Qualified' }));
      await waitFor(() => expect(last('time-in-status').getAll('statusCode')).toEqual(['qualified']));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Won' }));
      await waitFor(() => expect(last('time-in-status').getAll('statusCode')).toEqual(['qualified', 'won']));
      // The other figures were not asked again for a choice that is not theirs.
      expect(requests('handling-time')).toHaveLength(1);
    });
  });

  describe('most effective sales reps', () => {
    it('ranks the reps over the range by Opportunities won, each currency apart', async () => {
      open();
      const reps = card('analytics.reps.title');
      const ranking = await within(reps).findByRole('table', { name: en('analytics.reps.rankingCaption') });
      const rows = within(ranking).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent('Anna Nowak');
      expect(rows[0]).toHaveTextContent('3');
      expect(rows[0]).toHaveTextContent(moneyLabel('4000.00', 'PLN'));
      expect(rows[0]).toHaveTextContent(moneyLabel('250.00', 'EUR'));
      // Two months, one row: 1 + 1 won; EUR 500 and PLN 900, each on its own.
      expect(rows[1]).toHaveTextContent('Piotr Zielony');
      expect(rows[1]).toHaveTextContent('2');
      expect(rows[1]).toHaveTextContent(moneyLabel('500.00', 'EUR'));
      expect(rows[1]).toHaveTextContent(moneyLabel('900.00', 'PLN'));
    });

    it('breaks the ranking down by calendar month', async () => {
      open();
      const reps = card('analytics.reps.title');
      const monthly = await within(reps).findByRole('table', { name: en('analytics.reps.monthlyCaption') });
      const rows = within(monthly).getAllByRole('row').slice(1);
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringMatching(/February 2026.*Piotr Zielony.*1/),
        expect.stringMatching(/March 2026.*Anna Nowak.*3/),
        expect.stringMatching(/March 2026.*Piotr Zielony.*1/),
      ]);
    });

    it('draws the ranking, most wins first', async () => {
      open();
      const reps = card('analytics.reps.title');
      await within(reps).findByRole('table', { name: en('analytics.reps.rankingCaption') });
      const option = JSON.parse(within(reps).getByTestId('echart').getAttribute('data-option') ?? '{}') as {
        yAxis: { data: string[] };
        series: Array<{ data: number[] }>;
      };
      expect(option.yAxis.data).toEqual(['Anna Nowak', 'Piotr Zielony']);
      expect(option.series[0]?.data).toEqual([3, 2]);
    });
  });

  describe('most valuable opportunities', () => {
    it('lists them per currency, each a link to the Opportunity', async () => {
      open();
      const top = card('analytics.top.title');
      const pln = await within(top).findByRole('table', { name: en('analytics.top.caption', { currency: 'PLN' }) });
      const rows = within(pln).getAllByRole('row').slice(1);
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining('Fleet renewal'),
        expect.stringContaining('Spare parts'),
      ]);
      expect(rows[0]).toHaveTextContent(moneyLabel('3000.00', 'PLN'));
      expect(within(rows[0] as HTMLElement).getByRole('link', { name: /OPP-000012/ })).toHaveAttribute(
        'href',
        `/crm/opportunities/${ID(2)}`,
      );
      const eur = within(top).getByRole('table', { name: en('analytics.top.caption', { currency: 'EUR' }) });
      expect(within(eur).getAllByRole('row').slice(1)).toHaveLength(1);
    });

    it('goes by creation date first, and by closing date when asked', async () => {
      open();
      const top = card('analytics.top.title');
      await within(top).findAllByRole('table');
      expect(last('top-opportunities').get('basis')).toBe('created');
      await userEvent.selectOptions(
        within(top).getByLabelText(en('analytics.top.basis')),
        en('analytics.top.basis.closed'),
      );
      await waitFor(() => expect(last('top-opportunities').get('basis')).toBe('closed'));
    });
  });

  describe('the filters', () => {
    it('recomputes every figure for another range', async () => {
      open();
      await within(card('analytics.handling.title')).findByText(/23[.,]5 days/);
      await userEvent.selectOptions(
        screen.getByLabelText(en('analytics.filter.range')),
        en('analytics.filter.range.lastMonth'),
      );
      await waitFor(() => expect(last('average-value').get('from')).toBe('2026-02-01'));
      for (const figure of ['handling-time', 'time-in-status', 'rep-effectiveness', 'top-opportunities'] as const) {
        expect(last(figure).get('from'), figure).toBe('2026-02-01');
        expect(last(figure).get('to'), figure).toBe('2026-02-28');
      }
    });

    it('takes a range of the operator\'s own, and asks for nothing while it ends before it begins', async () => {
      open();
      await within(card('analytics.handling.title')).findByText(/23[.,]5 days/);
      await userEvent.selectOptions(
        screen.getByLabelText(en('analytics.filter.range')),
        en('analytics.filter.range.custom'),
      );
      const from = screen.getByLabelText(en('analytics.filter.from'));
      const to = screen.getByLabelText(en('analytics.filter.to'));
      const before = requests('handling-time').length;

      await userEvent.clear(from);
      await userEvent.type(from, '2026-04-10');
      // 2026-04-10 … 2026-03-31: not a range.
      expect(await screen.findByText(en('analytics.filter.invalidRange'))).toBeInTheDocument();
      expect(requests('handling-time')).toHaveLength(before);

      await userEvent.clear(to);
      await userEvent.type(to, '2026-04-20');
      await waitFor(() => expect(last('handling-time').get('to')).toBe('2026-04-20'));
      expect(last('handling-time').get('from')).toBe('2026-04-10');
      expect(screen.queryByText(en('analytics.filter.invalidRange'))).toBeNull();
    });

    it('narrows every figure to a sales rep', async () => {
      open();
      await within(card('analytics.handling.title')).findByText(/23[.,]5 days/);
      await userEvent.click(screen.getByRole('combobox', { name: en('analytics.filter.assignee') }));
      await userEvent.click(await screen.findByRole('option', { name: /Anna Nowak/ }));
      await waitFor(() => expect(last('rep-effectiveness').get('assignedAdminUserId')).toBe(ADMIN_ID));
      for (const figure of ['handling-time', 'time-in-status', 'top-opportunities', 'average-value'] as const) {
        expect(last(figure).get('assignedAdminUserId'), figure).toBe(ADMIN_ID);
      }
    });
  });

  describe('the states of a figure', () => {
    it('says it is loading until the figure arrives', async () => {
      let arrive: (value: unknown) => void = () => undefined;
      answers['handling-time'] = () => new Promise((resolve) => (arrive = resolve));
      open();
      const handling = await screen.findByRole('region', { name: en('analytics.handling.title') });
      expect(within(handling).getByRole('status')).toHaveTextContent(core('common.state.loading'));
      arrive({ data: HANDLING });
      expect(await within(handling).findByText(/23[.,]5 days/)).toBeInTheDocument();
    });

    it('says so when the range holds nothing, figure by figure', async () => {
      answers['handling-time'] = () =>
        Promise.resolve({
          data: {
            averageSeconds: null,
            closedCount: 0,
            byOutcome: {
              won: { averageSeconds: null, closedCount: 0 },
              lost: { averageSeconds: null, closedCount: 0 },
            },
          },
        });
      answers['time-in-status'] = () =>
        Promise.resolve({ data: STAYS.map((row) => ({ ...row, averageSeconds: null, sampleCount: 0 })) });
      answers['rep-effectiveness'] = () => Promise.resolve({ data: [] });
      answers['top-opportunities'] = () => Promise.resolve({ data: [] });
      answers['average-value'] = () => Promise.resolve({ data: [] });
      open();
      expect(await within(card('analytics.handling.title')).findByText(en('analytics.handling.empty'))).toBeInTheDocument();
      expect(await within(card('analytics.value.title')).findByText(en('analytics.value.empty'))).toBeInTheDocument();
      expect(await within(card('analytics.status.title')).findByText(en('analytics.status.empty'))).toBeInTheDocument();
      expect(await within(card('analytics.reps.title')).findByText(en('analytics.reps.empty'))).toBeInTheDocument();
      expect(await within(card('analytics.top.title')).findByText(en('analytics.top.empty'))).toBeInTheDocument();
      // Nothing to draw is no chart at all, not an empty one.
      expect(screen.queryByTestId('echart')).toBeNull();
    });

    it('shows a failed figure in the server\'s words, keeps the others, and tries again', async () => {
      let fail = true;
      answers['rep-effectiveness'] = () =>
        fail ? Promise.reject(refusal('The figures are not available right now.')) : Promise.resolve({ data: REPS });
      open();
      const reps = await screen.findByRole('region', { name: en('analytics.reps.title') });
      expect(await within(reps).findByText('The figures are not available right now.')).toBeInTheDocument();
      // The others are on screen all the same.
      expect(await within(card('analytics.handling.title')).findByText(/23[.,]5 days/)).toBeInTheDocument();

      fail = false;
      await userEvent.click(within(reps).getByRole('button', { name: core('common.action.retry') }));
      expect(await within(reps).findByRole('table', { name: en('analytics.reps.rankingCaption') })).toBeInTheDocument();
    });
  });
});
