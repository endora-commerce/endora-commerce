import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectReadPort } from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { PROJECTS_ADMIN, callProjects, createProject, deleteProjects } from '../../integration/projects/helpers.js';

/**
 * `specs/186-aggregate-ports/` T078 (issue #1828, US7 scenario 1; FR-015) — a
 * Project's custom-field values cross the module boundary on `ProjectRecord`.
 *
 * A field an administrator's screen hides (`adminAccess: 'hidden'`, the
 * "system" field an integration maintains — the investor of #1828) is still a
 * value the record carries: the reader of the record is code, and what the
 * admin panel shows is the panel's affair (`specs/conventions/custom-field-writes.md`
 * § *Admin access*). Every method of the read port answers the same bag, and
 * the record also carries the two tokens `projectCommandPort`'s
 * `expectedVersion` names.
 */

const CUSTOM_FIELDS_API = '/api/v1/admin/custom-fields';
const FIELD = 'read_port_investor';

describe('projects (contract) — projectReadPort carries the custom-field values (186 T078)', () => {
  let h: BackendServerHandle;
  let definitionId = '';
  const created: string[] = [];
  const port = () => h.container.resolve<ProjectReadPort>('projectReadPort');
  const asSystem = <T>(fn: () => Promise<T>) => withSystemScope('test: project read port custom fields', fn);

  beforeAll(async () => {
    h = await setupBackendServer();
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
        adminAccess: 'hidden',
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

  it('answers the stored bag, a hidden field included, from every read', async () => {
    const project = await createProject(h, { title: 'Investor project' });
    created.push(project.id);
    // The hidden field is written as an integration writes it, straight to the
    // Project's own Command — the admin form does not offer it.
    const patched = await callProjects(h, 'PATCH', `/${project.id}`, {
      payload: { version: project.version, customFieldValues: { [FIELD]: 'Acme Ventures' } },
    });
    expect(patched.statusCode, patched.body).toBe(200);

    const record = await asSystem(() => port().findById(project.id));
    expect(record?.customFieldValues).toEqual({ [FIELD]: 'Acme Ventures' });
    expect(record).toMatchObject({ version: project.version + 1, configurationVersion: project.configurationVersion });
    expect((await asSystem(() => port().findByIds([project.id])))[0]?.customFieldValues).toEqual({ [FIELD]: 'Acme Ventures' });
    expect(
      (await asSystem(() => port().search({ q: project.number, limit: 5 }))).find((r) => r.id === project.id)?.customFieldValues,
    ).toEqual({ [FIELD]: 'Acme Ventures' });
  });

  it('answers an empty bag for a Project with none', async () => {
    const project = await createProject(h, { title: 'No fields' });
    created.push(project.id);
    expect((await asSystem(() => port().findById(project.id)))?.customFieldValues).toEqual({});
  });
});
