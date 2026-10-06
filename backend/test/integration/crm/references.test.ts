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
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CrmOpportunityReference } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
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
  const PRODUCT_NAMES = { 'en-US': 'Example simple product', 'pl-PL': 'Przykładowy produkt prosty' };

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

  const renameProduct = (name: Record<string, string>) =>
    h.em().getConnection().execute(`update "products" set "name" = ?::jsonb where "id" = ?`, [
      JSON.stringify(name),
      SEED_PRODUCT_101_ID,
    ]);

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'References other');
  });

  afterAll(async () => {
    await renameProduct(PRODUCT_NAMES);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
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
        { type: 'order', id: order.id, available: true, label: order.businessId, url: `/orders/${order.id}` },
      ]);
      expect(Object.values(PRODUCT_NAMES)).toContain(read.references[0]?.label);
      expect(await storedReferences(opportunity.id)).toEqual(
        [`description:-:order:${order.id}`, `description:-:product:${SEED_PRODUCT_101_ID}`].sort(),
      );
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
      await renameProduct({ 'en-US': marker, 'pl-PL': marker, en: marker, pl: marker });
      try {
        const read = await detail(opportunity.id);
        expect(read.references[0]).toMatchObject({ available: true, label: marker });
        // Nothing of the old name was kept anywhere the response is built from.
        expect(JSON.stringify(read.references)).not.toContain(PRODUCT_NAMES['en-US']);
      } finally {
        await renameProduct(PRODUCT_NAMES);
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
          { type: 'order', id: ownOrder.id, available: true, label: ownOrder.businessId, url: `/orders/${ownOrder.id}` },
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
        { type: 'order', id: order.id, available: true, label: order.businessId, url: `/orders/${order.id}` },
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

  it('removes an Opportunity’s references with the Opportunity', async () => {
    const opportunity = await createCrmOpportunity(h, { description: product });
    expect(await storedReferences(opportunity.id)).toHaveLength(1);
    expect((await call('DELETE', `/opportunities/${opportunity.id}`)).statusCode).toBe(204);
    expect(await storedReferences(opportunity.id)).toEqual([]);
  });
});
