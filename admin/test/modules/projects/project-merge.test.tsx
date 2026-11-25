import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProjectMergePreview, ProjectMergeView } from '@endora-commerce/contracts';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import { setMobileViewport } from '../../setup';
import { PROJECT_ID, ROLES, detail } from './projects-fixtures';

/**
 * `specs/192-organization-merge/` US6, T087 (FR-051, FR-052, FR-080 – FR-083;
 * `contracts/project-merge.md` §4) — the Project merge in the admin: the
 * action on the Project screen for a holder of `projects:merge`, the flow
 * (choose, review, acknowledge, start), the progress view with resume, the
 * archived Project's banner leading to its survivor, the routes and the
 * palette actions in both languages.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => getSpy(...a),
      post: (...a: unknown[]) => postSpy(...a),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ProjectMergeFlow } = await import('../../../../packages/modules/projects/src/admin/merge/ProjectMergeFlow');
const { ProjectMergePage } = await import('../../../../packages/modules/projects/src/admin/pages/ProjectMergePage');
const { ProjectDetail } = await import('../../../../packages/modules/projects/src/admin/pages/ProjectDetail');
const { contributions } = await import('../../../../packages/modules/projects/src/admin/index');
const { manifest } = await import('../../../../packages/modules/projects/src/manifest');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const EN = read('../packages/modules/projects/i18n/en.json');
const PL = read('../packages/modules/projects/i18n/pl.json');
const CORE = read('../packages/modules/_i18n/i18n/en.json');

const LOSER = '00000000-0000-4000-8000-000000192d02';
const SURVIVOR_OF_ARCHIVED = '00000000-0000-4000-8000-000000192d03';
const MERGE = '00000000-0000-4000-8000-000000192d04';

function merge(overrides: Partial<ProjectMergeView> = {}): ProjectMergeView {
  return {
    id: MERGE,
    hostType: 'project',
    survivorId: PROJECT_ID,
    loserId: LOSER,
    state: 'running',
    version: 3,
    source: null,
    actorKind: 'admin',
    actorAdminUserId: null,
    startedAt: '2026-11-25T10:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    needsAttentionAt: null,
    lastErrorCode: null,
    fieldChoices: {},
    customFieldChoices: {},
    steps: [
      { moduleId: 'projects', key: 'host-structure', phase: 'structure', state: 'done', movedCount: 2, deferredReason: null, lastErrorCode: null, trailing: false },
      { moduleId: 'tasks', key: 'project-tasks', phase: 'records', state: 'pending', movedCount: 0, deferredReason: null, lastErrorCode: null, trailing: false },
    ],
    survivorName: 'PRJ-000001 Tender',
    loserName: 'PRJ-000002 Tender (copy)',
    actorName: 'Anna Nowak',
    ...overrides,
  };
}

function preview(overrides: Partial<ProjectMergePreview> = {}): ProjectMergePreview {
  return {
    refusals: [],
    fields: [{ code: 'title', survivor: 'Tender', loser: 'Tender (copy)', default: 'survivor' }],
    customFields: [],
    participants: [
      { moduleId: 'projects', key: 'project-records', phase: 'records', counts: { 'ProjectComment.projectId': 3 }, conflicts: [], warnings: [] },
      { moduleId: 'tasks', key: 'project-tasks', phase: 'records', counts: { 'Task.contextId': 2 }, conflicts: [], warnings: [] },
    ],
    incomplete: [],
    ...overrides,
  };
}

function render(ui: React.ReactElement, path: string, routePath: string, permissions: string[] = ['*']): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={ui} />
            <Route path="/projects/merges/:mergeId" element={<p>progress page</p>} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['projects'] }), contributions: [] },
    ),
    { core: CORE, projects: EN, tasks: { 'module.name': 'Tasks' } },
  );
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/projects?')) {
      return {
        items: [
          { id: PROJECT_ID, number: 'PRJ-000001', title: 'Tender' },
          { id: LOSER, number: 'PRJ-000002', title: 'Tender (copy)' },
        ],
        nextCursor: null,
        total: 2,
      };
    }
    if (url === `/api/v1/admin/projects/${LOSER}`) return { data: detail({ id: LOSER, number: 'PRJ-000002', title: 'Tender (copy)' }) };
    return { data: [] };
  });
});

function renderFlow(onStarted = vi.fn()): ReturnType<typeof renderWithI18n> {
  return render(
    <ProjectMergeFlow survivorId={PROJECT_ID} survivorName="PRJ-000001 Tender" onCancel={vi.fn()} onStarted={onStarted} />,
    '/flow',
    '/flow',
  );
}

async function pickDuplicate(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: EN['merge.flow.picker']! }));
  await user.click(await screen.findByRole('option', { name: /PRJ-000002/ }));
  fireEvent.click(screen.getByRole('button', { name: EN['merge.flow.next']! }));
}

describe('the Project merge flow', () => {
  it('never offers the Project itself as its duplicate', async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole('combobox', { name: EN['merge.flow.picker']! }));
    expect(await screen.findByRole('option', { name: /PRJ-000002/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /PRJ-000001/ })).toBeNull();
  });

  it('starts only after the irreversible acknowledgement, sending the chosen values', async () => {
    postSpy.mockResolvedValueOnce({ data: preview() });
    postSpy.mockResolvedValueOnce({ data: merge() });
    const onStarted = vi.fn();
    const user = userEvent.setup();
    renderFlow(onStarted);
    await pickDuplicate(user);
    expect(await screen.findByText(/Tasks \(project-tasks\)/)).toBeInTheDocument();
    const title = await screen.findByRole('radiogroup', { name: EN['merge.field.title']! });
    await user.click(within(title).getByRole('radio', { name: /Tender \(copy\)/ }));
    fireEvent.click(screen.getByRole('button', { name: EN['merge.flow.next']! }));
    const start = screen.getByRole('button', { name: EN['merge.flow.start']! });
    expect(start).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: EN['merge.flow.acknowledge']! }));
    await user.click(start);
    await waitFor(() =>
      expect(postSpy).toHaveBeenLastCalledWith(`/api/v1/admin/projects/${PROJECT_ID}/merges`, {
        loserId: LOSER,
        fieldChoices: { title: 'loser' },
        customFieldChoices: {},
        acknowledgeIrreversible: true,
      }),
    );
    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: MERGE }));
  });

  it('shows a refusal in words and goes no further', async () => {
    postSpy.mockResolvedValueOnce({ data: preview({ refusals: [{ code: 'PROJECT_MERGED' }] }) });
    const user = userEvent.setup();
    renderFlow();
    await pickDuplicate(user);
    expect(await screen.findByText(EN['errors.PROJECT_MERGED']!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN['merge.flow.next']! })).toBeDisabled();
  });

  it('has no axe violations', async () => {
    const { container } = renderFlow();
    await expectNoAxeViolations(container);
  });
});

describe('the progress view', () => {
  it('resumes a merge that needs attention', async () => {
    getSpy.mockResolvedValue({ data: merge({ state: 'needs_attention', lastErrorCode: 'RECORD_MERGE_RESIDUE' }) });
    postSpy.mockResolvedValue({ data: merge({ state: 'running', version: 4 }) });
    const user = userEvent.setup();
    render(<ProjectMergePage />, `/projects/merges/${MERGE}`, '/projects/merges/:mergeId');
    await user.click(await screen.findByRole('button', { name: EN['merge.action.resume']! }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/project-merges/${MERGE}/resume`, { expectedVersion: 3 }),
    );
  });
});

describe('the Project screen and the merge', () => {
  const serveDetail = (project: Record<string, unknown>, merges: ProjectMergeView[] = []): void => {
    getSpy.mockImplementation(async (url: string) => {
      if (url === `/api/v1/admin/projects/${PROJECT_ID}`) return { data: project };
      if (url === '/api/v1/admin/projects/roles') return { data: ROLES };
      if (url.startsWith('/api/v1/admin/project-merges?')) return { data: merges };
      if (url === `/api/v1/admin/project-merges/${MERGE}`) return { data: merges[0] };
      return { data: [] };
    });
  };
  const renderDetail = (permissions: string[]) =>
    render(<ProjectDetail />, `/projects/${PROJECT_ID}`, '/projects/:id', permissions);

  it('offers the merge to a holder of projects:merge, and opens the flow', async () => {
    serveDetail(detail({}));
    renderDetail(['projects:read', 'projects:write', 'projects:merge']);
    fireEvent.click(await screen.findByRole('button', { name: EN['merge.action.open']! }));
    expect(await screen.findByRole('dialog', { name: EN['merge.flow.title']! })).toBeInTheDocument();
  });

  it('offers no merge without projects:merge, and reads no merges', async () => {
    serveDetail(detail({}));
    renderDetail(['projects:read', 'projects:write']);
    expect(await screen.findByRole('button', { name: EN['detail.delete']! })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['merge.action.open']! })).toBeNull();
    expect(getSpy.mock.calls.some(([url]) => String(url).includes('project-merges'))).toBe(false);
  });

  it('shows an archived Project read-only, with its banner leading to the survivor', async () => {
    serveDetail(
      detail({
        mergedIntoProjectId: SURVIVOR_OF_ARCHIVED,
        mergedAt: '2026-11-25T10:05:00.000Z',
        mergeId: MERGE,
        permissions: { canWrite: false, canConfigure: false },
      }),
      [merge({ state: 'completed', survivorId: SURVIVOR_OF_ARCHIVED, loserId: PROJECT_ID, survivorName: 'PRJ-000009 Tender' })],
    );
    renderDetail(['projects:read', 'projects:write', 'projects:merge']);
    expect(await screen.findByText(EN['merge.banner.title']!)).toBeInTheDocument();
    expect((await screen.findByRole('link', { name: 'PRJ-000009 Tender' })).getAttribute('href')).toBe(
      `/projects/${SURVIVOR_OF_ARCHIVED}`,
    );
    expect(screen.queryByRole('button', { name: EN['merge.action.open']! })).toBeNull();
    expect(screen.queryByRole('button', { name: EN['detail.delete']! })).toBeNull();
  });
});

describe('routes, palette and wording', () => {
  it('declares the merge screens ahead of /:id under the codes their APIs enforce', () => {
    const paths = contributions.routes!.map((route) => route.path);
    const detailAt = paths.indexOf('/projects/:id');
    for (const [path, permission] of [
      ['/projects/merge', 'projects:merge'],
      ['/projects/merges', 'projects:merge'],
      ['/projects/merges/:mergeId', 'projects:read'],
    ] as const) {
      const at = paths.indexOf(path);
      expect(at, path).toBeGreaterThanOrEqual(0);
      expect(at, path).toBeLessThan(detailAt);
      expect(contributions.routes![at]!.requiredPermission).toBe(permission);
    }
  });

  it('offers merge-projects and open-project-merges under projects:merge, labelled in both languages', () => {
    for (const id of ['merge-projects', 'open-project-merges']) {
      const action = manifest.actions!.find((candidate) => candidate.id === id)!;
      expect(action.requiredPermission).toBe('projects:merge');
      expect(EN[action.labelKey]).toBeTruthy();
      expect(PL[action.labelKey]).toBeTruthy();
    }
  });

  it('ships every merge string in Polish as well as English', () => {
    const keys = Object.keys(EN).filter((key) => key.startsWith('merge.') || key.includes('Merge') || key.includes(':merge'));
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) expect(PL[key], key).toBeTruthy();
  });
});
