import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectDetail } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  LOSS_REASONS,
  PROJECT_ID,
  REASON_PRICE,
  ROLES,
  STAGE_BUILD,
  STAGE_DESIGN,
  STAGE_HANDOVER,
  detail,
  en,
  renderProjects,
  stage,
} from './projects-fixtures';

/**
 * A Project's screen and its Stage bar (`specs/163-projects-and-tasks/`, User
 * Story 1 — tasks T047 and T056; `contracts/admin-surfaces.md` §2).
 *
 * The bar draws every Stage in order with the current one marked, and offers
 * **only what the Project may do next**: a button per permitted move out of the
 * current Stage (the server's `moves`), "Close as completed" only where the
 * current Stage permits it, "Close as lost" through a dialog that will not send
 * without a loss reason, and "Reopen" on a closed Project. Every write names the
 * `version` it was read at; a 409 is shown in the server's words and the Project
 * is read again. Without `canWrite` the bar is a picture.
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

let current: ProjectDetail = detail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = detail();
  getSpy.mockImplementation((path: string) => {
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === '/api/v1/admin/projects/loss-reasons?active=true') return Promise.resolve({ data: LOSS_REASONS });
    if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ROLES });
    if (path === `${DETAIL_PATH}/stage-history`) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(options: { permissions?: readonly string[]; search?: string } = {}): Promise<void> {
  renderProjects(<ProjectDetailPage />, {
    path: `/projects/${PROJECT_ID}${options.search ?? ''}`,
    pattern: '/projects/:id',
    ...(options.permissions ? { permissions: options.permissions } : {}),
  });
  await screen.findByRole('heading', { name: /Warehouse fit-out/ });
}

const bar = (): HTMLElement => screen.getByRole('region', { name: en('stageBar.heading') });

describe('ProjectDetail — the header', () => {
  it('names the Project, its state, value and Organizations', async () => {
    await renderPage();
    expect(screen.getAllByText('PRJ-000001').length).toBeGreaterThan(0);
    expect(screen.getAllByText(en('state.open')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });

  it('says the Project is not available when the server answers 404', async () => {
    getSpy.mockImplementation(() =>
      Promise.reject(
        new ApiError(404, {
          error: { code: 'PROJECT_NOT_FOUND', message: 'This project does not exist or is not available to you.' },
        }),
      ),
    );
    renderProjects(<ProjectDetailPage />, { path: `/projects/${PROJECT_ID}`, pattern: '/projects/:id' });
    expect(await screen.findByText('This project does not exist or is not available to you.')).toBeTruthy();
  });
});

describe('ProjectDetail — the Stage bar', () => {
  it('draws every Stage in order, the current one marked', async () => {
    await renderPage();
    const steps = within(bar()).getAllByRole('listitem').filter((item) => item.hasAttribute('data-stage'));
    expect(steps.map((item) => item.getAttribute('data-stage'))).toEqual([STAGE_DESIGN, STAGE_BUILD, STAGE_HANDOVER]);
    expect(steps[0]?.getAttribute('aria-current')).toBe('step');
    expect(steps[1]?.hasAttribute('aria-current')).toBe(false);
  });

  it('offers a button only for each move the workflow permits from the current Stage', async () => {
    await renderPage();
    expect(within(bar()).getByRole('button', { name: en('stageBar.moveTo', { stage: 'Build' }) })).toBeTruthy();
    expect(within(bar()).queryByRole('button', { name: en('stageBar.moveTo', { stage: 'Handover' }) })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: en('stageBar.moveTo', { stage: 'Design' }) })).toBeNull();
  });

  it('moves the Project with the version it was read at, and shows the answer', async () => {
    const moved = detail({
      currentStage: { id: STAGE_BUILD, name: 'Build', color: '#f59e0b', deadlineOn: null, overdue: false },
      version: 4,
    });
    postSpy.mockResolvedValue({ data: { project: moved, entry: {}, createdTaskIds: [], notes: [] } });
    await renderPage();
    await userEvent.click(within(bar()).getByRole('button', { name: en('stageBar.moveTo', { stage: 'Build' }) }));
    expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/move`, { toStageId: STAGE_BUILD, version: 3 });
    await waitFor(() =>
      expect(within(bar()).getByRole('button', { name: en('stageBar.moveTo', { stage: 'Handover' }) })).toBeTruthy(),
    );
    expect(within(bar()).queryByRole('button', { name: en('stageBar.moveTo', { stage: 'Build' }) })).toBeNull();
  });

  it('offers "Close as completed" only where the current Stage permits it', async () => {
    await renderPage();
    expect(within(bar()).queryByRole('button', { name: en('stageBar.complete') })).toBeNull();
    expect(within(bar()).getByRole('button', { name: en('stageBar.lose') })).toBeTruthy();
  });

  it('completes the Project from a Stage that permits it', async () => {
    current = detail({
      currentStage: { id: STAGE_HANDOVER, name: 'Handover', color: '#10b981', deadlineOn: null, overdue: false },
    });
    postSpy.mockResolvedValue({
      data: { ...current, state: 'completed', closedAt: '2026-10-26T10:00:00.000Z', version: 4 },
    });
    await renderPage();
    await userEvent.click(within(bar()).getByRole('button', { name: en('stageBar.complete') }));
    expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/close`, { outcome: 'completed', version: 3 });
    expect(await within(bar()).findByRole('button', { name: en('stageBar.reopen') })).toBeTruthy();
  });

  it('will not close a Project as lost without a loss reason', async () => {
    postSpy.mockResolvedValue({ data: { ...current, state: 'lost', closedAt: '2026-10-26T10:00:00.000Z', version: 4 } });
    await renderPage();
    await userEvent.click(within(bar()).getByRole('button', { name: en('stageBar.lose') }));
    const dialog = await screen.findByRole('dialog', { name: en('close.title') });
    await userEvent.click(within(dialog).getByRole('button', { name: en('close.confirm') }));
    expect(within(dialog).getByText(en('close.reasonRequired'))).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();

    await userEvent.selectOptions(await within(dialog).findByLabelText(new RegExp(en('close.reason'))), REASON_PRICE);
    await userEvent.type(within(dialog).getByLabelText(en('close.comment')), 'Over budget');
    await userEvent.click(within(dialog).getByRole('button', { name: en('close.confirm') }));
    expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/close`, {
      outcome: 'lost',
      lossReasonId: REASON_PRICE,
      comment: 'Over budget',
      version: 3,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reopens a closed Project', async () => {
    current = detail({ state: 'lost', closedAt: '2026-10-25T10:00:00.000Z', lostStageId: STAGE_DESIGN });
    postSpy.mockResolvedValue({ data: detail({ version: 5 }) });
    await renderPage();
    expect(within(bar()).queryByRole('button', { name: en('stageBar.lose') })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: en('stageBar.moveTo', { stage: 'Build' }) })).toBeNull();
    await userEvent.click(within(bar()).getByRole('button', { name: en('stageBar.reopen') }));
    expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/reopen`, { version: 3 });
    expect(await within(bar()).findByRole('button', { name: en('stageBar.lose') })).toBeTruthy();
  });

  it('shows a 409 in the server words and reads the Project again', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'PROJECT_CHANGED',
          message: 'Someone else changed this project in the meantime. Reload it and try again.',
        },
      }),
    );
    await renderPage();
    const readsBefore = getSpy.mock.calls.filter(([path]) => path === DETAIL_PATH).length;
    await userEvent.click(within(bar()).getByRole('button', { name: en('stageBar.moveTo', { stage: 'Build' }) }));
    expect(
      await within(bar()).findByText('Someone else changed this project in the meantime. Reload it and try again.'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(getSpy.mock.calls.filter(([path]) => path === DETAIL_PATH).length).toBe(readsBefore + 1),
    );
  });

  it("shows a guard's refusal with the guard's own reason", async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'PROJECT_GUARD_REFUSED',
          message: 'A signed contract is required first.',
          details: { reason: 'A signed contract is required first.' },
        },
      }),
    );
    await renderPage();
    await userEvent.click(within(bar()).getByRole('button', { name: en('stageBar.moveTo', { stage: 'Build' }) }));
    expect(await within(bar()).findByText('A signed contract is required first.')).toBeTruthy();
  });

  it('is a picture without the right to write: Stages, no buttons', async () => {
    current = detail({ permissions: { canWrite: false, canConfigure: false } });
    await renderPage({ permissions: ['projects:read'] });
    expect(within(bar()).getByText('Build')).toBeTruthy();
    expect(within(bar()).queryAllByRole('button')).toHaveLength(0);
    expect(within(bar()).getByText(en('stageBar.readOnly'))).toBeTruthy();
  });
});

describe('ProjectDetail — the tabs', () => {
  it('opens on Overview with the description and the members by Role', async () => {
    await renderPage();
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('Racking and lighting for the new hall.')).toBeTruthy();
    expect(within(panel).getByText('Project Manager')).toBeTruthy();
    expect(within(panel).getByText('Anna Nowak')).toBeTruthy();
  });

  it('warns on the Stages tab about a Stage no move reaches', async () => {
    current = detail({ moves: [], unreachableStageIds: [STAGE_BUILD, STAGE_HANDOVER] });
    await renderPage({ search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    expect(
      await within(panel).findByText(en('editor.unreachable', { stages: 'Build, Handover' })),
    ).toBeTruthy();
  });

  it('saves a Stage edited on the Stages tab', async () => {
    patchSpy.mockResolvedValue({ data: stage({ id: STAGE_BUILD, name: 'Build out', position: 1 }) });
    await renderPage({ search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    const name = await within(panel).findByLabelText(en('stage.name', { position: 2 }));
    await userEvent.clear(name);
    await userEvent.type(name, 'Build out');
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.save', { position: 2 }) }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const [path, body] = patchSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`${DETAIL_PATH}/stages/${STAGE_BUILD}`);
    expect(body).toMatchObject({ name: 'Build out' });
  });

  it('sets a Stage deadline by hand, sending that alone (User Story 8)', async () => {
    patchSpy.mockResolvedValue({ data: stage({ id: STAGE_DESIGN, name: 'Design', position: 0 }) });
    await renderPage({ search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    const field = (await within(panel).findByLabelText(en('editor.deadlineField', { position: 1 }))) as HTMLInputElement;
    // A computed deadline is shown, not held in the field: empty means "start + planned days".
    expect(field.value).toBe('');
    expect(within(panel).getAllByText(en('editor.deadlineFieldHint')).length).toBeGreaterThan(0);
    fireEvent.change(field, { target: { value: '2026-11-30' } });
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.save', { position: 1 }) }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const [path, body] = patchSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`${DETAIL_PATH}/stages/${STAGE_DESIGN}`);
    // The deadline alone among the Stage's attributes, with the Stage's version as read (issue #449).
    expect(body).toEqual({ deadlineOn: '2026-11-30', version: 1 });
  });

  it('clears a deadline set by hand, so it is counted from the start again', async () => {
    current = detail({
      stages: [
        stage({ id: STAGE_DESIGN, name: 'Design', position: 0, startedOn: '2026-10-20', deadlineOn: '2026-11-30', deadlineManual: true }),
        stage({ id: STAGE_BUILD, name: 'Build', position: 1 }),
      ],
    });
    patchSpy.mockResolvedValue({ data: stage({ id: STAGE_DESIGN, name: 'Design', position: 0 }) });
    await renderPage({ search: '?tab=stages' });
    const panel = await screen.findByRole('tabpanel');
    const field = (await within(panel).findByLabelText(en('editor.deadlineField', { position: 1 }))) as HTMLInputElement;
    expect(field.value).toBe('2026-11-30');
    fireEvent.change(field, { target: { value: '' } });
    await userEvent.click(within(panel).getByRole('button', { name: en('editor.save', { position: 1 }) }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect((patchSpy.mock.calls[0] as [string, Record<string, unknown>])[1]).toEqual({ deadlineOn: null, version: 1 });
  });

  it('says on the Stage bar when the current deadline was set by hand', async () => {
    current = detail({
      currentStage: { id: STAGE_DESIGN, name: 'Design', color: '#3b82f6', deadlineOn: '2026-11-30', overdue: false },
      stages: [
        stage({ id: STAGE_DESIGN, name: 'Design', position: 0, startedOn: '2026-10-20', deadlineOn: '2026-11-30', deadlineManual: true }),
        stage({ id: STAGE_BUILD, name: 'Build', position: 1 }),
      ],
    });
    await renderPage();
    expect(within(bar()).getByText(new RegExp(en('stageBar.deadlineManualNote')))).toBeTruthy();
  });

  it('lists the Stage history on its tab', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === DETAIL_PATH) return Promise.resolve({ data: current });
      if (path === `${DETAIL_PATH}/stage-history`) {
        return Promise.resolve({
          data: [
            {
              id: '00000000-0000-4000-8000-000000000a91',
              kind: 'enter',
              fromStageId: null,
              toStageId: STAGE_DESIGN,
              fromStageName: null,
              toStageName: 'Design',
              notes: [],
              actor: { id: '00000000-0000-4000-8000-000000000c01', name: 'Anna Nowak' },
              at: '2026-10-20T10:00:00.000Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    await renderPage({ search: '?tab=stage-history' });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText(en('history.kind.enter', { to: 'Design' }))).toBeTruthy();
  });
});
