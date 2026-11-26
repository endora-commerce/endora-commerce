import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CustomFieldValuePort, type ProjectCommandPort } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmOrder, seedCrmOrganization } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { PROJECTS_ADMIN, deleteProjects, dictionaryIds } from './helpers.js';

/**
 * `specs/186-aggregate-ports/` T079 (issue #1828, US7) — the investor case from
 * a worker: a deployment's integration keeps the Projects it is told about in
 * step with its own records through `projectCommandPort`, with no
 * administrator behind most of its calls.
 *
 * Under `withSystemScope` every entry records the `system` actor (no
 * administrator id) and the integration names itself through `source`
 * (D-293.6): it edits a Project, sets its custom fields, Organizations and
 * Members, walks it to its next Stage, closes and reopens it, links an Order
 * and unlinks it, and finally deletes it. Creating a Project and writing a
 * comment record an administrator on the row, so those two run under
 * `withSystemScopeActingFor` — and are refused, with nothing written, without
 * one (R-22.2).
 */

const SOURCE = 'acme.investor-sync';
const CUSTOM_FIELDS_API = '/api/v1/admin/custom-fields';
const FIELD = 'worker_investor';

describe('projectCommandPort from a worker (186 T079)', () => {
  let h: BackendServerHandle;
  let port: ProjectCommandPort;
  let organizationA = '';
  let organizationB = '';
  let definitionId = '';
  const created: string[] = [];
  const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: investor sync worker', fn);
  const onBehalf = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: investor sync, queued by an administrator', fn);

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'project', objectId }, { orderBy: { actedAt: 'asc' } });

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<ProjectCommandPort>('projectCommandPort');
    organizationA = await seedCrmOrganization(h.em(), 'Worker A');
    organizationB = await seedCrmOrganization(h.em(), 'Worker B');
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
  });

  afterAll(async () => {
    await deleteProjects(h, created);
    if (definitionId) {
      await h.app.inject({ method: 'DELETE', url: `${CUSTOM_FIELDS_API}/definitions/${definitionId}`, cookies: PROJECTS_ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('runs a Project’s life with the system actor, recording its source', async () => {
    const options = { source: SOURCE };
    const project = await onBehalf(() =>
      port.create(
        {
          title: 'Investor-backed fit-out',
          organizationIds: [organizationA],
          stages: [
            { name: 'Offer', color: '#3b82f6' },
            { name: 'Delivery', color: '#22c55e' },
          ],
        },
        options,
      ),
    );
    created.push(project.id);
    expect(project).toMatchObject({ state: 'open', currentStageName: 'Offer', organizationIds: [organizationA] });

    const values = h.container.resolve<CustomFieldValuePort>('customFieldValueService');
    await asWorker(() => port.update(project.id, { title: 'Investor-backed fit-out (phase 1)' }, options));
    const withInvestor = await asWorker(() =>
      port.setCustomFieldValues(project.id, (current) => values.validateAndMerge('project', current, { [FIELD]: 'Acme Ventures' }), options),
    );
    expect(withInvestor.customFieldValues).toEqual({ [FIELD]: 'Acme Ventures' });

    const widened = await asWorker(() =>
      port.setOrganizations(project.id, { organizationIds: [organizationA, organizationB] }, options),
    );
    expect(widened?.organizationIds.sort()).toEqual([organizationA, organizationB].sort());
    const roles = await dictionaryIds(h, 'project_roles');
    await asWorker(() =>
      port.setMembers(project.id, { members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [roles['project_manager']!] }] }, options),
    );

    const delivery = (await h
      .em()
      .getConnection()
      .execute(`select "id" from "project_stages" where "project_id" = ? and "name" = 'Delivery'`, [project.id])) as Array<{
      id: string;
    }>;
    const moved = await asWorker(() => port.moveToStage(project.id, { toStageId: delivery[0]!.id }, options));
    expect(moved.currentStageName).toBe('Delivery');
    const closed = await asWorker(() => port.close(project.id, { outcome: 'completed' }, options));
    expect(closed.state).toBe('completed');
    const reopened = await asWorker(() => port.reopen(project.id, options));
    expect(reopened.state).toBe('open');

    const order = (await seedCrmOrder(h.em(), { organizationId: organizationB })).id;
    const { linkId } = await asWorker(() => port.link(project.id, { kind: 'order', recordId: order }, options));
    await asWorker(() => port.unlink(project.id, linkId, options));
    const { commentId } = await onBehalf(() => port.addComment(project.id, { kind: 'note', body: 'Synced.' }, options));
    expect(commentId).toMatch(/^[0-9a-f-]{36}$/);

    const written = await entries(project.id);
    expect(written.map((e) => e.action)).toEqual([
      'projects.project.create',
      'projects.project.update',
      'projects.project.custom_fields_update',
      'projects.project.organization_add',
      'projects.project.member_set',
      'projects.project.stage_move',
      'projects.project.close',
      'projects.project.reopen',
      'projects.project.link_add',
      'projects.project.link_remove',
      'projects.project.note_add',
    ]);
    for (const entry of written) {
      expect(entry.stateAfter, entry.action).toMatchObject({ source: SOURCE });
      const onBehalfOf = entry.action === 'projects.project.create' || entry.action === 'projects.project.note_add';
      expect(entry.actorAdminUserId ?? null, entry.action).toBe(onBehalfOf ? TEST_ADMIN_ID : null);
    }

    await asWorker(() => port.delete(project.id, options));
    const deleted = (await entries(project.id)).at(-1)!;
    expect(deleted.action).toBe('projects.project.delete');
    expect(deleted.actorAdminUserId ?? null).toBeNull();
    expect(await asWorker(() => h.container.resolve<ProjectCommandPort>('projectCommandPort').reopen(project.id).catch((e) => e))).toMatchObject({
      code: ERROR_CODES.PROJECT_NOT_FOUND,
    });
  });

  it('refuses create and addComment with no administrator, an unclaimed extension and a malformed source, writing nothing', async () => {
    const project = await onBehalf(() =>
      port.create({ title: 'Refusals', organizationIds: [], stages: [{ name: 'Only', color: '#3b82f6' }] }),
    );
    created.push(project.id);
    const count = (await entries(project.id)).length;

    expect(
      await refusal(asWorker(() => port.create({ title: 'Nobody’s', organizationIds: [], stages: [{ name: 'S', color: '#3b82f6' }] }))),
    ).toEqual({ statusCode: 403, code: ERROR_CODES.FORBIDDEN });
    expect(await refusal(asWorker(() => port.addComment(project.id, { kind: 'message', body: 'Nobody’s' })))).toEqual({
      statusCode: 403,
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(
      await refusal(asWorker(() => port.update(project.id, { title: 'Nope' }, { extensions: { nobody_here: { x: 1 } } }))),
    ).toEqual({ statusCode: 422, code: 'COMMAND_EXTENSION_UNCLAIMED' });
    expect(await refusal(asWorker(() => port.update(project.id, { title: 'Nope' }, { source: 'Free text!' })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(await entries(project.id)).toHaveLength(count);
  });
});
