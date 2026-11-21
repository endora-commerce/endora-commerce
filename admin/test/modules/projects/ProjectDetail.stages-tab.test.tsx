import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectDetail } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  EVERY_PROJECTS_PERMISSION,
  PROJECT_ID,
  ROLES,
  STAGE_BUILD,
  STAGE_DESIGN,
  STAGE_HANDOVER,
  core,
  detail,
  en,
  renderProjects,
  stage,
} from './projects-fixtures';

/**
 * A Project's *Stages* tab as rows (issue #1523, UX audit 2026-11-17, WORK-01).
 *
 * Every Stage used to be an always-open form with a Save of its own and a
 * second Save for its Stage Tasks, each repeating four hints — twelve Saves
 * and two dozen paragraphs on a six-Stage Project. Now every Stage is the
 * compact row a reader sees; *Edit* opens **one** Stage at a time, and that
 * Stage's **one** Save writes its attributes and its Task definitions
 * together. Deleting asks first.
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

let current: ProjectDetail = detail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = detail();
  getSpy.mockImplementation((path: string) => {
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === `${DETAIL_PATH}/tasks`) return Promise.resolve({ data: { tasksAvailable: true, stages: [] } });
    if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ROLES });
    if (path === `${DETAIL_PATH}/stage-history`) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function openStagesTab(
  options: { permissions?: readonly string[]; present?: readonly string[] } = {},
): Promise<HTMLElement> {
  renderProjects(<ProjectDetailPage />, {
    path: `/projects/${PROJECT_ID}?tab=stages`,
    pattern: '/projects/:id',
    permissions: options.permissions ?? TASKS_PERMISSIONS,
    present: options.present ?? TASKS_PRESENT,
  });
  const panel = await screen.findByRole('tabpanel');
  await within(panel).findAllByText('Handover');
  return panel;
}

const editButton = (panel: HTMLElement, position: number): HTMLElement =>
  within(panel).getByRole('button', { name: en('editor.edit', { position }) });

describe('ProjectDetail — the Stages tab as rows (WORK-01)', () => {
  it('shows every Stage as a row with an Edit button, and no field or Save until one is opened', async () => {
    const panel = await openStagesTab();
    for (const position of [1, 2, 3]) expect(editButton(panel, position).getAttribute('aria-expanded')).toBe('false');
    expect(within(panel).queryByLabelText(en('stage.name', { position: 2 }))).toBeNull();
    expect(within(panel).queryAllByRole('button', { name: core('common.action.save') })).toHaveLength(0);
    expect(within(panel).queryByRole('button', { name: en('editor.save', { position: 2 }) })).toBeNull();
    expect(within(panel).queryByText(en('editor.deadlineFieldHint'))).toBeNull();
    expect(within(panel).queryByText(en('stageTasks.hint'))).toBeNull();
  });

  it('opens one Stage at a time, its hints once, with one Save for its fields and its tasks', async () => {
    const panel = await openStagesTab();
    await userEvent.click(editButton(panel, 2));
    expect(within(panel).getByLabelText(en('stage.name', { position: 2 }))).toBeTruthy();
    expect(document.activeElement).toBe(within(panel).getByLabelText(en('stage.name', { position: 2 })));
    expect(within(panel).getAllByText(en('editor.deadlineFieldHint'))).toHaveLength(1);
    expect(within(panel).getAllByText(en('editor.gateHint'))).toHaveLength(1);
    expect(within(panel).getAllByText(en('editor.alertsHint'))).toHaveLength(1);
    expect(within(panel).getAllByText(en('stageTasks.hint'))).toHaveLength(1);
    // One Save in the whole tab — the open Stage's, covering its tasks as well.
    expect(within(panel).getAllByRole('button', { name: /^Save/ })).toHaveLength(1);
    expect(within(panel).getByRole('button', { name: en('editor.save', { position: 2 }) })).toBeTruthy();

    // Opening another Stage, with nothing changed, closes the first.
    await userEvent.click(editButton(panel, 3));
    expect(within(panel).queryByLabelText(en('stage.name', { position: 2 }))).toBeNull();
    expect(within(panel).getByLabelText(en('stage.name', { position: 3 }))).toBeTruthy();
  });

  it('saves the Stage and its tasks with the one Save: the tasks at the version the Stage edit answered', async () => {
    patchSpy.mockResolvedValue({ data: stage({ id: STAGE_BUILD, name: 'Assembly', position: 1, color: '#f59e0b', version: 2 }) });
    putSpy.mockResolvedValue({ data: stage({ id: STAGE_BUILD, name: 'Assembly', position: 1, version: 3 }) });
    const panel = await openStagesTab();
    await userEvent.click(editButton(panel, 2));
    const name = within(panel).getByLabelText(en('stage.name', { position: 2 }));
    await userEvent.clear(name);
    await userEvent.type(name, 'Assembly');
    const section = within(panel).getByRole('group', { name: en('stageTasks.heading', { position: 2 }) });
    await userEvent.click(within(section).getByRole('button', { name: en('stageTasks.add') }));
    await userEvent.type(within(section).getByLabelText(en('stageTasks.title', { index: 1, position: 2 })), 'Book the crane');
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.save', { position: 2 }) }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/stages/${STAGE_BUILD}`, { name: 'Assembly', version: 1 });
    expect(putSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/stages/${STAGE_BUILD}/tasks`, {
      tasks: [{ title: 'Book the crane', dueOffsetDays: 0 }],
      version: 2,
    });
    // Saved: the row closes, says so beside the list, and gives focus back to its Edit.
    await waitFor(() => expect(within(panel).queryByLabelText(en('stage.name', { position: 2 }))).toBeNull());
    expect(await within(panel).findByText(en('editor.saved'))).toBeTruthy();
    expect(document.activeElement).toBe(editButton(panel, 2));
  });

  it('sends nothing for what did not change, and closes on a Save with no change', async () => {
    const panel = await openStagesTab();
    await userEvent.click(editButton(panel, 1));
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.save', { position: 1 }) }));
    await waitFor(() => expect(within(panel).queryByLabelText(en('stage.name', { position: 1 }))).toBeNull());
    expect(patchSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('keeps the editor open with the error beside its Save when the tasks fail after the Stage saved, and a retry sends the tasks alone', async () => {
    patchSpy.mockImplementation(() => {
      current = detail({
        stages: [
          stage({ id: STAGE_DESIGN, name: 'Design', position: 0 }),
          stage({ id: STAGE_BUILD, name: 'Assembly', position: 1, color: '#f59e0b', version: 2 }),
          stage({ id: STAGE_HANDOVER, name: 'Handover', position: 2 }),
        ],
      });
      return Promise.resolve({ data: stage({ id: STAGE_BUILD, name: 'Assembly', position: 1, color: '#f59e0b', version: 2 }) });
    });
    putSpy.mockRejectedValueOnce(
      new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'The tasks could not be saved.' } }),
    );
    putSpy.mockResolvedValueOnce({ data: stage({ id: STAGE_BUILD, name: 'Assembly', position: 1, version: 3 }) });
    const panel = await openStagesTab();
    await userEvent.click(editButton(panel, 2));
    const name = within(panel).getByLabelText(en('stage.name', { position: 2 }));
    await userEvent.clear(name);
    await userEvent.type(name, 'Assembly');
    const section = within(panel).getByRole('group', { name: en('stageTasks.heading', { position: 2 }) });
    await userEvent.click(within(section).getByRole('button', { name: en('stageTasks.add') }));
    await userEvent.type(within(section).getByLabelText(en('stageTasks.title', { index: 1, position: 2 })), 'Book the crane');
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.save', { position: 2 }) }));

    expect(await within(panel).findByText('The tasks could not be saved.')).toBeTruthy();
    expect(within(panel).getByLabelText(en('stageTasks.title', { index: 1, position: 2 }))).toBeTruthy();

    await userEvent.click(within(panel).getByRole('button', { name: en('editor.save', { position: 2 }) }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenLastCalledWith(`${DETAIL_PATH}/stages/${STAGE_BUILD}/tasks`, {
      tasks: [{ title: 'Book the crane', dueOffsetDays: 0 }],
      version: 2,
    });
  });

  it('Cancel closes the Stage without sending, and gives focus back to its Edit', async () => {
    const panel = await openStagesTab();
    await userEvent.click(editButton(panel, 2));
    await userEvent.type(within(panel).getByLabelText(en('stage.name', { position: 2 })), ' out');
    await userEvent.click(within(panel).getByRole('button', { name: core('common.action.cancel') }));
    expect(within(panel).queryByLabelText(en('stage.name', { position: 2 }))).toBeNull();
    expect(document.activeElement).toBe(editButton(panel, 2));
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('asks before opening another Stage over unsaved changes', async () => {
    const panel = await openStagesTab();
    await userEvent.click(editButton(panel, 2));
    await userEvent.type(within(panel).getByLabelText(en('stage.name', { position: 2 })), ' out');
    await userEvent.click(editButton(panel, 3));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(en('editor.discard.message', { position: 2 }))).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.cancel') }));
    expect((within(panel).getByLabelText(en('stage.name', { position: 2 })) as HTMLInputElement).value).toBe('Build out');

    await userEvent.click(editButton(panel, 3));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en('editor.discard.confirm') }));
    await waitFor(() => expect(within(panel).queryByLabelText(en('stage.name', { position: 2 }))).toBeNull());
    expect(within(panel).getByLabelText(en('stage.name', { position: 3 }))).toBeTruthy();
  });

  it('asks before deleting a Stage', async () => {
    deleteSpy.mockResolvedValue(undefined);
    const panel = await openStagesTab();
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.delete', { position: 2 }) }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(en('editor.deleteConfirm', { name: 'Build' }))).toBeTruthy();
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/stages/${STAGE_BUILD}`));
  });

  it('shows a reader the same rows, with no Edit', async () => {
    current = detail({ permissions: { canWrite: false, canConfigure: false } });
    const panel = await openStagesTab();
    expect(within(panel).queryByRole('button', { name: en('editor.edit', { position: 1 }) })).toBeNull();
    expect(within(panel).getAllByText('Build').length).toBeGreaterThan(0);
  });
});
