import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskDetail as TaskDetailData } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { TASK_ID, core, en, historyEntry, historyPage, renderTasks, taskDetail, STATUS, workflow } from './tasks-fixtures';

/**
 * The Task screen's layout — issue #1524 (UX audit 2026-11-17, WORK-02) and,
 * on this screen, #1566 (WORK-19).
 *
 * The Opportunity's shape: **one main card** — the details, the custom fields
 * among them, and the sub-tasks; **one sidebar card** — where the Task belongs,
 * its linked records, its reminders, its related Tasks and the zone's panels;
 * **one tabbed card** — comments, attachments and history, the first two with
 * their counts. Three cards, not ten to twelve (Common Region, Prägnanz, Jakob).
 * The status is said once, in the title; the Details section offers only the
 * *Move to…* control (Occam, Signal-to-noise).
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { TaskDetail } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskDetail');

const TASK_PATH = `/api/v1/admin/tasks/${TASK_ID}`;
const WORKFLOW_PATH = '/api/v1/admin/tasks/workflow';
const PERMISSIONS = ['tasks:read', 'tasks:write', 'custom_fields:read'];

let current: TaskDetailData = taskDetail();

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  current = taskDetail({ commentsCount: 2, attachmentsCount: 1 });
  getSpy.mockImplementation((path: string) => {
    if (path === TASK_PATH) return Promise.resolve({ data: current });
    if (path === WORKFLOW_PATH) return Promise.resolve({ data: workflow() });
    if (path.startsWith(`${TASK_PATH}/history`)) return Promise.resolve(historyPage([historyEntry()]));
    if (path === `${TASK_PATH}/comments`) return Promise.resolve({ data: [] });
    if (path === `${TASK_PATH}/attachments`) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/custom-fields')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(path = `/tasks/${TASK_ID}`, permissions: readonly string[] = PERMISSIONS): Promise<HTMLElement> {
  const { container } = renderTasks(<TaskDetail />, { path, pattern: '/tasks/:id', permissions });
  await screen.findByRole('heading', { name: /Order the racking/ });
  return container;
}

/** The outermost cards of the screen: a card inside a card is not counted. */
function topLevelCards(container: HTMLElement): HTMLElement[] {
  const all = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="card"], .b2b-card'));
  return all.filter((card) => !all.some((other) => other !== card && other.contains(card)));
}

const tablist = (): HTMLElement => screen.getByRole('tablist', { name: en('detail.tabs') });

describe('TaskDetail — the layout (issue #1524)', () => {
  it('is three cards: the main one, the sidebar and the tabs', async () => {
    const container = await renderPage();
    await screen.findByText(en('comments.empty'));
    expect(topLevelCards(container)).toHaveLength(3);
  });

  it('puts the details and the sub-tasks in one card', async () => {
    await renderPage();
    const details = screen.getByRole('region', { name: en('detail.details') });
    const subtasks = screen.getByRole('region', { name: en('detail.subtasks') });
    const card = details.closest('[data-slot="card"]');
    expect(card).not.toBeNull();
    expect(card).toContainElement(subtasks);
  });

  it('puts the context, the linked records, the reminders and the related Tasks in the sidebar', async () => {
    await renderPage();
    const sidebar = screen.getByRole('complementary', { name: en('detail.sidebar') });
    for (const key of ['detail.context', 'detail.links', 'detail.reminders', 'detail.related']) {
      expect(within(sidebar).getByRole('region', { name: en(key) })).toBeTruthy();
    }
    // One card for all of them, as `OpportunitySidebar`.
    expect(sidebar.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
  });

  it('tabs the comments, the attachments and the history, the first two with their counts', async () => {
    await renderPage();
    const tabs = within(tablist()).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      `${en('detail.comments')} 2`,
      `${en('attachments.title')} 1`,
      en('detail.history'),
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAccessibleName(core('common.tabs.counted', { label: en('detail.comments'), count: 2 }));
    expect(await screen.findByText(en('comments.empty'))).toBeTruthy();
  });

  it('opens the history tab and keeps the choice in the address', async () => {
    await renderPage();
    await userEvent.click(within(tablist()).getByRole('tab', { name: en('detail.history') }));
    const panel = screen.getByRole('tabpanel', { name: en('detail.history') });
    expect(await within(panel).findByText(en('auditLog.tasks.task.create'))).toBeTruthy();
    expect(screen.queryByText(en('comments.empty'))).toBeNull();
  });

  it('opens on the tab the address names', async () => {
    await renderPage(`/tasks/${TASK_ID}?tab=attachments`);
    const panel = screen.getByRole('tabpanel', { name: /Attachments/ });
    expect(await within(panel).findByText(en('attachments.empty'))).toBeTruthy();
  });

  it('puts the custom fields in the Details section, not in a card of their own', async () => {
    const definitions = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        entityType: 'task',
        key: 'region',
        label: { en: 'Region' },
        labelDefault: 'Region',
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        options: [],
        listFilter: true,
        audience: 'internal',
        deletedAt: null,
      },
    ];
    current = { ...current, customFieldValues: { region: 'North' } };
    getSpy.mockImplementation((path: string) => {
      if (path === TASK_PATH) return Promise.resolve({ data: current });
      if (path === WORKFLOW_PATH) return Promise.resolve({ data: workflow() });
      if (path.startsWith(`${TASK_PATH}/history`)) return Promise.resolve(historyPage([]));
      if (path === `${TASK_PATH}/comments`) return Promise.resolve({ data: [] });
      if (path.startsWith('/api/v1/admin/custom-fields')) return Promise.resolve({ data: definitions });
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    await renderPage();
    const field = await screen.findByLabelText(/Region/);
    expect(screen.getByRole('region', { name: en('detail.details') })).toContainElement(field);
  });
});

describe('TaskDetail — the status is said once (issue #1566)', () => {
  it('names the status in the title only, and offers the Move to… menu in Details', async () => {
    await renderPage();
    expect(screen.getAllByText(STATUS.todo.name)).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(STATUS.todo.name);
    const move = screen.getByRole('button', { name: core('kanban.moveTo.label', { title: 'Order the racking' }) });
    expect(screen.getByRole('region', { name: en('detail.details') })).toContainElement(move);
    expect(screen.queryByRole('group', { name: en('field.status') })).toBeNull();
  });

  it('a reader sees the status once too', async () => {
    await renderPage(`/tasks/${TASK_ID}`, ['tasks:read']);
    await waitFor(() => expect(screen.getAllByText(STATUS.todo.name)).toHaveLength(1));
  });
});
