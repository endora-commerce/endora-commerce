import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectLinkListResponseSchema, type ProjectLink } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createCrmOpportunity, submitCrmQuoteRequest } from '../../helpers/seed-crm.js';
import { callProjects, createProject, deleteProjects } from './helpers.js';
import { tapStatements } from '../../helpers/statement-tap.js';

/**
 * Issue #457 — a Project's links read their Quote Requests (with what they are
 * worth) and their Opportunities in one batch per kind, through the owners'
 * `findByIds`, so `GET /projects/:id/links` costs the same number of
 * statements for one linked record of each kind as for many. Before the fix
 * every linked Quote Request cost three statements and every Opportunity its
 * own read.
 */
describe('projects — linked records are read in batches (issue #457) [integration]', () => {
  let h: BackendServerHandle;
  const created: string[] = [];

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

  async function links(projectId: string): Promise<ProjectLink[]> {
    const response = await callProjects(h, 'GET', `/${projectId}/links`);
    expect(response.statusCode, response.body).toBe(200);
    return ProjectLinkListResponseSchema.parse(response.json()).data;
  }

  /** A Project of TEST with `count` Quote Requests and `count` Opportunities linked. */
  async function projectWith(count: number): Promise<string> {
    const project = await createProject(h, {
      title: `Batched links ×${count}`,
      organizationIds: [TEST_ORGANIZATION_ID],
      visibility: 'everyone',
    });
    created.push(project.id);
    for (let n = 0; n < count; n += 1) {
      const quote = await submitCrmQuoteRequest(h, { quantity: n + 1, desiredUnitPrice: 10 });
      const opportunity = await createCrmOpportunity(h, {
        title: `Batched links ×${count} #${n}`,
        valueMode: 'manual',
        manualValue: `${n + 1}00.00`,
      });
      for (const [kind, recordId] of [
        ['quote_request', quote.id],
        ['opportunity', opportunity.id],
      ] as const) {
        const response = await callProjects(h, 'POST', `/${project.id}/links`, { payload: { kind, recordId } });
        expect(response.statusCode, response.body).toBe(201);
      }
    }
    return project.id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('shows every linked record, each with its number, status and amount', async () => {
    const projectId = await projectWith(3);
    const shown = await links(projectId);
    expect(shown).toHaveLength(6);
    for (const link of shown) {
      expect(link.available, `${link.kind} ${link.recordId}`).toBe(true);
      expect(link.number).toEqual(expect.any(String));
      expect(link.status).toEqual(expect.any(String));
      expect(link.amount).toEqual(expect.any(String));
    }
    expect(shown.filter((link) => link.kind === 'quote_request').map((link) => link.amount).sort()).toEqual([
      '10.00',
      '20.00',
      '30.00',
    ]);
    expect(shown.filter((link) => link.kind === 'opportunity').map((link) => link.amount).sort()).toEqual([
      '100.00',
      '200.00',
      '300.00',
    ]);
  });

  it('costs the same number of statements for one linked record of each kind as for five', async () => {
    const one = await projectWith(1);
    const five = await projectWith(5);
    // Warm whatever a first request caches (settings, permissions), so both
    // measurements count only the per-request work.
    await links(one);
    await links(five);

    const few = await statements(() => links(one));
    const many = await statements(() => links(five));
    expect(few.result).toHaveLength(2);
    expect(many.result).toHaveLength(10);
    expect(many.result.every((link) => link.available)).toBe(true);
    expect(many.queries, `1 of each: ${few.queries} statements; 5 of each: ${many.queries}`).toBe(few.queries);
  });
});
