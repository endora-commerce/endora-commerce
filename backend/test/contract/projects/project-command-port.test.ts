import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  type CustomFieldValuePort,
  type ProjectCommandPort,
  type ProjectDetail,
  type ProjectStageGuardRegistryPort,
} from '@endora-commerce/contracts';
import { AuditLogEntry, ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { seedCrmOrder, seedCrmOrganization } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import {
  PROJECTS_ADMIN,
  callProjects,
  createProject,
  deleteProjects,
  dictionaryIds,
  getProject,
  stageNamed,
} from '../../integration/projects/helpers.js';

/**
 * `specs/186-aggregate-ports/` T077 (issue #1828, US7; research R-22) —
 * `projectCommandPort` runs the Command the admin route for the same operation
 * runs, through the route's own service method. Each case performs the
 * operation twice, once through the route and once through the port under the
 * same administrator, on two Projects in the same state, and holds what each
 * wrote to the other (`expectPortParity`): the audit entries and what the
 * write left on the Project's own tables, through a probe.
 *
 * Then the port's own additions: the stage guards' veto on `moveToStage`,
 * `source` recorded beside the actor, a malformed `source` and an unclaimed
 * extension refused with nothing written, the two tokens `expectedVersion`
 * names, the refusal of `create` and `addComment` with no administrator behind
 * the call, and the port failing closed while `projects` is off.
 */

const CUSTOM_FIELDS_API = '/api/v1/admin/custom-fields';
const FIELD = 'cmd_port_note';
const GUARD_REASON = 'The investor has not signed off this stage.';

describe('projectCommandPort — the admin routes’ Commands (#1828)', () => {
  let h: BackendServerHandle;
  let port: ProjectCommandPort;
  let organizationA = '';
  let organizationB = '';
  let organizationC = '';
  let definitionId = '';
  const created: string[] = [];
  const refused = new Set<string>();

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: project command port', fn);

  /** What one path wrote for a Project: its audit entries, and the probe's answer. */
  function observe<T>(
    objectId: string | ((result: T) => string),
    write: () => Promise<T>,
    probe?: (result: T) => unknown,
  ): Promise<ParityObservation> {
    return observeWrite<T>(
      { em: () => h.em().fork(), objectType: 'project', objectId, ...(probe ? { probe } : {}) },
      write,
    ).then(({ observation }) => observation);
  }

  async function route(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: unknown, status = 200) {
    const response = await callProjects(h, method, path, payload === undefined ? {} : { payload });
    expect(response.statusCode, response.body).toBe(status);
    return response.body ? (response.json() as { data: Record<string, unknown> }) : null;
  }

  /** Two Projects in the same state. */
  async function pair(body: Record<string, unknown> = {}): Promise<[ProjectDetail, ProjectDetail]> {
    const a = await createProject(h, { title: 'Port parity', organizationIds: [organizationA], ...body });
    const b = await createProject(h, { title: 'Port parity', organizationIds: [organizationA], ...body });
    created.push(a.id, b.id);
    return [a, b];
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; details: unknown }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string; details?: unknown };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error), details: e.details };
    }
    throw new Error('expected a refusal');
  }

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'project', objectId }, { orderBy: { actedAt: 'asc' } });

  /** The Stage history of a Project, by kind — what a walk leaves beside its audit entry. */
  const stageEntries = async (projectId: string): Promise<string[]> =>
    (
      (await h
        .em()
        .getConnection()
        .execute(`select "kind" from "project_stage_entries" where "project_id" = ? order by "at", "id"`, [
          projectId,
        ])) as Array<{ kind: string }>
    ).map((row) => row.kind);

  /** The Organizations a Project holds, as stored. */
  const storedOrganizations = async (projectId: string): Promise<string[]> =>
    (
      (await h
        .em()
        .getConnection()
        .execute(`select "organization_id" from "project_organizations" where "project_id" = ? order by "organization_id"`, [
          projectId,
        ])) as Array<{ organization_id: string }>
    ).map((row) => row.organization_id);

  /** The Members a Project holds, as stored: each administrator with their Roles. */
  const storedMembers = async (projectId: string): Promise<Array<{ adminUserId: string; roleIds: string[] }>> =>
    (
      (await h
        .em()
        .getConnection()
        .execute(
          `select pm."admin_user_id", array_agg(pmr."role_id"::text order by pmr."role_id") as "role_ids"
             from "project_members" pm join "project_member_roles" pmr on pmr."member_id" = pm."id"
            where pm."project_id" = ? group by pm."admin_user_id" order by pm."admin_user_id"`,
          [projectId],
        )) as Array<{ admin_user_id: string; role_ids: string[] }>
    ).map((row) => ({ adminUserId: row.admin_user_id, roleIds: row.role_ids }));

  /** The Project rows carrying a title — a create writes under an id nobody holds yet. */
  const projectRowsTitled = async (title: string): Promise<number> => {
    // `count(*)` always answers exactly one row; read it, never default it (check:fixture-substitution).
    const [row] = (await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as "n" from "projects" where "title" = ?`, [title])) as Array<{ n: number }>;
    if (row === undefined) throw new Error('count(*) answered no row');
    return Number(row.n);
  };

  /**
   * The module's access service, whose methods a set calls between its read
   * and its Command's lock — where another caller's commit is made to land.
   */
  const projectsAccess = () =>
    h.container.resolve<{
      loadVisible(id: string): Promise<unknown>;
      orgInScope(organizationId: string): Promise<boolean>;
    }>('projectsAccess');

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<ProjectCommandPort>('projectCommandPort');
    organizationA = await seedCrmOrganization(h.em(), 'Port parity A');
    organizationB = await seedCrmOrganization(h.em(), 'Port parity B');
    organizationC = await seedCrmOrganization(h.em(), 'Port parity C');
    const response = await h.app.inject({
      method: 'POST',
      url: `${CUSTOM_FIELDS_API}/definitions`,
      cookies: PROJECTS_ADMIN,
      payload: {
        entityType: 'project',
        key: FIELD,
        label: {},
        labelDefault: FIELD,
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        options: [],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    definitionId = (response.json() as { data: { id: string } }).data.id;
    h.container.resolve<ProjectStageGuardRegistryPort>('projectStageGuardRegistry').register({
      ownerModuleId: 'crm',
      before: async (ctx) =>
        refused.has(ctx.projectId) ? { allow: false, reason: GUARD_REASON } : { allow: true },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await deleteProjects(h, created);
    if (definitionId) {
      await h.app.inject({ method: 'DELETE', url: `${CUSTOM_FIELDS_API}/definitions/${definitionId}`, cookies: PROJECTS_ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('create — projects.project.create, as the admin create', async () => {
    const body = () => ({
      title: 'Created through the port',
      organizationIds: [organizationA],
      stages: [
        { name: 'Design', color: '#3b82f6', plannedDurationDays: 10 },
        { name: 'Build', color: '#f59e0b' },
      ],
      description: 'Scope',
      value: { amount: '1000.00', currency: 'PLN' },
    });
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe<{ data: Record<string, unknown> } | null>(
          (res) => {
            const id = res!.data['id'] as string;
            created.push(id);
            return id;
          },
          () => route('POST', '', body(), 201),
          (res) => stageEntries(res!.data['id'] as string),
        ),
      viaPort: () =>
        observe(
          (record) => {
            created.push(record.id);
            return record.id;
          },
          () => asAdmin(() => port.create(body())),
          (record) => stageEntries(record.id),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['projects.project.create']);
    expect(viaPort.audit[0]!.actorAdminUserId).toBe(TEST_ADMIN_ID);
  });

  it('update — projects.project.update, as PATCH with the four fields', async () => {
    const [a, b] = await pair();
    const patch = { title: 'Renamed', description: 'A new scope', value: { amount: '20.00', currency: 'EUR' } };
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `/${a.id}`, { ...patch, version: a.version })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.update(b.id, patch))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['projects.project.update']);
    const record = await asAdmin(() => port.update(b.id, {}));
    expect(record).toMatchObject({ id: b.id, title: 'Renamed', valueAmount: '20.00', valueCurrency: 'EUR' });
  });

  it('setCustomFieldValues — projects.project.custom_fields_update, the Command PATCH runs for the values', async () => {
    const [a, b] = await pair();
    const values = h.container.resolve<CustomFieldValuePort>('customFieldValueService');
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(a.id, () => route('PATCH', `/${a.id}`, { customFieldValues: { [FIELD]: 'route' }, version: a.version })),
      viaPort: () =>
        observe(b.id, () =>
          asAdmin(() =>
            port.setCustomFieldValues(b.id, (current) => values.validateAndMerge('project', current, { [FIELD]: 'port' })),
          ),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['projects.project.custom_fields_update']);
    expect(viaPort.audit[0]!.stateAfter).toMatchObject({ changedCustomFields: [FIELD] });

    // The same value again changes nothing, records nothing and moves no version.
    const { version } = await asAdmin(() => port.update(b.id, {}));
    const record = await asAdmin(() => port.setCustomFieldValues(b.id, async (current) => ({ ...current })));
    expect(record.customFieldValues).toEqual({ [FIELD]: 'port' });
    expect(record.version).toBe(version);
    expect((await entries(b.id)).filter((e) => e.action === 'projects.project.custom_fields_update')).toHaveLength(1);
  });

  it('setOrganizations — one organization_add per Organization added, as PUT …/organizations', async () => {
    const [a, b] = await pair();
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PUT', `/${a.id}/organizations`, { organizationIds: [organizationA, organizationB] })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setOrganizations(b.id, { organizationIds: [organizationA, organizationB] }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['projects.project.organization_add']);
    const record = await asAdmin(() => port.setOrganizations(b.id, { organizationIds: [organizationB] }));
    expect(record?.organizationIds).toEqual([organizationB]);
  });

  it('setMembers — projects.project.member_set, as PUT …/members', async () => {
    const [a, b] = await pair();
    const roles = await dictionaryIds(h, 'project_roles');
    const members = [{ adminUserId: TEST_ADMIN_ID, roleIds: [roles['project_manager']!] }];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PUT', `/${a.id}/members`, { members })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setMembers(b.id, { members }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['projects.project.member_set']);
  });

  it('moveToStage, close and reopen — the walk’s Commands and Stage history, as the three routes', async () => {
    const [a, b] = await pair();
    const reasons = await dictionaryIds(h, 'project_loss_reasons');
    const { port: moved } = await expectPortParity({
      viaRoute: () =>
        observe(a.id, () => route('POST', `/${a.id}/move`, { toStageId: stageNamed(a, 'Build'), version: a.version }), () =>
          stageEntries(a.id),
        ),
      viaPort: () =>
        observe(b.id, () => asAdmin(() => port.moveToStage(b.id, { toStageId: stageNamed(b, 'Build') })), () =>
          stageEntries(b.id),
        ),
    });
    expect(moved.sideEffects).toEqual(['enter', 'enter']);

    const lost = { outcome: 'lost' as const, lossReasonId: Object.values(reasons)[0]!, comment: 'Budget cut' };
    const { port: closed } = await expectPortParity({
      viaRoute: async () => {
        const version = (await getProject(h, a.id)).version;
        return observe(a.id, () => route('POST', `/${a.id}/close`, { ...lost, version }), () => stageEntries(a.id));
      },
      viaPort: () => observe(b.id, () => asAdmin(() => port.close(b.id, lost)), () => stageEntries(b.id)),
    });
    expect(closed.audit.map((e) => e.action)).toEqual(['projects.project.close']);

    const { port: reopened } = await expectPortParity({
      viaRoute: async () => {
        const version = (await getProject(h, a.id)).version;
        return observe(a.id, () => route('POST', `/${a.id}/reopen`, { version }), () => stageEntries(a.id));
      },
      viaPort: () => observe(b.id, () => asAdmin(() => port.reopen(b.id)), () => stageEntries(b.id)),
    });
    expect(reopened.sideEffects).toEqual(['enter', 'enter', 'close_lost', 'reopen']);
    expect((await asAdmin(() => port.reopen(b.id).catch((e: unknown) => e))) as { code?: string }).toMatchObject({
      code: ERROR_CODES.PROJECT_MOVE_NOT_PERMITTED,
    });
  });

  it('link and unlink — projects.project.link_add / link_remove, as POST and DELETE …/links', async () => {
    const [a, b] = await pair();
    const [orderA, orderB] = [
      (await seedCrmOrder(h.em(), { organizationId: organizationA })).id,
      (await seedCrmOrder(h.em(), { organizationId: organizationA })).id,
    ];
    let linkA = '';
    let linkB = '';
    await expectPortParity({
      viaRoute: () =>
        observe(a.id, async () => {
          const res = await route('POST', `/${a.id}/links`, { kind: 'order', recordId: orderA }, 201);
          linkA = res!.data['id'] as string;
        }),
      viaPort: () =>
        observe(b.id, async () => {
          linkB = (await asAdmin(() => port.link(b.id, { kind: 'order', recordId: orderB }))).linkId;
        }),
    });
    const { port: unlinked } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('DELETE', `/${a.id}/links/${linkA}`, undefined, 204)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.unlink(b.id, linkB))),
    });
    expect(unlinked.audit.map((e) => e.action)).toEqual(['projects.project.link_remove']);
  });

  it('addComment — projects.project.note_add, as POST …/comments', async () => {
    const [a, b] = await pair();
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('POST', `/${a.id}/comments`, { kind: 'note', body: 'From the route' }, 201)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.addComment(b.id, { kind: 'note', body: 'From the port' }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['projects.project.note_add']);
  });

  it('delete — projects.project.delete, as DELETE /:id', async () => {
    const [a, b] = await pair();
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('DELETE', `/${a.id}`, undefined, 204)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.delete(b.id))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['projects.project.delete']);
  });

  it('a stage guard refuses moveToStage and close as it refuses the routes, and nothing is written', async () => {
    const [project] = await pair();
    refused.add(project.id);
    const before = await entries(project.id);
    expect(await refusal(asAdmin(() => port.moveToStage(project.id, { toStageId: stageNamed(project, 'Build') })))).toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PROJECT_GUARD_REFUSED,
      details: { reason: GUARD_REASON },
    });
    const lossReasonId = Object.values(await dictionaryIds(h, 'project_loss_reasons'))[0]!;
    expect(await refusal(asAdmin(() => port.close(project.id, { outcome: 'lost', lossReasonId })))).toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PROJECT_GUARD_REFUSED,
    });
    expect(await entries(project.id)).toHaveLength(before.length);
    expect(await stageEntries(project.id)).toEqual(['enter']);
    refused.delete(project.id);
  });

  it('records source beside the actor, and refuses a malformed source or an unclaimed extension with nothing written', async () => {
    const [project] = await pair();
    await asAdmin(() => port.update(project.id, { title: 'With a source' }, { source: 'erp.projects' }));
    const written = await entries(project.id);
    expect(written.at(-1)).toMatchObject({ action: 'projects.project.update', actorAdminUserId: TEST_ADMIN_ID });
    expect(written.at(-1)!.stateAfter).toMatchObject({ source: 'erp.projects' });

    const count = written.length;
    expect(await refusal(asAdmin(() => port.update(project.id, { title: 'Nope' }, { source: 'Not A Code' })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    // A hookable action no present hook module claims the key on…
    expect(
      await refusal(asAdmin(() => port.update(project.id, { title: 'Nope' }, { extensions: { acme_erp: { code: 'x' } } }))),
    ).toMatchObject({ statusCode: 422, code: 'COMMAND_EXTENSION_UNCLAIMED' });
    // …and an action that is not hookable at all.
    expect(
      await refusal(asAdmin(() => port.setMembers(project.id, { members: [] }, { extensions: { acme_erp: {} } }))),
    ).toMatchObject({ statusCode: 422, code: 'COMMAND_EXTENSION_UNCLAIMED' });
    expect(await entries(project.id)).toHaveLength(count);
    expect((await getProject(h, project.id)).title).toBe('With a source');

    // The named exception (#1986): an empty patch runs no Command, so the bus
    // never sees the key — nothing is refused, and nothing is written.
    const read = await asAdmin(() => port.update(project.id, {}, { extensions: { acme_erp: { code: 'x' } } }));
    expect(read).toMatchObject({ id: project.id, title: 'With a source' });
    expect(await entries(project.id)).toHaveLength(count);
  });

  it('honours expectedVersion as the token each route checks, and answers both on the record', async () => {
    const [project] = await pair();
    const record = await asAdmin(() => port.update(project.id, {}));
    expect(record).toMatchObject({ version: project.version, configurationVersion: project.configurationVersion });

    expect(
      await refusal(asAdmin(() => port.update(project.id, { title: 'Stale' }, { expectedVersion: project.version + 5 }))),
    ).toMatchObject({ statusCode: 409, code: ERROR_CODES.PROJECT_CHANGED });
    const updated = await asAdmin(() => port.update(project.id, { title: 'Fresh' }, { expectedVersion: project.version }));
    expect(updated.version).toBe(project.version + 1);

    expect(
      await refusal(
        asAdmin(() =>
          port.setOrganizations(
            project.id,
            { organizationIds: [organizationA, organizationB] },
            { expectedVersion: project.configurationVersion + 5 },
          ),
        ),
      ),
    ).toMatchObject({ statusCode: 409, code: ERROR_CODES.PROJECT_CHANGED });
    const moved = await asAdmin(() =>
      port.setOrganizations(
        project.id,
        { organizationIds: [organizationA, organizationB] },
        { expectedVersion: project.configurationVersion },
      ),
    );
    expect(moved?.configurationVersion).toBe(project.configurationVersion + 1);
    expect(await refusal(asAdmin(() => port.update(project.id, { title: '' })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('refuses a stale expectedVersion 409 PROJECT_CHANGED on setCustomFieldValues, setMembers, moveToStage, close and reopen, with nothing written', async () => {
    const [project] = await pair();
    const values = h.container.resolve<CustomFieldValuePort>('customFieldValueService');
    const roles = await dictionaryIds(h, 'project_roles');
    const lossReasonId = Object.values(await dictionaryIds(h, 'project_loss_reasons'))[0]!;
    const count = (await entries(project.id)).length;
    const stale = { statusCode: 409, code: ERROR_CODES.PROJECT_CHANGED };

    expect(
      await refusal(
        asAdmin(() =>
          port.setCustomFieldValues(
            project.id,
            (current) => values.validateAndMerge('project', current, { [FIELD]: 'stale' }),
            { expectedVersion: project.version + 5 },
          ),
        ),
      ),
    ).toMatchObject(stale);
    expect(
      await refusal(
        asAdmin(() =>
          port.setMembers(
            project.id,
            { members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [roles['project_manager']!] }] },
            { expectedVersion: project.configurationVersion + 5 },
          ),
        ),
      ),
    ).toMatchObject(stale);
    expect(
      await refusal(
        asAdmin(() =>
          port.moveToStage(project.id, { toStageId: stageNamed(project, 'Build') }, { expectedVersion: project.version + 5 }),
        ),
      ),
    ).toMatchObject(stale);
    expect(
      await refusal(
        asAdmin(() => port.close(project.id, { outcome: 'lost', lossReasonId }, { expectedVersion: project.version + 5 })),
      ),
    ).toMatchObject(stale);
    expect(await entries(project.id)).toHaveLength(count);
    expect(await stageEntries(project.id)).toEqual(['enter']);
    const untouched = await asAdmin(() => port.update(project.id, {}));
    expect(untouched).toMatchObject({
      version: project.version,
      configurationVersion: project.configurationVersion,
      customFieldValues: {},
    });

    // `reopen` needs a closed Project, so close it first with the current token.
    const closed = await asAdmin(() =>
      port.close(project.id, { outcome: 'lost', lossReasonId }, { expectedVersion: project.version }),
    );
    const closedCount = (await entries(project.id)).length;
    expect(
      await refusal(asAdmin(() => port.reopen(project.id, { expectedVersion: closed.version + 5 }))),
    ).toMatchObject(stale);
    expect(await entries(project.id)).toHaveLength(closedCount);
    expect((await asAdmin(() => port.update(project.id, {}))).version).toBe(closed.version);
  });

  it('setOrganizations without expectedVersion refuses a set committed between its read and its lock, and leaves that set (#1986)', async () => {
    // Caller A reads {A} and asks for {A, B}; caller B sets {C} and commits first.
    const [project] = await pair();
    const access = projectsAccess();
    const orgInScope = access.orgInScope.bind(access);
    let interleaved = false;
    // `orgInScope` is asked for each Organization A adds, after A read the
    // current set and before A's Command locks the Project.
    vi.spyOn(access, 'orgInScope').mockImplementation(async (organizationId) => {
      if (!interleaved) {
        interleaved = true;
        await route('PUT', `/${project.id}/organizations`, { organizationIds: [organizationC] });
      }
      return orgInScope(organizationId);
    });

    expect(
      await refusal(asAdmin(() => port.setOrganizations(project.id, { organizationIds: [organizationA, organizationB] }))),
    ).toMatchObject({ statusCode: 409, code: ERROR_CODES.PROJECT_CHANGED });
    expect(interleaved).toBe(true);
    expect(await storedOrganizations(project.id)).toEqual([organizationC]);
    expect((await getProject(h, project.id)).configurationVersion).toBe(project.configurationVersion + 1);
  });

  it('setMembers without expectedVersion refuses a set committed between its read and its lock, and leaves that set (#1986)', async () => {
    const [project] = await pair();
    const roles = await dictionaryIds(h, 'project_roles');
    const [first, second] = Object.values(roles);
    expect(second, 'two project roles are seeded').toBeDefined();
    const theirs = [{ adminUserId: TEST_ADMIN_ID, roleIds: [second!] }];
    const access = projectsAccess();
    const loadVisible = access.loadVisible.bind(access);
    let interleaved = false;
    vi.spyOn(access, 'loadVisible').mockImplementation(async (id) => {
      const row = await loadVisible(id);
      if (!interleaved && id === project.id) {
        interleaved = true;
        await route('PUT', `/${project.id}/members`, { members: theirs });
      }
      return row;
    });

    expect(
      await refusal(asAdmin(() => port.setMembers(project.id, { members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [first!] }] }))),
    ).toMatchObject({ statusCode: 409, code: ERROR_CODES.PROJECT_CHANGED });
    expect(interleaved).toBe(true);
    expect(await storedMembers(project.id)).toEqual(theirs);
  });

  it('the admin PUT …/organizations without configurationVersion keeps its published answer: not refused (#1986 route decision)', async () => {
    const [project] = await pair();
    const access = projectsAccess();
    const orgInScope = access.orgInScope.bind(access);
    let interleaved = false;
    vi.spyOn(access, 'orgInScope').mockImplementation(async (organizationId) => {
      if (!interleaved) {
        interleaved = true;
        await asAdmin(() => port.setOrganizations(project.id, { organizationIds: [organizationC] }));
      }
      return orgInScope(organizationId);
    });

    await route('PUT', `/${project.id}/organizations`, { organizationIds: [organizationA, organizationB] });
    expect(interleaved).toBe(true);
    // The route's diff, read before the other set committed: last writer wins on the diff.
    expect(await storedOrganizations(project.id)).toEqual([organizationB, organizationC].sort());
  });

  it('refuses create and addComment with no administrator behind the call, before anything is written', async () => {
    const [project] = await pair();
    const count = (await entries(project.id)).length;
    const asSystem = <T>(fn: () => Promise<T>) => withSystemScope('test: project command port, no administrator', fn);
    const title = `Nobody’s ${project.id}`;
    expect(
      await refusal(asSystem(() => port.create({ title, organizationIds: [], stages: [{ name: 'S', color: '#3b82f6' }] }))),
    ).toMatchObject({ statusCode: 403, code: ERROR_CODES.FORBIDDEN });
    // A create writes under a new id, so its own audit entries cannot show it: count the rows.
    expect(await projectRowsTitled(title)).toBe(0);
    expect(await refusal(asSystem(() => port.addComment(project.id, { kind: 'note', body: 'Nobody’s' })))).toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(await entries(project.id)).toHaveLength(count);
  });

  it('fails closed while projects is off, and nothing is written', async () => {
    const [project] = await pair();
    const count = (await entries(project.id)).length;
    await withModuleOff('projects', 'deactivated', async () => {
      await expect(
        asAdmin(async () => h.container.resolve<ProjectCommandPort>('projectCommandPort').update(project.id, { title: 'Off' })),
      ).rejects.toBeInstanceOf(ModuleDisabledError);
    });
    expect(await entries(project.id)).toHaveLength(count);
    expect((await asAdmin(() => port.update(project.id, {}))).id).toBe(project.id);
  });
});
