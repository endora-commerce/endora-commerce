import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatMoney } from '@endora-commerce/admin-kit/lib';
import { ADMIN_ID, ORGANIZATION_ID, REASON_PRICE, core, en, renderProjects, summary } from './projects-fixtures';

/**
 * Project analytics (`specs/163-projects-and-tasks/`, User Story 10 — task
 * T128; `contracts/admin-surfaces.md` §2): seven figures over a range of days,
 * narrowed by Template, Organization and Project Manager. Each figure says the
 * period and how many Projects it counted, and how many it left out for having
 * no value (FR-038); each chart sits above a table of the same numbers; money
 * is per currency.
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

/** ECharts draws on a canvas jsdom does not have: the chart is a marker carrying its option. */
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    EChart: (props: { option: unknown }) => <div data-testid="echart" data-option={JSON.stringify(props.option)} />,
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { AnalyticsPage } = await import('../../../../packages/modules/projects/src/admin/pages/AnalyticsPage');

const BASE = '/api/v1/admin/projects/analytics';
const TEMPLATE_ID = '00000000-0000-4000-8000-0000000007a1';
const COMPETITOR = '00000000-0000-4000-8000-000000000e12';
const TOP_ID = '00000000-0000-4000-8000-0000000000f9';

const FIGURES = ['summary', 'durations', 'time-in-stage', 'losses', 'value', 'top-open', 'managers'] as const;
type Figure = (typeof FIGURES)[number];

/** The zone the server says it counted in (issue #475); a test may move it. */
let reportingZone = 'UTC';

/** The envelope every figure answers in (FR-038), with the zone it was counted in (#475). */
const envelope = (data: unknown, projectCount: number, noValue = 0) => ({
  from: '2026-03-01',
  to: '2026-03-31',
  projectCount,
  excluded: { noValue },
  timeZone: reportingZone,
  data,
});

const DATA: Record<Figure, () => unknown> = {
  summary: () => envelope({ opened: 47, completed: 14, lost: 15, completionRate: 14 / 29 }, 49),
  durations: () => envelope({ completedAverageDays: 17.43, completedCount: 14, lostAverageDays: 9.87, lostCount: 15 }, 29),
  'time-in-stage': () =>
    envelope(
      [
        { stageName: 'Design', averageDays: 5.34, sampleCount: 47 },
        { stageName: 'Build', averageDays: 9.2, sampleCount: 20 },
        { stageName: 'Handover', averageDays: 1.8, sampleCount: 15 },
      ],
      47,
    ),
  losses: () =>
    envelope(
      {
        byStage: [
          { stageName: 'Design', count: 7, share: 7 / 15 },
          { stageName: 'Build', count: 5, share: 5 / 15 },
          { stageName: 'Handover', count: 3, share: 3 / 15 },
        ],
        byReason: [
          { lossReasonId: REASON_PRICE, code: 'price', name: 'Price', count: 8, share: 8 / 15 },
          { lossReasonId: COMPETITOR, code: 'competitor', name: 'Chose a competitor', count: 7, share: 7 / 15 },
        ],
        lostValue: [
          { currency: 'EUR', amount: '1500.00' },
          { currency: 'PLN', amount: '3000.00' },
        ],
      },
      15,
      5,
    ),
  value: () =>
    envelope(
      {
        average: [
          { currency: 'EUR', amount: '2678.57', count: 14 },
          { currency: 'PLN', amount: '8047.62', count: 21 },
        ],
      },
      47,
      12,
    ),
  'top-open': () =>
    envelope(
      [
        summary({ id: TOP_ID, number: 'PRJ-000041', title: 'Depot racking', value: { amount: '6400.00', currency: 'EUR' } }),
        summary({ number: 'PRJ-000031', title: 'Warehouse fit-out', value: { amount: '19000.00', currency: 'PLN' } }),
      ],
      20,
      5,
    ),
  managers: () =>
    envelope(
      [
        { adminUser: { id: ADMIN_ID, name: 'Anna Nowak' }, completedCount: 10 },
        { adminUser: { id: '00000000-0000-4000-8000-000000000c02', name: 'Piotr Zielony' }, completedCount: 7 },
      ],
      14,
    ),
};

let answers: Record<Figure, () => Promise<unknown>>;

const figureOf = (path: string): Figure | null =>
  path.startsWith(`${BASE}/`) ? (path.slice(BASE.length + 1).split('?')[0] as Figure) : null;

function requests(figure: Figure): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([path]) => String(path))
    .filter((path) => figureOf(path) === figure)
    .map((path) => new URLSearchParams(path.split('?')[1] ?? ''));
}
const last = (figure: Figure): URLSearchParams => requests(figure).at(-1) as URLSearchParams;

/** The formatter separates with no-break spaces; `toHaveTextContent` folds them, so fold the expectation too. */
const money = (amount: number, currency: string): string => formatMoney(amount, currency).replace(/\s+/g, ' ');

beforeEach(() => {
  getSpy.mockReset();
  reportingZone = 'UTC';
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  answers = Object.fromEntries(FIGURES.map((figure) => [figure, () => Promise.resolve(DATA[figure]())])) as Record<
    Figure,
    () => Promise<unknown>
  >;
  getSpy.mockImplementation((path: string) => {
    const figure = figureOf(path);
    if (figure) return answers[figure]();
    if (path === '/api/v1/admin/projects/templates') {
      return Promise.resolve({
        data: [{ id: TEMPLATE_ID, name: 'Showroom fit-out', stageCount: 3, archivedAt: null, updatedAt: '2026-03-01T10:00:00.000Z' }],
      });
    }
    if (path.startsWith('/api/v1/admin/projects/lookups/organizations')) {
      return Promise.resolve({ data: [{ id: ORGANIZATION_ID, name: 'Acme' }] });
    }
    if (path.startsWith('/api/v1/admin/projects/lookups/admin-users')) {
      return Promise.resolve({ data: [{ id: ADMIN_ID, name: 'Anna Nowak', email: 'anna@example.com' }] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const ANALYST = ['projects:read', 'projects:analytics'];

function open(): void {
  renderProjects(<AnalyticsPage />, { path: '/projects/analytics', pattern: '/projects/analytics', permissions: ANALYST });
}

const card = (titleKey: string): HTMLElement => screen.getByRole('region', { name: en(titleKey) });

async function loaded(): Promise<void> {
  await within(card('analytics.summary.title')).findByText('47');
}

describe('the Project analytics screen', () => {
  it('asks for every figure of the current month, once each', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: en('analytics.title') })).toBeInTheDocument();
    await loaded();
    for (const figure of FIGURES) {
      expect(requests(figure), figure).toHaveLength(1);
      expect(last(figure).get('from'), figure).toBe('2026-03-01');
      expect(last(figure).get('to'), figure).toBe('2026-03-31');
      for (const filter of ['templateId', 'organizationId', 'projectManagerId']) expect(last(figure).has(filter)).toBe(false);
    }
  });

  it('shows opened, completed, lost and the completion rate, with the period and the count it is over', async () => {
    open();
    await loaded();
    const summary = card('analytics.summary.title');
    const stat = (key: string) => within(summary).getByText(en(key)).closest('div') as HTMLElement;
    expect(stat('analytics.summary.opened')).toHaveTextContent('47');
    expect(stat('analytics.summary.completed')).toHaveTextContent('14');
    expect(stat('analytics.summary.lost')).toHaveTextContent('15');
    expect(stat('analytics.summary.rate')).toHaveTextContent('48%');
    expect(summary).toHaveTextContent(en('analytics.basis', { from: 'Mar 1, 2026', to: 'Mar 31, 2026', count: 49 }));
  });

  it('shows the average duration of completed and of lost Projects', async () => {
    open();
    const durations = card('analytics.durations.title');
    const completed = (await within(durations).findByText(en('analytics.durations.completed'))).closest('div') as HTMLElement;
    expect(completed).toHaveTextContent(/17[.,]4 days/);
    expect(completed).toHaveTextContent(en('analytics.count.projects', { count: 14 }));
    const lost = within(durations).getByText(en('analytics.durations.lost')).closest('div') as HTMLElement;
    expect(lost).toHaveTextContent(/9[.,]9 days/);
    expect(lost).toHaveTextContent(en('analytics.count.projects', { count: 15 }));
  });

  it('draws the time in each Stage and says the same in a table', async () => {
    open();
    const stages = card('analytics.stages.title');
    const table = await within(stages).findByRole('table', { name: en('analytics.stages.title') });
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement;
    expect(row('Design')).toHaveTextContent(/5[.,]3 days/);
    expect(row('Design')).toHaveTextContent('47');
    expect(row('Handover')).toHaveTextContent(/1[.,]8 days/);
    const chart = within(stages).getByTestId('echart');
    expect(chart.closest('[aria-hidden="true"]')).not.toBeNull();
    const option = JSON.parse(chart.getAttribute('data-option') ?? '{}') as {
      yAxis: { data: string[] };
      series: Array<{ data: number[] }>;
    };
    expect(option.yAxis.data).toEqual(['Design', 'Build', 'Handover']);
    expect(option.series[0]?.data).toEqual([5.34, 9.2, 1.8]);
  });

  it('ranks where Projects are lost, with each Stage’s share, drawn and in a table', async () => {
    open();
    const losses = card('analytics.lossStages.title');
    const table = await within(losses).findByRole('table', { name: en('analytics.lossStages.title') });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/Design.*7.*47%/),
      expect.stringMatching(/Build.*5.*33%/),
      expect.stringMatching(/Handover.*3.*20%/),
    ]);
    const option = JSON.parse(within(losses).getByTestId('echart').getAttribute('data-option') ?? '{}') as {
      yAxis: { data: string[] };
      series: Array<{ data: number[] }>;
    };
    expect(option.yAxis.data).toEqual(['Design', 'Build', 'Handover']);
    expect(option.series[0]?.data).toEqual([7, 5, 3]);
    expect(losses).toHaveTextContent(en('analytics.basis', { from: 'Mar 1, 2026', to: 'Mar 31, 2026', count: 15 }));
  });

  it('lists the loss reasons, and the value lost per currency with the Projects it could not count', async () => {
    open();
    const reasons = card('analytics.lossReasons.title');
    const price = (await within(reasons).findByText('Price')).closest('tr') as HTMLElement;
    expect(price).toHaveTextContent(/8.*53%/);
    expect(within(reasons).getByText('Chose a competitor').closest('tr')).toHaveTextContent(/7.*47%/);

    const lostValue = card('analytics.lostValue.title');
    expect(within(lostValue).getByText('EUR').closest('tr')).toHaveTextContent(money(1500, 'EUR'));
    expect(within(lostValue).getByText('PLN').closest('tr')).toHaveTextContent(money(3000, 'PLN'));
    expect(lostValue).toHaveTextContent(en('analytics.excluded', { count: 5 }));
    // 1500 + 3000 — a sum across currencies is not a number.
    expect(lostValue).not.toHaveTextContent(/4[\s ,.]?500/);
  });

  it('shows the average value per currency and never one figure for both', async () => {
    open();
    const value = card('analytics.value.title');
    const eur = (await within(value).findByText('EUR')).closest('tr') as HTMLElement;
    expect(eur).toHaveTextContent(money(2678.57, 'EUR'));
    expect(eur).toHaveTextContent('14');
    expect(within(value).getByText('PLN').closest('tr')).toHaveTextContent(money(8047.62, 'PLN'));
    expect(value).toHaveTextContent(en('analytics.excluded', { count: 12 }));
  });

  it('lists the most valuable open Projects per currency, each a link to the Project', async () => {
    open();
    const top = card('analytics.top.title');
    const eur = await within(top).findByRole('table', { name: en('analytics.top.caption', { currency: 'EUR' }) });
    const link = within(eur).getByRole('link', { name: /PRJ-000041/ });
    expect(link).toHaveAttribute('href', `/projects/${TOP_ID}`);
    expect(within(eur).getAllByRole('row')[1]).toHaveTextContent(money(6400, 'EUR'));
    const pln = within(top).getByRole('table', { name: en('analytics.top.caption', { currency: 'PLN' }) });
    expect(within(pln).getAllByRole('row')[1]).toHaveTextContent('Warehouse fit-out');
  });

  it('ranks the Project Managers by completed Projects', async () => {
    open();
    const managers = card('analytics.managers.title');
    const table = await within(managers).findByRole('table', { name: en('analytics.managers.title') });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/Anna Nowak.*10/),
      expect.stringMatching(/Piotr Zielony.*7/),
    ]);
  });

  describe('the filters', () => {
    it('narrows every figure to a Template', async () => {
      open();
      await loaded();
      const template = screen.getByLabelText(en('analytics.filter.template'));
      await within(template).findByRole('option', { name: 'Showroom fit-out' });
      await userEvent.selectOptions(template, TEMPLATE_ID);
      await waitFor(() => expect(last('managers').get('templateId')).toBe(TEMPLATE_ID));
      for (const figure of FIGURES) expect(last(figure).get('templateId'), figure).toBe(TEMPLATE_ID);
    });

    it('narrows every figure to an Organization and to a Project Manager', async () => {
      open();
      await loaded();
      await userEvent.click(screen.getByRole('combobox', { name: en('analytics.filter.organization') }));
      await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));
      await waitFor(() => expect(last('summary').get('organizationId')).toBe(ORGANIZATION_ID));

      await userEvent.click(screen.getByRole('combobox', { name: en('analytics.filter.manager') }));
      await userEvent.click(await screen.findByRole('option', { name: /Anna Nowak/ }));
      await waitFor(() => expect(last('losses').get('projectManagerId')).toBe(ADMIN_ID));
      for (const figure of FIGURES) {
        expect(last(figure).get('organizationId'), figure).toBe(ORGANIZATION_ID);
        expect(last(figure).get('projectManagerId'), figure).toBe(ADMIN_ID);
      }
    });

    it('recomputes every figure for another range, and asks nothing while the range ends before it begins', async () => {
      open();
      await loaded();
      await userEvent.selectOptions(
        screen.getByLabelText(en('analytics.filter.range')),
        en('analytics.filter.range.lastMonth'),
      );
      await waitFor(() => expect(last('value').get('from')).toBe('2026-02-01'));
      for (const figure of FIGURES) expect(last(figure).get('to'), figure).toBe('2026-02-28');

      const before = requests('summary').length;
      const from = screen.getByLabelText(en('analytics.filter.from'));
      await userEvent.clear(from);
      await userEvent.type(from, '2026-04-10');
      expect(await screen.findByText(en('analytics.filter.invalidRange'))).toBeInTheDocument();
      expect(requests('summary')).toHaveLength(before);
    });
  });

  describe('the states of a figure', () => {
    it('says a failed figure failed, and asks again on request, leaving the others shown', async () => {
      let fail = true;
      answers.durations = () =>
        fail
          ? Promise.reject(new ApiError(500, { error: { code: 'INTERNAL', message: 'The database is away.' } }))
          : Promise.resolve(DATA.durations());
      open();
      const durations = card('analytics.durations.title');
      expect(await within(durations).findByText('The database is away.')).toBeInTheDocument();
      expect(within(card('analytics.summary.title')).getByText('47')).toBeInTheDocument();
      fail = false;
      await userEvent.click(within(durations).getByRole('button', { name: core('common.action.retry') }));
      expect(await within(durations).findByText(/17[.,]4 days/)).toBeInTheDocument();
    });

    it('says so when the range holds nothing, figure by figure', async () => {
      answers.summary = () => Promise.resolve(envelope({ opened: 0, completed: 0, lost: 0, completionRate: null }, 0));
      answers.losses = () => Promise.resolve(envelope({ byStage: [], byReason: [], lostValue: [] }, 0));
      answers['top-open'] = () => Promise.resolve(envelope([], 0));
      open();
      expect(await within(card('analytics.summary.title')).findByText(en('analytics.summary.empty'))).toBeInTheDocument();
      expect(within(card('analytics.lossStages.title')).getByText(en('analytics.losses.empty'))).toBeInTheDocument();
      expect(within(card('analytics.lossReasons.title')).getByText(en('analytics.losses.empty'))).toBeInTheDocument();
      expect(within(card('analytics.lostValue.title')).getByText(en('analytics.lostValue.empty'))).toBeInTheDocument();
      expect(within(card('analytics.top.title')).getByText(en('analytics.top.empty'))).toBeInTheDocument();
    });
  });

  describe('the reporting time zone (#475)', () => {
    it('names the zone the figures are counted in', async () => {
      reportingZone = 'Europe/Warsaw';
      open();
      await loaded();
      expect(screen.getByText(en('analytics.timeZone', { zone: 'Europe/Warsaw' }))).toBeInTheDocument();
    });

    it('takes a preset’s days from that zone, not from the computer', async () => {
      // 12:00 UTC on 31 March is already 1 April in Kiritimati (UTC+14) — on no computer this runs on.
      vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'));
      reportingZone = 'Pacific/Kiritimati';
      open();
      await waitFor(() => expect(last('summary').get('from')).toBe('2026-04-01'));
      await waitFor(() => {
        for (const figure of FIGURES) {
          expect(last(figure).get('from'), figure).toBe('2026-04-01');
          expect(last(figure).get('to'), figure).toBe('2026-04-30');
        }
      });
      await userEvent.selectOptions(
        screen.getByLabelText(en('analytics.filter.range')),
        en('analytics.filter.range.lastMonth'),
      );
      await waitFor(() => expect(last('summary').get('from')).toBe('2026-03-01'));
      expect(last('summary').get('to')).toBe('2026-03-31');
    });
  });
});
