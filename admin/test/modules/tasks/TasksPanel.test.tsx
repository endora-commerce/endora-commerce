import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { AdminZoneName } from '@endora-commerce/contracts';
import { AdminZone, useRecordTabZone } from '@endora-commerce/admin-kit/zones';
import { setMobileViewport } from '../../setup';
import { OTHER_TASK_ID, STATUS, TASK_ID, core, en, renderTasks, taskSummary } from './tasks-fixtures';

/**
 * The *Tasks* panel on the screens of the records a Task may be linked to
 * (`specs/165-task-management/` User Story 6 scenario 2, FR-032, T065;
 * `contracts/admin-surfaces.md` §3).
 *
 * `tasks` contributes one panel to two sidebar zones — an Order's and a Quote
 * Request's screen — at weight 660, behind `tasks:read`, and the same list as
 * a *Tasks* tab of an Opportunity (`specs/183-record-tab-contributions/`,
 * FR-012–FR-014), whose count is the open Tasks.
 * It lists the Tasks linked to the record that the reader may see
 * (`GET /tasks?linkedKind=&linkedId=`), each with its status, assignees and
 * due date, and offers a writer *Add task*, which opens the create form with
 * the link filled in (`/tasks/new?link=<kind>:<id>`). The zone renderer
 * leaves it out — before its chunk loads — while `tasks` is off or for a
 * reader without `tasks:read`; the record's own screen names no contributor.
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

const tasks = await import('@endora-commerce/mod-tasks/admin');
const REGISTRY = [{ moduleId: 'tasks', contributions: tasks.contributions }];
const RECORD_ID = '00000000-0000-4000-8000-0000000000c7';

const ZONES = [
  { zone: 'order.detail.sidebar', kind: 'order', props: { orderId: RECORD_ID } },
  { zone: 'quote_request.detail.sidebar', kind: 'quote_request', props: { quoteRequestId: RECORD_ID } },
] as const;

const linked = [
  taskSummary({ id: TASK_ID, number: 'TSK-000001', title: 'Call the buyer', dueOn: '2026-11-05', overdue: true }),
  taskSummary({
    id: OTHER_TASK_ID,
    number: 'TSK-000002',
    title: 'Book the crane',
    status: STATUS.in_progress,
    assignees: [],
    dueOn: null,
    context: null,
  }),
];

let answer: () => Promise<unknown>;

function renderZone(
  entry: (typeof ZONES)[number],
  options: { permissions?: readonly string[]; present?: readonly string[] } = {},
): HTMLElement {
  cleanup();
  const { container } = renderTasks(<AdminZone name={entry.zone as AdminZoneName} props={entry.props as never} />, {
    path: RECORD_SCREEN,
    permissions: options.permissions ?? ['tasks:read', 'tasks:write'],
    present: options.present ?? ['tasks'],
    contributions: REGISTRY,
  });
  return container;
}

/** The record screen the panel is drawn on; its links lead back here (`?returnTo=`, #512). */
const RECORD_SCREEN = `/records/${RECORD_ID}?tab=tasks`;
const BACK_HERE = new URLSearchParams({ returnTo: RECORD_SCREEN }).toString();

const listPath = (kind: string): string =>
  `/api/v1/admin/tasks?linkedKind=${kind}&linkedId=${RECORD_ID}&limit=20`;

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  answer = () => Promise.resolve({ items: linked, nextCursor: null });
  getSpy.mockImplementation((path: string) =>
    path.startsWith('/api/v1/admin/tasks?') ? answer() : Promise.reject(new Error(`unexpected GET ${path}`)),
  );
});

describe('tasks contributes the Tasks panel', () => {
  it('declares one contribution per record screen, at weight 660, on tasks:read, behind a dynamic import', () => {
    for (const { zone } of ZONES) {
      const found = (tasks.contributions.zones ?? []).filter((entry) => entry.zone === zone);
      expect(found, zone).toHaveLength(1);
      expect(found[0]?.weight).toBe(660);
      expect(found[0]?.requiredPermission).toBe('tasks:read');
      expect(typeof found[0]?.component).toBe('function');
    }
  });

  for (const entry of ZONES) {
    it(`${entry.zone}: lists the linked Tasks with status, assignees and due date, and offers Add task`, async () => {
      renderZone(entry);
      const heading = await screen.findByRole('heading', { name: en('panel.title') });
      const panel = heading.closest('section') as HTMLElement;
      const first = await within(panel).findByRole('link', { name: /TSK-000001/ });
      expect(first).toHaveAttribute('href', `/tasks/${TASK_ID}?${BACK_HERE}`);
      expect(within(panel).getByText('Call the buyer')).toBeInTheDocument();
      expect(within(panel).getByRole('link', { name: /TSK-000002/ })).toHaveAttribute('href', `/tasks/${OTHER_TASK_ID}?${BACK_HERE}`);
      expect(within(panel).getByText(STATUS.in_progress.name)).toBeInTheDocument();
      expect(within(panel).getByText('Anna Nowak')).toBeInTheDocument();
      expect(within(panel).getByText(en('list.unassigned'))).toBeInTheDocument();
      expect(within(panel).getByText(new RegExp(new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(2026, 10, 5))))).toBeInTheDocument();
      expect(within(panel).getByText(new RegExp(en('list.overdue')))).toBeInTheDocument();
      expect(within(panel).getByRole('link', { name: en('panel.add') })).toHaveAttribute(
        'href',
        `/tasks/new?link=${encodeURIComponent(`${entry.kind}:${RECORD_ID}`)}&${BACK_HERE}`,
      );
      expect(within(panel).getByRole('link', { name: en('panel.all') })).toHaveAttribute(
        'href',
        `/tasks?linkedKind=${entry.kind}&linkedId=${RECORD_ID}`,
      );
      expect(getSpy).toHaveBeenCalledWith(listPath(entry.kind));
    });
  }

  it('says when no Task is linked, and still offers Add task', async () => {
    answer = () => Promise.resolve({ items: [], nextCursor: null });
    renderZone(ZONES[0]);
    expect(await screen.findByText(en('panel.empty'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en('panel.add') })).toBeInTheDocument();
  });

  it('offers no Add task to a reader without tasks:write', async () => {
    renderZone(ZONES[1], { permissions: ['tasks:read'] });
    expect(await screen.findByRole('link', { name: /TSK-000001/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en('panel.add') })).toBeNull();
  });

  it('says so in its own card when the Tasks cannot be read', async () => {
    answer = () => Promise.reject(new Error('offline'));
    renderZone(ZONES[1]);
    expect(await screen.findByText(en('panel.error'))).toBeInTheDocument();
    // And offers to read again (T092).
    answer = () => Promise.resolve({ items: [taskSummary()], nextCursor: null });
    await userEvent.click(screen.getByRole('button', { name: core('common.action.retry') }));
    expect(await screen.findByRole('link', { name: /Order the racking/ })).toBeInTheDocument();
    expect(screen.queryByText(en('panel.error'))).toBeNull();
  });

  it('is not there — and asks nothing — while tasks is off, or for a reader without tasks:read', async () => {
    const off = renderZone(ZONES[0], { present: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(off.innerHTML).toBe('');
    const refused = renderZone(ZONES[0], { permissions: ['orders:read'] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refused.innerHTML).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
    // The control: the same panel, present and permitted, does ask.
    renderZone(ZONES[0]);
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(listPath('order')));
  });
});

/** The Opportunity screen's strip, reduced to what the zone hands it: the tabs and the selected panel. */
function TabHost({ active }: { active: string }): ReactNode {
  const zone = useRecordTabZone('opportunity.detail.tabs', { opportunityId: RECORD_ID }, { reservedIds: ['overview'] });
  return (
    <>
      <ul aria-label="strip">
        {zone.tabs.map((tab) => (
          <li key={tab.id} data-count={String(tab.count)}>{`${tab.id}|${tab.label}|${tab.countLabel ?? ''}`}</li>
        ))}
      </ul>
      <div data-testid="panel">{zone.renderPanel(active)}</div>
    </>
  );
}

const countPath = `/api/v1/admin/tasks/count?linkedKind=opportunity&linkedId=${RECORD_ID}&statusCategory=open`;
const tabListPath = `/api/v1/admin/tasks?linkedKind=opportunity&linkedId=${RECORD_ID}&limit=50`;

function renderTab(options: { permissions?: readonly string[]; present?: readonly string[]; active?: string } = {}): HTMLElement {
  cleanup();
  const { container } = renderTasks(<TabHost active={options.active ?? 'tasks'} />, {
    path: RECORD_SCREEN,
    permissions: options.permissions ?? ['tasks:read', 'tasks:write'],
    present: options.present ?? ['tasks'],
    contributions: REGISTRY,
  });
  return container;
}

describe('tasks contributes a Tasks tab to an Opportunity', () => {
  beforeEach(() => {
    getSpy.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/tasks/count?')) return Promise.resolve({ data: { count: 3 } });
      if (path.startsWith('/api/v1/admin/tasks?')) return answer();
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
  });

  it('labels the tab "Tasks" and counts the open Tasks, read once with the record and a signal (FR-013)', async () => {
    renderTab({ active: 'none' });
    const tab = (): string => within(screen.getByRole('list', { name: 'strip' })).getByRole('listitem').textContent ?? '';
    expect(tab()).toBe(`tasks|${en('recordTab.label')}|`);
    await waitFor(() => expect(tab()).toBe(`tasks|${en('recordTab.label')}|${en('recordTab.countLabel', { label: en('recordTab.label'), count: 3 })}`));
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(countPath, { signal: expect.any(AbortSignal) });
  });

  it('lists the linked Tasks without a second heading, offers Add task back to ?tab=tasks, and links the full list (FR-014)', async () => {
    renderTab();
    const panel = screen.getByTestId('panel');
    const first = await within(panel).findByRole('link', { name: /TSK-000001/ });
    expect(first).toHaveAttribute('href', `/tasks/${TASK_ID}?${BACK_HERE}`);
    expect(within(panel).getByText(STATUS.in_progress.name)).toBeInTheDocument();
    expect(within(panel).getByText('Anna Nowak')).toBeInTheDocument();
    // The tab names the panel; the panel does not repeat it.
    expect(within(panel).queryByRole('heading')).toBeNull();
    expect(within(panel).getByRole('link', { name: en('panel.add') })).toHaveAttribute(
      'href',
      `/tasks/new?link=${encodeURIComponent(`opportunity:${RECORD_ID}`)}&${BACK_HERE}`,
    );
    expect(BACK_HERE).toContain(encodeURIComponent('?tab=tasks'));
    expect(within(panel).getByRole('link', { name: en('panel.all') })).toHaveAttribute(
      'href',
      `/tasks?linkedKind=opportunity&linkedId=${RECORD_ID}`,
    );
    expect(getSpy).toHaveBeenCalledWith(tabListPath);
  });

  it('shows the empty state with Add task when no Task is linked', async () => {
    answer = () => Promise.resolve({ items: [], nextCursor: null });
    renderTab();
    expect(await screen.findByText(en('panel.empty'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en('panel.add') })).toBeInTheDocument();
  });

  it('is not there — and asks nothing — while tasks is off, or for a reader without tasks:read (FR-015)', async () => {
    for (const hidden of [{ present: [] }, { permissions: ['crm:read'] }]) {
      renderTab(hidden);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(within(screen.getByRole('list', { name: 'strip' })).queryAllByRole('listitem')).toHaveLength(0);
      expect(screen.getByTestId('panel')).toBeEmptyDOMElement();
    }
    expect(getSpy).not.toHaveBeenCalled();
  });
});
