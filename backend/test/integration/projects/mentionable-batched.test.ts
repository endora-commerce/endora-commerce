import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectMentionableLookupResponseSchema, type ProjectDetail } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import { callProjects, createProject, deleteProjects, setProjectsVisibility } from './helpers.js';
import { tapStatements } from '../../helpers/statement-tap.js';

/**
 * Issue #461 — `GET /projects/lookups/mentionable` judges every candidate's
 * sight of the Project together (`ProjectAccess.canSeeAsMany`): active,
 * holding `projects:read`, and passing the visibility rule and the
 * Organization rule against their **own** reach — a sales representative's
 * included. What it offers is pinned person by person; what it costs does not
 * grow with the number of candidates. Before the fix every candidate cost the
 * reads `canSeeAs` makes for one person.
 */
describe('projects — the mentionable lookup asks once for everybody (issue #461) [integration]', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const people: Person[] = [];
  let project: ProjectDetail;
  /** Group A: two people, both of whom may see the Project. */
  let a: Record<'member' | 'rep', Person>;
  /** Group B: eight people, four of whom may see the Project. */
  let b: Record<'member' | 'member2' | 'listed' | 'seeAll' | 'stranger' | 'noRead' | 'inactive' | 'rep', Person>;

  async function statements<T>(run: () => Promise<T>): Promise<{ result: T; queries: number }> {
    let queries = 0;
    const onQuery = (): void => {
      queries += 1;
    };
    const untap = tapStatements(h.em(), onQuery);
    try {
      return { result: await run(), queries };
    } finally {
      untap();
    }
  }

  const mentionable = async (q: string): Promise<string[]> => {
    const response = await callProjects(h, 'GET', `/lookups/mentionable?projectId=${project.id}&q=${q}`);
    expect(response.statusCode, response.body).toBe(200);
    return ProjectMentionableLookupResponseSchema.parse(response.json()).data.map((option) => option.id);
  };

  const admin = async (label: string, permissions: string[]): Promise<Person> => {
    const made = await seedCrmAdmin(h.em(), label, permissions);
    people.push(made);
    return made;
  };

  /** A sales representative of `organizationIds`, named so the lookup's `q` finds it. */
  const rep = async (label: string, organizationIds: string[]): Promise<Person> => {
    const made = await seedCrmSalesRep(h.em(), organizationIds, ['projects:read']);
    people.push(made);
    const em = h.em().fork();
    const row = await em.findOneOrFail(AdminUser, { id: made.adminUserId }, { filters: false });
    row.lastName = `crm-${label}`;
    row.email = `crm-${label}-${made.adminUserId.slice(0, 8)}@crm.local`;
    await em.flush();
    return made;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await setProjectsVisibility(h, 'members');
    const elsewhere = await seedCrmOrganization(h.em(), 'mentionable batched elsewhere');
    a = {
      member: await admin('mb-a-member', ['projects:read']),
      // Governs the Project's Organization, so reaches it.
      rep: await rep('mb-a-rep', [TEST_ORGANIZATION_ID]),
    };
    b = {
      member: await admin('mb-b-member', ['projects:read']),
      member2: await admin('mb-b-member2', ['projects:read']),
      listed: await admin('mb-b-listed', ['projects:read']),
      seeAll: await admin('mb-b-see-all', ['projects:read', 'projects:see_all']),
      // Holds `projects:read` but is neither a Member nor listed.
      stranger: await admin('mb-b-stranger', ['projects:read']),
      noRead: await admin('mb-b-no-read', ['crm:read']),
      inactive: await admin('mb-b-inactive', ['projects:read']),
      // A Member, but the Project's Organization is governed by another representative.
      rep: await rep('mb-b-rep', [elsewhere]),
    };
    project = await createProject(h, {
      title: 'Mentionable, batched',
      organizationIds: [TEST_ORGANIZATION_ID],
      members: [a.member, a.rep, b.member, b.member2, b.noRead, b.inactive, b.rep].map((p) => ({
        adminUserId: p.adminUserId,
        roleIds: [],
      })),
      viewerIds: [b.listed.adminUserId],
    });
    // A Member who has since been deactivated: a Member may only be added while active.
    const em = h.em().fork();
    const inactive = await em.findOneOrFail(AdminUser, { id: b.inactive.adminUserId }, { filters: false });
    inactive.status = 'inactive';
    await em.flush();
  });

  afterAll(async () => {
    for (const p of people) p.undo();
    if (project) await deleteProjects(h, [project.id]);
    await teardownBackendServer(h);
  });

  it('offers exactly the people who may see the Project — a reaching representative included', async () => {
    expect((await mentionable('mb-a-')).sort()).toEqual([a.member.adminUserId, a.rep.adminUserId].sort());
    expect((await mentionable('mb-b-')).sort()).toEqual(
      [b.member.adminUserId, b.member2.adminUserId, b.listed.adminUserId, b.seeAll.adminUserId].sort(),
    );
  });

  it('costs the same number of statements for two candidates as for eight', async () => {
    // Warm whatever a first request caches, so both measurements count only
    // the per-request work.
    await mentionable('mb-a-');
    await mentionable('mb-b-');
    const two = await statements(() => mentionable('mb-a-'));
    const eight = await statements(() => mentionable('mb-b-'));
    expect(two.result).toHaveLength(2);
    expect(eight.result).toHaveLength(4);
    expect(eight.queries, `2 candidates: ${two.queries} statements; 8 candidates: ${eight.queries}`).toBe(two.queries);
  });
});
