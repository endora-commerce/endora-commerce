import { describe, expect, it } from 'vitest';
import * as projects from './projects.js';

/**
 * `specs/163-projects-and-tasks/contracts/admin-api.md` §2.1–§2.6 — one accept
 * and one reject case per request schema of the Projects API, the validation
 * rules of `data-model.md` §4 (title bounds, a two-decimal value with its
 * currency, alert offsets 1–365 and distinct, the `close` body discriminated on
 * `outcome`, the visibility enum), and the event names of
 * `contracts/ports-and-events.md` §2.
 */

const UUID_A = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const UUID_B = '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02';
const UUID_C = '2c4d6e8f-1a3b-4c5d-8e7f-9a0b1c2d3e03';

function accepts(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(true);
}

function rejects(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

describe('vocabulary', () => {
  it('states, own visibility and the module setting are the enums of data-model.md', () => {
    expect(projects.projectStateSchema.options).toEqual(['open', 'completed', 'lost']);
    expect(projects.projectVisibilitySchema.options).toEqual(['inherit', 'everyone', 'members_and_listed']);
    expect(projects.projectVisibilitySettingSchema.options).toEqual(['everyone', 'members']);
    expect(projects.projectRecordKindSchema.options).toEqual(['order', 'quote_request', 'opportunity']);
  });
});

describe('§2.1 GET /projects — ProjectListQuery', () => {
  it('accepts the documented filters and normalises a single state to an array', () => {
    const parsed = projects.ProjectListQuerySchema.parse({
      state: 'open',
      organizationId: UUID_A,
      memberId: 'me',
      roleId: UUID_B,
      templateId: UUID_C,
      stageName: 'Design',
      q: 'PRJ-0001',
      sort: 'deadline',
      limit: '20',
    });
    expect(parsed.state).toEqual(['open']);
    expect(parsed.limit).toBe(20);
    accepts(projects.ProjectListQuerySchema, { memberId: UUID_A, state: ['completed', 'lost'] });
  });

  it('defaults the limit and refuses more than 100, an unknown state, sort or member token', () => {
    expect(projects.ProjectListQuerySchema.parse({}).limit).toBe(50);
    rejects(projects.ProjectListQuerySchema, { limit: '101' });
    rejects(projects.ProjectListQuerySchema, { state: 'closed' });
    rejects(projects.ProjectListQuerySchema, { sort: 'title' });
    rejects(projects.ProjectListQuerySchema, { memberId: 'nobody' });
  });
});

describe('§2.1 POST /projects — CreateProjectBody', () => {
  it('accepts a title with no Organization (internal) and the full body', () => {
    accepts(projects.CreateProjectBodySchema, { title: 'Showroom fit-out', organizationIds: [] });
    accepts(projects.CreateProjectBodySchema, {
      title: 'Showroom fit-out',
      description: 'For [[admin_user:' + UUID_A + ']]',
      value: { amount: '125000.50', currency: 'PLN' },
      startOn: '2026-11-02',
      organizationIds: [UUID_A, UUID_B],
      templateId: UUID_C,
      members: [{ adminUserId: UUID_A, roleIds: [UUID_B, UUID_C] }, { adminUserId: UUID_B, roleIds: [] }],
      visibility: 'members_and_listed',
      viewerIds: [UUID_C],
      customFieldValues: { budget_line: 'A1' },
    });
  });

  it('accepts the Project’s Stages in order and refuses an empty list or a Stage without a colour', () => {
    accepts(projects.CreateProjectBodySchema, {
      title: 'x',
      organizationIds: [],
      stages: [
        { name: 'Design', color: '#3b82f6', plannedDurationDays: 10 },
        { name: 'Delivery', color: '#22c55e', completionPermitted: true },
      ],
    });
    rejects(projects.CreateProjectBodySchema, { title: 'x', organizationIds: [], stages: [] });
    rejects(projects.CreateProjectBodySchema, { title: 'x', organizationIds: [], stages: [{ name: 'Design' }] });
    rejects(projects.CreateProjectBodySchema, {
      title: 'x',
      organizationIds: [],
      stages: [{ name: 'Design', color: '#3b82f6', alertOffsetsDays: [3, 3] }],
    });
  });

  it('refuses a missing, empty or over-long title', () => {
    rejects(projects.CreateProjectBodySchema, { organizationIds: [] });
    rejects(projects.CreateProjectBodySchema, { title: ' ', organizationIds: [] });
    rejects(projects.CreateProjectBodySchema, { title: 'x'.repeat(201), organizationIds: [] });
    accepts(projects.CreateProjectBodySchema, { title: 'x'.repeat(200), organizationIds: [] });
  });

  it('refuses a value with more than two decimals, a negative value, or one without its currency', () => {
    rejects(projects.CreateProjectBodySchema, {
      title: 'x',
      organizationIds: [],
      value: { amount: '10.005', currency: 'PLN' },
    });
    rejects(projects.CreateProjectBodySchema, {
      title: 'x',
      organizationIds: [],
      value: { amount: '-1', currency: 'PLN' },
    });
    rejects(projects.CreateProjectBodySchema, { title: 'x', organizationIds: [], value: { amount: '10' } });
    rejects(projects.CreateProjectBodySchema, { title: 'x', organizationIds: [], value: { currency: 'PLN' } });
    rejects(projects.CreateProjectBodySchema, {
      title: 'x',
      organizationIds: [],
      value: { amount: '10', currency: 'zł' },
    });
  });

  it('refuses an unknown visibility, a duplicated Organization and a duplicated Member', () => {
    rejects(projects.CreateProjectBodySchema, { title: 'x', organizationIds: [], visibility: 'members' });
    rejects(projects.CreateProjectBodySchema, { title: 'x', organizationIds: [UUID_A, UUID_A] });
    rejects(projects.CreateProjectBodySchema, {
      title: 'x',
      organizationIds: [],
      members: [
        { adminUserId: UUID_A, roleIds: [] },
        { adminUserId: UUID_A, roleIds: [UUID_B] },
      ],
    });
  });
});

describe('§2.1 PATCH /projects/:id — UpdateProjectBody', () => {
  it('accepts one field with the version, and a cleared value', () => {
    accepts(projects.UpdateProjectBodySchema, { title: 'Renamed', version: 3 });
    accepts(projects.UpdateProjectBodySchema, { value: null, visibility: 'inherit', version: 1 });
  });

  it('refuses a body without the version, and organizationIds (they have their own route)', () => {
    rejects(projects.UpdateProjectBodySchema, { title: 'Renamed' });
    rejects(projects.UpdateProjectBodySchema, { organizationIds: [UUID_A], version: 1 });
  });
});

describe('§2.1 PUT /projects/:id/organizations and /members', () => {
  it('accepts a set, including the empty set', () => {
    accepts(projects.SetProjectOrganizationsBodySchema, { organizationIds: [] });
    accepts(projects.SetProjectOrganizationsBodySchema, { organizationIds: [UUID_A] });
    accepts(projects.SetProjectMembersBodySchema, { members: [{ adminUserId: UUID_A, roleIds: [UUID_B] }] });
  });

  it('refuses a non-uuid Organization and a Member with a duplicated Role', () => {
    rejects(projects.SetProjectOrganizationsBodySchema, { organizationIds: ['acme'] });
    rejects(projects.SetProjectMembersBodySchema, {
      members: [{ adminUserId: UUID_A, roleIds: [UUID_B, UUID_B] }],
    });
  });
});

describe('§2.2 Stages', () => {
  it('create: accepts a name and colour with the documented attributes', () => {
    accepts(projects.CreateProjectStageBodySchema, { name: 'Design', color: '#3366ff' });
    accepts(projects.CreateProjectStageBodySchema, {
      name: 'Design',
      color: '#3366FF',
      plannedDurationDays: 14,
      responsibleRoleIds: [UUID_A],
      alertOffsetsDays: [1, 3, 7],
      completionGate: true,
      completionPermitted: false,
    });
  });

  it('create: refuses a long name, a bad colour, a duration above 3 650 days', () => {
    rejects(projects.CreateProjectStageBodySchema, { name: 'x'.repeat(81), color: '#3366ff' });
    rejects(projects.CreateProjectStageBodySchema, { name: 'Design', color: 'blue' });
    rejects(projects.CreateProjectStageBodySchema, { name: 'Design', color: '#3366ff', plannedDurationDays: 3651 });
  });

  it('alert offsets are whole days 1–365, each once', () => {
    accepts(projects.CreateProjectStageBodySchema, { name: 'D', color: '#000000', alertOffsetsDays: [1, 365] });
    rejects(projects.CreateProjectStageBodySchema, { name: 'D', color: '#000000', alertOffsetsDays: [0] });
    rejects(projects.CreateProjectStageBodySchema, { name: 'D', color: '#000000', alertOffsetsDays: [366] });
    rejects(projects.CreateProjectStageBodySchema, { name: 'D', color: '#000000', alertOffsetsDays: [3, 3] });
    rejects(projects.CreateProjectStageBodySchema, { name: 'D', color: '#000000', alertOffsetsDays: [1.5] });
  });

  it('update: accepts a partial body and a manual deadline, or null to recompute it', () => {
    accepts(projects.UpdateProjectStageBodySchema, { name: 'Delivery' });
    accepts(projects.UpdateProjectStageBodySchema, { deadlineOn: '2026-12-01' });
    accepts(projects.UpdateProjectStageBodySchema, { deadlineOn: null });
  });

  it('update: refuses an empty body and a non-date deadline', () => {
    rejects(projects.UpdateProjectStageBodySchema, {});
    rejects(projects.UpdateProjectStageBodySchema, { deadlineOn: 'soon' });
  });

  it('order: accepts the Stage ids, refuses a duplicate or an empty list', () => {
    accepts(projects.ReorderProjectStagesBodySchema, { stageIds: [UUID_A, UUID_B] });
    rejects(projects.ReorderProjectStagesBodySchema, { stageIds: [UUID_A, UUID_A] });
    rejects(projects.ReorderProjectStagesBodySchema, { stageIds: [] });
  });

  it('moves: accepts a set (possibly empty), refuses a move from a Stage to itself', () => {
    accepts(projects.SetProjectMovesBodySchema, { moves: [] });
    accepts(projects.SetProjectMovesBodySchema, {
      moves: [
        { fromStageId: UUID_A, toStageId: UUID_B },
        { fromStageId: UUID_B, toStageId: UUID_A },
      ],
    });
    rejects(projects.SetProjectMovesBodySchema, { moves: [{ fromStageId: UUID_A, toStageId: UUID_A }] });
  });

  it('Stage Tasks: accepts definitions, refuses more than 100 or a negative offset', () => {
    accepts(projects.SetProjectStageTasksBodySchema, {
      tasks: [
        { title: 'Measure', dueOffsetDays: 0 },
        { title: 'Order panels', description: 'From the usual supplier', responsibleRoleId: UUID_A, dueOffsetDays: 5 },
      ],
    });
    rejects(projects.SetProjectStageTasksBodySchema, {
      tasks: Array.from({ length: 101 }, () => ({ title: 'x', dueOffsetDays: 0 })),
    });
    rejects(projects.SetProjectStageTasksBodySchema, { tasks: [{ title: 'x', dueOffsetDays: -1 }] });
    rejects(projects.SetProjectStageTasksBodySchema, { tasks: [{ title: '', dueOffsetDays: 0 }] });
  });
});

describe('§2.2 move, close, reopen', () => {
  it('move: needs the target Stage and the version', () => {
    accepts(projects.MoveProjectBodySchema, { toStageId: UUID_A, version: 2 });
    rejects(projects.MoveProjectBodySchema, { toStageId: UUID_A });
    rejects(projects.MoveProjectBodySchema, { toStageId: 'next', version: 2 });
  });

  it('close: discriminated on outcome — completed needs nothing more, lost needs a reason', () => {
    accepts(projects.CloseProjectBodySchema, { outcome: 'completed', version: 4 });
    accepts(projects.CloseProjectBodySchema, { outcome: 'lost', lossReasonId: UUID_A, version: 4 });
    accepts(projects.CloseProjectBodySchema, {
      outcome: 'lost',
      lossReasonId: UUID_A,
      comment: 'Went with the competitor',
      version: 4,
    });
    rejects(projects.CloseProjectBodySchema, { outcome: 'lost', version: 4 });
    rejects(projects.CloseProjectBodySchema, { outcome: 'cancelled', version: 4 });
    rejects(projects.CloseProjectBodySchema, { outcome: 'completed' });
    rejects(projects.CloseProjectBodySchema, {
      outcome: 'lost',
      lossReasonId: UUID_A,
      comment: 'x'.repeat(2001),
      version: 4,
    });
  });

  it('reopen: needs the version', () => {
    accepts(projects.ReopenProjectBodySchema, { version: 5 });
    rejects(projects.ReopenProjectBodySchema, {});
  });
});

describe('§2.3 links and the record panel', () => {
  it('link: accepts the three record kinds, refuses a Task or a Product', () => {
    accepts(projects.CreateProjectLinkBodySchema, { kind: 'order', recordId: UUID_A });
    accepts(projects.CreateProjectLinkBodySchema, { kind: 'quote_request', recordId: UUID_A });
    accepts(projects.CreateProjectLinkBodySchema, { kind: 'opportunity', recordId: UUID_A });
    rejects(projects.CreateProjectLinkBodySchema, { kind: 'task', recordId: UUID_A });
    rejects(projects.CreateProjectLinkBodySchema, { kind: 'product', recordId: UUID_A });
  });

  it('panel: the record kinds are the three link kinds and a Task (R-11)', () => {
    accepts(projects.RecordProjectParamsSchema, { kind: 'task', recordId: UUID_A });
    accepts(projects.RecordProjectParamsSchema, { kind: 'opportunity', recordId: UUID_A });
    rejects(projects.RecordProjectParamsSchema, { kind: 'invoice', recordId: UUID_A });
  });
});

describe('§2.4 collaboration', () => {
  it('comments: list by kind; create a note or a message; refuse an empty or over-long body', () => {
    accepts(projects.ProjectCommentListQuerySchema, { kind: 'message' });
    rejects(projects.ProjectCommentListQuerySchema, { kind: 'chat' });
    accepts(projects.CreateProjectCommentBodySchema, { kind: 'note', body: 'Called the client.' });
    rejects(projects.CreateProjectCommentBodySchema, { kind: 'note', body: '' });
    rejects(projects.CreateProjectCommentBodySchema, { kind: 'note', body: 'x'.repeat(20_001) });
    accepts(projects.UpdateProjectCommentBodySchema, { body: 'Edited.' });
    rejects(projects.UpdateProjectCommentBodySchema, { kind: 'message', body: 'x' });
  });

  it('read marker: names a message', () => {
    accepts(projects.MarkProjectMessagesReadBodySchema, { throughMessageId: UUID_A });
    rejects(projects.MarkProjectMessagesReadBodySchema, { throughMessageId: '2026-10-26T10:00:00Z' });
  });

  it('attachment: an asset id', () => {
    accepts(projects.CreateProjectAttachmentBodySchema, { assetId: UUID_A });
    rejects(projects.CreateProjectAttachmentBodySchema, { assetId: 'file.pdf' });
  });

  it('lookups: the Project and a search', () => {
    accepts(projects.ProjectMentionableLookupQuerySchema, { projectId: UUID_A, q: 'an' });
    accepts(projects.ProjectMentionableLookupQuerySchema, {});
    rejects(projects.ProjectMentionableLookupQuerySchema, { projectId: 'PRJ-1' });
    accepts(projects.ProjectDocumentLookupQuerySchema, { projectId: UUID_A, q: 'ORD' });
    rejects(projects.ProjectDocumentLookupQuerySchema, { q: 'x'.repeat(201) });
  });

  it('lookups for the pickers: a search or one id, at most 50', () => {
    for (const schema of [projects.ProjectOrganizationLookupQuerySchema, projects.ProjectAdminUserLookupQuerySchema]) {
      expect(schema.parse({})).toEqual({ limit: 20 });
      accepts(schema, { q: 'acme', limit: '50' });
      accepts(schema, { id: UUID_A });
      rejects(schema, { id: 'acme' });
      rejects(schema, { limit: '51' });
    }
    accepts(projects.ProjectAdminUserOptionSchema, { id: UUID_A, name: 'Anna Nowak', email: 'anna@example.com' });
    rejects(projects.ProjectOrganizationOptionSchema, { id: UUID_A });
  });

  it('the module visibility setting, as a screen reads it', () => {
    accepts(projects.ProjectVisibilitySettingSchema, { setting: 'members' });
    rejects(projects.ProjectVisibilitySettingSchema, { setting: 'members_and_listed' });
  });
});

describe('§2.5 configuration', () => {
  it('the Role and loss-reason lists take an `active` filter, true or false', () => {
    expect(projects.ProjectDictionaryListQuerySchema.parse({ active: 'true' }).active).toBe('true');
    accepts(projects.ProjectDictionaryListQuerySchema, {});
    rejects(projects.ProjectDictionaryListQuerySchema, { active: 'yes' });
  });

  it('Roles and loss reasons: a name per language and a fallback name', () => {
    accepts(projects.CreateProjectRoleBodySchema, { name: { en: 'Installer', pl: 'Monter' }, defaultName: 'Installer' });
    rejects(projects.CreateProjectRoleBodySchema, { name: { en: 'Installer' } });
    rejects(projects.CreateProjectRoleBodySchema, { name: { en: '' }, defaultName: '' });
    accepts(projects.UpdateProjectRoleBodySchema, { defaultName: 'Fitter' });
    rejects(projects.UpdateProjectRoleBodySchema, {});
    accepts(projects.CreateProjectLossReasonBodySchema, { name: { en: 'Budget', pl: 'Budżet' }, defaultName: 'Budget' });
    rejects(projects.CreateProjectLossReasonBodySchema, { defaultName: 'x'.repeat(121) });
    accepts(projects.UpdateProjectLossReasonBodySchema, { name: { en: 'Budget cut' } });
    rejects(projects.UpdateProjectLossReasonBodySchema, { code: 'budget' });
  });

  it('Template: the whole graph in one body', () => {
    accepts(projects.ProjectTemplateBodySchema, {
      name: 'Showroom fit-out',
      description: 'Default description',
      roleIds: [UUID_A],
      stages: [
        {
          key: 'design',
          name: 'Design',
          color: '#3366ff',
          plannedDurationDays: 10,
          responsibleRoleIds: [UUID_A],
          alertOffsetsDays: [2],
          completionGate: true,
          completionPermitted: false,
          tasks: [{ title: 'Measure', responsibleRoleId: UUID_A, dueOffsetDays: 1 }],
        },
        { key: 'delivery', name: 'Delivery', color: '#22aa44' },
      ],
      moves: [{ fromStageKey: 'design', toStageKey: 'delivery' }],
    });
  });

  it('Template: refuses no Stage, a move naming an unknown Stage, a self-move and a duplicated key', () => {
    rejects(projects.ProjectTemplateBodySchema, { name: 'T', stages: [], moves: [] });
    const stage = (key: string) => ({ key, name: key, color: '#000000' });
    rejects(projects.ProjectTemplateBodySchema, {
      name: 'T',
      stages: [stage('a')],
      moves: [{ fromStageKey: 'a', toStageKey: 'b' }],
    });
    rejects(projects.ProjectTemplateBodySchema, {
      name: 'T',
      stages: [stage('a')],
      moves: [{ fromStageKey: 'a', toStageKey: 'a' }],
    });
    rejects(projects.ProjectTemplateBodySchema, { name: 'T', stages: [stage('a'), stage('a')], moves: [] });
    rejects(projects.ProjectTemplateBodySchema, { name: 'x'.repeat(121), stages: [stage('a')], moves: [] });
  });
});

describe('§2.6 analytics', () => {
  it('query: a range and the three filters', () => {
    accepts(projects.ProjectAnalyticsQuerySchema, { from: '2026-01-01', to: '2026-12-31' });
    accepts(projects.ProjectAnalyticsQuerySchema, {
      from: '2026-01-01',
      to: '2026-01-01',
      templateId: UUID_A,
      organizationId: UUID_B,
      projectManagerId: UUID_C,
    });
  });

  it('query: refuses a missing bound and a range that ends before it starts', () => {
    rejects(projects.ProjectAnalyticsQuerySchema, { from: '2026-01-01' });
    rejects(projects.ProjectAnalyticsQuerySchema, { from: '2026-02-01', to: '2026-01-01' });
  });

  it('every figure states its period, its population and what it excluded (FR-038)', () => {
    accepts(projects.ProjectAnalyticsSummaryResponseSchema, {
      from: '2026-01-01',
      to: '2026-12-31',
      projectCount: 12,
      excluded: { noValue: 2 },
      data: { opened: 12, completed: 5, lost: 3, completionRate: 0.625 },
    });
    rejects(projects.ProjectAnalyticsSummaryResponseSchema, {
      from: '2026-01-01',
      to: '2026-12-31',
      data: { opened: 12, completed: 5, lost: 3, completionRate: 0.625 },
    });
    accepts(projects.ProjectAnalyticsLossesResponseSchema, {
      from: '2026-01-01',
      to: '2026-12-31',
      projectCount: 3,
      excluded: { noValue: 0 },
      data: {
        byStage: [{ stageName: 'Design', count: 2, share: 0.6667 }],
        byReason: [{ lossReasonId: UUID_A, code: 'price', name: 'Price', count: 3, share: 1 }],
        lostValue: [{ currency: 'PLN', amount: '1000.00' }],
      },
    });
  });
});

describe('ports, events and error codes', () => {
  it('names the six events of the module', () => {
    expect(projects.PROJECTS_EVENTS).toEqual({
      PROJECT_CREATED: 'projects.project.created.v1',
      STAGE_MOVED: 'projects.stage.moved.v1',
      PROJECT_CLOSED: 'projects.project.closed.v1',
      PROJECT_REOPENED: 'projects.project.reopened.v1',
      RECORD_LINKED: 'projects.record.linked.v1',
      RECORD_UNLINKED: 'projects.record.unlinked.v1',
    });
  });

  it('names every error code admin-api.md raises', () => {
    for (const code of [
      'PROJECT_NOT_FOUND',
      'PROJECT_HAS_LINKS',
      'PROJECT_ORGANIZATION_IN_USE',
      'PROJECT_ORGANIZATION_OUT_OF_SCOPE',
      'PROJECT_STAGE_CURRENT',
      'PROJECT_STAGE_HAS_TASKS',
      'PROJECT_STAGE_LAST',
      'PROJECT_MOVE_NOT_PERMITTED',
      'PROJECT_STAGE_GATE_OPEN_TASKS',
      'PROJECT_CHANGED',
      'PROJECT_GUARD_REFUSED',
      'PROJECT_COMPLETION_NOT_PERMITTED',
      'PROJECT_RECORD_NOT_FOUND',
      'PROJECT_RECORD_ALREADY_LINKED',
      'PROJECT_LINK_ORGANIZATION_MISMATCH',
      'PROJECT_NOTE_NOT_AUTHOR',
    ]) {
      expect(projects.PROJECTS_ERROR_CODES).toContain(code);
    }
  });

  it('the gate refusal counts the open Tasks, and names them only to a reader of Tasks', () => {
    accepts(projects.ProjectStageGateOpenTasksDetailsSchema, {
      openTaskCount: 1,
      openTasks: [{ id: UUID_A, number: 'TSK-000001', title: 'Measure' }],
    });
    accepts(projects.ProjectStageGateOpenTasksDetailsSchema, { openTaskCount: 3 });
    rejects(projects.ProjectStageGateOpenTasksDetailsSchema, { openTaskCount: 1, openTasks: [{ id: UUID_A }] });
    rejects(projects.ProjectStageGateOpenTasksDetailsSchema, {
      openTasks: [{ id: UUID_A, number: 'TSK-000001', title: 'Measure' }],
    });
  });
});

describe('linked records — issue #456, how far a Quote Request is agreed', () => {
  const link = {
    id: UUID_A,
    kind: 'quote_request',
    recordId: UUID_B,
    available: true,
    number: 'QR-1',
    status: 'Pending',
    amount: '37.50',
    currency: 'PLN',
    href: `/quote-requests/${UUID_B}`,
    linkedBy: null,
    linkedAt: '2026-11-08T10:00:00.000Z',
  };

  it('a Quote Request link says how far its lines are agreed', () => {
    for (const agreement of ['agreed', 'partial', 'none'] as const) {
      expect(projects.ProjectLinkSchema.parse({ ...link, agreement }).agreement).toBe(agreement);
    }
    // An Order link, and an unavailable one, carry none.
    expect(projects.ProjectLinkSchema.parse(link).agreement).toBeUndefined();
    rejects(projects.ProjectLinkSchema, { ...link, agreement: 'some' });
  });
});
