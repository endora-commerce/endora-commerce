import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { ProjectDetail, RecordHistoryEntry } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  ADMIN_ID,
  LOSS_REASONS,
  ORGANIZATION_ID,
  PROJECT_ID,
  ROLES,
  ROLE_MANAGER,
  ROLE_SALES_REP,
  STAGE_BUILD,
  STAGE_DESIGN,
  STAGE_HANDOVER,
  detail,
  en,
  pl,
  renderProjects,
} from './projects-fixtures';

/**
 * Issue #460 — a Project's *Change history* on a par with CRM's: who the
 * members are by name, Stages by name, the nested changes — members and their
 * Roles, the workflow's moves, a Stage's tasks — as lines in words, and every
 * code (a comment's kind, a note, a loss reason) in the reader's language.
 *
 * The audit entries carry ids and codes, never names (D-288,
 * `specs/conventions/audit-state.md`): every name here is the screen's to
 * find — the Project's own Stages, Members, Organizations and listed people,
 * the Roles and loss-reason dictionaries, the entries' actors — and an id it
 * cannot name reads as a former one, never as the id.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { ProjectHistory } = await import('../../../../packages/modules/projects/src/admin/components/ProjectHistory');

const HISTORY_PATH = `/api/v1/admin/projects/${PROJECT_ID}/history`;
const BOB = '00000000-0000-4000-8000-000000000c02';
const GONE = '00000000-0000-4000-8000-000000000c09';
const VIEWER = '00000000-0000-4000-8000-000000000c03';
const REMOVED_STAGE = '00000000-0000-4000-8000-000000000d09';
const ID = (n: number): string => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, '0')}`;

function entry(n: number, action: string, before: unknown, after: unknown): RecordHistoryEntry {
  return {
    id: ID(n),
    actedAt: `2026-10-25T12:${String(60 - n).padStart(2, '0')}:00.000Z`,
    action,
    actor: { kind: 'admin', id: ADMIN_ID, name: 'Anna Nowak' },
    before,
    after,
    references: [],
  };
}

function project(): ProjectDetail {
  return detail({
    viewers: [{ id: VIEWER, name: 'Vera Viewer' }],
    members: [
      {
        id: '00000000-0000-4000-8000-000000000b01',
        adminUser: { id: ADMIN_ID, name: 'Anna Nowak', active: true },
        roles: [{ id: ROLE_MANAGER, name: 'Project Manager', archived: false }],
        addedAt: '2026-10-20T10:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000b02',
        adminUser: { id: BOB, name: 'Bob Kowalski', active: true },
        roles: [{ id: ROLE_SALES_REP, name: 'Sales Rep', archived: false }],
        addedAt: '2026-10-21T10:00:00.000Z',
      },
    ],
  });
}

let entries: RecordHistoryEntry[];

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  entries = [];
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith(HISTORY_PATH)) {
      return Promise.resolve({ data: entries, pagination: { cursor: null, hasMore: false, limit: 50 }, truncated: false });
    }
    if (path.startsWith('/api/v1/admin/projects/roles')) return Promise.resolve({ data: ROLES });
    if (path.startsWith('/api/v1/admin/projects/loss-reasons')) return Promise.resolve({ data: LOSS_REASONS });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderHistory(language: 'en' | 'pl' = 'en'): Promise<HTMLElement> {
  renderProjects(<ProjectHistory project={project()} />, { language });
  const say = language === 'pl' ? pl : en;
  const first = entries[0];
  if (first) await screen.findByRole('heading', { name: say(`auditLog.${first.action}`) });
  return document.body;
}

/** The entry under the heading `action`, as one element. */
function entryOf(action: string, say: (key: string) => string = en): HTMLElement {
  return screen.getByRole('heading', { name: say(`auditLog.${action}`) }).closest('li') as HTMLElement;
}

describe('Project change history — names and nested changes (issue #460)', () => {
  it('lists the members a change added, removed and gave other Roles, by name and Role', async () => {
    entries = [
      entry(
        1,
        'projects.project.member_set',
        {
          members: [
            { adminUserId: ADMIN_ID, roleIds: [ROLE_MANAGER] },
            { adminUserId: GONE, roleIds: [ROLE_SALES_REP] },
          ],
        },
        {
          members: [
            { adminUserId: ADMIN_ID, roleIds: [ROLE_MANAGER, ROLE_SALES_REP] },
            { adminUserId: BOB, roleIds: [ROLE_SALES_REP] },
          ],
        },
      ),
    ];
    await renderHistory();
    const shown = entryOf('projects.project.member_set');
    expect(within(shown).getByText(en('history.field.members'))).toBeInTheDocument();
    expect(await within(shown).findByText(en('history.members.added', { name: 'Bob Kowalski', roles: 'Sales Rep' }))).toBeInTheDocument();
    expect(
      within(shown).getByText(en('history.members.removed', { name: en('history.value.formerMember') })),
    ).toBeInTheDocument();
    expect(
      within(shown).getByText(
        en('history.members.rolesChanged', {
          name: 'Anna Nowak',
          before: 'Project Manager',
          after: 'Project Manager, Sales Rep',
        }),
      ),
    ).toBeInTheDocument();
    expect(shown).not.toHaveTextContent(GONE);
    expect(shown).not.toHaveTextContent(ROLE_SALES_REP);
  });

  it('names the listed people and the Organizations by name', async () => {
    entries = [
      entry(1, 'projects.project.viewers_set', { viewerIds: [] }, { viewerIds: [VIEWER, GONE] }),
      entry(2, 'projects.project.organization_add', null, { organizationId: ORGANIZATION_ID }),
    ];
    await renderHistory();
    const viewers = entryOf('projects.project.viewers_set');
    expect(within(viewers).getByText(en('history.field.viewerIds'))).toBeInTheDocument();
    expect(viewers).toHaveTextContent(`Vera Viewer, ${en('history.value.formerMember')}`);
    const organization = entryOf('projects.project.organization_add');
    expect(within(organization).getByText(en('history.field.organizationId'))).toBeInTheDocument();
    expect(within(organization).getByText('Acme')).toBeInTheDocument();
  });

  it('shows a Stage move by the Stages’ names, and a Stage it no longer has by the name it had', async () => {
    entries = [
      entry(
        1,
        'projects.project.stage_move',
        { stageId: STAGE_DESIGN, stageName: 'Design (old name)', version: 3 },
        { stageId: STAGE_BUILD, stageName: 'Build', startedOn: '2026-10-25', deadlineOn: null, version: 4, notes: ['stage_tasks_skipped'] },
      ),
      entry(2, 'projects.project.stage_delete', { stageId: REMOVED_STAGE, name: 'Snagging', position: 4 }, null),
    ];
    await renderHistory();
    const move = entryOf('projects.project.stage_move');
    expect(within(move).getByText(en('history.field.stageId'))).toBeInTheDocument();
    expect(within(move).getByText('Design')).toBeInTheDocument();
    expect(within(move).getByText('Build')).toBeInTheDocument();
    expect(within(move).getByText(en('history.note.stage_tasks_skipped'))).toBeInTheDocument();
    expect(move).not.toHaveTextContent('stage_tasks_skipped');
    expect(move).not.toHaveTextContent(STAGE_DESIGN);
    const removed = entryOf('projects.project.stage_delete');
    expect(within(removed).getByText(en('history.lead.stage', { stage: 'Snagging' }))).toBeInTheDocument();
  });

  it('lists the workflow’s moves a change allowed and withdrew, by Stage name', async () => {
    entries = [
      entry(
        1,
        'projects.project.moves_set',
        { moves: [{ fromStageId: STAGE_DESIGN, toStageId: STAGE_BUILD }] },
        {
          moves: [
            { fromStageId: STAGE_BUILD, toStageId: STAGE_HANDOVER },
            { fromStageId: STAGE_DESIGN, toStageId: STAGE_HANDOVER },
          ],
        },
      ),
    ];
    await renderHistory();
    const workflow = entryOf('projects.project.moves_set');
    expect(within(workflow).getByText(en('history.field.moves'))).toBeInTheDocument();
    expect(within(workflow).getByText(en('history.moves.added', { from: 'Build', to: 'Handover' }))).toBeInTheDocument();
    expect(within(workflow).getByText(en('history.moves.added', { from: 'Design', to: 'Handover' }))).toBeInTheDocument();
    expect(within(workflow).getByText(en('history.moves.removed', { from: 'Design', to: 'Build' }))).toBeInTheDocument();
  });

  it('lists a Stage’s tasks a change added, removed and changed, under the Stage’s name', async () => {
    entries = [
      entry(
        1,
        'projects.project.stage_tasks_set',
        {
          stageId: STAGE_BUILD,
          tasks: [
            { title: 'Order racking', descriptionLength: 0, responsibleRoleId: null, dueOffsetDays: 2, position: 1 },
            { title: 'Book crane', descriptionLength: 0, responsibleRoleId: null, dueOffsetDays: 5, position: 2 },
          ],
        },
        {
          stageId: STAGE_BUILD,
          tasks: [
            { title: 'Order racking', descriptionLength: 0, responsibleRoleId: ROLE_SALES_REP, dueOffsetDays: 3, position: 1 },
            { title: 'Install lights', descriptionLength: 4, responsibleRoleId: null, dueOffsetDays: 7, position: 2 },
          ],
        },
      ),
    ];
    await renderHistory();
    const tasks = entryOf('projects.project.stage_tasks_set');
    expect(within(tasks).getByText(en('history.lead.stage', { stage: 'Build' }))).toBeInTheDocument();
    expect(within(tasks).getByText(en('history.field.tasks'))).toBeInTheDocument();
    expect(within(tasks).getByText(en('history.tasks.added', { title: 'Install lights' }))).toBeInTheDocument();
    expect(within(tasks).getByText(en('history.tasks.removed', { title: 'Book crane' }))).toBeInTheDocument();
    expect(within(tasks).getByText(en('history.tasks.changed', { title: 'Order racking' }))).toBeInTheDocument();
  });

  it('labels a Stage’s own fields and names its responsible Roles', async () => {
    entries = [
      entry(
        1,
        'projects.project.stage_update',
        { stageId: STAGE_BUILD, plannedDurationDays: 10, responsibleRoleIds: [], completionGate: false },
        { stageId: STAGE_BUILD, plannedDurationDays: 12, responsibleRoleIds: [ROLE_MANAGER], completionGate: true },
      ),
    ];
    await renderHistory();
    const update = entryOf('projects.project.stage_update');
    expect(within(update).getByText(en('history.lead.stage', { stage: 'Build' }))).toBeInTheDocument();
    for (const field of ['plannedDurationDays', 'responsibleRoleIds', 'completionGate']) {
      expect(within(update).getByText(en(`history.field.${field}`))).toBeInTheDocument();
    }
    expect(await within(update).findByText('Project Manager')).toBeInTheDocument();
    expect(update).not.toHaveTextContent(ROLE_MANAGER);
  });

  it('names a comment’s kind and a loss reason in the reader’s language', async () => {
    entries = [
      entry(1, 'projects.project.message_add', null, { commentId: ID(80), kind: 'message', length: 12 }),
      entry(2, 'projects.project.close', { state: 'open', version: 4 }, {
        state: 'lost',
        stageId: STAGE_BUILD,
        stageName: 'Build',
        lossReasonCode: 'price',
        lossCommentLength: 10,
        version: 5,
      }),
    ];
    await renderHistory('pl');
    const message = entryOf('projects.project.message_add', pl);
    expect(within(message).getByText(pl('history.value.kind.message'))).toBeInTheDocument();
    expect(message).not.toHaveTextContent(/\bmessage\b/);
    const close = entryOf('projects.project.close', pl);
    expect(await within(close).findByText('Price')).toBeInTheDocument();
    expect(within(close).getByText(pl('history.field.lossReasonCode'))).toBeInTheDocument();
    expect(within(close).getByText(pl('history.lead.stage').replace('{stage}', 'Build'))).toBeInTheDocument();
  });

  it('names Stages, tasks and files from the Project and the stored values in entries written since #1226', async () => {
    // Since #1226 the audit log names a Stage by id and a task by position; the
    // server puts back the names its own store kept (a Stage's name, a task's
    // title, a file's name) and the rest is named from the Project.
    entries = [
      entry(
        1,
        'projects.project.stage_move',
        { stageId: STAGE_DESIGN, version: 3 },
        { stageId: STAGE_BUILD, startedOn: '2026-10-25', deadlineOn: null, version: 4 },
      ),
      entry(2, 'projects.project.close', { state: 'open', version: 4 }, {
        state: 'lost',
        stageId: STAGE_BUILD,
        lossReasonCode: 'price',
        lossCommentLength: 10,
        version: 5,
      }),
      entry(
        3,
        'projects.project.stage_tasks_set',
        { stageId: STAGE_BUILD, tasks: [{ descriptionLength: 0, responsibleRoleId: null, dueOffsetDays: 2, position: 1 }] },
        { stageId: STAGE_BUILD, tasks: [{ descriptionLength: 0, responsibleRoleId: null, dueOffsetDays: 3, position: 1 }] },
      ),
      entry(4, 'projects.project.stage_delete', { stageId: REMOVED_STAGE, name: 'Snagging', position: 4 }, null),
      entry(5, 'projects.project.create', null, {
        number: 'PRJ-000001',
        state: 'open',
        stageIds: [STAGE_DESIGN, REMOVED_STAGE, STAGE_BUILD],
        version: 1,
      }),
    ];
    await renderHistory();
    const move = entryOf('projects.project.stage_move');
    expect(within(move).getByText('Design')).toBeInTheDocument();
    expect(within(move).getByText('Build')).toBeInTheDocument();
    const close = entryOf('projects.project.close');
    expect(within(close).getByText(en('history.lead.stage', { stage: 'Build' }))).toBeInTheDocument();
    // A task whose title did not change has none in the entry: it is named by its place.
    const tasks = entryOf('projects.project.stage_tasks_set');
    expect(within(tasks).getByText(en('history.tasks.changed', { title: en('history.tasks.numbered', { position: 1 }) }))).toBeInTheDocument();
    // A Stage the Project no longer has is named by the name its deletion served.
    const create = entryOf('projects.project.create');
    expect(create).toHaveTextContent('Design, Snagging, Build');
    for (const shown of [move, close, tasks, create]) {
      expect(shown).not.toHaveTextContent(STAGE_DESIGN);
      expect(shown).not.toHaveTextContent(REMOVED_STAGE);
    }
  });

  it('ships every new sentence in both languages', () => {
    const keys = [
      'history.field.members',
      'history.field.viewerIds',
      'history.field.organizationId',
      'history.field.stageId',
      'history.field.moves',
      'history.field.tasks',
      'history.field.notes',
      'history.field.lossReasonCode',
      'history.field.plannedDurationDays',
      'history.field.responsibleRoleIds',
      'history.field.completionGate',
      'history.members.added',
      'history.members.removed',
      'history.members.rolesChanged',
      'history.moves.added',
      'history.moves.removed',
      'history.tasks.added',
      'history.tasks.removed',
      'history.tasks.changed',
      'history.lead.stage',
      'history.value.formerMember',
      'history.value.formerOrganization',
      'history.value.formerStage',
      'history.value.kind.note',
      'history.value.kind.message',
    ];
    for (const key of keys) {
      expect(en(key), key).not.toBe('');
      expect(pl(key), key).not.toBe('');
    }
  });
});
