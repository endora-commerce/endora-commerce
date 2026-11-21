import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { ProjectTemplateDetail } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { ROLES, ROLE_MANAGER, ROLE_SALES_REP, core, en, renderProjects } from './projects-fixtures';

/**
 * The Template editor (`specs/163-projects-and-tasks/`, User Story 3 — tasks
 * T075 and T078; `contracts/admin-surfaces.md` §2, `/projects/settings/templates/:id`).
 *
 * A Template is edited as a whole and saved in **one** request — `POST` for a
 * new one, `PUT` for an existing one, the whole graph in the body — with the
 * same Stage fields, Stage Task definitions and workflow graph as a Project's
 * *Stages* tab. A Stage is named in the body by a `key`: an existing Stage's id,
 * or a label for a new one, which is what a move names.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();

/** The workflow graph draws with ECharts, which jsdom cannot run; its keyboard form is what is used here. */
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
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { TemplateEditor } = await import('../../../../packages/modules/projects/src/admin/pages/TemplateEditor');

const TEMPLATE_ID = '00000000-0000-4000-8000-0000000007a1';
const COPY_ID = '00000000-0000-4000-8000-0000000007a2';
const SURVEY = '00000000-0000-4000-8000-0000000007b1';
const BUILD = '00000000-0000-4000-8000-0000000007b2';
const TEMPLATES = '/api/v1/admin/projects/templates';
const PERMISSIONS = ['projects:read', 'projects:write', 'projects:configure'];

function template(overrides: Partial<ProjectTemplateDetail> = {}): ProjectTemplateDetail {
  return {
    id: TEMPLATE_ID,
    name: 'Showroom fit-out',
    description: 'Fit out a showroom.',
    roleIds: [ROLE_MANAGER],
    stages: [
      {
        id: SURVEY,
        name: 'Survey',
        color: '#0ea5e9',
        position: 1,
        plannedDurationDays: 5,
        responsibleRoleIds: [],
        alertOffsetsDays: [],
        completionGate: false,
        completionPermitted: false,
        tasks: [
          {
            id: '00000000-0000-4000-8000-0000000007c1',
            title: 'Measure the floor',
            description: 'All three halls',
            responsibleRoleId: ROLE_MANAGER,
            dueOffsetDays: 1,
            position: 1,
          },
        ],
      },
      {
        id: BUILD,
        name: 'Build',
        color: '#f59e0b',
        position: 2,
        plannedDurationDays: 20,
        responsibleRoleIds: [],
        alertOffsetsDays: [3],
        completionGate: true,
        completionPermitted: true,
        tasks: [],
      },
    ],
    moves: [{ fromStageId: SURVEY, toStageId: BUILD }],
    archivedAt: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-21T10:00:00.000Z',
    ...overrides,
  };
}

let current: ProjectTemplateDetail;

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  putSpy.mockReset();
  current = template();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ROLES });
    if (path === `${TEMPLATES}/${TEMPLATE_ID}`) return Promise.resolve({ data: current });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  putSpy.mockImplementation(() => Promise.resolve({ data: current }));
});

function AddressProbe(): ReactElement {
  const location = useLocation();
  return <output data-testid="address">{location.pathname}</output>;
}

async function open(options: { id?: string; present?: readonly string[]; listRoute?: boolean } = {}): Promise<void> {
  const id = options.id ?? TEMPLATE_ID;
  renderProjects(
    <>
      <TemplateEditor />
      <AddressProbe />
    </>,
    {
      permissions: PERMISSIONS,
      path: id === 'new' ? '/projects/settings/templates/new' : `/projects/settings/templates/${id}`,
      // A new Template is at an address with no id; the catch-all keeps the probe mounted after it is saved.
      ...(id === 'new' ? {} : { pattern: '/projects/settings/templates/:id' }),
      present: options.present ?? ['projects', 'tasks'],
      // The list the editor leaves for, so the address can still be read once it has.
      ...(options.listRoute ? { routes: <Route path="/projects/settings" element={<AddressProbe />} /> } : {}),
    },
  );
  if (id === 'new') await screen.findByRole('heading', { name: en('templates.editor.titleNew') });
  else await screen.findByDisplayValue('Showroom fit-out');
}

const stagesSection = (): HTMLElement => screen.getByRole('group', { name: en('templates.editor.stages') });
const saveButton = (): HTMLElement => screen.getByRole('button', { name: en('templates.editor.save') });

describe('TemplateEditor', () => {
  it('loads every part of the Template into the editor', async () => {
    await open();
    expect((screen.getByLabelText(new RegExp(en('templates.editor.name'))) as HTMLInputElement).value).toBe('Showroom fit-out');
    expect((screen.getByLabelText(en('templates.editor.description')) as HTMLTextAreaElement).value).toBe('Fit out a showroom.');
    const roles = screen.getByRole('group', { name: en('templates.editor.roles') });
    expect((within(roles).getByRole('checkbox', { name: 'Project Manager' }) as HTMLInputElement).checked).toBe(true);
    expect((within(roles).getByRole('checkbox', { name: 'Sales Rep' }) as HTMLInputElement).checked).toBe(false);
    const stages = stagesSection();
    expect((within(stages).getByLabelText(en('stage.name', { position: 1 })) as HTMLInputElement).value).toBe('Survey');
    expect((within(stages).getByLabelText(en('stage.name', { position: 2 })) as HTMLInputElement).value).toBe('Build');
    expect((within(stages).getByLabelText(en('editor.alerts', { position: 2 })) as HTMLInputElement).value).toBe('3');
    expect((within(stages).getByLabelText(en('stageTasks.title', { index: 1, position: 1 })) as HTMLInputElement).value).toBe(
      'Measure the floor',
    );
    // The workflow is the kit's graph, as on a Project.
    expect(screen.getByRole('heading', { name: en('editor.moves') })).toBeTruthy();
  });

  it('saves the whole Template in one PUT, a new Stage reached from the one that was last', async () => {
    await open();
    const name = screen.getByLabelText(new RegExp(en('templates.editor.name')));
    await userEvent.clear(name);
    await userEvent.type(name, 'Showroom fit-out v2');
    const roles = screen.getByRole('group', { name: en('templates.editor.roles') });
    await userEvent.click(within(roles).getByRole('checkbox', { name: 'Sales Rep' }));

    const stages = stagesSection();
    await userEvent.click(within(stages).getByRole('button', { name: en('editor.add') }));
    const third = within(stages).getByLabelText(en('stage.name', { position: 3 }));
    await userEvent.clear(third);
    await userEvent.type(third, 'Handover');
    const taskSection = within(stages).getByRole('group', { name: en('stageTasks.heading', { position: 3 }) });
    await userEvent.click(within(taskSection).getByRole('button', { name: en('stageTasks.add') }));
    await userEvent.type(within(taskSection).getByLabelText(en('stageTasks.title', { index: 1, position: 3 })), 'Hand the keys over');

    await userEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const [path, body] = putSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`${TEMPLATES}/${TEMPLATE_ID}`);
    expect(body).toMatchObject({
      name: 'Showroom fit-out v2',
      description: 'Fit out a showroom.',
      roleIds: [ROLE_MANAGER, ROLE_SALES_REP],
    });
    const sent = body['stages'] as Array<Record<string, unknown>>;
    expect(sent.map((stage) => [stage['key'], stage['name']])).toEqual([
      [SURVEY, 'Survey'],
      [BUILD, 'Build'],
      [expect.any(String), 'Handover'],
    ]);
    expect(sent[0]).toMatchObject({
      plannedDurationDays: 5,
      tasks: [{ title: 'Measure the floor', description: 'All three halls', dueOffsetDays: 1, responsibleRoleId: ROLE_MANAGER }],
    });
    expect(sent[1]).toMatchObject({ alertOffsetsDays: [3], completionGate: true, completionPermitted: true, tasks: [] });
    expect(sent[2]).toMatchObject({ tasks: [{ title: 'Hand the keys over', dueOffsetDays: 0 }] });
    const handoverKey = sent[2]!['key'];
    expect(body['moves']).toEqual([
      { fromStageKey: SURVEY, toStageKey: BUILD },
      { fromStageKey: BUILD, toStageKey: handoverKey },
    ]);
    expect(await screen.findByText(en('templates.editor.saved'))).toBeTruthy();
  });

  it('refuses to send a Template without a name, or with an unnamed Stage, and says why', async () => {
    await open();
    await userEvent.clear(screen.getByLabelText(new RegExp(en('templates.editor.name'))));
    await userEvent.clear(within(stagesSection()).getByLabelText(en('stage.name', { position: 2 })));
    await userEvent.click(saveButton());
    expect(screen.getByText(en('templates.editor.error.name'))).toBeTruthy();
    expect(screen.getByText(en('create.error.stageName'))).toBeTruthy();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("shows the server's sentence when the save is refused", async () => {
    putSpy.mockRejectedValue(
      new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'A responsible role is not a project role.' } }),
    );
    await open();
    await userEvent.click(saveButton());
    expect(await screen.findByText('A responsible role is not a project role.')).toBeTruthy();
  });

  it('removing a Stage takes its moves with it', async () => {
    await open();
    await userEvent.click(within(stagesSection()).getByRole('button', { name: en('editor.delete', { position: 1 }) }));
    await userEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const body = putSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect((body['stages'] as Array<Record<string, unknown>>).map((stage) => stage['name'])).toEqual(['Build']);
    expect(body['moves']).toEqual([]);
  });

  it('creates a new Template with one POST and opens it', async () => {
    postSpy.mockResolvedValue({ data: template({ name: 'Kiosk' }) });
    await open({ id: 'new' });
    await userEvent.type(screen.getByLabelText(new RegExp(en('templates.editor.name'))), 'Kiosk');
    await userEvent.type(within(stagesSection()).getByLabelText(en('stage.name', { position: 1 })), 'Plan');
    await userEvent.click(saveButton());
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [path, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(TEMPLATES);
    expect(body).toMatchObject({ name: 'Kiosk', roleIds: [], moves: [] });
    expect((body['stages'] as Array<Record<string, unknown>>).map((stage) => stage['name'])).toEqual(['Plan']);
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(`/projects/settings/templates/${TEMPLATE_ID}`));
  });

  it('archives and restores the Template, saying it is no longer offered', async () => {
    postSpy.mockImplementation((path: string) => {
      if (path === `${TEMPLATES}/${TEMPLATE_ID}/archive`) {
        current = template({ archivedAt: '2026-10-26T10:00:00.000Z' });
        return Promise.resolve({ data: current });
      }
      if (path === `${TEMPLATES}/${TEMPLATE_ID}/restore`) {
        current = template();
        return Promise.resolve({ data: current });
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });
    await open();
    await userEvent.click(screen.getByRole('button', { name: en('templates.editor.archive') }));
    expect(await screen.findByText(en('templates.editor.archivedNotice'))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: en('templates.editor.restore') }));
    await waitFor(() => expect(screen.queryByText(en('templates.editor.archivedNotice'))).toBeNull());
  });

  it('duplicates the Template and opens the copy', async () => {
    postSpy.mockResolvedValue({ data: template({ id: COPY_ID, name: 'Showroom fit-out (copy)' }) });
    await open();
    await userEvent.click(screen.getByRole('button', { name: en('templates.editor.duplicate') }));
    await waitFor(() =>
      expect(postSpy.mock.calls.map(([path]) => path)).toEqual([`${TEMPLATES}/${TEMPLATE_ID}/duplicate`]),
    );
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(`/projects/settings/templates/${COPY_ID}`));
  });

  describe('unsaved edits (issue #452)', () => {
    const rename = async (to: string): Promise<void> => {
      const name = screen.getByLabelText(new RegExp(en('templates.editor.name')));
      await userEvent.clear(name);
      await userEvent.type(name, to);
    };
    const backLink = (): HTMLElement => screen.getByRole('link', { name: new RegExp(en('templates.editor.back')) });

    it('leaving through a link asks first, and staying keeps the edits', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      try {
        await open();
        await rename('Showroom fit-out v2');
        await userEvent.click(backLink());
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('address').textContent).toBe(`/projects/settings/templates/${TEMPLATE_ID}`);
        expect(screen.getByDisplayValue('Showroom fit-out v2')).toBeTruthy();
      } finally {
        confirm.mockRestore();
      }
    });

    it('asks nothing with no edits, nor once the edits are saved', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      try {
        await open();
        await rename('Showroom fit-out v2');
        current = template({ name: 'Showroom fit-out v2' });
        await userEvent.click(saveButton());
        await screen.findByText(en('templates.editor.saved'));
        await userEvent.click(backLink());
        expect(confirm).not.toHaveBeenCalled();
      } finally {
        confirm.mockRestore();
      }
    });

    it('Cancel with unsaved edits asks in the kit dialog before discarding them', async () => {
      await open({ listRoute: true });
      await rename('Showroom fit-out v2');
      await userEvent.click(screen.getByRole('button', { name: core('common.action.cancel') }));
      const dialog = await screen.findByRole('dialog', { name: en('templates.editor.unsaved.title') });
      await userEvent.click(within(dialog).getByRole('button', { name: en('templates.editor.unsaved.stay') }));
      expect(screen.getByTestId('address').textContent).toBe(`/projects/settings/templates/${TEMPLATE_ID}`);
      expect(screen.getByDisplayValue('Showroom fit-out v2')).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: core('common.action.cancel') }));
      const again = await screen.findByRole('dialog', { name: en('templates.editor.unsaved.title') });
      await userEvent.click(within(again).getByRole('button', { name: en('templates.editor.unsaved.discard') }));
      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe('/projects/settings'));
    });

    it('Duplicate with unsaved edits says it copies the saved version, and copies nothing until told to', async () => {
      postSpy.mockResolvedValue({ data: template({ id: COPY_ID, name: 'Showroom fit-out (copy)' }) });
      await open();
      await rename('Showroom fit-out v2');
      await userEvent.click(screen.getByRole('button', { name: en('templates.editor.duplicate') }));
      const dialog = await screen.findByRole('dialog', { name: en('templates.editor.duplicateUnsaved.title') });
      expect(within(dialog).getByText(en('templates.editor.duplicateUnsaved.message'))).toBeTruthy();
      await userEvent.click(within(dialog).getByRole('button', { name: en('templates.editor.unsaved.stay') }));
      expect(postSpy).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: en('templates.editor.duplicate') }));
      const again = await screen.findByRole('dialog', { name: en('templates.editor.duplicateUnsaved.title') });
      await userEvent.click(within(again).getByRole('button', { name: en('templates.editor.duplicateUnsaved.confirm') }));
      await waitFor(() =>
        expect(postSpy.mock.calls.map(([path]) => path)).toEqual([`${TEMPLATES}/${TEMPLATE_ID}/duplicate`]),
      );
      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(`/projects/settings/templates/${COPY_ID}`));
    });

    it('a new Template with nothing typed is not unsaved; one with a name is', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      try {
        await open({ id: 'new' });
        await userEvent.click(backLink());
        expect(confirm).not.toHaveBeenCalled();
      } finally {
        confirm.mockRestore();
      }
    });
  });

  it('with the Tasks module off, shows no Stage Task section but keeps the definitions on save', async () => {
    await open({ present: ['projects'] });
    expect(within(stagesSection()).queryByRole('group', { name: en('stageTasks.heading', { position: 1 }) })).toBeNull();
    await userEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const body = putSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect((body['stages'] as Array<Record<string, unknown>>)[0]!['tasks']).toEqual([
      { title: 'Measure the floor', description: 'All three halls', dueOffsetDays: 1, responsibleRoleId: ROLE_MANAGER },
    ]);
  });

  it('says so when the Template cannot be loaded', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ROLES });
      return Promise.reject(new ApiError(404, { error: { code: 'PROJECT_TEMPLATE_NOT_FOUND', message: 'No such project template.' } }));
    });
    renderProjects(<TemplateEditor />, {
      permissions: PERMISSIONS,
      path: `/projects/settings/templates/${TEMPLATE_ID}`,
      pattern: '/projects/settings/templates/:id',
    });
    expect(await screen.findByText('No such project template.')).toBeTruthy();
    expect(screen.getByRole('link', { name: new RegExp(en('templates.editor.back')) })).toBeTruthy();
    expect(core('common.action.retry')).toBeTruthy();
  });
});

/**
 * Issue #1449 (UX audit 2026-11-17, DS-19; WORK-16) — the template editor ends with the kit's
 * sticky save bar: in view while the form scrolls, the secondary action first and the one
 * primary last (Von Restorff, Jakob).
 */
describe('TemplateEditor — the sticky save bar (#1449)', () => {
  it('ends the form with Cancel, then Save last', async () => {
    await open();
    const bar = saveButton().closest<HTMLElement>('[data-slot="sticky-form-actions"]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute('data-desktop', 'sticky');
    expect(
      within(bar!)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([core('common.action.cancel'), en('templates.editor.save')]);
  });
});
