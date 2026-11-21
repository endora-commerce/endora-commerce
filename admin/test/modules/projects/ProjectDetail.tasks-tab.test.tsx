import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectDetail, ProjectTasksResponse, TaskSummary } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  EVERY_PROJECTS_PERMISSION,
  PROJECT_ID,
  ROLES,
  ROLE_MANAGER,
  STAGE_BUILD,
  STAGE_DESIGN,
  STAGE_HANDOVER,
  detail,
  en,
  renderProjects,
  stage,
} from './projects-fixtures';

/**
 * A Project's Tasks (`specs/163-projects-and-tasks/`, User Story 2 — tasks T064
 * and T071; `contracts/admin-surfaces.md` §2 and §7).
 *
 * **Everything here exists only while the Tasks module does**: the *Tasks* tab
 * (by Stage, with a quick-add into each Stage), the Stage Task definitions of
 * the Stages editor, and the open Tasks a closed completion gate names on the
 * Stage bar. With `tasks` off — or for an operator who may not read Tasks — the
 * tab is not offered, an address naming it opens *Overview*, and the editor has
 * no Task section; Stage Task definitions stay stored and come back with it.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

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
      post: (...args: unknown[]) => postSpy(...args),
      put: (...args: unknown[]) => putSpy(...args),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { ProjectDetail: ProjectDetailPage } = await import(
  '../../../../packages/modules/projects/src/admin/pages/ProjectDetail'
);

const DETAIL_PATH = `/api/v1/admin/projects/${PROJECT_ID}`;
const TASKS_PRESENT = ['projects', 'organizations', 'admin_users', 'tasks'];
const TASKS_PERMISSIONS = [...EVERY_PROJECTS_PERMISSION, 'tasks:read', 'tasks:write'];

const TASK: TaskSummary = {
  id: '00000000-0000-4000-8000-0000000007a1',
  number: 'TSK-000001',
  title: 'Approve the drawings',
  status: { code: 'in_progress', name: 'In progress', color: '#f59e0b', category: 'open' },
  closed: false,
  dueOn: '2026-10-30',
  dueAt: null,
  overdue: false,
  assignees: [{ id: '00000000-0000-4000-8000-000000000c01', name: 'Anna Nowak', active: true }],
  priority: null,
  tags: [],
  context: {
    type: 'project',
    available: true,
    label: 'PRJ-000001 Warehouse fit-out',
    href: `/projects/${PROJECT_ID}`,
    groupLabel: 'Design',
  },
  parent: null,
  subtasks: { closed: 0, total: 0 },
  draft: false,
  private: false,
  createdAt: '2026-10-20T08:00:00.000Z',
  updatedAt: '2026-10-20T08:00:00.000Z',
};

let current: ProjectDetail = detail();
let tasks: ProjectTasksResponse = {
  tasksAvailable: true,
  stages: [
    { stageId: STAGE_DESIGN, tasks: [TASK] },
    { stageId: STAGE_BUILD, tasks: [] },
    { stageId: STAGE_HANDOVER, tasks: [] },
  ],
};

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = detail();
  tasks = {
    tasksAvailable: true,
    stages: [
      { stageId: STAGE_DESIGN, tasks: [TASK] },
      { stageId: STAGE_BUILD, tasks: [] },
      { stageId: STAGE_HANDOVER, tasks: [] },
    ],
  };
  getSpy.mockImplementation((path: string) => {
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === `${DETAIL_PATH}/tasks`) return Promise.resolve({ data: tasks });
    if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ROLES });
    if (path === `${DETAIL_PATH}/stage-history`) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(
  options: { permissions?: readonly string[]; present?: readonly string[]; search?: string } = {},
): Promise<void> {
  renderProjects(<ProjectDetailPage />, {
    path: `/projects/${PROJECT_ID}${options.search ?? ''}`,
    pattern: '/projects/:id',
    permissions: options.permissions ?? TASKS_PERMISSIONS,
    present: options.present ?? TASKS_PRESENT,
  });
  await screen.findByRole('heading', { name: /Warehouse fit-out/ });
}

const tabNames = (): string[] => screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
const stageSection = (panel: HTMLElement, name: string): HTMLElement =>
  within(panel).getByRole('region', { name: new RegExp(`^${name}`) });

describe('ProjectDetail — the Tasks tab', () => {
  it('is offered while Tasks is on and the operator may read Tasks', async () => {
    await renderPage();
    expect(tabNames()).toContain(en('tabs.tasks'));
  });

  it('is absent while the Tasks module is off, and its address opens Overview', async () => {
    await renderPage({ present: ['projects', 'organizations', 'admin_users'], search: '?tab=tasks' });
    expect(tabNames()).not.toContain(en('tabs.tasks'));
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('Racking and lighting for the new hall.')).toBeTruthy();
    expect(getSpy.mock.calls.some(([path]) => path === `${DETAIL_PATH}/tasks`)).toBe(false);
  });

  it('is absent for an operator who may not read Tasks', async () => {
    await renderPage({ permissions: EVERY_PROJECTS_PERMISSION });
    expect(tabNames()).not.toContain(en('tabs.tasks'));
  });

  it("lists the Tasks under each Stage, each linked to its screen", async () => {
    await renderPage({ search: '?tab=tasks' });
    const panel = await screen.findByRole('tabpanel');
    const design = await waitFor(() => stageSection(panel, 'Design'));
    const link = within(design).getByRole('link', { name: 'TSK-000001' });
    expect(link.getAttribute('href')).toBe(`/tasks/${TASK.id}`);
    expect(within(design).getByText('Approve the drawings')).toBeTruthy();
    // The status is the Tasks workflow's own name, served with the Task (165 R-1).
    expect(within(design).getByText('In progress')).toBeTruthy();
    expect(within(design).getByText('Anna Nowak')).toBeTruthy();
    expect(within(stageSection(panel, 'Build')).getByText(en('tasks.empty'))).toBeTruthy();
  });

  it('says so when the server answers that Tasks are not available', async () => {
    tasks = { tasksAvailable: false, stages: [] };
    await renderPage({ search: '?tab=tasks' });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText(en('tasks.unavailable'))).toBeTruthy();
  });

  it('adds a Task into a Stage with the Project as its context', async () => {
    postSpy.mockResolvedValue({ data: { ...TASK, id: '00000000-0000-4000-8000-0000000007a9', number: 'TSK-000009' } });
    await renderPage({ search: '?tab=tasks' });
    const panel = await screen.findByRole('tabpanel');
    const build = await waitFor(() => stageSection(panel, 'Build'));
    await userEvent.type(within(build).getByLabelText(en('tasks.quickAdd.label', { stage: 'Build' })), 'Book the crane');
    await userEvent.click(within(build).getByRole('button', { name: en('tasks.quickAdd.submitTo', { stage: 'Build' }) }));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/tasks', {
      title: 'Book the crane',
      context: { contextType: 'project', contextId: PROJECT_ID, contextGroupId: STAGE_BUILD },
    });
    await waitFor(() =>
      expect(getSpy.mock.calls.filter(([path]) => path === `${DETAIL_PATH}/tasks`).length).toBe(2),
    );
  });

  it('sends nothing without a title', async () => {
    await renderPage({ search: '?tab=tasks' });
    const panel = await screen.findByRole('tabpanel');
    const build = await waitFor(() => stageSection(panel, 'Build'));
    await userEvent.click(within(build).getByRole('button', { name: en('tasks.quickAdd.submitTo', { stage: 'Build' }) }));
    expect(within(build).getByText(en('tasks.quickAdd.titleRequired'))).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('offers no quick-add to an operator who may not write Tasks', async () => {
    await renderPage({ permissions: [...EVERY_PROJECTS_PERMISSION, 'tasks:read'], search: '?tab=tasks' });
    const panel = await screen.findByRole('tabpanel');
    await waitFor(() => stageSection(panel, 'Design'));
    expect(within(panel).queryByRole('button', { name: en('tasks.quickAdd.submitTo', { stage: 'Build' }) })).toBeNull();
  });

  it('offers no quick-add to an operator who may write Tasks but not this Project (T147, #472)', async () => {
    current = detail({ permissions: { canWrite: false, canConfigure: false } });
    await renderPage({ search: '?tab=tasks' });
    const panel = await screen.findByRole('tabpanel');
    await waitFor(() => stageSection(panel, 'Design'));
    expect(within(panel).queryByRole('button', { name: en('tasks.quickAdd.submitTo', { stage: 'Build' }) })).toBeNull();
  });
});

describe('ProjectDetail — Stage Task definitions on the Stages tab', () => {
  it('saves the Tasks a Stage creates on entry, the whole list at once', async () => {
    putSpy.mockResolvedValue({ data: stage({ id: STAGE_BUILD, name: 'Build', position: 1 }) });
    await renderPage({ search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    await userEvent.click(await within(panel).findByRole('button', { name: en('editor.edit', { position: 2 }) }));
    const section = await within(panel).findByRole('group', { name: en('stageTasks.heading', { position: 2 }) });
    await userEvent.click(within(section).getByRole('button', { name: en('stageTasks.add') }));
    await userEvent.type(within(section).getByLabelText(en('stageTasks.title', { index: 1, position: 2 })), 'Book the crane');
    const offset = within(section).getByLabelText(en('stageTasks.offset', { index: 1, position: 2 }));
    await userEvent.clear(offset);
    await userEvent.type(offset, '3');
    await userEvent.selectOptions(within(section).getByLabelText(en('stageTasks.role', { index: 1, position: 2 })), ROLE_MANAGER);
    // The Stage's one Save writes its tasks too; nothing else changed, so nothing else is sent.
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.save', { position: 2 }) }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).not.toHaveBeenCalled();
    expect(putSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/stages/${STAGE_BUILD}/tasks`, {
      tasks: [{ title: 'Book the crane', dueOffsetDays: 3, responsibleRoleId: ROLE_MANAGER }],
      // The Stage's version as read (issue #449).
      version: 1,
    });
  });

  it('a Stage edit names the Stage version it was read at, and a 409 re-reads the Project (issue #449)', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'PROJECT_CHANGED', message: 'The project changed since it was read. Reload it and try again.' },
      }),
    );
    await renderPage({ search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    await userEvent.click(await within(panel).findByRole('button', { name: en('editor.edit', { position: 2 }) }));
    const name = await within(panel).findByLabelText(en('stage.name', { position: 2 }));
    await userEvent.clear(name);
    await userEvent.type(name, 'Assembly');
    const reads = getSpy.mock.calls.filter(([path]) => path === DETAIL_PATH).length;
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.save', { position: 2 }) }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/stages/${STAGE_BUILD}`, { name: 'Assembly', version: 1 });
    expect(await screen.findByText('The project changed since it was read. Reload it and try again.')).toBeTruthy();
    await waitFor(() => expect(getSpy.mock.calls.filter(([path]) => path === DETAIL_PATH).length).toBe(reads + 1));
  });

  it('reordering the Stages names the Project’s configurationVersion as read (issue #449)', async () => {
    putSpy.mockResolvedValue({ data: current });
    await renderPage({ search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    await userEvent.click(await within(panel).findByRole('button', { name: en('stage.moveDown', { position: 1 }) }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/stages/order`, {
      stageIds: [STAGE_BUILD, STAGE_DESIGN, STAGE_HANDOVER],
      configurationVersion: current.configurationVersion,
    });
  });

  it('shows the definitions a Stage already has', async () => {
    current = detail({
      stages: [
        stage({
          id: STAGE_DESIGN,
          name: 'Design',
          position: 0,
          stageTasks: [
            { id: '00000000-0000-4000-8000-000000000f91', position: 0, title: 'Measure the hall', dueOffsetDays: 2, responsibleRoleId: null },
          ],
        }),
        stage({ id: STAGE_BUILD, name: 'Build', position: 1 }),
        stage({ id: STAGE_HANDOVER, name: 'Handover', position: 2, completionPermitted: true }),
      ],
    });
    await renderPage({ search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    // In the row, as a reader sees it; and in the fields once the Stage is opened.
    expect(await within(panel).findByText(en('stageTasks.item', { title: 'Measure the hall', days: 2 }))).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.edit', { position: 1 }) }));
    const field = await within(panel).findByLabelText(en('stageTasks.title', { index: 1, position: 1 }));
    expect((field as HTMLInputElement).value).toBe('Measure the hall');
  });

  it('offers to create a Stage’s Tasks again after creating them failed, and says how many were created (T079)', async () => {
    const failed = (flag: boolean) =>
      detail({
        stages: [
          stage({ id: STAGE_DESIGN, name: 'Design', position: 0, startedOn: '2026-10-20' }),
          stage({
            id: STAGE_BUILD,
            name: 'Build',
            position: 1,
            startedOn: '2026-10-25',
            tasksMaterializeFailed: flag,
            stageTasks: [
              { id: '00000000-0000-4000-8000-000000000f92', position: 1, title: 'Book the crane', dueOffsetDays: 1, responsibleRoleId: null },
            ],
          }),
          stage({ id: STAGE_HANDOVER, name: 'Handover', position: 2, completionPermitted: true }),
        ],
      });
    current = failed(true);
    postSpy.mockImplementation((path: string) => {
      if (path === `${DETAIL_PATH}/stages/${STAGE_BUILD}/materialize-tasks`) {
        current = failed(false);
        return Promise.resolve({ data: { created: 1 } });
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });
    await renderPage({ search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText(en('editor.retry.body', { position: 2 }))).toBeTruthy();
    // Only the Stage whose Tasks failed offers it.
    expect(within(panel).getAllByText(en('editor.retry.action'))).toHaveLength(1);
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.retry.actionFor', { position: 2 }) }));
    expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/stages/${STAGE_BUILD}/materialize-tasks`);
    await waitFor(() => expect(within(panel).queryByText(en('editor.retry.body', { position: 2 }))).toBeNull());
    expect(await screen.findByText(en('editor.retry.done', { count: 1 }))).toBeTruthy();
  });

  it('offers no retry while the Tasks module is off, nor to a reader', async () => {
    current = detail({
      stages: [
        stage({ id: STAGE_DESIGN, name: 'Design', position: 0, tasksMaterializeFailed: true }),
        stage({ id: STAGE_BUILD, name: 'Build', position: 1 }),
      ],
    });
    await renderPage({ present: ['projects', 'organizations', 'admin_users'], search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    await within(panel).findAllByText('Build');
    expect(within(panel).queryByText(en('editor.retry.body', { position: 1 }))).toBeNull();
  });

  it('has no Task section while the Tasks module is off', async () => {
    await renderPage({ present: ['projects', 'organizations', 'admin_users'], search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    await userEvent.click(await within(panel).findByRole('button', { name: en('editor.edit', { position: 2 }) }));
    await within(panel).findByLabelText(en('stage.name', { position: 2 }));
    expect(within(panel).queryByRole('group', { name: en('stageTasks.heading', { position: 2 }) })).toBeNull();
  });
});

describe('ProjectDetail — the completion gate on the Stage bar', () => {
  it('names the open Tasks the refusal names, each linked', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'PROJECT_STAGE_GATE_OPEN_TASKS',
          message: 'The project cannot leave this stage while some of its tasks are neither done nor cancelled.',
          details: { openTaskCount: 1, openTasks: [{ id: TASK.id, number: TASK.number, title: TASK.title }] },
        },
      }),
    );
    await renderPage();
    const bar = screen.getByRole('region', { name: en('stageBar.heading') });
    await userEvent.click(within(bar).getByRole('button', { name: en('stageBar.moveTo', { stage: 'Build' }) }));
    const link = await within(bar).findByRole('link', { name: /TSK-000001/ });
    expect(link.getAttribute('href')).toBe(`/tasks/${TASK.id}`);
    expect(within(bar).getByText(en('stageBar.openTasks'))).toBeTruthy();
  });

  it('to somebody who may not read Tasks, says how many are open and names none (T144 F2)', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'PROJECT_STAGE_GATE_OPEN_TASKS',
          message: 'The project cannot leave this stage while some of its tasks are neither done nor cancelled.',
          details: { openTaskCount: 2 },
        },
      }),
    );
    await renderPage();
    const bar = screen.getByRole('region', { name: en('stageBar.heading') });
    await userEvent.click(within(bar).getByRole('button', { name: en('stageBar.moveTo', { stage: 'Build' }) }));
    expect(await within(bar).findByText(en('stageBar.openTaskCount', { count: 2 }))).toBeTruthy();
    expect(within(bar).queryByRole('link', { name: /TSK-/ })).toBeNull();
  });
});
