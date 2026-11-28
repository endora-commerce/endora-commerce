import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDetail, ProjectReadPort } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { seedCrmAdmin, seedCrmOrder, seedCrmOrganization } from '../../helpers/seed-crm.js';
import {
  callProjects,
  createProject,
  deleteProjects,
  setProjectsVisibility,
  stageNamed,
} from '../../integration/projects/helpers.js';

/**
 * `projectReadPort` — reading Projects from another module, an overlay or a
 * later feature (`specs/163-projects-and-tasks/contracts/ports-and-events.md`
 * §2; T132's Phase 8 note).
 *
 * Plain records, never an entity, under the **caller's** context: a Project out
 * of the caller's Organization reach or visibility is `null`, exactly as one
 * that does not exist. Gated: resolving it while `projects` is off throws
 * `ModuleDisabledError`.
 */
describe('projects (contract) — projectReadPort', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let member: Person;
  let other: Person;
  let organizationA = '';
  let organizationB = '';
  let open: ProjectDetail;
  let hidden: ProjectDetail;
  let order = '';
  let unlinkedOrder = '';
  const created: string[] = [];

  const port = () => h.container.resolve<ProjectReadPort>('projectReadPort');
  /** Call the port as `adminUserId`, reaching every Organization or only `organizationIds`. */
  const as = <T>(adminUserId: string, body: () => Promise<T>, organizationIds?: string[]): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext(
        { kind: 'admin', adminUserId },
        organizationIds === undefined
          ? { allowAll: true, allowedOrganizationIds: [] }
          : { allowAll: false, allowedOrganizationIds: organizationIds },
      ),
      body,
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    member = await seedCrmAdmin(h.em(), 'port-member', ['projects:read']);
    other = await seedCrmAdmin(h.em(), 'port-other', ['projects:read']);
    await setProjectsVisibility(h, 'members');
    organizationA = await seedCrmOrganization(h.em(), 'Read port A');
    organizationB = await seedCrmOrganization(h.em(), 'Read port B');
    open = await createProject(h, {
      title: 'Read port open',
      visibility: 'everyone',
      organizationIds: [organizationA],
      value: { amount: '1200.50', currency: 'PLN' },
    });
    hidden = await createProject(h, {
      title: 'Read port hidden',
      visibility: 'members_and_listed',
      organizationIds: [organizationA],
      members: [{ adminUserId: member.adminUserId, roleIds: [] }],
    });
    created.push(open.id, hidden.id);
    order = (await seedCrmOrder(h.em(), { organizationId: organizationA })).id;
    unlinkedOrder = (await seedCrmOrder(h.em(), { organizationId: organizationA })).id;
    const link = await callProjects(h, 'POST', `/${hidden.id}/links`, { payload: { kind: 'order', recordId: order } });
    expect(link.statusCode, link.body).toBe(201);
  });

  afterAll(async () => {
    for (const person of [member, other]) person?.undo();
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('finds a Project by id as a plain record, and no entity', async () => {
    const record = await as(other.adminUserId, () => port().findById(open.id));
    expect(record).toEqual({
      id: open.id,
      number: open.number,
      title: 'Read port open',
      state: 'open',
      currentStageId: stageNamed(open, 'Design'),
      currentStageName: 'Design',
      organizationIds: [organizationA],
      valueAmount: '1200.50',
      valueCurrency: 'PLN',
      templateId: null,
      closedAt: null,
      createdAt: expect.any(Date),
      // `specs/192-organization-merge/` FR-051 — set on an archived (merged) Project only.
      mergedIntoProjectId: null,
      mergedAt: null,
      mergeId: null,
      // `specs/186-aggregate-ports/` FR-015 and R-22.3.
      customFieldValues: {},
      version: open.version,
      configurationVersion: open.configurationVersion,
    });
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });

  it('answers null for an invisible Project exactly as for a missing id or a non-id', async () => {
    expect((await as(member.adminUserId, () => port().findById(hidden.id)))?.id).toBe(hidden.id);
    expect(await as(other.adminUserId, () => port().findById(hidden.id))).toBeNull();
    expect(await as(other.adminUserId, () => port().findById('00000000-0000-4000-8000-00000000dead'))).toBeNull();
    expect(await as(other.adminUserId, () => port().findById('not-an-id'))).toBeNull();
    // Out of reach: an administrator confined to another Organization.
    expect(await as(other.adminUserId, () => port().findById(open.id), [organizationB])).toBeNull();
    expect((await as(other.adminUserId, () => port().findById(open.id), [organizationA]))?.id).toBe(open.id);
  });

  it('finds the Project a record is linked to, only for a reader who may see it', async () => {
    expect((await as(member.adminUserId, () => port().findByRecord('order', order)))?.id).toBe(hidden.id);
    expect(await as(other.adminUserId, () => port().findByRecord('order', order))).toBeNull();
    expect(await as(member.adminUserId, () => port().findByRecord('order', unlinkedOrder))).toBeNull();
    // The same id under another kind is another record.
    expect(await as(member.adminUserId, () => port().findByRecord('quote_request', order))).toBeNull();
    expect(await as(member.adminUserId, () => port().findByRecord('order', 'not-an-id'))).toBeNull();
  });

  it('fails closed while projects is off', async () => {
    await withModuleOff('projects', 'deactivated', async () => {
      await expect(as(member.adminUserId, async () => port().findById(open.id))).rejects.toBeInstanceOf(ModuleDisabledError);
    });
    expect((await as(member.adminUserId, () => port().findById(open.id)))?.id).toBe(open.id);
  });
});
