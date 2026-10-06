import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityDetailResponseSchema,
  OpportunityLinkResponseSchema,
  OpportunityTransitionResponseSchema,
  OpportunityTransitionVetoError,
  PropagationOutcomeResponseSchema,
  type OpportunityTransitionGuardRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  setCrmForwardMappings,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { CrmOpportunityStatusHistory, CrmStatusPropagation, Order } from '../../helpers/package-entities.js';

/**
 * Linking Orders and moving an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §2 and §3).
 */
describe('crm links and transition (contract)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let viewer: { cookies: { b2b_session: string }; undo: () => void };

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

  const detail = async (id: string) =>
    OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${id}`)).json()).data;

  const orderStatus = async (id: string) =>
    (await h.em().findOneOrFail(Order, { id }, { filters: false })).status;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Other');
    viewer = await seedCrmAdmin(h.em(), 'viewer', ['crm:read']);
    // `qualified` asks a linked Order for `paid` (the Order workflow has
    // new → paid). `lost` asks for `completed`, which an Order in `new` cannot
    // reach — the refusal the retry and dismiss cases need.
    const mapped = await setCrmForwardMappings(h, { qualified: 'paid', lost: 'completed' });
    expect(mapped.statusCode, mapped.body).toBe(200);
  });

  afterAll(async () => {
    viewer.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('POST /opportunities/:id/links', () => {
    it('links an Order of the same Organization — 201, following by default', async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      const response = await linkCrmOrder(h, opportunity.id, order.id);
      expect(response.statusCode, response.body).toBe(201);
      const { data } = OpportunityLinkResponseSchema.parse(response.json());
      expect(data).toMatchObject({
        documentKind: 'order',
        documentId: order.id,
        available: true,
        number: order.businessId,
        status: 'new',
        total: '123.00',
        currency: 'PLN',
        syncStatus: true,
        linkSource: 'manual',
      });
      expect((await detail(opportunity.id)).links).toEqual([data]);
    });

    it('is audited as link_add and emits crm.opportunity.document_linked.v1 once', async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      const seen: unknown[] = [];
      const off = h.eventBus.on('crm.opportunity.document_linked.v1', (payload: unknown) => {
        seen.push(payload);
      });
      try {
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      } finally {
        off();
      }
      expect(seen).toEqual([
        expect.objectContaining({
          opportunityId: opportunity.id,
          organizationId: TEST_ORGANIZATION_ID,
          documentKind: 'order',
          documentId: order.id,
          linkSource: 'manual',
        }),
      ]);
      const entries = await h.auditLogService.query({
        action: 'crm.opportunity.link_add',
        objectId: opportunity.id,
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.objectType).toBe('crm_opportunity');
    });

    it('answers 404 CRM_DOCUMENT_NOT_FOUND for an Order that does not exist', async () => {
      const opportunity = await createCrmOpportunity(h);
      const response = await linkCrmOrder(h, opportunity.id, randomUUID());
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('CRM_DOCUMENT_NOT_FOUND');
    });

    it('answers 409 CRM_DOCUMENT_ALREADY_LINKED naming the Opportunity that holds it', async () => {
      const holder = await createCrmOpportunity(h);
      const second = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, holder.id, order.id)).statusCode).toBe(201);

      const response = await linkCrmOrder(h, second.id, order.id);
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject({
        code: 'CRM_DOCUMENT_ALREADY_LINKED',
        details: { opportunityId: holder.id },
      });
      expect((await detail(second.id)).links).toEqual([]);

      // The same document twice on one Opportunity is the same refusal.
      const again = await linkCrmOrder(h, holder.id, order.id);
      expect(again.statusCode, again.body).toBe(409);
      expect(again.json().error.code).toBe('CRM_DOCUMENT_ALREADY_LINKED');
    });

    it('answers 422 CRM_LINK_ORGANIZATION_MISMATCH for an Order of another Organization', async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em(), { organizationId: otherOrganizationId });
      const response = await linkCrmOrder(h, opportunity.id, order.id);
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error.code).toBe('CRM_LINK_ORGANIZATION_MISMATCH');
      expect((await detail(opportunity.id)).links).toEqual([]);
    });

    it('answers 404 CRM_OPPORTUNITY_NOT_FOUND for an unknown Opportunity', async () => {
      const order = await seedCrmOrder(h.em());
      const response = await linkCrmOrder(h, randomUUID(), order.id);
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });

    it('refuses a body the schema does not accept, and is gated crm:write', async () => {
      const opportunity = await createCrmOpportunity(h);
      const malformed = await call('POST', `/opportunities/${opportunity.id}/links`, {
        documentKind: 'invoice',
        documentId: randomUUID(),
      });
      expect(malformed.statusCode, malformed.body).toBe(400);
      const order = await seedCrmOrder(h.em());
      const refused = await linkCrmOrder(h, opportunity.id, order.id, { cookies: viewer.cookies });
      expect(refused.statusCode, refused.body).toBe(403);
    });
  });

  describe('PATCH and DELETE /opportunities/:id/links/:linkId', () => {
    it('switches following off and on, and unlinks', async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      const link = OpportunityLinkResponseSchema.parse(
        (await linkCrmOrder(h, opportunity.id, order.id)).json(),
      ).data;

      const off = await call('PATCH', `/opportunities/${opportunity.id}/links/${link.id}`, { syncStatus: false });
      expect(off.statusCode, off.body).toBe(200);
      expect(OpportunityLinkResponseSchema.parse(off.json()).data.syncStatus).toBe(false);
      expect((await detail(opportunity.id)).links[0]?.syncStatus).toBe(false);

      const removed = await call('DELETE', `/opportunities/${opportunity.id}/links/${link.id}`);
      expect(removed.statusCode, removed.body).toBe(204);
      expect((await detail(opportunity.id)).links).toEqual([]);

      for (const action of ['crm.opportunity.link_sync_set', 'crm.opportunity.link_remove']) {
        const entries = await h.auditLogService.query({ action, objectId: opportunity.id });
        expect(entries, action).toHaveLength(1);
      }

      // Unlinked, the Order can be linked again — here or anywhere.
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
    });

    it('answers 404 for a link that is not on this Opportunity', async () => {
      const opportunity = await createCrmOpportunity(h);
      const other = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      const link = OpportunityLinkResponseSchema.parse((await linkCrmOrder(h, other.id, order.id)).json()).data;

      const patched = await call('PATCH', `/opportunities/${opportunity.id}/links/${link.id}`, { syncStatus: false });
      expect(patched.statusCode, patched.body).toBe(404);
      const removed = await call('DELETE', `/opportunities/${opportunity.id}/links/${link.id}`);
      expect(removed.statusCode, removed.body).toBe(404);
      expect((await detail(other.id)).links[0]).toMatchObject({ id: link.id, syncStatus: true });
    });
  });

  describe('POST /opportunities/:id/transition', () => {
    it('moves the Opportunity and answers the result shape, with one outcome per following Order', async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

      const response = await transitionCrmOpportunity(h, opportunity.id, 'qualified', CRM_ADMIN, 'Call went well');
      expect(response.statusCode, response.body).toBe(200);
      const { data } = OpportunityTransitionResponseSchema.parse(response.json());
      expect(data.from).toBe('new');
      expect(data.to).toBe('qualified');
      expect(data.opportunity.status).toMatchObject({ code: 'qualified', kind: 'open' });
      expect(data.opportunity.version).toBe(opportunity.version + 1);
      expect(data.propagation).toEqual([
        expect.objectContaining({
          orderId: order.id,
          orderNumber: order.businessId,
          direction: 'opportunity_to_order',
          orderStatusCode: 'paid',
          outcome: 'applied',
          detail: null,
        }),
      ]);
      expect(await orderStatus(order.id)).toBe('paid');

      const history = await h
        .em()
        .find(CrmOpportunityStatusHistory, { opportunityId: opportunity.id }, { filters: false, orderBy: { changedAt: 'asc' } });
      expect(
        history.map((row) => [row.fromStatusCode ?? null, row.toStatusCode, row.cause, row.reason ?? null]),
      ).toEqual([
        [null, 'new', 'created', null],
        ['new', 'qualified', 'manual', 'Call went well'],
      ]);
      const audit = await h.auditLogService.query({ action: 'crm.opportunity.transition', objectId: opportunity.id });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.stateBefore).toMatchObject({ status: 'new' });
      expect(audit[0]?.stateAfter).toMatchObject({ status: 'qualified' });
    });

    it('answers 200 with an empty propagation when the Opportunity is already there, writing nothing', async () => {
      const opportunity = await createCrmOpportunity(h);
      const response = await transitionCrmOpportunity(h, opportunity.id, 'new');
      expect(response.statusCode, response.body).toBe(200);
      const { data } = OpportunityTransitionResponseSchema.parse(response.json());
      expect(data).toMatchObject({ from: 'new', to: 'new', propagation: [] });
      expect(data.opportunity.version).toBe(opportunity.version);
      const audit = await h.auditLogService.query({ action: 'crm.opportunity.transition', objectId: opportunity.id });
      expect(audit).toHaveLength(0);
    });

    it('refuses an unknown status — 422 VALIDATION_FAILED', async () => {
      const opportunity = await createCrmOpportunity(h);
      const response = await transitionCrmOpportunity(h, opportunity.id, 'no_such_status');
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
      expect((await detail(opportunity.id)).status.code).toBe('new');
    });

    it('refuses a transition the workflow has no edge for — 409 CRM_INVALID_TRANSITION', async () => {
      const opportunity = await createCrmOpportunity(h);
      const response = await transitionCrmOpportunity(h, opportunity.id, 'won');
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject({
        code: 'CRM_INVALID_TRANSITION',
        details: { from: 'new', to: 'won' },
      });
      expect((await detail(opportunity.id)).status.code).toBe('new');
    });

    it('refuses a vetoed transition — 409 CRM_TRANSITION_VETOED with the guard’s sentence', async () => {
      const marker = randomUUID();
      const opportunity = await createCrmOpportunity(h, { title: marker });
      const registry = h.container.resolve<OpportunityTransitionGuardRegistryPort>(
        'opportunityTransitionGuardRegistry',
      );
      // A guard cannot be withdrawn, so this one refuses its own Opportunity
      // only and is inert for every other test in the file.
      registry.register({
        ownerModuleId: 'crm',
        match: { from: 'new', to: 'qualified' },
        guard: (event) => {
          if (event.opportunityId === opportunity.id) {
            throw new OpportunityTransitionVetoError('Qualify the contact before the deal.', event.from, event.to);
          }
        },
      });
      const response = await transitionCrmOpportunity(h, opportunity.id, 'qualified');
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject({
        code: 'CRM_TRANSITION_VETOED',
        message: 'Qualify the contact before the deal.',
      });
      expect((await detail(opportunity.id)).status.code).toBe('new');
    });

    it('answers 404 CRM_OPPORTUNITY_NOT_FOUND for an unknown Opportunity, and is gated crm:write', async () => {
      const missing = await transitionCrmOpportunity(h, randomUUID(), 'qualified');
      expect(missing.statusCode, missing.body).toBe(404);
      expect(missing.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      const opportunity = await createCrmOpportunity(h);
      const refused = await transitionCrmOpportunity(h, opportunity.id, 'qualified', viewer.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
    });

    it('answers 409 CRM_TRANSITION_CONFLICT when the Opportunity keeps moving underneath the request', async () => {
      const opportunity = await createCrmOpportunity(h);
      const flipped: string[] = [];
      // Each `.before` of this Opportunity moves it somewhere else before the
      // write takes its lock: once on the first evaluation, once on the
      // re-evaluation. The service chases a moved row once, then refuses.
      const flip = (to: string) => async () => {
        flipped.push(to);
        await h.em().getConnection().execute(
          `update "crm_opportunities" set "status_code" = ? where "id" = ?`,
          [to, opportunity.id],
        );
      };
      const registry = h.container.resolve<OpportunityTransitionGuardRegistryPort>(
        'opportunityTransitionGuardRegistry',
      );
      const moves = ['proposal', 'negotiation'];
      registry.register({
        ownerModuleId: 'crm',
        match: { to: 'lost' },
        guard: async (event) => {
          if (event.opportunityId !== opportunity.id) return;
          const next = moves.shift();
          if (next) await flip(next)();
        },
      });
      const response = await transitionCrmOpportunity(h, opportunity.id, 'lost');
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_TRANSITION_CONFLICT');
      expect(flipped).toEqual(['proposal', 'negotiation']);
      expect((await detail(opportunity.id)).status.code).toBe('negotiation');
    });
  });

  describe('retry and dismiss', () => {
    /** An Opportunity whose linked Order refused: `lost` asks for `completed`, which `new` cannot reach. */
    async function refusedOnce() {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      const response = await transitionCrmOpportunity(h, opportunity.id, 'lost');
      expect(response.statusCode, response.body).toBe(200);
      const { data } = OpportunityTransitionResponseSchema.parse(response.json());
      expect(data.propagation).toHaveLength(1);
      expect(data.propagation[0]).toMatchObject({ outcome: 'not_permitted', orderStatusCode: 'completed' });
      expect(data.propagation[0]?.detail).toEqual(expect.any(String));
      expect(data.opportunity.unresolvedPropagations).toEqual(data.propagation);
      return { opportunity, order, refusal: data.propagation[0]! };
    }

    it('POST …/retry answers the new outcome and retires the old one', async () => {
      const { opportunity, order, refusal } = await refusedOnce();
      // Still refused: nothing about the Order changed.
      const again = await call('POST', `/opportunities/${opportunity.id}/propagations/${refusal.id}/retry`);
      expect(again.statusCode, again.body).toBe(200);
      const second = PropagationOutcomeResponseSchema.parse(again.json()).data;
      expect(second).toMatchObject({ orderId: order.id, outcome: 'not_permitted', orderStatusCode: 'completed' });
      expect(second.id).not.toBe(refusal.id);
      expect((await detail(opportunity.id)).unresolvedPropagations.map((row) => row.id)).toEqual([second.id]);

      // Fix the cause — the Order reaches a status `completed` follows — and retry.
      await h.em().getConnection().execute(`update "orders" set "status" = 'paid' where "id" = ?`, [order.id]);
      const fixed = await call('POST', `/opportunities/${opportunity.id}/propagations/${second.id}/retry`);
      expect(fixed.statusCode, fixed.body).toBe(200);
      expect(PropagationOutcomeResponseSchema.parse(fixed.json()).data).toMatchObject({
        orderId: order.id,
        outcome: 'applied',
        detail: null,
      });
      expect(await orderStatus(order.id)).toBe('completed');
      expect((await detail(opportunity.id)).unresolvedPropagations).toEqual([]);
      const audit = await h.auditLogService.query({
        action: 'crm.opportunity.propagation_retry',
        objectId: opportunity.id,
      });
      expect(audit).toHaveLength(2);
    });

    it('POST …/dismiss acknowledges a refusal — 204, gone from the unresolved list, the Order untouched', async () => {
      const { opportunity, order, refusal } = await refusedOnce();
      const response = await call('POST', `/opportunities/${opportunity.id}/propagations/${refusal.id}/dismiss`);
      expect(response.statusCode, response.body).toBe(204);
      expect((await detail(opportunity.id)).unresolvedPropagations).toEqual([]);
      expect(await orderStatus(order.id)).toBe('new');
      const audit = await h.auditLogService.query({
        action: 'crm.opportunity.propagation_dismiss',
        objectId: opportunity.id,
      });
      expect(audit).toHaveLength(1);
      // A dismissed outcome is settled: it cannot be retried.
      const retry = await call('POST', `/opportunities/${opportunity.id}/propagations/${refusal.id}/retry`);
      expect(retry.statusCode, retry.body).toBe(409);
    });

    it('answers 404 for an outcome that is not on this Opportunity, and both are gated crm:write', async () => {
      const { opportunity, refusal } = await refusedOnce();
      const other = await createCrmOpportunity(h);
      for (const action of ['retry', 'dismiss']) {
        const misplaced = await call('POST', `/opportunities/${other.id}/propagations/${refusal.id}/${action}`);
        expect(misplaced.statusCode, `${action} ${misplaced.body}`).toBe(404);
        const refused = await call(
          'POST',
          `/opportunities/${opportunity.id}/propagations/${refusal.id}/${action}`,
          undefined,
          viewer.cookies,
        );
        expect(refused.statusCode, `${action} ${refused.body}`).toBe(403);
      }
      expect((await detail(opportunity.id)).unresolvedPropagations.map((row) => row.id)).toEqual([refusal.id]);
    });

    it('lets one of two simultaneous retries of one outcome through: the Order is asked once more, not twice (review finding 8)', async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      const moved = await transitionCrmOpportunity(h, opportunity.id, 'lost');
      expect(moved.statusCode, moved.body).toBe(200);
      const refusal = OpportunityTransitionResponseSchema.parse(moved.json()).data.propagation[0]!;
      expect(refusal.outcome).toBe('not_permitted');

      const path = `/opportunities/${opportunity.id}/propagations/${refusal.id}/retry`;
      const answers = await Promise.all([call('POST', path), call('POST', path)]);
      expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409]);

      // The retired refusal and the one retry that replaced it — not two.
      const rows = await h.em().find(CrmStatusPropagation, { opportunityId: opportunity.id }, { filters: false });
      expect(rows).toHaveLength(2);
      expect((await detail(opportunity.id)).unresolvedPropagations).toHaveLength(1);
      const audit = await h.auditLogService.query({
        action: 'crm.opportunity.propagation_retry',
        objectId: opportunity.id,
      });
      expect(audit).toHaveLength(1);
    });
  });

  describe('an Order is `orders`’ to show and to follow — crm:write alone is not orders:read (review finding 3)', () => {
    let crmOnly: { cookies: { b2b_session: string }; undo: () => void };

    beforeAll(async () => {
      crmOnly = await seedCrmAdmin(h.em(), 'links-crm-only', ['crm:read', 'crm:write']);
    });

    afterAll(() => {
      crmOnly.undo();
    });

    it('refuses linking an Order and switching its following without orders:read — 403, nothing written', async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());

      const linked = await linkCrmOrder(h, opportunity.id, order.id, { cookies: crmOnly.cookies });
      expect(linked.statusCode, linked.body).toBe(403);
      expect(linked.body).not.toContain(order.id);
      expect((await detail(opportunity.id)).links).toEqual([]);

      // Linked by somebody who may: the crm-only caller cannot decide whether it follows…
      const link = OpportunityLinkResponseSchema.parse((await linkCrmOrder(h, opportunity.id, order.id)).json()).data;
      const path = `/opportunities/${opportunity.id}/links/${link.id}`;
      const toggled = await call('PATCH', path, { syncStatus: false }, crmOnly.cookies);
      expect(toggled.statusCode, toggled.body).toBe(403);
      expect((await detail(opportunity.id)).links[0]?.syncStatus).toBe(true);

      // …and may still take the link off, which shows nothing and moves nothing.
      const removed = await call('DELETE', path, undefined, crmOnly.cookies);
      expect(removed.statusCode, removed.body).toBe(204);
    });

    it('shows a linked Order as unavailable — no number, status or total — to a reader without orders:read', async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      // `lost` asks the Order for a status it cannot reach: an unresolved outcome naming it.
      expect((await transitionCrmOpportunity(h, opportunity.id, 'lost')).statusCode).toBe(200);

      // The control: somebody holding orders:read is shown the Order.
      const full = await detail(opportunity.id);
      expect(full.links[0]).toMatchObject({ documentId: order.id, available: true });
      expect(full.links[0]?.number).toEqual(expect.any(String));
      expect(full.unresolvedPropagations[0]?.orderNumber).toBe(full.links[0]?.number);

      const read = await call('GET', `/opportunities/${opportunity.id}`, undefined, crmOnly.cookies);
      expect(read.statusCode, read.body).toBe(200);
      const narrowed = OpportunityDetailResponseSchema.parse(read.json()).data;
      expect(narrowed.links).toHaveLength(1);
      expect(narrowed.links[0]).toMatchObject({ documentKind: 'order', documentId: order.id, available: false });
      for (const member of ['number', 'status', 'total', 'currency'] as const) {
        expect(narrowed.links[0], member).not.toHaveProperty(member);
      }
      expect(narrowed.unresolvedPropagations).toHaveLength(1);
      expect(narrowed.unresolvedPropagations[0]?.orderNumber).toBeNull();
      expect(read.body).not.toContain(full.links[0]?.number ?? 'no-number');
    });
  });
});
