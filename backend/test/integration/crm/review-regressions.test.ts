import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type OpportunityTransitionGuardRegistryPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminNotification, Asset, CrmStatusPropagation, Order } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  changeOrderStatusAsOperator,
  createCrmOpportunity,
  linkCrmOrder,
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
  setCrmForwardMappings,
  setCrmMappings,
  transitionCrmOpportunity,
  unassignCrmSalesRep,
} from '../../helpers/seed-crm.js';
import { TINY_PNG, uploadCrmAttachment, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';

/**
 * The scenarios an independent review of the module broke it with
 * (`specs/143-crm-sales-opportunities/research.md` N-R1 … N-R12), each kept as
 * the request sequence that showed the defect. A scenario whose first step is
 * now refused asserts the refusal *and* what the rest of it was after.
 */
describe('crm review regressions', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;
  type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** Confined to A. */
  let rep: Seeded;
  /** Reaches every Organization, holds the two CRM permissions and nothing of `orders`. */
  let crmOnly: Seeded;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    path: string,
    cookies: Record<string, string> = CRM_ADMIN,
    payload?: unknown,
    headers?: Record<string, string>,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(headers ? { headers } : {}),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const detail = async (opportunityId: string) =>
    (
      (await call('GET', `/opportunities/${opportunityId}`)).json() as {
        data: { status: { code: string }; closedKind: string | null; unresolvedPropagations: unknown[] };
      }
    ).data;

  const orderStatus = async (orderId: string) =>
    (await h.em().findOneOrFail(Order, { id: orderId }, { filters: false })).status;

  const bellOf = async (adminUserId: string) =>
    (await h.em().find(AdminNotification, { targetAdminUserId: adminUserId }, { filters: false })).map((row) => ({
      title: row.title,
      body: row.body,
    }));

  const guards = () =>
    h.container.resolve<OpportunityTransitionGuardRegistryPort>('opportunityTransitionGuardRegistry');

  /**
   * Announce an Order status change and wait until every subscriber has
   * finished: the bus awaits its handlers in turn, and this one is the last.
   */
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

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'Review A');
    organizationB = await seedCrmOrganization(h.em(), 'Review B');
    rep = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'crm:write']);
    crmOnly = await seedCrmAdmin(h.em(), 'review-crm-only', ['crm:read', 'crm:write']);
  });

  afterAll(async () => {
    rep.undo();
    crmOnly.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('finding 1 — an attachment is never served back as a page', () => {
    it('refuses an HTML page uploaded by a crm:write holder and stores nothing; a real file is handed out as a download', async () => {
      const store = await useTemporaryAssetStore(h);
      const uploaded: string[] = [];
      try {
        const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
        const name = `review-${randomUUID().slice(0, 8)}.html`;
        const refused = await uploadCrmAttachment(
          h,
          opportunity.id,
          {
            filename: name,
            mime: 'text/html',
            value: Buffer.from('<!doctype html><script>fetch("/api/v1/admin/crm/opportunities")</script>'),
          },
          rep.cookies,
        );
        expect(refused.statusCode, refused.body).toBe(415);
        expect(refused.json().error.code).toBe(ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);
        expect(await h.em().count(Asset, { filename: name }, { filters: false })).toBe(0);

        const accepted = await uploadCrmAttachment(
          h,
          opportunity.id,
          { filename: 'photo.png', mime: 'image/png', value: TINY_PNG },
          rep.cookies,
        );
        expect(accepted.statusCode, accepted.body).toBe(201);
        const attachment = (accepted.json() as { data: { assetId: string; url: string | null } }).data;
        uploaded.push(attachment.assetId);
        // What the Admin UI opens for whoever clicks the attachment.
        const link = new URL(attachment.url ?? '', 'http://localhost');
        const served = await h.app.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
        expect(served.statusCode, served.body).toBe(200);
        expect(String(served.headers['content-disposition'])).toMatch(/^attachment;/);
      } finally {
        await removeCrmAssets(h.em(), uploaded);
        await store.undo();
      }
    });

    it('refuses a file whose name and declared type are innocent and whose content the library reads as XML — and takes it back', async () => {
      const store = await useTemporaryAssetStore(h);
      try {
        const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
        const name = `review-${randomUUID().slice(0, 8)}.txt`;
        const refused = await uploadCrmAttachment(
          h,
          opportunity.id,
          {
            filename: name,
            mime: 'text/plain',
            value: Buffer.from(
              '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            ),
          },
          rep.cookies,
        );
        expect(refused.statusCode, refused.body).toBe(415);
        // Nothing attached, and nothing left live in the library under that name.
        const listed = await call('GET', `/opportunities/${opportunity.id}/attachments`);
        expect((listed.json() as { data: unknown[] }).data).toEqual([]);
        const left = await h.em().find(Asset, { filename: name }, { filters: false });
        expect(left.filter((asset) => !asset.deletedAt)).toEqual([]);
        await removeCrmAssets(
          h.em(),
          left.map((asset) => asset.id),
        );
      } finally {
        await store.undo();
      }
    });
  });

  describe('finding 2 — a bell entry says nothing of an Opportunity its reader cannot open', () => {
    it('does not let an Opportunity be assigned to somebody who cannot reach its Organization', async () => {
      const secret = await createCrmOpportunity(h, {
        title: 'SECRET-TITLE takeover of Acme',
        organizationId: organizationB,
        assignedAdminUserId: null,
      });
      expect((await call('GET', `/opportunities/${secret.id}`, rep.cookies)).statusCode).toBe(404);
      const assigned = await call('POST', `/opportunities/${secret.id}/assign`, CRM_ADMIN, {
        adminUserId: rep.adminUserId,
      });
      expect(assigned.statusCode, assigned.body).toBe(422);
      expect(assigned.json().error.code).toBe(ERROR_CODES.CRM_ASSIGNEE_INVALID);
      expect(JSON.stringify(await bellOf(rep.adminUserId))).not.toContain('SECRET');
    });

    it('names the Opportunity by number only, and stops telling an assignee who lost reach', async () => {
      const wide = await seedCrmSalesRep(h.em(), [organizationA, organizationB], ['crm:read', 'crm:write']);
      try {
        const secret = await createCrmOpportunity(h, {
          title: 'SECRET-TITLE takeover of Acme',
          organizationId: organizationB,
          assignedAdminUserId: null,
        });
        const assigned = await call('POST', `/opportunities/${secret.id}/assign`, CRM_ADMIN, {
          adminUserId: wide.adminUserId,
        });
        expect(assigned.statusCode, assigned.body).toBe(200);
        const first = await call('POST', `/opportunities/${secret.id}/comments`, CRM_ADMIN, {
          kind: 'message',
          body: 'SECRET-BODY margin is 42 percent',
        });
        expect(first.statusCode, first.body).toBe(201);
        const whileInReach = await bellOf(wide.adminUserId);
        expect(whileInReach).toHaveLength(2);
        expect(JSON.stringify(whileInReach)).toContain(secret.number);
        expect(JSON.stringify(whileInReach)).not.toContain('SECRET');

        await unassignCrmSalesRep(h.em(), organizationB, wide.adminUserId);
        expect((await call('GET', `/opportunities/${secret.id}`, wide.cookies)).statusCode).toBe(404);
        const second = await call('POST', `/opportunities/${secret.id}/comments`, CRM_ADMIN, {
          kind: 'message',
          body: 'SECRET-BODY the second one',
        });
        expect(second.statusCode, second.body).toBe(201);
        expect(await bellOf(wide.adminUserId)).toHaveLength(2);
      } finally {
        wide.undo();
      }
    });
  });

  describe('finding 3 — crm:write alone does not choose which Orders follow', () => {
    it('refuses the link, so the transition that would have moved the Order moves nothing', async () => {
      expect((await setCrmForwardMappings(h, { qualified: 'paid' })).statusCode).toBe(200);
      try {
        const order = await seedCrmOrder(h.em(), { organizationId: organizationA });
        // The control: `orders` refuses this caller a status change of its own.
        const direct = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/orders/bulk/status',
          cookies: crmOnly.cookies,
          payload: { orderIds: [order.id], toStatusCode: 'paid' },
        });
        expect(direct.statusCode, direct.body).toBe(403);

        const opportunity = await createCrmOpportunity(h, { organizationId: organizationA }, crmOnly.cookies);
        const linked = await linkCrmOrder(h, opportunity.id, order.id, { cookies: crmOnly.cookies });
        expect(linked.statusCode, linked.body).toBe(403);
        const moved = await transitionCrmOpportunity(h, opportunity.id, 'qualified', crmOnly.cookies);
        expect(moved.statusCode, moved.body).toBe(200);
        expect((moved.json() as { data: { propagation: unknown[] } }).data.propagation).toEqual([]);
        expect(await orderStatus(order.id)).toBe('new');
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });
  });

  describe('finding 4 — an Order never reopens a closed Opportunity', () => {
    it('leaves an Opportunity closed while the Order event was being applied where it was closed', async () => {
      // qualified → new makes the mapped target reachable from the open status the
      // Opportunity is in when the event arrives; lost → new (seeded) from the
      // closed one it is moved to meanwhile.
      const edge = await call('PUT', '/transitions', CRM_ADMIN, {
        add: [{ fromStatusCode: 'qualified', toStatusCode: 'new' }],
      });
      expect(edge.statusCode, edge.body).toBe(200);
      expect(
        (
          await setCrmMappings(h, [
            { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'new' },
          ])
        ).statusCode,
      ).toBe(200);
      try {
        const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
        expect((await transitionCrmOpportunity(h, opportunity.id, 'qualified')).statusCode).toBe(200);
        const order = await seedCrmOrder(h.em(), { organizationId: organizationA });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

        // The interleaving a second request would produce, made deterministic:
        // between the Order-caused move's read and its locked write, somebody
        // closes the Opportunity.
        let closed: number | null = null;
        guards().register({
          ownerModuleId: 'crm',
          match: { from: 'qualified', to: 'new' },
          guard: async (event) => {
            if (closed !== null || event.opportunityId !== opportunity.id) return;
            closed = 0;
            closed = (await transitionCrmOpportunity(h, opportunity.id, 'lost')).statusCode;
          },
        });
        await changeOrderStatusAsOperator(h, order.id, 'paid');

        expect(closed).toBe(200);
        expect(await detail(opportunity.id)).toMatchObject({ status: { code: 'lost' }, closedKind: 'lost' });
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });
  });

  describe('finding 5 — an Order-caused move that fails says so on the Opportunity', () => {
    it('records a failed outcome when a guard throws something that is not a veto', async () => {
      expect(
        (
          await setCrmMappings(h, [
            { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified' },
          ])
        ).statusCode,
      ).toBe(200);
      let active = true;
      try {
        const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
        const order = await seedCrmOrder(h.em(), { organizationId: organizationA });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
        guards().register({
          ownerModuleId: 'crm',
          match: { from: 'new', to: 'qualified' },
          guard: (event) => {
            if (!active || event.opportunityId !== opportunity.id) return;
            throw new Error('guard dependency unavailable');
          },
        });
        await changeOrderStatusAsOperator(h, order.id, 'paid');

        expect(await orderStatus(order.id)).toBe('paid');
        expect((await detail(opportunity.id)).status.code).toBe('new');
        const rows = await h.em().find(CrmStatusPropagation, { opportunityId: opportunity.id }, { filters: false });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          direction: 'order_to_opportunity',
          outcome: 'failed',
          detail: 'guard dependency unavailable',
        });
      } finally {
        active = false;
        await restoreDefaultCrmWorkflow(h.em());
      }
    });
  });

  describe('finding 6 — the audit trail is not a second copy of the conversation', () => {
    const asAuditor = async (opportunityId: string, cookies: Record<string, string>) =>
      h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/audit-log?filter[objectType]=crm_opportunity&filter[objectId]=${opportunityId}`,
        cookies,
      });

    it('keeps a note’s text out of what an auditor confined to another Organization reads', async () => {
      const auditor = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'audit_log:read']);
      try {
        const secret = await createCrmOpportunity(h, { organizationId: organizationB });
        const note = await call('POST', `/opportunities/${secret.id}/comments`, CRM_ADMIN, {
          kind: 'note',
          body: 'AUDIT-SECRET-NOTE the customer is insolvent',
        });
        expect(note.statusCode, note.body).toBe(201);
        expect((await call('GET', `/opportunities/${secret.id}`, auditor.cookies)).statusCode).toBe(404);

        const audit = await asAuditor(secret.id, auditor.cookies);
        expect(audit.statusCode, audit.body).toBe(200);
        // The control: the entry is there to be read.
        expect(audit.body).toContain('crm.opportunity.note_add');
        expect(audit.body).not.toContain('AUDIT-SECRET-NOTE');
      } finally {
        auditor.undo();
      }
    });

    // Open, and not CRM's to close: `audit_logs` answers every entry to anybody
    // holding `audit_log:read`, and the Opportunity's own audited state — which
    // its change history is read from — carries the title (research N-R6).
    it.fails('keeps the Opportunity’s title from that auditor too', async () => {
      const auditor = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'audit_log:read']);
      try {
        const secret = await createCrmOpportunity(h, { title: 'AUDIT-SECRET-TITLE', organizationId: organizationB });
        const audit = await asAuditor(secret.id, auditor.cookies);
        expect(audit.body).not.toContain('AUDIT-SECRET-TITLE');
      } finally {
        auditor.undo();
      }
    });
  });

  describe('finding 8 — one refused outcome is retried once', () => {
    it('asks the Order once more, not twice, for two simultaneous retries', async () => {
      expect((await setCrmForwardMappings(h, { lost: 'completed' })).statusCode).toBe(200);
      try {
        const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
        const order = await seedCrmOrder(h.em(), { organizationId: organizationA });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
        const moved = await transitionCrmOpportunity(h, opportunity.id, 'lost');
        expect(moved.statusCode, moved.body).toBe(200);
        const refusal = (moved.json() as { data: { propagation: Array<{ id: string; outcome: string }> } }).data
          .propagation[0]!;
        expect(refusal.outcome).toBe('not_permitted');

        const path = `/opportunities/${opportunity.id}/propagations/${refusal.id}/retry`;
        const answers = await Promise.all([call('POST', path), call('POST', path)]);
        expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409]);
        const rows = await h.em().find(CrmStatusPropagation, { opportunityId: opportunity.id }, { filters: false });
        expect(rows).toHaveLength(2);
        expect((await detail(opportunity.id)).unresolvedPropagations).toHaveLength(1);
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });
  });

  describe('reach, where no test held it', () => {
    it('answers no contact for an Organization out of the caller’s reach', async () => {
      const response = await call('GET', `/lookups/contacts?organizationId=${organizationB}`, rep.cookies);
      expect(response.statusCode, response.body).toBe(200);
      expect((response.json() as { data: unknown[] }).data).toEqual([]);
    });

    it('moves nothing for an Order event naming another Organization than the Opportunity’s', async () => {
      expect(
        (
          await setCrmMappings(h, [
            { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified' },
          ])
        ).statusCode,
      ).toBe(200);
      try {
        const opportunity = await createCrmOpportunity(h, { organizationId: organizationB });
        const order = await seedCrmOrder(h.em(), { organizationId: organizationB });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

        await announceOrderStatus({ orderId: order.id, organizationId: organizationA, to: 'paid' });
        expect((await detail(opportunity.id)).status.code).toBe('new');
        // The control: the same event naming the Opportunity's own Organization moves it.
        await announceOrderStatus({ orderId: order.id, organizationId: organizationB, to: 'paid' });
        expect((await detail(opportunity.id)).status.code).toBe('qualified');
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });
  });
});
