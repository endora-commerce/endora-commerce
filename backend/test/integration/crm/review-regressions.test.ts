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

  describe('finding 9 — an If-Match that cannot be read is refused, not taken for "no precondition"', () => {
    it.each(['"stale-garbage"', '"1abc"', 'W/"1"', '"1", "2"', '1.5', '""'])('answers 400 for %s and writes nothing', async (header) => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA, title: 'As it was' });
      const response = await call(
        'PATCH',
        `/opportunities/${opportunity.id}`,
        CRM_ADMIN,
        { title: 'Overwritten' },
        { 'if-match': header },
      );
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      const read = await call('GET', `/opportunities/${opportunity.id}`);
      expect((read.json() as { data: { title: string; version: number } }).data).toMatchObject({
        title: 'As it was',
        version: opportunity.version,
      });
    });

    it('still takes the version quoted or bare, refuses a stale one with 409, and takes none at all', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      const patch = (title: string, header?: string) =>
        call('PATCH', `/opportunities/${opportunity.id}`, CRM_ADMIN, { title }, header ? { 'if-match': header } : undefined);
      const version = opportunity.version;
      expect((await patch('quoted', `"${version}"`)).statusCode).toBe(200);
      expect((await patch('bare', String(version + 1))).statusCode).toBe(200);
      const stale = await patch('stale', `"${version}"`);
      expect(stale.statusCode, stale.body).toBe(409);
      expect(stale.json().error.code).toBe(ERROR_CODES.VERSION_CONFLICT);
      expect((await patch('unconditional')).statusCode).toBe(200);
    });
  });

  describe('finding 10 — the tag filter is the database’s work, not a list of ids', () => {
    const BULK = 3000;

    it('names no Opportunity id in a statement, however many Opportunities out of reach carry the tag', async () => {
      const conn = h.em().getConnection();
      const tagged = async (name: string) => {
        const created = await call('POST', '/tags', CRM_ADMIN, { name: `${name}-${randomUUID().slice(0, 8)}` });
        expect(created.statusCode, created.body).toBe(201);
        return (created.json() as { data: { id: string } }).data.id;
      };
      const [both, second] = [await tagged('review-bulk'), await tagged('review-second')];
      // B's, by the thousand, all carrying the first tag — none of them the rep's to see.
      await conn.execute(
        `insert into "crm_opportunities"
           ("id", "number", "title", "organization_id", "status_code", "currency", "created_at", "updated_at")
         select gen_random_uuid(), 'RVW-' || g, 'bulk ' || g, ?, 'new', 'PLN', now(), now()
           from generate_series(1, ${BULK}) g`,
        [organizationB],
      );
      await conn.execute(
        `insert into "crm_opportunity_tags" ("opportunity_id", "tag_id", "created_at")
         select o."id", ?, now() from "crm_opportunities" o where o."number" like 'RVW-%'`,
        [both],
      );
      const logger = h.em().config.getLogger() as unknown as { logQuery: (context: unknown) => void };
      const original = logger.logQuery;
      try {
        const mine = await createCrmOpportunity(h, { organizationId: organizationA, tagIds: [both, second] });
        await createCrmOpportunity(h, { organizationId: organizationA, tagIds: [second] });

        let widest = 0;
        logger.logQuery = (context: unknown): void => {
          widest = Math.max(widest, (context as { params?: unknown[] }).params?.length ?? 0);
          original.call(logger, context);
        };
        const list = await call('GET', `/opportunities?tagId=${both}`, rep.cookies);
        const pair = await call('GET', `/opportunities?tagId=${both}&tagId=${second}`, rep.cookies);
        const board = await call('GET', `/board?tagId=${both}&tagId=${second}`, rep.cookies);
        const everyone = await call('GET', `/opportunities?tagId=${both}&limit=1`, CRM_ADMIN);
        logger.logQuery = original;

        for (const response of [list, pair]) {
          expect(response.statusCode, response.body).toBe(200);
          expect((response.json() as { data: Array<{ id: string }> }).data.map((row) => row.id)).toEqual([mine.id]);
        }
        expect(board.statusCode, board.body).toBe(200);
        const columns = (board.json() as { data: { columns: Array<{ count: number; items: Array<{ id: string }> }> } })
          .data.columns;
        expect(columns.reduce((sum, column) => sum + column.count, 0)).toBe(1);
        expect(columns.flatMap((column) => column.items.map((item) => item.id))).toEqual([mine.id]);
        // The control: the tagged thousands are there for somebody who reaches them.
        expect((everyone.json() as { pagination: { hasMore: boolean } }).pagination.hasMore).toBe(true);
        // A statement carries the tags asked for and the caller's reach — never
        // one parameter per Opportunity that carries the tag.
        expect(widest).toBeGreaterThan(0);
        expect(widest).toBeLessThan(100);
      } finally {
        logger.logQuery = original;
        await conn.execute(`delete from "crm_opportunities" where "number" like 'RVW-%'`);
        await conn.execute(`delete from "crm_tags" where "id" in (?, ?)`, [both, second]);
      }
    }, 120_000);
  });

  describe('finding 12 — a bell that cannot be written does not undo what was committed', () => {
    type RecordPort = { record: (input: unknown) => Promise<unknown> };
    /** `admin_notifications`' port answering with a failure for as long as `work` runs. */
    const withTheBellFailing = async <T>(work: () => Promise<T>): Promise<{ result: T; asked: number }> => {
      const port = h.container.resolve<RecordPort>('adminNotificationRecordPort');
      const original = port.record;
      let asked = 0;
      port.record = async () => {
        asked += 1;
        throw new Error('bell store unavailable');
      };
      try {
        return { result: await work(), asked };
      } finally {
        port.record = original;
      }
    };
    const assigneeOf = async (opportunityId: string) =>
      ((await call('GET', `/opportunities/${opportunityId}`)).json() as { data: { assignee: { id: string } | null } })
        .data.assignee?.id ?? null;

    it('answers the assignment it made — on assign, on create and on PATCH', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: null });

      const assigned = await withTheBellFailing(() =>
        call('POST', `/opportunities/${opportunity.id}/assign`, CRM_ADMIN, { adminUserId: crmOnly.adminUserId }),
      );
      expect(assigned.asked, 'the control: the bell was asked, and failed').toBe(1);
      expect(assigned.result.statusCode, assigned.result.body).toBe(200);
      expect(await assigneeOf(opportunity.id)).toBe(crmOnly.adminUserId);

      const created = await withTheBellFailing(() =>
        call('POST', '/opportunities', CRM_ADMIN, {
          title: 'Created with the bell down',
          organizationId: organizationA,
          currency: 'PLN',
          assignedAdminUserId: crmOnly.adminUserId,
        }),
      );
      expect(created.asked).toBe(1);
      expect(created.result.statusCode, created.result.body).toBe(201);

      const patched = await withTheBellFailing(() =>
        call('PATCH', `/opportunities/${opportunity.id}`, CRM_ADMIN, { assignedAdminUserId: rep.adminUserId }),
      );
      expect(patched.asked).toBe(1);
      expect(patched.result.statusCode, patched.result.body).toBe(200);
      expect(await assigneeOf(opportunity.id)).toBe(rep.adminUserId);
    });

    it('answers the message it stored', async () => {
      const opportunity = await createCrmOpportunity(h, {
        organizationId: organizationA,
        assignedAdminUserId: crmOnly.adminUserId,
      });
      const posted = await withTheBellFailing(() =>
        call('POST', `/opportunities/${opportunity.id}/comments`, CRM_ADMIN, { kind: 'message', body: 'Still here' }),
      );
      expect(posted.asked).toBe(1);
      expect(posted.result.statusCode, posted.result.body).toBe(201);
      const listed = await call('GET', `/opportunities/${opportunity.id}/comments?kind=message`);
      expect(listed.body).toContain('Still here');
    });
  });

  describe('finding 12 — no Opportunity is left in a status that was deleted or re-defined under it', () => {
    let races = 0;

    /** A transaction of the test's own, holding whatever `statements` lock until `release`. */
    const holding = async (statements: ReadonlyArray<readonly [string, unknown[]]>) => {
      const em = h.em().fork();
      await em.begin();
      for (const [sql, params] of statements) {
        await em.getConnection().execute(sql, params, 'run', em.getTransactionContext());
      }
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          await em.commit();
        },
      };
    };
    /** Whether `pending` is still waiting after a moment — it is blocked, not slow. */
    const stillWaiting = async (pending: Promise<unknown>) =>
      Promise.race([
        pending.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 400)),
      ]);
    const statusRow = async (opportunityId: string) =>
      (
        (await h
          .em()
          .getConnection()
          .execute(`select "status_code", "closed_kind" from "crm_opportunities" where "id" = ?`, [
            opportunityId,
          ])) as Array<{ status_code: string; closed_kind: string | null }>
      )[0];
    /** Whether the Opportunity is in a status the workflow no longer has. */
    const stranded = async (opportunityId: string) => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(
          `select o."id" from "crm_opportunities" o
            where o."id" = ?
              and not exists (select 1 from "crm_opportunity_statuses" s where s."code" = o."status_code")`,
          [opportunityId],
        )) as unknown[];
      return rows.length > 0;
    };

    /** A status of this case's own — whatever an earlier case left behind is in another. */
    const withRaceStatus = async (): Promise<string> => {
      await restoreDefaultCrmWorkflow(h.em());
      races += 1;
      const RACE = `review_race_${races}`;
      const created = await call('POST', '/statuses', CRM_ADMIN, { code: RACE, defaultName: 'Race', kind: 'open' });
      expect(created.statusCode, created.body).toBe(201);
      const edges = await call('PUT', '/transitions', CRM_ADMIN, {
        add: [
          { fromStatusCode: 'new', toStatusCode: RACE },
          { fromStatusCode: RACE, toStatusCode: 'lost' },
        ],
      });
      expect(edges.statusCode, edges.body).toBe(200);
      return RACE;
    };

    afterAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
    });

    it('a transition that read the workflow before its target was deleted does not write it', async () => {
      const RACE = await withRaceStatus();
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      // The transition has read the workflow and waits for the Opportunity's row…
      const row = await holding([[`select 1 from "crm_opportunities" where "id" = ? for update`, [opportunity.id]]]);
      try {
        const moving = transitionCrmOpportunity(h, opportunity.id, RACE);
        expect(await stillWaiting(moving)).toBe(true);
        // …while the status it is heading for is deleted: nothing is in it yet.
        const deleted = await call('DELETE', `/statuses/${RACE}`);
        expect(deleted.statusCode, deleted.body).toBe(204);
        await row.release();

        const moved = await moving;
        expect(moved.statusCode, moved.body).toBe(422);
        expect(await statusRow(opportunity.id)).toMatchObject({ status_code: 'new' });
        expect(await stranded(opportunity.id)).toBe(false);
      } finally {
        await row.release();
      }
    });

    it('a transition that read what its target means before that changed closes the Opportunity as it means now', async () => {
      const RACE = await withRaceStatus();
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      const row = await holding([[`select 1 from "crm_opportunities" where "id" = ? for update`, [opportunity.id]]]);
      try {
        const moving = transitionCrmOpportunity(h, opportunity.id, RACE);
        expect(await stillWaiting(moving)).toBe(true);
        const redefined = await call('PATCH', `/statuses/${RACE}`, CRM_ADMIN, { kind: 'lost' });
        expect(redefined.statusCode, redefined.body).toBe(200);
        await row.release();

        const moved = await moving;
        expect(moved.statusCode, moved.body).toBe(200);
        expect(await statusRow(opportunity.id)).toEqual({ status_code: RACE, closed_kind: 'lost' });
      } finally {
        await row.release();
      }
    });

    it.each([
      ['deleting the status', 'DELETE', undefined],
      ['changing what it means', 'PATCH', { kind: 'lost' }],
    ] as const)('%s waits for a transition into it that has not committed, then finds it in use', async (_label, method, payload) => {
      const RACE = await withRaceStatus();
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      // A transition in flight, as the transition Command leaves the rows before it commits.
      const inFlight = await holding([
        [`select 1 from "crm_opportunities" where "id" = ? for update`, [opportunity.id]],
        [`select 1 from "crm_opportunity_statuses" where "code" = ? for share`, [RACE]],
        [`update "crm_opportunities" set "status_code" = ? where "id" = ?`, [RACE, opportunity.id]],
      ]);
      try {
        const configuring = call(method, `/statuses/${RACE}`, CRM_ADMIN, payload);
        expect(await stillWaiting(configuring)).toBe(true);
        await inFlight.release();

        const refused = await configuring;
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json().error.code).toBe(ERROR_CODES.CRM_STATUS_IN_USE);
        expect(await stranded(opportunity.id)).toBe(false);
        const workflow = (await call('GET', '/workflow')).json() as {
          data: { statuses: Array<{ code: string; kind: string }> };
        };
        expect(workflow.data.statuses.find((status) => status.code === RACE)?.kind).toBe('open');
      } finally {
        await inFlight.release();
      }
    });

    it('a creation that read the start status before it was removed does not write it', async () => {
      await withRaceStatus();
      // Somebody is removing the start status and has not committed: the creation
      // still reads it as the start.
      const removing = await holding([[`delete from "crm_opportunity_statuses" where "code" = ?`, ['new']]]);
      try {
        const creating = call('POST', '/opportunities', CRM_ADMIN, {
          title: 'Created under a vanishing start status',
          organizationId: organizationA,
          currency: 'PLN',
        });
        expect(await stillWaiting(creating)).toBe(true);
        await removing.release();

        const refused = await creating;
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json().error.code).toBe(ERROR_CODES.VERSION_CONFLICT);
        const left = (await h
          .em()
          .getConnection()
          .execute(`select count(*)::int as n from "crm_opportunities" where "title" = ?`, [
            'Created under a vanishing start status',
          ])) as Array<{ n: number }>;
        expect(left[0]?.n).toBe(0);
      } finally {
        await removing.release();
        // Opportunities of earlier cases are in `new`; give the status back before anything reads them.
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
