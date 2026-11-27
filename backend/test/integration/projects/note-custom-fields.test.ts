import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ProjectCommentListResponseSchema,
  ProjectCommentResponseSchema,
  type ProjectCommandPort,
  type ProjectReadPort,
} from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { PROJECTS_ADMIN, callProjects, createProject, deleteProjects } from './helpers.js';

/**
 * Issue #2005 — a note on a Project is a custom-field host, `project_note`
 * (`specs/conventions/custom-field-writes.md`).
 *
 * The values are written with the note, validated with the administrator's
 * rules, by the note's own Command (`projects.project.note_add` /
 * `.note_update`), whose audit state names the changed keys and never a value.
 * A message is not a host: a non-empty bag on one is refused. The admin list
 * and `projectReadPort.listNotes` answer the values; while `projects` is off
 * the type is not offered at all.
 */
describe('projects — custom fields on notes (issue #2005)', () => {
  let h: BackendServerHandle;
  const DEFINITIONS = '/api/v1/admin/custom-fields/definitions';
  const suffix = randomUUID().slice(0, 6);
  const TYPE = `pnote_type_${suffix}`;
  const REMARK = `pnote_remark_${suffix}`;
  const definitions: string[] = [];
  const created: string[] = [];

  async function define(payload: Record<string, unknown>): Promise<void> {
    const response = await h.app.inject({
      method: 'POST',
      url: DEFINITIONS,
      cookies: PROJECTS_ADMIN,
      payload: { entityType: 'project_note', label: {}, required: false, sortOrder: 0, config: {}, options: [], ...payload },
    });
    expect(response.statusCode, response.body).toBe(201);
    definitions.push((response.json() as { data: { id: string } }).data.id);
  }

  async function newProject(): Promise<string> {
    const project = await createProject(h, { title: `Note fields ${suffix}` });
    created.push(project.id);
    return project.id;
  }

  const audit = (projectId: string, action: string) =>
    h.auditLogService.query({ action, objectType: 'project', objectId: projectId });

  beforeAll(async () => {
    h = await setupBackendServer();
    await define({
      key: TYPE,
      labelDefault: 'Type',
      valueType: 'select',
      options: ['call', 'meeting'].map((value, index) => ({
        value,
        label: {},
        labelDefault: value,
        isDefault: false,
        sortOrder: index,
      })),
    });
    await define({ key: REMARK, labelDefault: 'Remark', valueType: 'text' });
  });

  afterAll(async () => {
    await deleteProjects(h, created);
    for (const id of definitions) await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS}/${id}`, cookies: PROJECTS_ADMIN });
    await teardownBackendServer(h);
  });

  it('offers project_note as an entity type while projects is on, labelled from custom_fields’ bundle', async () => {
    const types = async () =>
      (
        (await h.app.inject({ method: 'GET', url: '/api/v1/admin/custom-fields/entity-types', cookies: PROJECTS_ADMIN })).json() as {
          data: Array<{ entityType: string; labelKey: string }>;
        }
      ).data;
    expect((await types()).find((row) => row.entityType === 'project_note')).toMatchObject({
      labelKey: 'customFields.entity.projectNote',
    });
    await withModuleOff('projects', 'deactivated', async () => {
      expect((await types()).map((row) => row.entityType)).not.toContain('project_note');
    });
  });

  it('stores a note’s values with the note, answers them, and records only the keys', async () => {
    const projectId = await newProject();
    const response = await callProjects(h, 'POST', `/${projectId}/comments`, {
      payload: { kind: 'note', body: 'Visited the site.', customFieldValues: { [TYPE]: 'call', [REMARK]: 'S2005-CF-PNOTE' } },
    });
    expect(response.statusCode, response.body).toBe(201);
    const note = ProjectCommentResponseSchema.parse(response.json()).data;
    expect(note.customFieldValues).toEqual({ [TYPE]: 'call', [REMARK]: 'S2005-CF-PNOTE' });

    const listed = ProjectCommentListResponseSchema.parse(
      (await callProjects(h, 'GET', `/${projectId}/comments?kind=note`)).json(),
    ).data;
    expect(listed.find((row) => row.id === note.id)?.customFieldValues).toEqual({
      [TYPE]: 'call',
      [REMARK]: 'S2005-CF-PNOTE',
    });

    const added = await audit(projectId, 'projects.project.note_add');
    expect(added).toHaveLength(1);
    expect(added[0]?.stateAfter).toMatchObject({ commentId: note.id, changedCustomFields: [REMARK, TYPE].sort() });
    expectNoAuditValues(added, ['S2005-CF-PNOTE']);

    const edited = await callProjects(h, 'PATCH', `/${projectId}/comments/${note.id}`, {
      payload: { body: 'Visited the site.', customFieldValues: { [TYPE]: 'meeting' } },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(ProjectCommentResponseSchema.parse(edited.json()).data.customFieldValues).toEqual({
      [TYPE]: 'meeting',
      [REMARK]: 'S2005-CF-PNOTE',
    });
    const updated = await audit(projectId, 'projects.project.note_update');
    expect(updated).toHaveLength(1);
    expect(updated[0]?.stateAfter).toMatchObject({ commentId: note.id, changedCustomFields: [TYPE] });
    expectNoAuditValues(updated, ['S2005-CF-PNOTE']);
  });

  it('refuses a value that breaks its definition, and values on a message, writing nothing', async () => {
    const projectId = await newProject();
    const invalid = await callProjects(h, 'POST', `/${projectId}/comments`, {
      payload: { kind: 'note', body: 'Never stored.', customFieldValues: { [TYPE]: 'carrier-pigeon' } },
    });
    expect(invalid.statusCode, invalid.body).toBe(422);
    expect(invalid.json().error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
    expect(invalid.json().error.details).toEqual([expect.objectContaining({ path: TYPE })]);

    const message = await callProjects(h, 'POST', `/${projectId}/comments`, {
      payload: { kind: 'message', body: 'A message has no fields.', customFieldValues: { [TYPE]: 'call' } },
    });
    expect(message.statusCode, message.body).toBe(422);
    expect(message.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);

    expect(await audit(projectId, 'projects.project.note_add')).toHaveLength(0);
    expect(await audit(projectId, 'projects.project.message_add')).toHaveLength(0);
  });

  it('takes the values through projectCommandPort.addComment and answers them on listNotes', async () => {
    const since = new Date(Date.now() - 1000);
    const projectId = await newProject();
    const port = h.container.resolve<ProjectCommandPort>('projectCommandPort');
    const { commentId } = await withSystemScopeActingFor(TEST_ADMIN_ID, 'test: note with fields', () =>
      port.addComment(projectId, { kind: 'note', body: 'From a connector.', customFieldValues: { [TYPE]: 'meeting' } }),
    );
    await expect(
      withSystemScopeActingFor(TEST_ADMIN_ID, 'test: bad note value', () =>
        port.addComment(projectId, { kind: 'note', body: 'Bad.', customFieldValues: { [TYPE]: 'fax' } }),
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID });

    const read = h.container.resolve<ProjectReadPort>('projectReadPort');
    const page = await runWithTenantContext(
      resolveTenantContext({ kind: 'admin', adminUserId: TEST_ADMIN_ID }, { allowAll: true, allowedOrganizationIds: [] }),
      () => read.listNotes({ authorAdminUserId: TEST_ADMIN_ID, createdFrom: since, limit: 100 }),
    );
    expect(page.items.find((item) => item.id === commentId)?.customFieldValues).toEqual({ [TYPE]: 'meeting' });
  });
});
