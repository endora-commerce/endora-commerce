import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatOpportunityReferenceToken,
  OpportunityCommentListResponseSchema,
  OpportunityCommentResponseSchema,
  OpportunityDetailResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { CrmOpportunityReference } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';

/**
 * User Story 12 — references to Products and Orders in the description, in
 * notes and in messages (`specs/143-crm-sales-opportunities/spec.md`, FR-045;
 * research R-21).
 */
describe('crm references to Products and Orders (US12)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  const product = formatOpportunityReferenceToken('product', SEED_PRODUCT_101_ID);
  /**
   * The seeded Product's Global name (`seed-catalog.ts`). Since feature 174
   * (`specs/174-product-editor-scope-switcher/data-model.md` §1, FR-031)
   * `products.name` is one text, not a language map, and a reference is
   * labelled by it whatever language the reader works in.
   */
  const PRODUCT_NAME = 'Example simple product';

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: Record<string, string> = CRM_ADMIN,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const detail = async (id: string, cookies: Record<string, string> = CRM_ADMIN) => {
    const response = await call('GET', `/opportunities/${id}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityDetailResponseSchema.parse(response.json()).data;
  };

  const storedReferences = async (opportunityId: string) =>
    (await h.em().find(CrmOpportunityReference, { opportunityId }, { filters: false }))
      .map((row) => `${row.sourceKind}:${row.sourceId ?? '-'}:${row.targetType}:${row.targetId}`)
      .sort();

  const renameProduct = (name: string) =>
    h.em().getConnection().execute(`update "products" set "name" = ? where "id" = ?`, [name, SEED_PRODUCT_101_ID]);

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'References other');
  });

  afterAll(async () => {
    await renameProduct(PRODUCT_NAME);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  /**
   * What an available Order reference says beyond its number
   * (`specs/158-crm-opportunity-inline-editing/`, FR-012), for an Order as
   * `seedCrmOrder` places it: its status, its total, when, and the billing
   * recipient — the seed's billing address carries no company.
   */
  const orderFacts = (): unknown => ({
    status: expect.any(String),
    total: '123.00',
    currency: 'PLN',
    placedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    customerName: 'A',
  });

  describe('in the description', () => {
    it('resolves a Product and an Order to named links, in the order they are mentioned', async () => {
      const order = await seedCrmOrder(h.em());
      const description = `Quoted ${product} against ${formatOpportunityReferenceToken('order', order.id)}.`;
      const opportunity = await createCrmOpportunity(h, { description });

      const read = await detail(opportunity.id);
      // The text is returned exactly as it was stored.
      expect(read.description).toBe(description);
      expect(read.references).toEqual([
        {
          type: 'product',
          id: SEED_PRODUCT_101_ID,
          available: true,
          label: expect.stringMatching(/\S/),
          url: `/catalog/products/${SEED_PRODUCT_101_ID}`,
        },
        { type: 'order', id: order.id, available: true, label: order.businessId, url: `/orders/${order.id}`, order: orderFacts() },
      ]);
      expect(read.references[0]?.label).toBe(PRODUCT_NAME);
      expect(await storedReferences(opportunity.id)).toEqual(
        [`description:-:order:${order.id}`, `description:-:product:${SEED_PRODUCT_101_ID}`].sort(),
      );
    });

    // `specs/163-projects-and-tasks/` FR-044, research R-14: the shared
    // grammar's Quote Request and Task tokens are stored and resolved as the
    // other three are — `references-documents.test.ts` holds the rest. The
    // Opportunity is removed at the end, so no row of the two types outlives
    // this case in the worker's database.
    it('resolves a Quote Request and a Task token and stores a row for each', async () => {
      const quote = await submitCrmQuoteRequest(h);
      const taskId = randomUUID();
      const taskNumber = `TSK-I${taskId.slice(0, 8)}`.toUpperCase();
      await h.orm.em.getConnection().execute(
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "created_at", "updated_at")
         values (?, ?, 'Interim', ?, now(), now())`,
        [taskId, taskNumber, TEST_ADMIN_ID],
      );
      const description =
        `See ${formatOpportunityReferenceToken('quote_request', quote.id)} ` +
        `and ${formatOpportunityReferenceToken('task', taskId)}, with ${product}.`;
      const opportunity = await createCrmOpportunity(h, { description });
      try {
        const read = await detail(opportunity.id);
        expect(read.description).toBe(description);
        expect(read.references).toEqual([
          { type: 'quote_request', id: quote.id, available: true, label: quote.businessId, url: `/quote-requests/${quote.id}` },
          { type: 'task', id: taskId, available: true, label: taskNumber, url: `/tasks/${taskId}` },
          expect.objectContaining({ type: 'product', id: SEED_PRODUCT_101_ID, available: true }),
        ]);
        expect(await storedReferences(opportunity.id)).toEqual(
          [
            `description:-:product:${SEED_PRODUCT_101_ID}`,
            `description:-:quote_request:${quote.id}`,
            `description:-:task:${taskId}`,
          ].sort(),
        );
      } finally {
        await call('DELETE', `/opportunities/${opportunity.id}`);
        await h.orm.em.getConnection().execute(`delete from "tasks" where "id" = ?`, [taskId]);
      }
    });

    it('replaces the stored references of the description when it is saved again', async () => {
      const first = await seedCrmOrder(h.em());
      const second = await seedCrmOrder(h.em());
      const opportunity = await createCrmOpportunity(h, {
        description: `${product} ${formatOpportunityReferenceToken('order', first.id)}`,
      });

      const edited = await call('PATCH', `/opportunities/${opportunity.id}`, {
        description: `Now only ${formatOpportunityReferenceToken('order', second.id)}`,
      });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(OpportunityDetailResponseSchema.parse(edited.json()).data.references.map((ref) => ref.id)).toEqual([
        second.id,
      ]);
      expect(await storedReferences(opportunity.id)).toEqual([`description:-:order:${second.id}`]);

      // An edit that does not touch the description leaves them alone.
      expect((await call('PATCH', `/opportunities/${opportunity.id}`, { title: 'Renamed' })).statusCode).toBe(200);
      expect(await storedReferences(opportunity.id)).toEqual([`description:-:order:${second.id}`]);

      // Clearing the description clears them.
      expect((await call('PATCH', `/opportunities/${opportunity.id}`, { description: null })).statusCode).toBe(200);
      expect(await storedReferences(opportunity.id)).toEqual([]);
      expect((await detail(opportunity.id)).references).toEqual([]);
    });

    it('shows the Product’s current name — renamed after the text was written', async () => {
      const opportunity = await createCrmOpportunity(h, { description: `Interested in ${product}` });
      const marker = `Renamed ${randomUUID().slice(0, 8)}`;
      await renameProduct(marker);
      try {
        const read = await detail(opportunity.id);
        expect(read.references[0]).toMatchObject({ available: true, label: marker });
        // Nothing of the old name was kept anywhere the response is built from.
        expect(JSON.stringify(read.references)).not.toContain(PRODUCT_NAME);
      } finally {
        await renameProduct(PRODUCT_NAME);
      }
    });

    it('shows a Product that does not exist as unavailable — no name, no link', async () => {
      const missing = randomUUID();
      const opportunity = await createCrmOpportunity(h, {
        description: `Was ${formatOpportunityReferenceToken('product', missing)}, now ${product}`,
      });
      const read = await detail(opportunity.id);
      expect(read.references).toEqual([
        { type: 'product', id: missing, available: false, label: null, url: null },
        expect.objectContaining({ type: 'product', id: SEED_PRODUCT_101_ID, available: true }),
      ]);
      // Stored all the same: the target may exist tomorrow.
      expect(await storedReferences(opportunity.id)).toContain(`description:-:product:${missing}`);
    });

    it('shows an Order outside the reader’s Organizations as unavailable, and leaks nothing of it', async () => {
      const foreignOrder = await seedCrmOrder(h.em(), { organizationId: otherOrganizationId });
      const ownOrder = await seedCrmOrder(h.em());
      const opportunity = await createCrmOpportunity(h, {
        description: `${formatOpportunityReferenceToken('order', foreignOrder.id)} and ${formatOpportunityReferenceToken('order', ownOrder.id)}`,
      });
      const rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'orders:read']);
      try {
        const response = await call('GET', `/opportunities/${opportunity.id}`, undefined, rep.cookies);
        expect(response.statusCode, response.body).toBe(200);
        const read = OpportunityDetailResponseSchema.parse(response.json()).data;
        expect(read.references).toEqual([
          { type: 'order', id: foreignOrder.id, available: false, label: null, url: null },
          { type: 'order', id: ownOrder.id, available: true, label: ownOrder.businessId, url: `/orders/${ownOrder.id}`, order: orderFacts() },
        ]);
        expect(response.body).not.toContain(String(foreignOrder.businessId));
      } finally {
        rep.undo();
      }
      // The control: the same reference, read by somebody who reaches both.
      const asAdmin = await detail(opportunity.id);
      expect(asAdmin.references[0]).toMatchObject({ available: true, label: foreignOrder.businessId });
    });

    it('returns markup as the text it is, and resolves nothing from it', async () => {
      const description = `<script>alert("x")</script> <a href="/orders/1">[[order:not-a-uuid]]</a> & <b>bold</b>`;
      const opportunity = await createCrmOpportunity(h, { description });
      const response = await call('GET', `/opportunities/${opportunity.id}`);
      const read = OpportunityDetailResponseSchema.parse(response.json()).data;
      expect(read.description).toBe(description);
      expect(read.references).toEqual([]);
      expect(response.headers['content-type']).toContain('application/json');
    });
  });

  describe('in notes and messages', () => {
    it('resolves the references of a note when it is written, listed and edited, and forgets them when it is deleted', async () => {
      const order = await seedCrmOrder(h.em());
      const opportunity = await createCrmOpportunity(h);
      const body = `Compare ${product} with ${formatOpportunityReferenceToken('order', order.id)}`;

      const written = await call('POST', `/opportunities/${opportunity.id}/comments`, { kind: 'note', body });
      expect(written.statusCode, written.body).toBe(201);
      const note = OpportunityCommentResponseSchema.parse(written.json()).data;
      expect(note.body).toBe(body);
      expect(note.references).toEqual([
        expect.objectContaining({ type: 'product', id: SEED_PRODUCT_101_ID, available: true }),
        { type: 'order', id: order.id, available: true, label: order.businessId, url: `/orders/${order.id}`, order: orderFacts() },
      ]);
      expect(await storedReferences(opportunity.id)).toEqual(
        [`comment:${note.id}:order:${order.id}`, `comment:${note.id}:product:${SEED_PRODUCT_101_ID}`].sort(),
      );

      const listed = OpportunityCommentListResponseSchema.parse(
        (await call('GET', `/opportunities/${opportunity.id}/comments?kind=note`)).json(),
      ).data;
      expect(listed).toHaveLength(1);
      expect(listed[0]?.references).toEqual(note.references);

      const edited = await call('PATCH', `/opportunities/${opportunity.id}/comments/${note.id}`, {
        body: `Only ${product} now`,
      });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(OpportunityCommentResponseSchema.parse(edited.json()).data.references.map((ref) => ref.type)).toEqual([
        'product',
      ]);
      expect(await storedReferences(opportunity.id)).toEqual([`comment:${note.id}:product:${SEED_PRODUCT_101_ID}`]);

      expect((await call('DELETE', `/opportunities/${opportunity.id}/comments/${note.id}`)).statusCode).toBe(204);
      expect(await storedReferences(opportunity.id)).toEqual([]);
    });

    it('keeps each source’s references apart: the description, a note and a message', async () => {
      const order = await seedCrmOrder(h.em());
      const orderToken = formatOpportunityReferenceToken('order', order.id);
      const opportunity = await createCrmOpportunity(h, { description: product });
      const note = await call('POST', `/opportunities/${opportunity.id}/comments`, { kind: 'note', body: orderToken });
      const message = await call('POST', `/opportunities/${opportunity.id}/comments`, {
        kind: 'message',
        body: `${product} ${orderToken}`,
      });
      const noteId = (note.json() as { data: { id: string } }).data.id;
      const messageId = (message.json() as { data: { id: string } }).data.id;
      expect(OpportunityCommentResponseSchema.parse(message.json()).data.references).toHaveLength(2);

      expect(await storedReferences(opportunity.id)).toEqual(
        [
          `description:-:product:${SEED_PRODUCT_101_ID}`,
          `comment:${noteId}:order:${order.id}`,
          `comment:${messageId}:product:${SEED_PRODUCT_101_ID}`,
          `comment:${messageId}:order:${order.id}`,
        ].sort(),
      );

      // Saving the description again touches the description's rows only.
      expect((await call('PATCH', `/opportunities/${opportunity.id}`, { description: 'Nothing now' })).statusCode).toBe(200);
      expect(await storedReferences(opportunity.id)).toEqual(
        [
          `comment:${noteId}:order:${order.id}`,
          `comment:${messageId}:product:${SEED_PRODUCT_101_ID}`,
          `comment:${messageId}:order:${order.id}`,
        ].sort(),
      );
    });

    it('a comment with no token has no references, and a text is never interpreted', async () => {
      const opportunity = await createCrmOpportunity(h);
      const body = 'Plain <b>text</b> with [[product:not-a-uuid]] and [order] brackets';
      const written = await call('POST', `/opportunities/${opportunity.id}/comments`, { kind: 'note', body });
      const note = OpportunityCommentResponseSchema.parse(written.json()).data;
      expect(note.body).toBe(body);
      expect(note.references).toEqual([]);
      expect(await storedReferences(opportunity.id)).toEqual([]);
    });
  });

  /**
   * `specs/165-task-management/` T028, research R-5: Opportunities and Projects
   * became referenceable kinds of the shared grammar, so CRM's texts store and
   * resolve them like every other kind — with no 500 from the widened check —
   * and its `@@` list offers both groups, each only while its owner is present
   * and to a reader holding its read code.
   */
  describe('Opportunities and Projects (165)', () => {
    let reader: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
    let project: { id: string; number: string };
    const projectIds: string[] = [];

    beforeAll(async () => {
      reader = await seedCrmAdmin(h.em(), 'refs-165', ['crm:read', 'crm:write', 'orders:read']);
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/projects',
        cookies: CRM_ADMIN,
        payload: {
          title: 'Referenced from CRM',
          organizationIds: [],
          stages: [{ name: 'Only', color: '#3b82f6', plannedDurationDays: 1 }],
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      project = (response.json() as { data: { id: string; number: string } }).data;
      projectIds.push(project.id);
    });

    afterAll(async () => {
      reader?.undo();
      await h.em().getConnection().execute(`delete from "projects" where "id" = any(?::uuid[])`, [`{${projectIds.join(',')}}`]);
    });

    it('stores and resolves an Opportunity and a Project in the description', async () => {
      const target = await createCrmOpportunity(h, { title: 'Referenced deal' });
      const description = `See ${formatOpportunityReferenceToken('opportunity', target.id)} and ${formatOpportunityReferenceToken('project', project.id)}`;
      const response = await call('POST', '/opportunities', {
        title: 'Referring deal',
        organizationId: TEST_ORGANIZATION_ID,
        currency: 'PLN',
        description,
      });
      expect(response.statusCode, response.body).toBe(201);
      const created = OpportunityDetailResponseSchema.parse(response.json()).data;
      expect((await detail(created.id)).references).toEqual([
        { type: 'opportunity', id: target.id, available: true, label: target.number, url: `/crm/opportunities/${target.id}` },
        { type: 'project', id: project.id, available: true, label: project.number, url: `/projects/${project.id}` },
      ]);
      expect(await storedReferences(created.id)).toEqual(
        [`description:-:opportunity:${target.id}`, `description:-:project:${project.id}`].sort(),
      );
      // A reader without projects:read sees the Project as unavailable.
      const narrow = await call('GET', `/opportunities/${created.id}`, undefined, reader.cookies);
      expect(OpportunityDetailResponseSchema.parse(narrow.json()).data.references[1]).toEqual({
        type: 'project',
        id: project.id,
        available: false,
        label: null,
        url: null,
      });
      expect(narrow.body).not.toContain(project.number);
      // While Projects is off, unavailable to everybody.
      await withModuleOff('projects', 'deactivated', async () => {
        expect((await detail(created.id)).references[1]).toMatchObject({ type: 'project', available: false });
      });
    });

    it('offers the two groups after @@ only to their readers and while their owners are present', async () => {
      const lookup = async (cookies: Record<string, string> = CRM_ADMIN) => {
        const response = await call('GET', `/lookups/documents?organizationId=${TEST_ORGANIZATION_ID}&q=`, undefined, cookies);
        expect(response.statusCode, response.body).toBe(200);
        return (response.json() as { groups: Array<{ kind: string; items: Array<{ id: string }> }> }).groups;
      };
      const all = await lookup();
      expect(all.map((g) => g.kind)).toEqual(expect.arrayContaining(['opportunity', 'project']));
      expect(all.find((g) => g.kind === 'project')!.items.map((i) => i.id)).toContain(project.id);
      expect((await lookup(reader.cookies)).map((g) => g.kind)).not.toContain('project');
      await withModuleOff('projects', 'deactivated', async () => {
        expect((await lookup()).map((g) => g.kind)).not.toContain('project');
      });
    });
  });

  it('removes an Opportunity’s references with the Opportunity', async () => {
    const opportunity = await createCrmOpportunity(h, { description: product });
    expect(await storedReferences(opportunity.id)).toHaveLength(1);
    expect((await call('DELETE', `/opportunities/${opportunity.id}`)).statusCode).toBe(204);
    expect(await storedReferences(opportunity.id)).toEqual([]);
  });
});
