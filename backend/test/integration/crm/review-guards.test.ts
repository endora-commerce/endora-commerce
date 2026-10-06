import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CrmStatusPropagation } from '../../helpers/package-entities.js';
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
  setCrmMappings,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';

/**
 * Guards the module had and no test held
 * (`specs/143-crm-sales-opportunities/research.md` N-R11): each of these was
 * removed from the code once, by a review, with the whole suite still green.
 * Every test here was seen red against its guard taken out.
 */
describe('crm guards a review found untested', () => {
  let h: BackendServerHandle;
  let organizationB: string;
  let crmOnly: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
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

  type Detail = {
    status: { code: string };
    closedAt: string | null;
    closedKind: string | null;
    customerAccount: { id: string } | null;
    unresolvedPropagations: Array<{ id: string; outcome: string }>;
  };
  const detail = async (opportunityId: string) =>
    ((await call('GET', `/opportunities/${opportunityId}`)).json() as { data: Detail }).data;

  const propagationsOf = (opportunityId: string) =>
    h.em().find(CrmStatusPropagation, { opportunityId }, { filters: false, orderBy: { createdAt: 'asc' } });

  /** A forward outcome written as a transition would have left it. */
  const seedForwardRow = async (
    row: { opportunityId: string; orderId: string; opportunityStatusCode: string; orderStatusCode: string },
    overrides: { outcome?: 'pending' | 'applied'; createdAt?: Date } = {},
  ) => {
    const em = h.em();
    const created = em.create(CrmStatusPropagation, {
      ...row,
      direction: 'opportunity_to_order',
      outcome: overrides.outcome ?? 'applied',
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    });
    await em.flush();
    return created.id;
  };

  /** Announce an Order status change and wait for every subscriber: the bus awaits each in turn, this one last. */
  const announceOrderStatus = async (event: { orderId: string; organizationId: string; to: string }) => {
    const eventId = randomUUID();
    let off: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      off = h.eventBus.on('order.status_changed.v1', (payload: unknown) => {
        if ((payload as { eventId?: string }).eventId === eventId) resolve();
      });
    });
    try {
      (h.eventBus as unknown as { emit(name: string, payload: unknown): void }).emit('order.status_changed.v1', {
        eventId,
        occurredAt: new Date().toISOString(),
        salesChannelId: randomUUID(),
        from: 'new',
        ...event,
      });
      await settled;
    } finally {
      off();
    }
  };

  /** An Opportunity moved to `lost` whose one following Order refused to follow. */
  const refusedAtLost = async () => {
    expect((await setCrmForwardMappings(h, { lost: 'completed' })).statusCode).toBe(200);
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em());
    const linked = await linkCrmOrder(h, opportunity.id, order.id);
    expect(linked.statusCode, linked.body).toBe(201);
    const moved = await transitionCrmOpportunity(h, opportunity.id, 'lost');
    expect(moved.statusCode, moved.body).toBe(200);
    const refusal = (moved.json() as { data: { propagation: Array<{ id: string; outcome: string }> } }).data
      .propagation[0]!;
    expect(refusal.outcome).toBe('not_permitted');
    return {
      opportunity,
      order,
      linkId: (linked.json() as { data: { id: string } }).data.id,
      refusal,
      retry: () => call('POST', `/opportunities/${opportunity.id}/propagations/${refusal.id}/retry`),
      dismiss: () => call('POST', `/opportunities/${opportunity.id}/propagations/${refusal.id}/dismiss`),
    };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationB = await seedCrmOrganization(h.em(), 'Guards B');
    crmOnly = await seedCrmAdmin(h.em(), 'guards-crm-only', ['crm:read', 'crm:write']);
  });

  afterAll(async () => {
    crmOnly.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('editing', () => {
    it('refuses, on PATCH, a contact person of another Organization than the Opportunity’s', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: organizationB });
      const refused = await call('PATCH', `/opportunities/${foreign.id}`, { customerAccountId: TEST_CUSTOMER_ID });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect((await detail(foreign.id)).customerAccount).toBeNull();

      // The control: the same person on an Opportunity of their own Organization.
      const own = await createCrmOpportunity(h, { organizationId: TEST_ORGANIZATION_ID });
      const taken = await call('PATCH', `/opportunities/${own.id}`, { customerAccountId: TEST_CUSTOMER_ID });
      expect(taken.statusCode, taken.body).toBe(200);
      expect((await detail(own.id)).customerAccount?.id).toBe(TEST_CUSTOMER_ID);
    });
  });

  describe('workflow configuration', () => {
    it('does not let what a status means change while an Opportunity is in it', async () => {
      const opportunity = await createCrmOpportunity(h);
      try {
        expect((await transitionCrmOpportunity(h, opportunity.id, 'qualified')).statusCode).toBe(200);
        const refused = await call('PATCH', '/statuses/qualified', { kind: 'lost' });
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json().error).toMatchObject({
          code: ERROR_CODES.CRM_STATUS_IN_USE,
          details: { statusCode: 'qualified', count: 1 },
        });
        const workflow = (await call('GET', '/workflow')).json() as {
          data: { statuses: Array<{ code: string; kind: string }> };
        };
        expect(workflow.data.statuses.find((status) => status.code === 'qualified')?.kind).toBe('open');

        // The control: with nothing in it, the same request goes through.
        expect((await call('DELETE', `/opportunities/${opportunity.id}`)).statusCode).toBe(204);
        const allowed = await call('PATCH', '/statuses/qualified', { kind: 'lost' });
        expect(allowed.statusCode, allowed.body).toBe(200);
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });

    it.each([
      ['POST /statuses', 'POST', '/statuses', { code: 'review_extra', defaultName: 'Extra', kind: 'open' }],
      ['PATCH /statuses/:code', 'PATCH', '/statuses/qualified', { defaultName: 'Renamed by a rep' }],
      ['DELETE /statuses/:code', 'DELETE', '/statuses/negotiation', undefined],
      ['PUT /transitions', 'PUT', '/transitions', { add: [{ fromStatusCode: 'won', toStatusCode: 'new' }] }],
      ['PUT /order-status-mappings', 'PUT', '/order-status-mappings', { mappings: [] }],
    ] as const)('answers 403 on %s to crm:read + crm:write without crm:configure, and changes nothing', async (_label, method, path, payload) => {
      const workflow = async () => (await call('GET', '/workflow')).body;
      expect(
        (
          await setCrmMappings(h, [
            { direction: 'opportunity_to_order', opportunityStatusCode: 'won', orderStatusCode: 'completed' },
          ])
        ).statusCode,
      ).toBe(200);
      try {
        const before = await workflow();
        const refused = await call(method, path, payload, crmOnly.cookies);
        expect(refused.statusCode, refused.body).toBe(403);
        expect(refused.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
        expect(await workflow()).toBe(before);
        // The control: the caller is known and may read what it may not configure.
        expect((await call('GET', '/workflow', undefined, crmOnly.cookies)).statusCode).toBe(200);
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });
  });

  describe('transition', () => {
    it('clears closedAt and closedKind when a closed Opportunity is reopened', async () => {
      const opportunity = await createCrmOpportunity(h);
      expect((await transitionCrmOpportunity(h, opportunity.id, 'lost')).statusCode).toBe(200);
      const closed = await detail(opportunity.id);
      expect(closed.closedKind).toBe('lost');
      expect(closed.closedAt).toEqual(expect.any(String));

      expect((await transitionCrmOpportunity(h, opportunity.id, 'new')).statusCode).toBe(200);
      expect(await detail(opportunity.id)).toMatchObject({ status: { code: 'new' }, closedAt: null, closedKind: null });
    });
  });

  describe('a refused outcome: retry and dismiss', () => {
    afterAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
    });

    it('does not retry once the Opportunity has moved on from the status the outcome is about', async () => {
      const { opportunity, retry } = await refusedAtLost();
      expect((await transitionCrmOpportunity(h, opportunity.id, 'new')).statusCode).toBe(200);
      const refused = await retry();
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error.code).toBe(ERROR_CODES.VERSION_CONFLICT);
      // Nothing retired, nothing asked again.
      const rows = await propagationsOf(opportunity.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.dismissedAt ?? null).toBeNull();
    });

    it('does not retry for an Order that no longer follows — following switched off, or the link gone', async () => {
      const followingOff = await refusedAtLost();
      const path = `/opportunities/${followingOff.opportunity.id}/links/${followingOff.linkId}`;
      expect((await call('PATCH', path, { syncStatus: false })).statusCode).toBe(200);
      const first = await followingOff.retry();
      expect(first.statusCode, first.body).toBe(409);
      expect(await propagationsOf(followingOff.opportunity.id)).toHaveLength(1);

      const unlinked = await refusedAtLost();
      expect(
        (await call('DELETE', `/opportunities/${unlinked.opportunity.id}/links/${unlinked.linkId}`)).statusCode,
      ).toBe(204);
      const second = await unlinked.retry();
      expect(second.statusCode, second.body).toBe(409);
      expect(await propagationsOf(unlinked.opportunity.id)).toHaveLength(1);
    });

    it('dismisses an outcome once: the second dismissal is 409 and writes no second audit entry', async () => {
      const { opportunity, dismiss } = await refusedAtLost();
      const first = await dismiss();
      expect(first.statusCode, first.body).toBeLessThan(300);
      expect((await detail(opportunity.id)).unresolvedPropagations).toEqual([]);
      const dismissedAt = (await propagationsOf(opportunity.id))[0]?.dismissedAt?.getTime();
      expect(dismissedAt).toEqual(expect.any(Number));

      const second = await dismiss();
      expect(second.statusCode, second.body).toBe(409);
      expect(second.json().error.code).toBe(ERROR_CODES.VERSION_CONFLICT);
      expect((await propagationsOf(opportunity.id))[0]?.dismissedAt?.getTime()).toBe(dismissedAt);
      const audit = await h.auditLogService.query({
        action: 'crm.opportunity.propagation_dismiss',
        objectId: opportunity.id,
      });
      expect(audit).toHaveLength(1);
    });

    it('shows a pending outcome nobody finished as unresolved, and one being asked right now as not', async () => {
      const opportunity = await createCrmOpportunity(h);
      const [stale, fresh] = [await seedCrmOrder(h.em()), await seedCrmOrder(h.em())];
      const row = { opportunityId: opportunity.id, opportunityStatusCode: 'new', orderStatusCode: 'paid' };
      const staleId = await seedForwardRow(
        { ...row, orderId: stale.id },
        { outcome: 'pending', createdAt: new Date(Date.now() - 5 * 60_000) },
      );
      await seedForwardRow({ ...row, orderId: fresh.id }, { outcome: 'pending' });

      const unresolved = (await detail(opportunity.id)).unresolvedPropagations;
      // Shown as the failure it is: `pending` is not an outcome anybody is shown.
      expect(unresolved.map((outcome) => [outcome.id, outcome.outcome])).toEqual([[staleId, 'failed']]);
    });
  });

  describe('the echo of CRM’s own request to an Order', () => {
    /** An Opportunity in `new`, its following Order, and a reverse mapping `to` → qualified. */
    const following = async (orderStatuses: readonly string[]) => {
      expect(
        (
          await setCrmMappings(
            h,
            orderStatuses.map((orderStatusCode) => ({
              direction: 'order_to_opportunity' as const,
              orderStatusCode,
              opportunityStatusCode: 'qualified',
            })),
          )
        ).statusCode,
      ).toBe(200);
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      // CRM asked this Order for `paid` and has not seen the Order say so yet.
      const asked = await seedForwardRow({
        opportunityId: opportunity.id,
        orderId: order.id,
        opportunityStatusCode: 'new',
        orderStatusCode: 'paid',
      });
      const echoed = async () =>
        (await h.em().findOneOrFail(CrmStatusPropagation, { id: asked }, { filters: false })).echoed;
      return { opportunity, order, echoed };
    };

    afterAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
    });

    it('is only the status the Order was asked for: any other status is the Order’s own change', async () => {
      const { opportunity, order, echoed } = await following(['paid', 'completed']);
      await announceOrderStatus({ orderId: order.id, organizationId: TEST_ORGANIZATION_ID, to: 'completed' });
      expect((await detail(opportunity.id)).status.code).toBe('qualified');
      expect(await echoed()).toBe(false);
    });

    it('is consumed once: the same status a second time is the Order’s own change', async () => {
      const { opportunity, order, echoed } = await following(['paid']);
      await announceOrderStatus({ orderId: order.id, organizationId: TEST_ORGANIZATION_ID, to: 'paid' });
      expect((await detail(opportunity.id)).status.code).toBe('new');
      expect(await echoed()).toBe(true);

      await announceOrderStatus({ orderId: order.id, organizationId: TEST_ORGANIZATION_ID, to: 'paid' });
      expect((await detail(opportunity.id)).status.code).toBe('qualified');
    });
  });
});
