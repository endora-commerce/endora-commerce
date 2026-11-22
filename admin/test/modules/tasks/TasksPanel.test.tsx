import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminZoneName } from '@endora-commerce/contracts';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { setMobileViewport } from '../../setup';
import { OTHER_TASK_ID, STATUS, TASK_ID, core, en, renderTasks, taskSummary } from './tasks-fixtures';

/**
 * The *Tasks* panel on the screens of the records a Task may be linked to
 * (`specs/165-task-management/` User Story 6 scenario 2, FR-032, T065;
 * `contracts/admin-surfaces.md` §3).
 *
 * `tasks` contributes one panel to three zones — an Order's, a Quote
 * Request's and an Opportunity's screen — at weight 660, behind `tasks:read`.
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
  { zone: 'opportunity.detail.sidebar', kind: 'opportunity', props: { opportunityId: RECORD_ID } },
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
    renderZone(ZONES[2], { permissions: ['tasks:read'] });
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
